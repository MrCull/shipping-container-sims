// ---------------------------------------------------------------------------
// Box Empire — Sim-specific Three.js scene setup
// ---------------------------------------------------------------------------

import { onBeforeUnmount, ref, nextTick, watch, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGameStore } from '../store/gameStore'
import { buildScene } from '../modules/sceneBuilder'
import { animateOcean } from '../modules/oceanAnimation'
import { ContainerRenderer } from '../modules/containerRenderer'
import { EquipmentRenderer } from '../modules/equipmentRenderer'
import { VesselRenderer } from '../modules/vesselRenderer'
import { TruckRenderer } from '../modules/truckRenderer'
import { FloatingTextRenderer } from '../modules/floatingTextRenderer'
import { loadModel } from '../modules/modelLoader'
import { TRUCK_GLB_URL } from '../modules/truckRenderer'
import { VESSEL_GLB_URL } from '../modules/vesselRenderer'

export interface GameSceneRefs {
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  getRenderer: () => THREE.WebGLRenderer | null
  isReady: Ref<boolean>
  webglFailed: Ref<boolean>
  render: () => void
  updateEntities: () => void
  spawnFloatingText: (text: string, color: string, worldPos: { x: number; y: number; z: number }) => void
  getContainerIdAtInstance: () => string | null
  getContainerMesh: () => THREE.InstancedMesh | null
  getContainerIdNearScreen: (clickX: number, clickY: number, canvasW: number, canvasH: number) => string | null
  triggerVesselShake: (vesselId: string) => void
}

export function useBoxEmpireScene(canvasRef: Ref<HTMLCanvasElement | null>): GameSceneRefs {
  let renderer: THREE.WebGLRenderer | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  let containerRenderer: ContainerRenderer | null = null
  let equipmentRenderer: EquipmentRenderer | null = null
  let vesselRenderer: VesselRenderer | null = null
  let truckRenderer: TruckRenderer | null = null
  let floatingTextRenderer: FloatingTextRenderer | null = null

  const isReady = ref(false)
  const webglFailed = ref(false)
  const store = useGameStore()

  function init(canvas: HTMLCanvasElement): void {
    try {
      const testCanvas = document.createElement('canvas')
      const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl')
      if (!gl) {
        console.warn('Box Empire: WebGL not available in this environment')
        webglFailed.value = true
        return
      }
    } catch {
      console.warn('Box Empire: WebGL check failed')
      webglFailed.value = true
      return
    }

    try {
      scene = new THREE.Scene()

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        failIfMajorPerformanceCaveat: false,
      })

      const w = window.innerWidth
      const h = window.innerHeight

      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
      renderer.outputColorSpace = THREE.SRGBColorSpace

      camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 800)
      camera.position.set(30, 45, 60)
      camera.lookAt(0, 0, 15)

      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.06
      controls.minDistance = 15
      controls.maxDistance = 180
      controls.maxPolarAngle = Math.PI / 2.05
      controls.screenSpacePanning = false
      controls.target.set(0, 0, 15)
      controls.update()

      buildScene(scene)

      containerRenderer = new ContainerRenderer(scene)
      equipmentRenderer = new EquipmentRenderer(scene)
      vesselRenderer = new VesselRenderer(scene)
      truckRenderer = new TruckRenderer(scene)
      floatingTextRenderer = new FloatingTextRenderer(scene)

      // Pre-warm GLB assets so they are cached before trucks/vessels appear
      loadModel(TRUCK_GLB_URL).catch(e => console.warn('Box Empire: truck GLB pre-warm failed', e))
      loadModel(VESSEL_GLB_URL).catch(e => console.warn('Box Empire: vessel GLB pre-warm failed', e))

      window.addEventListener('resize', onResize)
      isReady.value = true
    } catch (e) {
      console.warn('Box Empire: Scene init failed, running in UI-only mode:', e)
      webglFailed.value = true
    }
  }

  watch(canvasRef, async (canvas) => {
    if (canvas && !isReady.value && !webglFailed.value) {
      await nextTick()
      init(canvas)
    }
  }, { immediate: true })

  function onResize(): void {
    if (!camera || !renderer) return
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  function render(): void {
    if (!renderer || !scene || !camera) return
    controls?.update()
    floatingTextRenderer?.update()
    animateOcean(performance.now() / 1000)
    renderer.render(scene, camera)
  }

  function updateEntities(): void {
    containerRenderer?.update(store.containers, store.truckVisits)
    equipmentRenderer?.update(store.equipment)
    vesselRenderer?.update(store.vesselVisits, store.containers, 0.016)
    truckRenderer?.update(store.truckVisits, store.containers)
  }

  function spawnFloatingText(text: string, color: string, worldPos: { x: number; y: number; z: number }): void {
    floatingTextRenderer?.spawn(text, color, worldPos)
  }

  function getContainerIdAtInstance(): string | null {
    return containerRenderer?.getContainerIdAtIndex() ?? null
  }

  function getContainerMesh(): THREE.InstancedMesh | null {
    return containerRenderer?.getMesh() ?? null
  }

  function getContainerIdNearScreen(
    clickX: number, clickY: number, canvasW: number, canvasH: number,
  ): string | null {
    if (!camera || !containerRenderer) return null
    return containerRenderer.getContainerIdNearScreen(clickX, clickY, canvasW, canvasH, camera)
  }

  function triggerVesselShake(vesselId: string): void {
    vesselRenderer?.triggerLoadShake(vesselId)
  }

  function dispose(): void {
    window.removeEventListener('resize', onResize)
    controls?.dispose()
    containerRenderer?.dispose()
    equipmentRenderer?.dispose()
    vesselRenderer?.dispose()
    truckRenderer?.dispose()
    floatingTextRenderer?.dispose()

    if (scene) {
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
          else mesh.material.dispose()
        }
      })
    }

    renderer?.dispose()
    renderer = null
    scene = null
    camera = null
    controls = null
    isReady.value = false
  }

  onBeforeUnmount(dispose)

  return {
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
    isReady,
    webglFailed,
    render,
    updateEntities,
    spawnFloatingText,
    getContainerIdAtInstance,
    getContainerMesh,
    getContainerIdNearScreen,
    triggerVesselShake,
  }
}

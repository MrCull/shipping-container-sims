// ---------------------------------------------------------------------------
// Box Empire — Sim-specific Three.js scene setup
// ---------------------------------------------------------------------------

import { onBeforeUnmount, ref, nextTick, watch, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGameStore } from '../store/gameStore'
import { buildScene } from '../modules/sceneBuilder'
import { ContainerRenderer } from '../modules/containerRenderer'
import { EquipmentRenderer } from '../modules/equipmentRenderer'
import { VesselRenderer } from '../modules/vesselRenderer'
import { TruckRenderer } from '../modules/truckRenderer'

export interface GameSceneRefs {
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  getRenderer: () => THREE.WebGLRenderer | null
  isReady: Ref<boolean>
  render: () => void
  updateEntities: () => void
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

  const isReady = ref(false)
  const store = useGameStore()

  function init(canvas: HTMLCanvasElement): void {
    try {
      scene = new THREE.Scene()

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
      })

      const w = window.innerWidth
      const h = window.innerHeight

      renderer.setSize(w, h)
      renderer.setPixelRatio(1)
      renderer.shadowMap.enabled = false
      renderer.toneMapping = THREE.NoToneMapping
      renderer.toneMappingExposure = 1
      renderer.outputColorSpace = THREE.SRGBColorSpace

      camera = new THREE.PerspectiveCamera(50, w / h, 0.5, 500)
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

      window.addEventListener('resize', onResize)
      isReady.value = true
    } catch (e) {
      console.error('Box Empire scene init failed:', e)
    }
  }

  watch(canvasRef, async (canvas) => {
    if (canvas && !isReady.value) {
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
    renderer.render(scene, camera)
  }

  function updateEntities(): void {
    containerRenderer?.update(store.containers)
    equipmentRenderer?.update(store.equipment)
    vesselRenderer?.update(store.vesselVisits)
    truckRenderer?.update(store.truckVisits)
  }

  function dispose(): void {
    window.removeEventListener('resize', onResize)
    controls?.dispose()
    containerRenderer?.dispose()
    equipmentRenderer?.dispose()
    vesselRenderer?.dispose()
    truckRenderer?.dispose()

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
    render,
    updateEntities,
  }
}

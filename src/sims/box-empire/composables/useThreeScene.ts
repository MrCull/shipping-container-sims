// ---------------------------------------------------------------------------
// Box Empire — Sim-specific Three.js scene setup
// ---------------------------------------------------------------------------

import { onBeforeUnmount, ref, nextTick, watch, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useGameStore } from '../store/gameStore'
import { buildScene } from '../modules/sceneBuilder'
import { animateOcean, animateFoam } from '../modules/oceanAnimation'
import { ContainerRenderer } from '../modules/containerRenderer'
import { EquipmentRenderer } from '../modules/equipmentRenderer'
import { VesselRenderer } from '../modules/vesselRenderer'
import { TruckRenderer } from '../modules/truckRenderer'
import { FloatingTextRenderer } from '../modules/floatingTextRenderer'
import { loadModel } from '../modules/modelLoader'
import { TRUCK_GLB_URL } from '../modules/truckRenderer'
import { VESSEL_GLB_URL } from '../modules/vesselRenderer'
import {
  BERTH_POSITION,
  CRANE_POSITION,
  GATE_INGATE_POSITION,
  GATE_OUTGATE_POSITION,
  GATE_OUTGATE_FENCE_Z,
  QUAY_BUFFER_DISCHARGE_POSITION,
  QUAY_BUFFER_LOAD_POSITION,
  YARD_BLOCK_POSITION,
  YARD_TRUCK_PARK_POSITION,
} from '../modules/config'
import type { CameraCueTarget } from '../types'
import type { GatehouseState, TruckVisit } from '../types'

const KEY_PAN_SPEED  = 20
const KEY_ZOOM_SPEED = 25
const CAMERA_CUE_DURATION = 1.35

interface CameraAnimation {
  startTime: number
  duration: number
  fromPosition: THREE.Vector3
  toPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
}

export interface GameSceneRefs {
  getScene: () => THREE.Scene | null
  getCamera: () => THREE.PerspectiveCamera | null
  getRenderer: () => THREE.WebGLRenderer | null
  isReady: Ref<boolean>
  webglFailed: Ref<boolean>
  render: () => void
  updateEntities: () => void
  applyKeyboardCamera: (dt: number) => void
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
  let activeCameraAnimation: CameraAnimation | null = null
  let ingateBarrier: THREE.Group | null = null
  let outgateBarrier: THREE.Group | null = null

  const isReady = ref(false)
  const webglFailed = ref(false)
  const store = useGameStore()

  // Keyboard camera state
  const keys = { left: false, right: false, up: false, down: false, zoomIn: false, zoomOut: false }
  const _spherical = new THREE.Spherical()
  const _offset = new THREE.Vector3()
  const _cameraTarget = new THREE.Vector3()
  const _cameraPosition = new THREE.Vector3()

  function easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  function getCameraCuePose(target: CameraCueTarget): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
    switch (target) {
      case 'vessel_approach':
        return {
          position: new THREE.Vector3(88, 34, 26),
          lookAt: new THREE.Vector3(BERTH_POSITION.x + 80, 2, BERTH_POSITION.z),
        }
      case 'berth':
        return {
          position: new THREE.Vector3(58, 36, 36),
          lookAt: new THREE.Vector3(BERTH_POSITION.x, 2, BERTH_POSITION.z),
        }
      case 'crane':
        return {
          position: new THREE.Vector3(34, 30, 30),
          lookAt: new THREE.Vector3(CRANE_POSITION.x, 10, CRANE_POSITION.z),
        }
      case 'gatehouse':
        return {
          position: new THREE.Vector3(-34, 30, 116),
          lookAt: new THREE.Vector3(GATE_INGATE_POSITION.x - 2, 2, GATE_INGATE_POSITION.z + 12),
        }
      case 'yard':
        return {
          position: new THREE.Vector3(38, 32, 62),
          lookAt: new THREE.Vector3(YARD_BLOCK_POSITION.x + 12, 4, YARD_BLOCK_POSITION.z),
        }
      case 'quay_discharge':
        return {
          position: new THREE.Vector3(34, 28, 34),
          lookAt: new THREE.Vector3(QUAY_BUFFER_DISCHARGE_POSITION.x, 3, QUAY_BUFFER_DISCHARGE_POSITION.z),
        }
      case 'quay_load':
        return {
          position: new THREE.Vector3(32, 28, 30),
          lookAt: new THREE.Vector3(QUAY_BUFFER_LOAD_POSITION.x, 3, QUAY_BUFFER_LOAD_POSITION.z),
        }
      case 'yard_truck_stand':
        return {
          position: new THREE.Vector3(28, 24, 70),
          lookAt: new THREE.Vector3(YARD_TRUCK_PARK_POSITION.x, 2, YARD_TRUCK_PARK_POSITION.z - 6),
        }
      case 'outgate':
        return {
          position: new THREE.Vector3(40, 24, 138),
          lookAt: new THREE.Vector3(GATE_OUTGATE_POSITION.x, 2, GATE_OUTGATE_POSITION.z),
        }
    }
  }

  function startCameraCue(target: CameraCueTarget): void {
    if (!camera || !controls) return
    const pose = getCameraCuePose(target)
    activeCameraAnimation = {
      startTime: performance.now(),
      duration: CAMERA_CUE_DURATION,
      fromPosition: camera.position.clone(),
      toPosition: pose.position,
      fromTarget: controls.target.clone(),
      toTarget: pose.lookAt,
    }
  }

  function shouldOpenIngateBarrier(trucks: TruckVisit[], gatehouse: GatehouseState): boolean {
    if (!gatehouse.exportLaneOpen) return false
    return trucks.some(truck =>
      (truck.state === 'driving_to_yard' && truck.position.z < GATE_INGATE_POSITION.z + 12),
    )
  }

  function shouldOpenOutgateBarrier(trucks: TruckVisit[], gatehouse: GatehouseState): boolean {
    if (!gatehouse.importLaneOpen) return false
    return trucks.some(truck =>
      truck.state === 'departing' &&
      Math.abs(truck.position.x - GATE_OUTGATE_POSITION.x) < 6 &&
      truck.position.z < GATE_OUTGATE_FENCE_Z + 12,
    )
  }

  function updateGatehouseBarriers(): void {
    const openAngle = Math.PI * 0.43
    const ingateTarget = shouldOpenIngateBarrier(store.truckVisits, store.gatehouse) ? openAngle : 0
    const outgateTarget = shouldOpenOutgateBarrier(store.truckVisits, store.gatehouse) ? openAngle : 0
    if (ingateBarrier) ingateBarrier.rotation.z = THREE.MathUtils.lerp(ingateBarrier.rotation.z, ingateTarget, 0.12)
    if (outgateBarrier) outgateBarrier.rotation.z = THREE.MathUtils.lerp(outgateBarrier.rotation.z, outgateTarget, 0.12)
  }

  function updateCameraCue(): void {
    if (!camera || !controls || !activeCameraAnimation) return
    const elapsed = (performance.now() - activeCameraAnimation.startTime) / 1000
    const rawProgress = Math.min(1, elapsed / activeCameraAnimation.duration)
    const t = easeInOutCubic(rawProgress)

    _cameraPosition.copy(activeCameraAnimation.fromPosition).lerp(activeCameraAnimation.toPosition, t)
    _cameraTarget.copy(activeCameraAnimation.fromTarget).lerp(activeCameraAnimation.toTarget, t)
    camera.position.copy(_cameraPosition)
    controls.target.copy(_cameraTarget)
    controls.update()

    if (rawProgress >= 1) {
      activeCameraAnimation = null
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return
    const t = e.target as Node | null
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft':       keys.left    = true; e.preventDefault(); break
      case 'KeyD': case 'ArrowRight':      keys.right   = true; e.preventDefault(); break
      case 'KeyW': case 'ArrowUp':         keys.up      = true; e.preventDefault(); break
      case 'KeyS': case 'ArrowDown':       keys.down    = true; e.preventDefault(); break
      case 'Equal': case 'NumpadAdd':      keys.zoomIn  = true; e.preventDefault(); break
      case 'Minus': case 'NumpadSubtract': keys.zoomOut = true; e.preventDefault(); break
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyA': case 'ArrowLeft':       keys.left    = false; break
      case 'KeyD': case 'ArrowRight':      keys.right   = false; break
      case 'KeyW': case 'ArrowUp':         keys.up      = false; break
      case 'KeyS': case 'ArrowDown':       keys.down    = false; break
      case 'Equal': case 'NumpadAdd':      keys.zoomIn  = false; break
      case 'Minus': case 'NumpadSubtract': keys.zoomOut = false; break
    }
  }

  function applyKeyboardCamera(dt: number): void {
    if (!camera || !controls) return
    const anyKey = keys.left || keys.right || keys.up || keys.down || keys.zoomIn || keys.zoomOut
    if (!anyKey) return

    const panDist = KEY_PAN_SPEED * dt
    const right = new THREE.Vector3()
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    right.crossVectors(forward, camera.up).normalize()

    const pan = new THREE.Vector3()
    if (keys.left)  pan.addScaledVector(right, -panDist)
    if (keys.right) pan.addScaledVector(right,  panDist)
    if (keys.up)    pan.addScaledVector(forward,  panDist)
    if (keys.down)  pan.addScaledVector(forward, -panDist)

    camera.position.add(pan)
    controls.target.add(pan)

    if (keys.zoomIn || keys.zoomOut) {
      _offset.copy(camera.position).sub(controls.target)
      _spherical.setFromVector3(_offset)
      if (keys.zoomIn)  _spherical.radius -= KEY_ZOOM_SPEED * dt
      if (keys.zoomOut) _spherical.radius += KEY_ZOOM_SPEED * dt
      _spherical.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, _spherical.radius))
      _offset.setFromSpherical(_spherical)
      camera.position.copy(controls.target).add(_offset)
    }

    controls.update()
  }

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

      if (store.cameraCue) {
        startCameraCue(store.cameraCue.target)
      }

      buildScene(scene)
      ingateBarrier = scene.getObjectByName('ingate-barrier') as THREE.Group | null
      outgateBarrier = scene.getObjectByName('outgate-barrier') as THREE.Group | null

      containerRenderer = new ContainerRenderer(scene)
      equipmentRenderer = new EquipmentRenderer(scene)
      vesselRenderer = new VesselRenderer(scene)
      truckRenderer = new TruckRenderer(scene)
      floatingTextRenderer = new FloatingTextRenderer(scene)

      // Pre-warm GLB assets so they are cached before trucks/vessels appear
      loadModel(TRUCK_GLB_URL).catch(e => console.warn('Box Empire: truck GLB pre-warm failed', e))
      loadModel(VESSEL_GLB_URL).catch(e => console.warn('Box Empire: vessel GLB pre-warm failed', e))

      window.addEventListener('resize', onResize)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
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

  watch(() => store.cameraCue?.id, () => {
    const cue = store.cameraCue
    if (!cue || !isReady.value) return
    startCameraCue(cue.target)
  })

  function onResize(): void {
    if (!camera || !renderer) return
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  function render(): void {
    if (!renderer || !scene || !camera) return
    updateCameraCue()
    controls?.update()
    floatingTextRenderer?.update()
    const t = performance.now() / 1000
    animateOcean(t)
    animateFoam(t)
    updateGatehouseBarriers()
    renderer.render(scene, camera)
  }

  function updateEntities(): void {
    containerRenderer?.update(store.containers, store.truckVisits)
    equipmentRenderer?.update(store.equipment, store.containers)
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
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    controls?.dispose()
    containerRenderer?.dispose()
    equipmentRenderer?.dispose()
    vesselRenderer?.dispose()
    truckRenderer?.dispose()
    floatingTextRenderer?.dispose()
    ingateBarrier = null
    outgateBarrier = null

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
    applyKeyboardCamera,
    spawnFloatingText,
    getContainerIdAtInstance,
    getContainerMesh,
    getContainerIdNearScreen,
    triggerVesselShake,
  }
}

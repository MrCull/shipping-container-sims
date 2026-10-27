/**
 * Terminal Twin's own Three.js view (the shared useThreeScene is too limited:
 * far plane, no OrbitControls). Owns renderer, camera, controls and the
 * animation loop. Each frame it ticks the playback clock, syncs the store and,
 * unless a flat-out run is in progress, poses and renders the scene.
 * Nothing Three.js-related is put in Vue reactivity.
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SceneRenderer, type OverlayState } from '../modules/sceneRenderer'
import type { SceneModel } from '../modules/sceneModel'
import { useTwinStore } from '../store/twinStore'

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const HIDDEN_OVERLAYS: OverlayState = { laneGraph: false, reservations: false }

export function useTwinScene(host: Ref<HTMLElement | null>) {
  const store = useTwinStore()
  const webglFailed = ref(false)
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  let view: SceneRenderer | null = null
  let builtFor: SceneModel | null = null
  let overlaysApplied: OverlayState | null = null
  let frame = 0
  /** Frames actually rendered (dev API: proves the view keeps animating). */
  let framesRendered = 0
  let resizeObserver: ResizeObserver | null = null

  function resize(): void {
    const el = host.value
    if (!el || !renderer || !camera) return
    const w = Math.max(1, el.clientWidth)
    const h = Math.max(1, el.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function aim(target: { x: number; y: number; z: number }, keepOffset: boolean): void {
    if (!camera || !controls) return
    const offset = keepOffset
      ? camera.position.clone().sub(controls.target)
      : new THREE.Vector3(95, 70, 115)
    controls.target.set(target.x, target.y, target.z)
    camera.position.copy(controls.target).add(offset)
    controls.update()
  }

  function rebuild(model: SceneModel | null): void {
    view?.dispose()
    view = null
    builtFor = model
    if (!model) return
    view = new SceneRenderer(model)
    overlaysApplied = null
    aim(view.overviewTarget(), false)
  }

  function loop(now: number): void {
    frame = requestAnimationFrame(loop)
    const controller = store.controller()
    controller?.tick(now)
    store.sync()
    if (!renderer || !camera || !controller) return
    if (controller.model !== builtFor) rebuild(controller.model)
    if (!view || controller.busy) return
    // O (overlaysVisible) is the master switch over the individual 3D overlays.
    const overlays = store.overlaysVisible ? store.overlays : HIDDEN_OVERLAYS
    if (overlaysApplied !== overlays) {
      overlaysApplied = overlays
      view.setOverlays(overlays)
    }
    if (store.following && store.selectedId) {
      // Follow camera (F): keep the selection centred, keeping the user's viewing offset.
      const centre = controller.model?.entityCentre(store.selectedId, controller.displayTime)
      if (centre) aim(centre, true)
    }
    view.update(controller.displayTime, store.selectedId)
    controls?.update()
    renderer.render(view.scene, camera)
    framesRendered++
  }

  onMounted(() => {
    const el = host.value
    if (el && webglAvailable()) {
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFShadowMap
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.outputColorSpace = THREE.SRGBColorSpace
        el.appendChild(renderer.domElement)
        renderer.domElement.classList.add('tt-canvas')
        camera = new THREE.PerspectiveCamera(45, 1, 0.5, 6000)
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.minDistance = 8
        controls.maxDistance = 2500
        controls.maxPolarAngle = Math.PI / 2.05
        resize()
        resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(el)
      } catch (err) {
        console.warn('Terminal Twin: WebGL initialisation failed', err)
        renderer = null
        webglFailed.value = true
      }
    } else {
      webglFailed.value = true
    }
    store.attachView({
      cameraTo(entityId) {
        const controller = store.controller()
        const centre = controller?.model?.entityCentre(entityId, controller.displayTime)
        if (!centre) return false
        aim(centre, true)
        return true
      },
      stats: () => (view ? { ...view.stats(), frames: framesRendered } : null),
    })
    frame = requestAnimationFrame(loop)
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    resizeObserver?.disconnect()
    store.attachView(null)
    view?.dispose()
    controls?.dispose()
    renderer?.dispose()
    renderer?.domElement.remove()
    renderer = null
  })

  return { webglFailed }
}

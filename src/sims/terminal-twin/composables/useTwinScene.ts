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
import { NO_OVERLAYS } from '../modules/overlays'
import { pickEntity } from '../modules/picking'
import { SceneRenderer } from '../modules/sceneRenderer'
import type { SceneModel } from '../modules/sceneModel'
import { AutoQuality, FpsMeter, profileFor } from '../modules/quality'
import { usePerfStore } from '../store/perfStore'
import { useTwinStore } from '../store/twinStore'

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function useTwinScene(host: Ref<HTMLElement | null>) {
  const store = useTwinStore()
  const perf = usePerfStore()
  const meter = new FpsMeter()
  const auto = new AutoQuality((level) => perf.setEffective(level, true))
  const frustum = new THREE.Frustum()
  const viewProjection = new THREE.Matrix4()
  let appliedLevel: string | null = null
  let lastReportAt = 0
  /** Smoothed main-thread ms per frame (pose + render submit). */
  let cpuMs = 0
  /** The part of it spent posing the scene (`view.update`), without the render submit. */
  let poseMs = 0
  let lastSetting = perf.setting
  const webglFailed = ref(false)
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let controls: OrbitControls | null = null
  let view: SceneRenderer | null = null
  let builtFor: SceneModel | null = null
  let overlaysApplied: object | null = null
  let frame = 0
  /** Frames actually rendered (dev API: proves the view keeps animating). */
  let framesRendered = 0
  /** Draw calls and triangles of the last frame (main + shadow pass). */
  let lastRender = { calls: 0, triangles: 0 }
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

  /** Puts the effective quality profile in force: shadows, render resolution, and the scene's own LOD / ocean settings. */
  function applyQuality(): void {
    if (!renderer) return
    const profile = profileFor(perf.effective)
    appliedLevel = perf.effective
    renderer.shadowMap.enabled = profile.shadows
    renderer.setPixelRatio(Math.min(window.devicePixelRatio * profile.resolutionScale, 2))
    resize()
    view?.setQuality(profile)
  }

  function aim(target: { x: number; y: number; z: number }, keepOffset: boolean, distanceM?: number): void {
    if (!camera || !controls) return
    const offset = keepOffset
      ? camera.position.clone().sub(controls.target)
      : new THREE.Vector3(95, 70, 115)
    if (distanceM !== undefined) offset.setLength(Math.max(controls.minDistance, distanceM))
    controls.target.set(target.x, target.y, target.z)
    camera.position.copy(controls.target).add(offset)
    controls.update()
  }

  /** The entity under a viewport point (client coordinates) at the displayed time, or null. */
  function pickAt(clientX: number, clientY: number): string | null {
    const controller = store.controller()
    if (!renderer || !camera || !controller?.model) return null
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)
    const { origin, direction } = raycaster.ray
    return pickEntity(controller.model, controller.displayTime, { origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: direction.x, y: direction.y, z: direction.z } })
  }

  /** Viewport (client) coordinates of an entity's centre, or null if it is not in the scene or off screen. */
  function screenPoint(entityId: string): { x: number; y: number } | null {
    const controller = store.controller()
    const centre = controller?.model?.entityCentre(entityId, controller.displayTime)
    if (!renderer || !camera || !centre) return null
    camera.updateMatrixWorld()
    const p = new THREE.Vector3(centre.x, centre.y, centre.z).project(camera)
    if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null
    const rect = renderer.domElement.getBoundingClientRect()
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
  }

  // A click (little movement, short press) selects; a drag orbits and must not.
  let pressed: { x: number; y: number; at: number } | null = null
  function onPointerDown(e: PointerEvent): void {
    pressed = { x: e.clientX, y: e.clientY, at: performance.now() }
  }
  function onPointerUp(e: PointerEvent): void {
    const p = pressed
    pressed = null
    if (!p || e.button !== 0) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5 || performance.now() - p.at > 600) return
    const id = pickAt(e.clientX, e.clientY)
    store.select(id)
  }

  function rebuild(model: SceneModel | null): void {
    view?.dispose()
    view = null
    builtFor = model
    if (!model) return
    view = new SceneRenderer(model)
    overlaysApplied = null
    view.setQuality(profileFor(perf.effective))
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
    const overlays = store.overlaysVisible ? store.overlays : NO_OVERLAYS
    if (overlaysApplied !== overlays) {
      overlaysApplied = overlays
      view.setOverlays(overlays)
    }
    if (store.following && store.selectedId) {
      // Follow camera (F): keep the selection centred, keeping the user's viewing offset.
      const centre = controller.model?.entityCentre(store.selectedId, controller.displayTime)
      if (centre) aim(centre, true)
    }
    controls?.update()
    camera.updateMatrixWorld()
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const cpuStart = performance.now()
    view.update(controller.displayTime, store.selectedId, camera.position, frustum)
    const poseDone = performance.now()
    poseMs = poseMs === 0 ? poseDone - cpuStart : poseMs * 0.9 + (poseDone - cpuStart) * 0.1
    if (import.meta.env.DEV && perf.debugLoadMs > 0) {
      const until = performance.now() + perf.debugLoadMs
      while (performance.now() < until) {
        /* dev-only artificial frame cost */
      }
    }
    renderer.render(view.scene, camera)
    cpuMs = cpuMs === 0 ? performance.now() - cpuStart : cpuMs * 0.9 + (performance.now() - cpuStart) * 0.1
    lastRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
    framesRendered++
    // quality: measure this frame, let Auto judge, apply a changed level on the next frame
    meter.frame(now)
    if (perf.setting !== lastSetting) {
      if (perf.setting === 'auto') auto.reset(perf.effective)
      lastSetting = perf.setting
    }
    if (perf.debugAuto) {
      auto.downFps = perf.debugAuto.down
      auto.upFps = perf.debugAuto.up
    }
    if (perf.setting === 'auto') auto.frame(now)
    if (appliedLevel !== perf.effective) applyQuality()
    if (now - lastReportAt >= 250) {
      lastReportAt = now
      perf.report({ fps: meter.fps, calls: lastRender.calls, triangles: lastRender.triangles, cpuMs, poseMs })
    }
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
        renderer.domElement.addEventListener('pointerdown', onPointerDown)
        renderer.domElement.addEventListener('pointerup', onPointerUp)
        applyQuality()
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
      cameraTo(entityId, distanceM) {
        const controller = store.controller()
        const centre = controller?.model?.entityCentre(entityId, controller.displayTime)
        if (!centre) return false
        aim(centre, true, distanceM)
        return true
      },
      pickAt,
      screenPoint,
      cameraTarget: () => (controls ? { x: controls.target.x, y: controls.target.y, z: controls.target.z } : null),
      stats: () => (view ? { ...view.stats(), frames: framesRendered, render: { ...lastRender } } : null),
      liveries: () => view?.renderedLiveries() ?? null,
      shcRigs: () => view?.renderedShcs() ?? null,
      truckRigs: () => view?.renderedTrucks() ?? null,
      ascRigs: () => view?.renderedAscs() ?? null,
      sts: () => view?.renderedSts() ?? null,
      vesselHulls: () => view?.vesselHulls() ?? null,
      drawBreakdown: () => (view ? view.drawBreakdown(frustum) : null),
    })
    frame = requestAnimationFrame(loop)
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    resizeObserver?.disconnect()
    store.attachView(null)
    view?.dispose()
    renderer?.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer?.domElement.removeEventListener('pointerup', onPointerUp)
    controls?.dispose()
    renderer?.dispose()
    renderer?.domElement.remove()
    renderer = null
  })

  return { webglFailed }
}

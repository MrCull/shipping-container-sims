import { onMounted, onBeforeUnmount, ref, type Ref } from 'vue'
import * as THREE from 'three'

export interface ThreeSceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  clock: THREE.Clock
}

/**
 * Sets up a Three.js scene bound to a canvas element ref.
 * Handles resize, animation loop, and cleanup automatically.
 * Pass an `onFrame` callback to run logic each frame.
 *
 * IMPORTANT: Three.js objects have non-configurable properties that break
 * Vue's reactive proxy. The context is stored in a plain variable and exposed
 * via a getter. A separate `ready` ref is provided for watchers that need to
 * react when the scene becomes available.
 */
export function useThreeScene(
  canvasRef: Ref<HTMLCanvasElement | null>,
  onFrame?: (ctx: ThreeSceneContext, delta: number) => void
) {
  // Plain variable — must NOT be wrapped in ref/shallowRef
  let ctx: ThreeSceneContext | null = null
  const ready = ref(false)
  let animationId = 0

  function initScene(canvas: HTMLCanvasElement): ThreeSceneContext {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    )
    camera.position.set(0, 5, 10)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    const clock = new THREE.Clock()

    return { scene, camera, renderer, clock }
  }

  function onResize() {
    if (!ctx || !canvasRef.value) return
    const parent = canvasRef.value.parentElement!
    ctx.camera.aspect = parent.clientWidth / parent.clientHeight
    ctx.camera.updateProjectionMatrix()
    ctx.renderer.setSize(parent.clientWidth, parent.clientHeight)
  }

  function animate() {
    animationId = requestAnimationFrame(animate)
    if (!ctx) return
    const delta = ctx.clock.getDelta()
    onFrame?.(ctx, delta)
    ctx.renderer.render(ctx.scene, ctx.camera)
  }

  onMounted(() => {
    if (!canvasRef.value) return
    ctx = initScene(canvasRef.value)
    window.addEventListener('resize', onResize)
    animate()
    ready.value = true
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(animationId)
    window.removeEventListener('resize', onResize)
    ctx?.renderer.dispose()
    ctx = null
    ready.value = false
  })

  // Return a getter function + ready signal instead of a reactive ref containing Three.js objects
  return {
    getCtx: () => ctx,
    ready,
  }
}

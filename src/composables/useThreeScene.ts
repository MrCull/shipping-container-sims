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
 */
export function useThreeScene(
  canvasRef: Ref<HTMLCanvasElement | null>,
  onFrame?: (ctx: ThreeSceneContext, delta: number) => void
) {
  const ctx = ref<ThreeSceneContext | null>(null)
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
    if (!ctx.value || !canvasRef.value) return
    const { camera, renderer } = ctx.value
    const parent = canvasRef.value.parentElement!
    camera.aspect = parent.clientWidth / parent.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(parent.clientWidth, parent.clientHeight)
  }

  function animate() {
    animationId = requestAnimationFrame(animate)
    if (!ctx.value) return
    const delta = ctx.value.clock.getDelta()
    onFrame?.(ctx.value, delta)
    ctx.value.renderer.render(ctx.value.scene, ctx.value.camera)
  }

  onMounted(() => {
    if (!canvasRef.value) return
    ctx.value = initScene(canvasRef.value)
    window.addEventListener('resize', onResize)
    animate()
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(animationId)
    window.removeEventListener('resize', onResize)
    ctx.value?.renderer.dispose()
  })

  return ctx
}

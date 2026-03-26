import { ref, onUnmounted } from 'vue'

export function useGameLoop(callback: (deltaTime: number, time: number) => void) {
  const isRunning = ref(false)
  let animFrameId: number | null = null
  let lastTime = 0

  function start(): void {
    if (isRunning.value) return
    isRunning.value = true
    lastTime = performance.now()
    tick()
  }

  function stop(): void {
    isRunning.value = false
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  function tick(): void {
    if (!isRunning.value) return
    animFrameId = requestAnimationFrame(tick)
    const now = performance.now()
    const deltaTime = Math.min((now - lastTime) / 1000, 0.1)
    lastTime = now
    callback(deltaTime, now / 1000)
  }

  onUnmounted(stop)

  return { start, stop, isRunning }
}

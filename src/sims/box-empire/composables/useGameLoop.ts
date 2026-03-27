// ---------------------------------------------------------------------------
// Box Empire — Fixed-step simulation tick + RAF render loop
// ---------------------------------------------------------------------------

import { ref, onBeforeUnmount } from 'vue'
import { SIM_TICK_INTERVAL } from '../modules/config'
import { useGameStore } from '../store/gameStore'

export function useGameLoop(onRender: (dt: number) => void) {
  const store = useGameStore()
  const isRunning = ref(false)
  let animFrameId = 0
  let lastTime = 0
  let accumulator = 0

  function loop(): void {
    if (!isRunning.value) return
    animFrameId = requestAnimationFrame(loop)
    const now = performance.now()
    const rawDt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now
    const dt = Math.min(rawDt, 0.1)

    accumulator += dt

    let tickCount = 0
    while (accumulator >= SIM_TICK_INTERVAL && tickCount < 20) {
      store.tick(SIM_TICK_INTERVAL)
      accumulator -= SIM_TICK_INTERVAL
      tickCount++
    }
    if (tickCount >= 20) accumulator = 0

    onRender(dt)
  }

  function start(): void {
    if (isRunning.value) return
    isRunning.value = true
    lastTime = 0
    accumulator = 0
    animFrameId = requestAnimationFrame(loop)
  }

  function stop(): void {
    isRunning.value = false
    if (animFrameId) {
      cancelAnimationFrame(animFrameId)
      animFrameId = 0
    }
  }

  onBeforeUnmount(stop)

  return { start, stop, isRunning }
}

// ---------------------------------------------------------------------------
// Box Empire — Fixed-step simulation tick + RAF render loop
// ---------------------------------------------------------------------------

import { onMounted, onBeforeUnmount } from 'vue'
import { SIM_TICK_INTERVAL } from '../modules/config'
import { useGameStore } from '../store/gameStore'

export function useGameLoop(onRender: (dt: number) => void): void {
  const store = useGameStore()
  let animFrameId = 0
  let lastTime = 0
  let accumulator = 0

  function loop(time: number): void {
    animFrameId = requestAnimationFrame(loop)
    const rawDt = lastTime === 0 ? 0 : (time - lastTime) / 1000
    lastTime = time
    const dt = Math.min(rawDt, 0.1)

    accumulator += dt

    while (accumulator >= SIM_TICK_INTERVAL) {
      store.tick(SIM_TICK_INTERVAL)
      accumulator -= SIM_TICK_INTERVAL
    }

    onRender(dt)
  }

  onMounted(() => {
    lastTime = 0
    accumulator = 0
    animFrameId = requestAnimationFrame(loop)
  })

  onBeforeUnmount(() => {
    cancelAnimationFrame(animFrameId)
  })
}

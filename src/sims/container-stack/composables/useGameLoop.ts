import { watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useContainerStackStore } from '../store/gameStore'
import { integrateCollapsePiece } from '../modules/physics'
const GROUND_Y = 0.02

export function useGameLoop(
  render: () => void,
  getTopY: () => number,
  frameTower: (topY: number) => void,
  setCameraShake: (n: number) => void,
  beforeRender?: (dt: number) => void,
  applyKeyboardCamera?: (dt: number) => void
) {
  const store = useContainerStackStore()
  const { phase, wobble, collapsePieces } = storeToRefs(store)

  let raf = 0
  let last = performance.now()
  let collapsePhaseStart = 0

  function tick(): void {
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now

    if (
      phase.value === 'paused' ||
      phase.value === 'start' ||
      phase.value === 'gameOver' ||
      phase.value === 'levelCompletePending' ||
      phase.value === 'levelComplete' ||
      phase.value === 'levelFailed'
    ) {
      render()
      return
    }

    if (phase.value === 'collapsing') {
      if (collapsePhaseStart === 0) collapsePhaseStart = now
      for (const p of collapsePieces.value) {
        integrateCollapsePiece(p, dt, GROUND_Y)
      }
      if (now - collapsePhaseStart > 2800) {
        collapsePhaseStart = 0
        store.finishCollapse()
      }
    } else {
      collapsePhaseStart = 0
      store.tickPhysics(dt)
    }

    beforeRender?.(dt)
    applyKeyboardCamera?.(dt)
    setCameraShake(Math.abs(wobble.value.angle) * 1.2)
    frameTower(getTopY())
    render()
  }

  function start(): void {
    last = performance.now()
    cancelAnimationFrame(raf)
    tick()
  }

  function stop(): void {
    cancelAnimationFrame(raf)
  }

  watch(phase, p => {
    if (
      p === 'gameOver' ||
      p === 'start' ||
      p === 'paused' ||
      p === 'levelCompletePending' ||
      p === 'levelComplete' ||
      p === 'levelFailed'
    ) {
      setCameraShake(0)
    }
  })

  return { start, stop }
}

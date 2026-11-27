/**
 * Yardshift Pinia store: glue only. It holds the engine `Shift`, the UI state and the play-surface size, and
 * forwards hit targets to `input` and actions to `dispatch`. Rules live in modules/engine.ts, view logic in
 * modules/presentation.ts.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { LEVELS, levelByNumber } from '../modules/levels'
import { createShift, exposedNextStack, MAX_STEP_MS, rejectionFor } from '../modules/engine'
import { craneDurationMs, hitTest, input, moveSpan, present } from '../modules/presentation'
import type { DispatchResult, Shift, ShiftAction, ShiftState } from '../types/engine'
import type { HitTarget, UiState, Viewport } from '../types/presentation'

/** A crane move in flight: the engine holds the `animation` pause until it ends, then the action is applied. */
export interface CraneMove {
  action: ShiftAction
  /** Source stack, and destination stack or -1 for the collection truck. */
  from: number
  to: number
  durationMs: number
  /** 0..1, advanced by `frame`. */
  progress: number
}

export const useYardshiftStore = defineStore('yardshift', () => {
  let shift: Shift = createShift(LEVELS[0]!)
  const state = shallowRef<ShiftState>(shift.state)
  const ui = ref<UiState>({ selection: null })
  const viewport = ref<Viewport>({ width: 390, height: 560 })
  const message = ref('')
  const move = shallowRef<CraneMove | null>(null)
  /** Bumped on every +1 s time credit, so the HUD can replay its feedback. */
  const creditPulse = ref(0)
  /** Bumped on every bonus award, so the view can replay the gold burst and "+250 · +5s" float. */
  const bonusPulse = ref(0)
  let lastFrame: number | null = null
  let reducedMotion = false

  function sync(): void {
    state.value = shift.state
  }

  function watchEvents(): void {
    shift.onEvent((e) => {
      if (e.type === 'time-credit') creditPulse.value++
      if (e.type === 'bonus-awarded') bonusPulse.value++
    })
  }
  watchEvents()

  const view = computed(() => present(state.value, ui.value, viewport.value))

  function loadLevel(n: number): void {
    const level = levelByNumber(n)
    if (!level) throw new Error(`Yardshift: no level ${n}`)
    const hidden = shift.state.pauses.includes('hidden')
    shift = createShift(level)
    watchEvents()
    if (hidden) shift.dispatch({ type: 'pause', reason: 'hidden' })
    move.value = null
    lastFrame = null
    sync()
    ui.value = { selection: null }
    message.value = ''
  }

  function dispatch(action: ShiftAction): DispatchResult {
    const r = shift.dispatch(action)
    sync()
    message.value = r.ok ? '' : r.rejection.message
    return r
  }

  /**
   * Play a legal move as a crane animation: hold the `animation` pause (clocks freeze, further moves are rejected),
   * and apply the action when `frame` reaches the end. An illegal action is dispatched at once for its rejection.
   */
  function startMove(action: ShiftAction): void {
    if (move.value || rejectionFor(shift.state, action) !== null || reducedMotion) {
      dispatch(action)
      return
    }
    const span = moveSpan(view.value.layout, action, shift.state)
    const from = action.type === 'rehandle' ? action.from : action.type === 'collect' ? (action.from ?? exposedNextStack(shift.state)) : -1
    const to = action.type === 'rehandle' ? action.to : -1
    shift.dispatch({ type: 'pause', reason: 'animation' })
    sync()
    move.value = { action, from, to, durationMs: craneDurationMs(span ? span.toX - span.fromX : 0), progress: 0 }
  }

  function finishMove(): void {
    const m = move.value
    if (!m) return
    move.value = null
    shift.dispatch({ type: 'resume', reason: 'animation' })
    dispatch(m.action)
  }

  /** One animation frame at `nowMs` (performance.now): advances the crane move, then the clocks (step capped). */
  function frame(nowMs: number): void {
    const dt = lastFrame === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, nowMs - lastFrame))
    lastFrame = nowMs
    const m = move.value
    if (m) {
      const progress = Math.min(1, m.progress + dt / m.durationMs)
      if (progress >= 1) finishMove()
      else move.value = { ...m, progress }
      return
    }
    if (dt > 0 && shift.state.status === 'playing') {
      shift.tick(dt)
      sync()
    }
  }

  /** The tab was hidden or shown: hold or release the `hidden` pause. */
  function setHidden(hidden: boolean): void {
    shift.dispatch({ type: hidden ? 'pause' : 'resume', reason: 'hidden' })
    lastFrame = null
    sync()
  }

  function setReducedMotion(on: boolean): void {
    reducedMotion = on
  }

  function tapTarget(target: HitTarget | null): void {
    const r = input(ui.value, { type: 'tap', target }, state.value)
    ui.value = r.ui
    if (r.action) startMove(r.action)
  }

  /** A tap at play-surface coordinates (CSS px). */
  function tapAt(x: number, y: number): void {
    tapTarget(hitTest(view.value.hitRegions, x, y))
  }

  function setViewport(width: number, height: number): void {
    if (width !== viewport.value.width || height !== viewport.value.height) viewport.value = { width, height }
  }

  function restart(): void {
    loadLevel(state.value.level.number)
  }

  return {
    state,
    ui,
    viewport,
    message,
    view,
    move,
    creditPulse,
    bonusPulse,
    loadLevel,
    dispatch,
    tapTarget,
    tapAt,
    setViewport,
    restart,
    frame,
    setHidden,
    setReducedMotion,
  }
})

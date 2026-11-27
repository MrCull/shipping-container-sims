/**
 * Yardshift Pinia store: glue only. It holds the engine `Shift`, the UI state and the play-surface size, and
 * forwards hit targets to `input` and actions to `dispatch`. Rules live in modules/engine.ts, view logic in
 * modules/presentation.ts.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { LEVELS, levelByNumber } from '../modules/levels'
import { createShift, exposedNextStack, MAX_STEP_MS, rejectionFor, waitingArrival } from '../modules/engine'
import { craneDurationMs, hitTest, input, moveSpan, present } from '../modules/presentation'
import type { DispatchResult, Shift, ShiftAction, ShiftState } from '../types/engine'
import type { HitTarget, UiAction, UiEvent, UiState, Viewport } from '../types/presentation'

/** `CraneMove.from` for a receipt: the crane lifts the cargo off the receipt truck. */
export const RECEIPT_TRUCK = -2
/** A pointer that moves farther than this (CSS px) from where it went down starts a drag (V20: 6 logical px). */
export const DRAG_THRESHOLD_PX = 6

/** How long the arrival announcement shows, ms (brief; it does not pause the clocks or block input). */
export const ANNOUNCE_MS = 1600

/** A crane move in flight: the engine holds the `animation` pause until it ends, then the action is applied. */
export interface CraneMove {
  action: ShiftAction
  /** Source stack or `RECEIPT_TRUCK`, and destination stack or -1 for the collection truck. */
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
  /** The brief arrival announcement, or empty; `announceLeftMs` counts it down in `frame`. */
  const announcement = ref('')
  let announceLeftMs = 0
  /** Bumped on every bonus award, so the view can replay the gold burst and "+250 · +5s" float. */
  const bonusPulse = ref(0)
  let lastFrame: number | null = null
  let reducedMotion = false
  /** The pointer that went down and has not come up yet: where, on what, and whether it became a drag. */
  let pointer: { x: number; y: number; target: HitTarget | null; dragging: boolean } | null = null

  function sync(): void {
    state.value = shift.state
  }

  function announce(id: number, moves: number): void {
    announcement.value =
      moves === 0 ? `Incoming truck #${id}: receive it now.` : `Incoming truck #${id}: receive within ${moves} ${moves === 1 ? 'move' : 'moves'}.`
    announceLeftMs = ANNOUNCE_MS
  }

  function watchEvents(): void {
    shift.onEvent((e) => {
      if (e.type === 'time-credit') creditPulse.value++
      if (e.type === 'arrival') announce(e.id, e.moves)
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
    ui.value = { selection: null, reducedMotion }
    pointer = null
    message.value = ''
    announcement.value = ''
    announceLeftMs = 0
    const waiting = waitingArrival(shift.state)
    if (waiting !== undefined) announce(waiting, shift.state.deadline ?? 0)
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
    const from =
      action.type === 'rehandle'
        ? action.from
        : action.type === 'collect'
          ? (action.from ?? exposedNextStack(shift.state))
          : RECEIPT_TRUCK
    const to = action.type === 'rehandle' || action.type === 'receive' ? action.to : -1
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
    if (announceLeftMs > 0) {
      announceLeftMs -= dt
      if (announceLeftMs <= 0) announcement.value = ''
    }
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
    ui.value = { ...ui.value, reducedMotion: on }
  }

  /** Undo is #386's engine action; until the engine has it, U only says so. */
  function undo(): void {
    message.value = 'Undo is not available yet.'
  }

  /** Apply what `input` resolved: a move plays as a crane animation, pause and resume apply at once. */
  function apply(action: UiAction): void {
    if (action.type === 'undo') undo()
    else if (action.type === 'pause' || action.type === 'resume') dispatch(action)
    else startMove(action)
  }

  /** Forward one raw UI event to `input`. */
  function send(event: UiEvent): void {
    const r = input(ui.value, event, state.value)
    ui.value = r.ui
    if (r.action) apply(r.action)
  }

  function tapTarget(target: HitTarget | null): void {
    send({ type: 'tap', target })
  }

  /** A key press (`KeyboardEvent.key`). */
  function key(k: string): void {
    send({ type: 'key', key: k })
  }

  function pointerDown(x: number, y: number): void {
    pointer = { x, y, target: hitTest(view.value.hitRegions, x, y), dragging: false }
  }

  function pointerMove(x: number, y: number): void {
    const p = pointer
    if (!p) return
    const over = hitTest(view.value.hitRegions, x, y)
    if (p.dragging) {
      send({ type: 'drag-move', over })
      return
    }
    if (p.target && Math.hypot(x - p.x, y - p.y) > DRAG_THRESHOLD_PX) {
      p.dragging = true
      send({ type: 'drag-start', from: p.target })
      send({ type: 'drag-move', over })
    }
  }

  /** Pointer up: a drop when a drag started, else a tap where the pointer came up. */
  function pointerUp(x: number, y: number): void {
    const p = pointer
    pointer = null
    const target = hitTest(view.value.hitRegions, x, y)
    if (p?.dragging) send({ type: 'drag-end', target })
    else send({ type: 'tap', target })
  }

  function pointerCancel(): void {
    if (pointer?.dragging) send({ type: 'drag-end', target: null })
    pointer = null
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
    announcement,
    bonusPulse,
    loadLevel,
    dispatch,
    tapTarget,
    tapAt,
    key,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    setViewport,
    restart,
    frame,
    setHidden,
    setReducedMotion,
  }
})

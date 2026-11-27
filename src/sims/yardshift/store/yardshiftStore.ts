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
import { craneCues, craneStartCue, cuesForStep, PICK_AT, rejectionCue, type Cue } from '../modules/audioCues'
import type { DispatchResult, Shift, ShiftAction, ShiftEvent, ShiftState } from '../types/engine'
import type { HitTarget, UiAction, UiEvent, UiState, Viewport } from '../types/presentation'
import { loadProgress, recordCompletion, saveProgress, type Progress } from '../modules/progress'
import { minRehandlesFor, starsFor } from '../modules/stars'

/** A screen over the yard. Result and fail follow the shift status; the others are opened by the player. */
export type Overlay = 'intro' | 'pause' | 'levels' | null

/** What the yard effects hear: engine events, and a move the engine refused (the tapped container shakes red). */
export type YardFxEvent = ShiftEvent | { type: 'rejected'; action: ShiftAction }

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
  const progress = ref<Progress>(loadProgress())
  /** `?unlock=all` in a dev or smoke build (set by the host). */
  const unlockAll = ref(false)
  const overlay = ref<Overlay>(null)
  /** The pointer that went down and has not come up yet: where, on what, and whether it became a drag. */
  let pointer: { x: number; y: number; target: HitTarget | null; dragging: boolean } | null = null
  /** Audio cue listeners (#388); each engine step's cues are sent once, when the step happens. */
  const cueListeners = new Set<(cue: Cue) => void>()
  /** Events the engine emitted during the current step. */
  let stepEvents: ShiftEvent[] = []

  /** Yard effect listeners (art pass 2): every engine event, plus a refused move, for render-only juice. */
  const fxListeners = new Set<(e: YardFxEvent) => void>()

  /** Listen to engine events and refused moves for the yard effects; returns an unsubscribe function. */
  function onYardEvent(listener: (e: YardFxEvent) => void): () => void {
    fxListeners.add(listener)
    return () => fxListeners.delete(listener)
  }

  function emitCues(cues: readonly Cue[]): void {
    for (const cue of cues) for (const listener of cueListeners) listener(cue)
  }

  /** Listen to audio cues; returns an unsubscribe function. */
  function onCue(listener: (cue: Cue) => void): () => void {
    cueListeners.add(listener)
    return () => cueListeners.delete(listener)
  }

  /** Run one engine step (a dispatch or a tick) and fire its cues once. */
  function step<T>(run: () => T): T {
    stepEvents = []
    const result = run()
    emitCues(cuesForStep(shift.state, stepEvents))
    stepEvents = []
    return result
  }

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
      stepEvents.push(e)
      for (const listener of fxListeners) listener(e)
      if (e.type === 'time-credit') creditPulse.value++
      if (e.type === 'arrival') announce(e.id, e.moves)
      // The red mandatory signal takes over: the announcement would only repeat it (playtest fix 7).
      if (e.type === 'deadline-zero') {
        announcement.value = ''
        announceLeftMs = 0
      }
      if (e.type === 'bonus-awarded') bonusPulse.value++
      if (e.type === 'completed') recordResult()
    })
  }
  watchEvents()

  const view = computed(() => present(state.value, ui.value, viewport.value))

  /** Best stars and score kept, next level unlocked; a refused storage write keeps the progress for this visit. */
  function recordResult(): void {
    const s = shift.state
    const stars = starsFor(s.rehandles, minRehandlesFor(s.level.number))
    progress.value = recordCompletion(progress.value, s.level.number, stars, s.score, LEVELS.length)
    saveProgress(progress.value)
  }

  /**
   * Load level `n`. With `intro` the intro screen opens and holds the `intro` pause until `startShift`; without it
   * (the dev hook) play starts at once.
   */
  function loadLevel(n: number, options: { intro?: boolean } = {}): void {
    const level = levelByNumber(n)
    if (!level) throw new Error(`Yardshift: no level ${n}`)
    const hidden = shift.state.pauses.includes('hidden')
    shift = createShift(level)
    watchEvents()
    if (hidden) shift.dispatch({ type: 'pause', reason: 'hidden' })
    overlay.value = options.intro ? 'intro' : null
    if (options.intro) shift.dispatch({ type: 'pause', reason: 'intro' })
    move.value = null
    lastFrame = null
    sync()
    ui.value = { selection: null, reducedMotion }
    pointer = null
    message.value = ''
    announcement.value = ''
    announceLeftMs = 0
    if (!options.intro) announceWaiting()
  }

  function announceWaiting(): void {
    const waiting = waitingArrival(shift.state)
    if (waiting !== undefined) announce(waiting, shift.state.deadline ?? 0)
  }

  /** Close the intro and start the clocks. */
  function startShift(): void {
    overlay.value = null
    shift.dispatch({ type: 'resume', reason: 'intro' })
    lastFrame = null
    sync()
    announceWaiting()
  }

  function pause(): void {
    if (shift.state.status !== 'playing' || overlay.value) return
    shift.dispatch({ type: 'pause', reason: 'player' })
    overlay.value = 'pause'
    sync()
  }

  function resume(): void {
    overlay.value = null
    shift.dispatch({ type: 'resume', reason: 'player' })
    lastFrame = null
    sync()
  }

  /** The level picker; the shift underneath stays paused until a level is chosen or the picker is closed. */
  function openLevels(): void {
    if (shift.state.status === 'playing') shift.dispatch({ type: 'pause', reason: 'player' })
    overlay.value = 'levels'
    sync()
  }

  function closeLevels(): void {
    if (shift.state.pauses.includes('intro')) overlay.value = 'intro'
    else if (shift.state.status === 'playing') overlay.value = 'pause'
    else overlay.value = null
  }

  /** Undo the last move (one per shift); ignored while a crane move plays. */
  function undo(): DispatchResult | null {
    if (move.value) return null
    const r = dispatch({ type: 'undo' })
    if (r.ok) {
      ui.value = { selection: null }
      message.value = 'Undo · −25 pts · −3s'
    }
    return r
  }

  function dispatch(action: ShiftAction): DispatchResult {
    const r = step(() => shift.dispatch(action))
    if (!r.ok) {
      emitCues([rejectionCue()])
      for (const listener of fxListeners) listener({ type: 'rejected', action })
    }
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
      // Reduced motion: no animation, so the landing sounds with the move.
      if (dispatch(action).ok) emitCues(craneCues(PICK_AT, 1))
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
    emitCues([craneStartCue()])
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
      emitCues(craneCues(m.progress, progress))
      if (progress >= 1) finishMove()
      else move.value = { ...m, progress }
      return
    }
    if (dt > 0 && shift.state.status === 'playing') {
      step(() => shift.tick(dt))
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

  /**
   * Apply what `input` resolved: a move plays as a crane animation, undo goes to `undo`, and pause and resume (Esc)
   * open and close the pause menu (resume from the level picker goes back to the screen under it).
   */
  function apply(action: UiAction): void {
    if (action.type === 'undo') undo()
    else if (action.type === 'pause') pause()
    else if (action.type === 'resume') {
      if (overlay.value === 'pause') resume()
      else if (overlay.value === 'levels') closeLevels()
    } else startMove(action)
  }

  /** Forward one raw UI event to `input`. */
  function send(event: UiEvent): void {
    const r = input(ui.value, event, state.value)
    // A new selection answers the last rejection, so its message gives way to the live hint.
    if (r.ui.selection !== ui.value.selection) message.value = ''
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

  function setUnlockAll(on: boolean): void {
    unlockAll.value = on
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
    onCue,
    onYardEvent,
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
    progress,
    unlockAll,
    overlay,
    startShift,
    pause,
    resume,
    openLevels,
    closeLevels,
    undo,
    setUnlockAll,
    frame,
    setHidden,
    setReducedMotion,
  }
})

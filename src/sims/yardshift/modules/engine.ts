/**
 * Yardshift rules engine (pure TS: no DOM, timers or Date.now). `createShift(level)` owns every rule; hosts dispatch
 * actions and render `state`. An illegal action returns a typed rejection and changes nothing.
 */
import type {
  DispatchResult,
  LevelDef,
  PauseReason,
  RejectReason,
  Rejection,
  Shift,
  ShiftAction,
  ShiftEvent,
  ShiftState,
} from '../types/engine'

const MESSAGES: Record<RejectReason, string> = {
  'shift-over': 'The shift is over.',
  'no-such-stack': 'Choose a yard stack.',
  'empty-stack': 'That stack is empty.',
  'wrong-order': 'Invalid move: check the collection order.',
  'not-exposed': 'The next container is not on top yet.',
  'same-stack': 'Choose a different stack.',
  'stack-full': 'Stack full.',
  'rehandle-cap': 'Rehandle limit reached. Collections only.',
  heavy: 'Heavy cargo goes only on an empty stack or another heavy container.',
  'no-truck': 'No incoming truck is waiting.',
  'receive-first': 'Deadline reached. Receive the incoming truck first.',
  'crane-busy': 'The crane is busy.',
}

/** The longest clock step one `tick` applies; a longer stall loses no more than this. */
export const MAX_STEP_MS = 100
/** Next-truck time a valid rehandle adds (never to the shift clock). */
export const REHANDLE_CREDIT_MS = 1000
const TIMEOUT_MESSAGE = 'Time ran out.'

/** Score for a receipt. */
export const RECEIPT_POINTS = 100
/** Bonus container collected within its window: extra points and shift time. */
export const BONUS_POINTS = 250
export const BONUS_SHIFT_MS = 5000
/** Shift time for a truck operation (collect or receive) done before overtime. */
export const QUICK_SERVICE_MS = 350

/** Collection score at `combo` (after counting this collection): 100, 150, 200, 250, then 300. */
export function collectPoints(combo: number): number {
  return 100 + 50 * (Math.min(combo, 5) - 1)
}

/** Rehandle cost (negative score): 25 + 5 x stack distance. */
export function rehandlePoints(from: number, to: number): number {
  return -(25 + 5 * Math.abs(from - to))
}

/** Shift time a chained collection adds at `combo`: none for the first, then min(2 s, combo x 0.4 s). */
export function comboShiftMs(combo: number): number {
  return combo > 1 ? Math.min(2000, combo * 400) : 0
}

/** The next-truck allowance, ms, after `operations` truck operations have been completed. */
export function truckAllowanceMs(level: LevelDef, operations: number): number {
  return Math.round(level.truckSeconds[Math.min(operations, 2)]! * 1000)
}

function reject(reason: RejectReason): Rejection {
  return { reason, message: MESSAGES[reason] }
}

/** Activates the next incoming truck when none waits and enough containers have been collected. */
function activate(state: ShiftState): ShiftState {
  if (state.deadline !== null) return state
  const arrival = state.level.arrivals[state.receipts]
  if (!arrival || state.collected < arrival.after) return state
  return { ...state, deadline: arrival.moves }
}

export function initialState(level: LevelDef): ShiftState {
  return activate({
    level,
    stacks: level.stacks.map((s) => [...s]),
    next: 1,
    collected: 0,
    rehandles: 0,
    receipts: 0,
    deadline: null,
    status: 'playing',
    operations: 0,
    shiftMs: level.shiftSeconds * 1000,
    truckMs: truckAllowanceMs(level, 0),
    truckAllowanceMs: truckAllowanceMs(level, 0),
    overtime: false,
    pauses: [],
    score: 0,
    combo: 0,
    bestCombo: 0,
    golds: 0,
    bonusMs: bonusWindowMs(level, 1),
    failure: null,
  })
}

/** The window, ms, that opens when `id` becomes the next required container (0 when it is not a bonus). */
function bonusWindowMs(level: LevelDef, id: number): number {
  return level.bonusIds.includes(id) && id <= level.count ? Math.round(level.bonusWindowSeconds * 1000) : 0
}

/** The container the waiting incoming truck carries, or undefined when no truck waits. */
export function waitingArrival(state: ShiftState): number | undefined {
  return state.deadline === null ? undefined : state.level.arrivals[state.receipts]?.id
}

/** The stack whose top container is the next required one, or -1. */
export function exposedNextStack(state: ShiftState): number {
  return state.stacks.findIndex((s) => s.length > 0 && s[s.length - 1] === state.next)
}

function hasStack(state: ShiftState, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < state.stacks.length
}

/** Why `action` is illegal in `state`, or null when it is legal. The single legality rule set. */
function placeRejection(state: ShiftState, id: number, to: number): Rejection | null {
  const dest = state.stacks[to]!
  if (dest.length >= state.level.capacity) return reject('stack-full')
  const heavy = state.level.heavy
  if (heavy.includes(id) && dest.length > 0 && !heavy.includes(dest[dest.length - 1]!)) return reject('heavy')
  return null
}

export function rejectionFor(state: ShiftState, action: ShiftAction): Rejection | null {
  if (action.type === 'pause' || action.type === 'resume') return null
  if (state.status !== 'playing') return reject('shift-over')
  if (state.pauses.includes('animation')) return reject('crane-busy')
  if (action.type === 'receive') {
    const id = waitingArrival(state)
    if (id === undefined) return reject('no-truck')
    if (!hasStack(state, action.to)) return reject('no-such-stack')
    return placeRejection(state, id, action.to)
  }
  if (state.deadline === 0) return reject('receive-first')
  if (action.type === 'collect') {
    if (action.from === undefined) return exposedNextStack(state) < 0 ? reject('not-exposed') : null
    if (!hasStack(state, action.from)) return reject('no-such-stack')
    const stack = state.stacks[action.from]!
    if (stack.length === 0) return reject('empty-stack')
    return stack[stack.length - 1] === state.next ? null : reject('wrong-order')
  }
  const { from, to } = action
  if (!hasStack(state, from) || !hasStack(state, to)) return reject('no-such-stack')
  if (from === to) return reject('same-stack')
  if (state.stacks[from]!.length === 0) return reject('empty-stack')
  if (state.stacks[to]!.length >= state.level.capacity) return reject('stack-full')
  if (state.rehandles >= state.level.maxRehandles) return reject('rehandle-cap')
  const stack = state.stacks[from]!
  return placeRejection(state, stack[stack.length - 1]!, to)
}

function isComplete(state: ShiftState): boolean {
  return (
    state.collected >= state.level.count &&
    state.receipts >= state.level.arrivals.length &&
    state.stacks.every((s) => s.length === 0)
  )
}

/** Counts down the waiting truck's deadline, then activates the next truck (so a triggering move never counts). */
function afterMove(state: ShiftState, events: ShiftEvent[]): ShiftState {
  const counted = state.deadline === null ? state : { ...state, deadline: Math.max(0, state.deadline - 1) }
  return arrive(counted, events)
}

function arrive(state: ShiftState, events: ShiftEvent[]): ShiftState {
  const next = activate(state)
  if (next !== state) events.push({ type: 'arrival', id: waitingArrival(next)!, moves: next.deadline! })
  if (isComplete(next)) {
    events.push({ type: 'completed' })
    return { ...next, status: 'complete' }
  }
  return next
}

/**
 * Applies a legal action (no legality check: call `rejectionFor` first). Pure; the solver and `createShift` share it.
 */
export function applyAction(state: ShiftState, action: ShiftAction): { state: ShiftState; events: ShiftEvent[] } {
  if (action.type === 'pause' || action.type === 'resume') {
    return { state: withPause(state, action.reason, action.type === 'pause'), events: [] }
  }
  return withClocks(state, action, withScore(state, action, applyMove(state, action)))
}

/**
 * Score, combo, golds, bonus window and shift-time rewards of a move, judged against the state before it (the bonus
 * and quick service are evaluated when the action starts). Receipts do not touch the bonus window.
 */
function withScore(
  before: ShiftState,
  action: Exclude<ShiftAction, { type: 'pause' | 'resume' }>,
  moved: { state: ShiftState; events: ShiftEvent[] },
): { state: ShiftState; events: ShiftEvent[] } {
  const s = moved.state
  const events = moved.events
  const quick = before.truckMs > 0 ? QUICK_SERVICE_MS : 0
  let next: ShiftState
  if (action.type === 'rehandle') {
    next = { ...s, combo: 0, score: before.score + rehandlePoints(action.from, action.to) }
  } else if (action.type === 'receive') {
    next = { ...s, combo: 0, score: before.score + RECEIPT_POINTS, shiftMs: before.shiftMs + quick }
  } else {
    const combo = before.combo + 1
    const id = before.next
    const awarded = before.bonusMs > 0
    const bonusMs = bonusWindowMs(before.level, s.next)
    next = {
      ...s,
      combo,
      bestCombo: Math.max(before.bestCombo, combo),
      score: before.score + collectPoints(combo) + (awarded ? BONUS_POINTS : 0),
      golds: before.golds + (awarded ? 1 : 0),
      shiftMs: before.shiftMs + quick + comboShiftMs(combo) + (awarded ? BONUS_SHIFT_MS : 0),
      bonusMs,
    }
    const extra: ShiftEvent[] = []
    if (awarded) extra.push({ type: 'bonus-awarded', id, points: BONUS_POINTS, ms: BONUS_SHIFT_MS })
    if (bonusMs > 0) extra.push({ type: 'bonus-window', id: s.next, ms: bonusMs })
    // Before 'completed', which `arrive` appends last.
    const at = events.findIndex((e) => e.type === 'completed')
    events.splice(at < 0 ? events.length : at, 0, ...extra)
  }
  return { state: next, events }
}

/** Overtime-start/end events for a change of the next-truck clock. */
function overtimeEvents(before: ShiftState, after: ShiftState): ShiftEvent[] {
  if (!before.overtime && after.overtime) return [{ type: 'overtime-start' }]
  if (before.overtime && !after.overtime) return [{ type: 'overtime-end' }]
  return []
}

function withPause(state: ShiftState, reason: PauseReason, held: boolean): ShiftState {
  if (state.pauses.includes(reason) === held) return state
  return { ...state, pauses: held ? [...state.pauses, reason] : state.pauses.filter((p) => p !== reason) }
}

/**
 * The clock effects of a move: a completed truck operation (collect or receive) resets the next-truck clock to the
 * next allowance; a rehandle adds exactly +1 s to it (never to the shift clock).
 */
function withClocks(
  before: ShiftState,
  action: ShiftAction,
  moved: { state: ShiftState; events: ShiftEvent[] },
): { state: ShiftState; events: ShiftEvent[] } {
  const events = [...moved.events]
  let next: ShiftState
  if (action.type === 'rehandle') {
    next = { ...moved.state, truckMs: before.truckMs + REHANDLE_CREDIT_MS, overtime: false }
    events.push({ type: 'time-credit', ms: REHANDLE_CREDIT_MS })
  } else {
    const operations = before.operations + 1
    const allowance = truckAllowanceMs(before.level, operations)
    next = { ...moved.state, operations, truckMs: allowance, truckAllowanceMs: allowance, overtime: false }
  }
  events.push(...overtimeEvents(before, next))
  return { state: next, events }
}

/** Run both clocks for `dtMs` (capped). The part of the step past the next-truck clock drains the shift faster. */
export function advance(state: ShiftState, dtMs: number): { state: ShiftState; events: ShiftEvent[] } {
  if (state.status !== 'playing' || state.pauses.length > 0 || !(dtMs > 0)) return { state, events: [] }
  const dt = Math.min(dtMs, MAX_STEP_MS)
  const over = Math.max(0, dt - state.truckMs)
  const shiftMs = Math.max(0, state.shiftMs - dt - (state.level.overtimeMultiplier - 1) * over)
  const truckMs = Math.max(0, state.truckMs - dt)
  // The bonus window waits while a receipt is forced (pauses already stop the whole tick).
  const bonusMs = state.deadline === 0 ? state.bonusMs : Math.max(0, state.bonusMs - dt)
  let next: ShiftState = { ...state, shiftMs, truckMs, overtime: truckMs === 0, bonusMs }
  const events = overtimeEvents(state, next)
  if (state.bonusMs > 0 && bonusMs === 0) events.push({ type: 'bonus-missed', id: state.next })
  if (shiftMs === 0) {
    next = { ...next, status: 'failed', failure: { reason: 'timeout', message: TIMEOUT_MESSAGE } }
    events.push({ type: 'failed', reason: 'timeout' })
  }
  return { state: next, events }
}

function applyMove(state: ShiftState, action: Exclude<ShiftAction, { type: 'pause' | 'resume' }>): { state: ShiftState; events: ShiftEvent[] } {
  const stacks = state.stacks.map((s) => [...s])
  if (action.type === 'receive') {
    const id = waitingArrival(state)!
    stacks[action.to]!.push(id)
    const events: ShiftEvent[] = [{ type: 'received', id, to: action.to }]
    return { state: arrive({ ...state, stacks, receipts: state.receipts + 1, deadline: null }, events), events }
  }
  if (action.type === 'collect') {
    const from = action.from ?? exposedNextStack(state)
    const id = stacks[from]!.pop()!
    const events: ShiftEvent[] = [{ type: 'collected', id, from }]
    const next = { ...state, stacks, next: id + 1, collected: state.collected + 1 }
    return { state: afterMove(next, events), events }
  }
  const id = stacks[action.from]!.pop()!
  stacks[action.to]!.push(id)
  const events: ShiftEvent[] = [{ type: 'rehandled', id, from: action.from, to: action.to }]
  return { state: afterMove({ ...state, stacks, rehandles: state.rehandles + 1 }, events), events }
}

export function createShift(level: LevelDef): Shift {
  let state = initialState(level)
  const events: ShiftEvent[] = []
  const listeners = new Set<(event: ShiftEvent) => void>()

  function commit(next: { state: ShiftState; events: ShiftEvent[] }): void {
    state = next.state
    events.push(...next.events)
    for (const e of next.events) for (const l of listeners) l(e)
  }

  return {
    get state() {
      return state
    },
    get events() {
      return events
    },
    dispatch(action: ShiftAction): DispatchResult {
      const rejection = rejectionFor(state, action)
      if (rejection) return { ok: false, state, rejection }
      const next = applyAction(state, action)
      commit(next)
      return { ok: true, state, events: next.events }
    },
    tick(dtMs: number) {
      commit(advance(state, dtMs))
      return state
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

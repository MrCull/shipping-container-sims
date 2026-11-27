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
  'crane-busy': 'The crane is busy.',
}

/** The longest clock step one `tick` applies; a longer stall loses no more than this. */
export const MAX_STEP_MS = 100
/** Next-truck time a valid rehandle adds (never to the shift clock). */
export const REHANDLE_CREDIT_MS = 1000
const TIMEOUT_MESSAGE = 'Time ran out.'

/** The next-truck allowance, ms, after `operations` truck operations have been completed. */
export function truckAllowanceMs(level: LevelDef, operations: number): number {
  return Math.round(level.truckSeconds[Math.min(operations, 2)] * 1000)
}

function reject(reason: RejectReason): Rejection {
  return { reason, message: MESSAGES[reason] }
}

export function initialState(level: LevelDef): ShiftState {
  return {
    level,
    stacks: level.stacks.map((s) => [...s]),
    next: 1,
    collected: 0,
    rehandles: 0,
    status: 'playing',
    operations: 0,
    shiftMs: level.shiftSeconds * 1000,
    truckMs: truckAllowanceMs(level, 0),
    truckAllowanceMs: truckAllowanceMs(level, 0),
    overtime: false,
    pauses: [],
    failure: null,
  }
}

/** The stack whose top container is the next required one, or -1. */
export function exposedNextStack(state: ShiftState): number {
  return state.stacks.findIndex((s) => s.length > 0 && s[s.length - 1] === state.next)
}

function hasStack(state: ShiftState, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < state.stacks.length
}

/** Why `action` is illegal in `state`, or null when it is legal. The single legality rule set. */
export function rejectionFor(state: ShiftState, action: ShiftAction): Rejection | null {
  if (action.type === 'pause' || action.type === 'resume') return null
  if (state.status !== 'playing') return reject('shift-over')
  if (state.pauses.includes('animation')) return reject('crane-busy')
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
  return null
}

/** Overtime-start/end events for a change of the next-truck clock. */
function overtimeEvents(before: ShiftState, after: ShiftState): ShiftEvent[] {
  if (!before.overtime && after.overtime) return [{ type: 'overtime-start' }]
  if (before.overtime && !after.overtime) return [{ type: 'overtime-end' }]
  return []
}

function withPause(state: ShiftState, reason: PauseReason, held: boolean): ShiftState {
  const has = state.pauses.includes(reason)
  if (has === held) return state
  return { ...state, pauses: held ? [...state.pauses, reason] : state.pauses.filter((p) => p !== reason) }
}

function apply(state: ShiftState, action: ShiftAction): { state: ShiftState; events: ShiftEvent[] } {
  if (action.type === 'pause' || action.type === 'resume') {
    return { state: withPause(state, action.reason, action.type === 'pause'), events: [] }
  }
  const stacks = state.stacks.map((s) => [...s])
  if (action.type === 'collect') {
    const from = action.from ?? exposedNextStack(state)
    const id = stacks[from]!.pop()!
    const collected = state.collected + 1
    const events: ShiftEvent[] = [{ type: 'collected', id, from }]
    const done = collected >= state.level.count && stacks.every((s) => s.length === 0)
    const operations = state.operations + 1
    const allowance = truckAllowanceMs(state.level, operations)
    const next: ShiftState = {
      ...state,
      stacks,
      next: id + 1,
      collected,
      status: done ? 'complete' : 'playing',
      operations,
      truckMs: allowance,
      truckAllowanceMs: allowance,
      overtime: false,
    }
    events.push(...overtimeEvents(state, next))
    if (done) events.push({ type: 'completed' })
    return { state: next, events }
  }
  const id = stacks[action.from]!.pop()!
  stacks[action.to]!.push(id)
  const next: ShiftState = {
    ...state,
    stacks,
    rehandles: state.rehandles + 1,
    truckMs: state.truckMs + REHANDLE_CREDIT_MS,
    overtime: false,
  }
  return {
    state: next,
    events: [
      { type: 'rehandled', id, from: action.from, to: action.to },
      { type: 'time-credit', ms: REHANDLE_CREDIT_MS },
      ...overtimeEvents(state, next),
    ],
  }
}

/** Run both clocks for `dtMs` (capped). The part of the step past the next-truck clock drains the shift faster. */
export function advance(state: ShiftState, dtMs: number): { state: ShiftState; events: ShiftEvent[] } {
  if (state.status !== 'playing' || state.pauses.length > 0 || !(dtMs > 0)) return { state, events: [] }
  const dt = Math.min(dtMs, MAX_STEP_MS)
  const over = Math.max(0, dt - state.truckMs)
  const shiftMs = Math.max(0, state.shiftMs - dt - (state.level.overtimeMultiplier - 1) * over)
  const truckMs = Math.max(0, state.truckMs - dt)
  let next: ShiftState = { ...state, shiftMs, truckMs, overtime: truckMs === 0 }
  const events = overtimeEvents(state, next)
  if (shiftMs === 0) {
    next = { ...next, status: 'failed', failure: { reason: 'timeout', message: TIMEOUT_MESSAGE } }
    events.push({ type: 'failed', reason: 'timeout' })
  }
  return { state: next, events }
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
      const next = apply(state, action)
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

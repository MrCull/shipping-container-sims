/**
 * Yardshift rules engine (pure TS: no DOM, timers or Date.now). `createShift(level)` owns every rule; hosts dispatch
 * actions and render `state`. An illegal action returns a typed rejection and changes nothing.
 */
import type {
  DispatchResult,
  LevelDef,
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
  })
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
  if (state.status !== 'playing') return reject('shift-over')
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
      state = next.state
      events.push(...next.events)
      for (const e of next.events) for (const l of listeners) l(e)
      return { ok: true, state, events: next.events }
    },
    tick() {
      return state
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

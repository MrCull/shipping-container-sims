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
  if (state.status !== 'playing') return reject('shift-over')
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

function apply(state: ShiftState, action: ShiftAction): { state: ShiftState; events: ShiftEvent[] } {
  const stacks = state.stacks.map((s) => [...s])
  if (action.type === 'collect') {
    const from = action.from ?? exposedNextStack(state)
    const id = stacks[from]!.pop()!
    const collected = state.collected + 1
    const events: ShiftEvent[] = [{ type: 'collected', id, from }]
    const done = collected >= state.level.count && stacks.every((s) => s.length === 0)
    if (done) events.push({ type: 'completed' })
    return {
      state: { ...state, stacks, next: id + 1, collected, status: done ? 'complete' : 'playing' },
      events,
    }
  }
  const id = stacks[action.from]!.pop()!
  stacks[action.to]!.push(id)
  return {
    state: { ...state, stacks, rehandles: state.rehandles + 1 },
    events: [{ type: 'rehandled', id, from: action.from, to: action.to }],
  }
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
      const next = apply(state, action)
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

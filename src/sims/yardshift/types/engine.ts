/**
 * Yardshift engine types: level data, shift state, actions, rejections and events. Pure data, no DOM.
 * Containers are numbered 1..count and are collected in that order.
 */

/** One level, ported from the V20 prototype as plain data (#382 adds the other twelve and the extra fields). */
export interface LevelDef {
  /** 1-based level number. */
  number: number
  name: string
  /** Yard stacks, each bottom to top. */
  stacks: number[][]
  /** Most containers one stack may hold. */
  capacity: number
  /** Containers to collect in the whole shift (yard plus future receipts). */
  count: number
  /** Hard cap on rehandles; collections stay legal at the cap. */
  maxRehandles: number
}

export type ShiftStatus = 'playing' | 'complete'

/** Read-only shift state. A new object after every accepted action; never mutated in place. */
export interface ShiftState {
  readonly level: LevelDef
  /** Stacks bottom to top. */
  readonly stacks: readonly (readonly number[])[]
  /** The container number that must be collected next (count + 1 once all are collected). */
  readonly next: number
  readonly collected: number
  readonly rehandles: number
  readonly status: ShiftStatus
}

/**
 * Engine actions. `collect` without `from` collects the exposed next required container from whichever stack holds
 * it on top (the collection truck tap); with `from` it collects the top of that stack.
 */
export type ShiftAction =
  | { type: 'collect'; from?: number }
  | { type: 'rehandle'; from: number; to: number }

export type RejectReason =
  | 'shift-over'
  | 'no-such-stack'
  | 'empty-stack'
  | 'wrong-order'
  | 'not-exposed'
  | 'same-stack'
  | 'stack-full'
  | 'rehandle-cap'

export interface Rejection {
  readonly reason: RejectReason
  /** Short message for the player. */
  readonly message: string
}

export type ShiftEvent =
  | { type: 'collected'; id: number; from: number }
  | { type: 'rehandled'; id: number; from: number; to: number }
  | { type: 'completed' }

export type DispatchResult =
  | { ok: true; state: ShiftState; events: ShiftEvent[] }
  | { ok: false; state: ShiftState; rejection: Rejection }

export interface Shift {
  readonly state: ShiftState
  dispatch(action: ShiftAction): DispatchResult
  /** Advance the injected clock. Clocks arrive in #383; a no-op for now. */
  tick(dtMs: number): ShiftState
  /** Every event so far, oldest first. */
  readonly events: readonly ShiftEvent[]
  /** Listen to events as they happen; returns an unsubscribe function. */
  onEvent(listener: (event: ShiftEvent) => void): () => void
}

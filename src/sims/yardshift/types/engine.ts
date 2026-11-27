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
  /** Shift clock length in seconds. */
  shiftSeconds: number
  /**
   * Next-truck allowances in seconds: the first truck operation, the second, then every later one. The tutorial is
   * 30/20/15; other levels are first x 1, 0.5 and 0.28 (`truckSecondsFrom` in modules/levels.ts).
   */
  truckSeconds: readonly [number, number, number]
  /** Total shift drain while the next-truck clock is at 0 (3, the tutorial 2). */
  overtimeMultiplier: number
}

export type ShiftStatus = 'playing' | 'complete' | 'failed'

/**
 * Why the clocks are frozen. Each reason is held and released on its own; the clocks run only when none is held.
 * `intro` (the intro modal), `player` (the pause menu), `animation` (a crane move is playing), `hidden` (the tab).
 */
export type PauseReason = 'intro' | 'player' | 'animation' | 'hidden'

export type FailureReason = 'timeout'

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
  /** Truck operations completed (collections now, receipts from #384); picks the next-truck allowance. */
  readonly operations: number
  /** Shift time left, ms, never negative. */
  readonly shiftMs: number
  /** Next-truck time left, ms, never negative. 0 means overtime. */
  readonly truckMs: number
  /** The allowance the next-truck clock was last reset to, ms. */
  readonly truckAllowanceMs: number
  /** True while the next-truck clock is at 0: the shift drains at the level's overtime multiplier. */
  readonly overtime: boolean
  /** Pause reasons currently held; clocks run only when empty. */
  readonly pauses: readonly PauseReason[]
  /** Set when status is 'failed'. */
  readonly failure: { readonly reason: FailureReason; readonly message: string } | null
}

/**
 * Engine actions. `collect` without `from` collects the exposed next required container from whichever stack holds
 * it on top (the collection truck tap); with `from` it collects the top of that stack.
 */
export type ShiftAction =
  | { type: 'collect'; from?: number }
  | { type: 'rehandle'; from: number; to: number }
  /** Hold a pause reason (clocks freeze). While `animation` is held, moves are rejected as `crane-busy`. */
  | { type: 'pause'; reason: PauseReason }
  /** Release a pause reason. */
  | { type: 'resume'; reason: PauseReason }

export type RejectReason =
  | 'shift-over'
  | 'no-such-stack'
  | 'empty-stack'
  | 'wrong-order'
  | 'not-exposed'
  | 'same-stack'
  | 'stack-full'
  | 'rehandle-cap'
  | 'crane-busy'

export interface Rejection {
  readonly reason: RejectReason
  /** Short message for the player. */
  readonly message: string
}

export type ShiftEvent =
  | { type: 'collected'; id: number; from: number }
  | { type: 'rehandled'; id: number; from: number; to: number }
  | { type: 'completed' }
  /** The next-truck clock hit 0. */
  | { type: 'overtime-start' }
  /** The next-truck clock left 0 (a truck operation reset it, or a rehandle credited +1 s). */
  | { type: 'overtime-end' }
  /** A valid rehandle added time to the next-truck clock. */
  | { type: 'time-credit'; ms: number }
  | { type: 'failed'; reason: FailureReason }

export type DispatchResult =
  | { ok: true; state: ShiftState; events: ShiftEvent[] }
  | { ok: false; state: ShiftState; rejection: Rejection }

export interface Shift {
  readonly state: ShiftState
  dispatch(action: ShiftAction): DispatchResult
  /**
   * Advance the injected clock by `dtMs` (capped at `MAX_STEP_MS`). A no-op while any pause reason is held or the
   * shift is over.
   */
  tick(dtMs: number): ShiftState
  /** Every event so far, oldest first. */
  readonly events: readonly ShiftEvent[]
  /** Listen to events as they happen; returns an unsubscribe function. */
  onEvent(listener: (event: ShiftEvent) => void): () => void
}

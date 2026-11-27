/**
 * Yardshift engine types: level data, shift state, actions, rejections and events. Pure data, no DOM.
 * Containers are numbered 1..count and are collected in that order.
 */

/** An incoming (receipt) truck: it arrives once `after` containers have been collected and earlier trucks are served. */
export interface Arrival {
  /** Collections needed before this truck arrives (0 = at the start). */
  after: number
  /** The container it brings (always a number above every starting container). */
  id: number
  /** Other successful moves (rehandles and collections) allowed before receiving becomes mandatory. */
  moves: number
}

/** One level, ported exactly from the V20 prototype as plain data (`modules/levels.ts`). */
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
  /** Hard cap on rehandles; collections and receipts stay legal at the cap. */
  maxRehandles: number
  /** Shift clock at the start, seconds. */
  shiftSeconds: number
  /** Next-truck allowance for the first, second and every later truck operation, seconds (explicit data). */
  truckSeconds: readonly [number, number, number]
  /** Incoming trucks, served strictly in this order. */
  arrivals: readonly Arrival[]
  /** Heavy containers: placed only on an empty stack or on another heavy container. */
  heavy: readonly number[]
  /** Bonus (star) containers. */
  bonusIds: readonly number[]
  /** Bonus window when a bonus container becomes next, seconds (0 when the level has no bonus). */
  bonusWindowSeconds: number
  /** Total shift drain while the next-truck clock is at 0 (2 on the tutorial, 3 elsewhere). */
  overtimeMultiplier: number
  /** Live tutorial coaching (level 1). */
  tutorialCoaching: boolean
  /** Live heavy-cargo hints when heavy cargo is selected (levels 11 and 12; faded out on 13). */
  heavyHints: boolean
  /** One-line intro tip. */
  tip: string
}

export type ShiftStatus = 'playing' | 'complete' | 'failed'

/**
 * Why the clocks are frozen. Each reason is held and released on its own; the clocks run only when none is held.
 * `intro` (the intro modal), `player` (the pause menu), `animation` (a crane move is playing), `hidden` (the tab).
 */
export type PauseReason = 'intro' | 'player' | 'animation' | 'hidden'

/** `timeout`: the shift clock ran out. `blocked`: no legal move exists (including a mandatory receipt with no space). */
export type FailureReason = 'timeout' | 'blocked'

/** Read-only shift state. A new object after every accepted action; never mutated in place. */
export interface ShiftState {
  readonly level: LevelDef
  /** Stacks bottom to top. */
  readonly stacks: readonly (readonly number[])[]
  /** The container number that must be collected next (count + 1 once all are collected). */
  readonly next: number
  readonly collected: number
  readonly rehandles: number
  /** Incoming trucks served so far; the waiting (or next) truck is `level.arrivals[receipts]`. */
  readonly receipts: number
  /**
   * Moves left before the waiting truck must be received, or null when no truck waits. 0 means mandatory: only
   * `receive` is legal. Every other successful move counts it down; the move that triggers an arrival does not.
   */
  readonly deadline: number | null
  readonly status: ShiftStatus
  /** Truck operations completed (collections and receipts); picks the next-truck allowance. */
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
  /** Arcade score; can go negative. */
  readonly score: number
  /** Consecutive collections; a rehandle or receipt resets it to 0. */
  readonly combo: number
  /** Highest combo this shift. */
  readonly bestCombo: number
  /** Bonus containers collected within their window. */
  readonly golds: number
  /**
   * Bonus window left for the next required container, ms. Above 0 only while `next` is a bonus container whose
   * window is open: collecting it now awards the bonus. 0 means not eligible (no bonus, or the window ran out).
   * Undo (#386) restores the smaller of now and the snapshot, so it is never refunded.
   */
  readonly bonusMs: number
  /** Shift time earned this shift, ms: quick service, combo chains and bonuses (the result screen's "time earned"). */
  readonly earnedMs: number
  /** Undos left this shift (one per shift). */
  readonly undosLeft: number
  /**
   * The state before the last accepted move (its own `undoSnapshot` is null), or null before the first move and after
   * an undo. `undo` returns to it.
   */
  readonly undoSnapshot: ShiftState | null
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
  /** Unload the waiting incoming truck onto stack `to`. */
  | { type: 'receive'; to: number }
  /** Hold a pause reason (clocks freeze). While `animation` is held, moves are rejected as `crane-busy`. */
  | { type: 'pause'; reason: PauseReason }
  /** Release a pause reason. */
  | { type: 'resume'; reason: PauseReason }
  /**
   * Undo the last move (#386): one per shift, -25 points and -3 s of shift. Restores puzzle, combo, receipts and
   * deadline; the clocks and bonus window keep the smaller of now and the snapshot (no refund, no farming).
   */
  | { type: 'undo' }

export type RejectReason =
  | 'shift-over'
  | 'no-such-stack'
  | 'empty-stack'
  | 'wrong-order'
  | 'not-exposed'
  | 'same-stack'
  | 'stack-full'
  | 'rehandle-cap'
  | 'heavy'
  | 'no-truck'
  | 'receive-first'
  | 'crane-busy'
  | 'nothing-to-undo'
  | 'undo-used'
  | 'undo-low-time'

export interface Rejection {
  readonly reason: RejectReason
  /** Short message for the player. */
  readonly message: string
}

export type ShiftEvent =
  | { type: 'collected'; id: number; from: number }
  | { type: 'rehandled'; id: number; from: number; to: number }
  | { type: 'received'; id: number; to: number }
  | { type: 'arrival'; id: number; moves: number }
  /** The waiting truck's deadline reached 0: receiving is now mandatory. */
  | { type: 'deadline-zero'; id: number }
  | { type: 'completed' }
  /** The next-truck clock hit 0. */
  | { type: 'overtime-start' }
  /** The next-truck clock left 0 (a truck operation reset it, or a rehandle credited +1 s). */
  | { type: 'overtime-end' }
  /** A valid rehandle added time to the next-truck clock. */
  | { type: 'time-credit'; ms: number }
  | { type: 'failed'; reason: FailureReason }
  /** A bonus container became the next required one: its window of `ms` opened. */
  | { type: 'bonus-window'; id: number; ms: number }
  /** A bonus container was collected within its window. */
  | { type: 'bonus-awarded'; id: number; points: number; ms: number }
  /** A bonus window ran out: the container is ordinary cargo now. */
  | { type: 'bonus-missed'; id: number }
  /** The last move was undone (score and shift costs applied). */
  | { type: 'undone'; points: number; ms: number }

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

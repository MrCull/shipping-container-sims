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
  /** Incoming trucks served so far; the waiting (or next) truck is `level.arrivals[receipts]`. */
  readonly receipts: number
  /**
   * Moves left before the waiting truck must be received, or null when no truck waits. 0 means mandatory: only
   * `receive` is legal. Every other successful move counts it down; the move that triggers an arrival does not.
   */
  readonly deadline: number | null
  readonly status: ShiftStatus
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

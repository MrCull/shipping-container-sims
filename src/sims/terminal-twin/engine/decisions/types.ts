/**
 * Decision-point contract (TOS seams).
 *
 * Every decision point has a typed, plain-JSON request and reply, a contract
 * version and a correlation id per call. A handler receives a
 * `DecisionRequestMessage` and returns a reply, synchronously or as a
 * Promise. The shape is message-like on purpose: an ActiveMQ request/reply or
 * REST adapter is "just a handler" that serialises the message and awaits the
 * reply, with no engine change.
 *
 * Add a decision point: add its request to `DecisionRequests`, its reply to
 * `DecisionReplies` and its version to `DECISION_CONTRACT_VERSIONS`, then
 * register 1–3 strategies in `strategies.ts` and a reply reactor in the
 * subsystem that asks (see the agent guide).
 */
import type { SimQuery } from '../query'

// ── stsGroundPosition ──────────────────────────────────────────────────────

export interface GroundPositionRequest {
  stsId: string
  containerId: string
  /** The crane's ground positions in lane order, with current occupancy. */
  groundPositions: { id: string; lane: number; occupiedBy: string | null }[]
}

export interface GroundPositionReply {
  /** Chosen ground position, or null if none is available (STS waits). */
  groundPositionId: string | null
}

// ── catalogue ──────────────────────────────────────────────────────────────

export interface DecisionRequests {
  stsGroundPosition: GroundPositionRequest
}

export interface DecisionReplies {
  stsGroundPosition: GroundPositionReply
}

export type DecisionPointId = keyof DecisionRequests

/** Bump a decision point's version when its request or reply shape changes. */
export const DECISION_CONTRACT_VERSIONS: Record<DecisionPointId, number> = {
  stsGroundPosition: 1,
}

export const DECISION_POINT_IDS = Object.keys(DECISION_CONTRACT_VERSIONS) as DecisionPointId[]

/** The message a handler receives. Plain JSON. */
export interface DecisionRequestMessage<K extends DecisionPointId = DecisionPointId> {
  /** Unique per call within a run, e.g. "stsGroundPosition-7". */
  correlationId: string
  decisionPoint: K
  version: number
  /** Sim time (s) at which the request was sent. */
  t: number
  payload: DecisionRequests[K]
}

/**
 * A decision-point handler. `query` is a live read-only view of engine state
 * at the time of the call (a remote TOS would not have it; it is a
 * convenience for built-in and test handlers).
 */
export type DecisionHandler<K extends DecisionPointId> = (
  message: DecisionRequestMessage<K>,
  query: SimQuery,
) => DecisionReplies[K] | Promise<DecisionReplies[K]>

export type HandlerSet = { [K in DecisionPointId]: DecisionHandler<K> }

// ── per-scenario configuration ─────────────────────────────────────────────

/**
 * keep-running (default): the sim continues while a decision is pending and
 * the waiting equipment idles. pause: the sim clock freezes until all pending
 * decisions resolve.
 */
export type AsyncMode = 'keep-running' | 'pause'

export type LatencyDelay =
  | { kind: 'none' }
  | { kind: 'fixed'; ms: number }
  | { kind: 'uniform'; minMs: number; maxMs: number }
  | { kind: 'exponential'; meanMs: number }

export interface LatencySpec {
  delay?: LatencyDelay
  /** % of calls whose reply never arrives (the decision times out). */
  timeoutPct?: number
  /** % of calls whose reply is an error (arrives after the delay). */
  errorPct?: number
}

export interface DecisionPointConfig {
  /** Built-in strategy name (default: the decision point's default strategy). */
  strategy?: string
  /** Built-in strategy that answers on timeout or error (default: the default strategy). */
  fallbackStrategy?: string
  /** A reply later than this is a timeout (default DEFAULT_DECISION_TIMEOUT_MS). */
  timeoutMs?: number
  /** Latency injector (default: none). */
  latency?: LatencySpec
}

export interface DecisionsConfig {
  asyncMode?: AsyncMode
  /**
   * How injected latency (wall ms) maps to sim time in keep-running mode:
   * sim seconds per wall second (default 1 = real time).
   */
  simSecondsPerWallSecond?: number
  points?: { [K in DecisionPointId]?: DecisionPointConfig }
}

export const DEFAULT_DECISION_TIMEOUT_MS = 5000

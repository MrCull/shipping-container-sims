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
import type { YardStacks } from '../yardLayout'
import type { ContainerSize } from '../../scenario/types'

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

// ── shcDispatch ────────────────────────────────────────────────────────────

/** An open job in the released pool: a box on an STS ground position waiting for an SHC. */
export interface ShcDispatchJob {
  jobId: string
  containerId: string
  groundPositionId: string
  stsId: string
  /** Sim time the box was grounded. */
  readyAt: number
  /** Where the box is (m). */
  x: number
  z: number
  /** Lane-graph route length from the SHC to the box (m). */
  distanceM: number
}

export interface ShcDispatchPad {
  id: string
  blockId: string
  x: number
  z: number
  occupiedBy: string | null
  /** SHC already heading there with a box. */
  claimedBy: string | null
}

/** A free SHC pulls its next job from the released pool. */
export interface ShcDispatchRequest {
  shcId: string
  /** Lane-graph node where the SHC is. */
  nodeId: string
  x: number
  z: number
  /** Open (unclaimed) jobs, oldest first. */
  jobs: ShcDispatchJob[]
  wtpPads: ShcDispatchPad[]
}

export interface ShcDispatchReply {
  /** The job to take, or null (the SHC parks). */
  jobId: string | null
  /** WTP pad to deliver to (required with a job). */
  wtpPadId: string | null
}

// ── yardAllocation ─────────────────────────────────────────────────────────

/**
 * A box was set down on a WTP pad: pick its stack slot in the pad's block.
 * The legal slots are derived from the stacks with `candidateSlots(request)`
 * (exported from the engine), which keeps the request small: per-stack heights
 * instead of a candidate list.
 */
export interface YardAllocationRequest extends YardStacks {
  containerId: string
  size: ContainerSize
  full: boolean
  line: string
  /** Vessel the box was discharged from. */
  vesselId: string
  wtpPadId: string
  /** Uniform [0, 1) drawn from the engine's seeded RNG (the only source of randomness for strategies). */
  random: number
}

export interface YardAllocationReply {
  /** Slot (anchor cell `<block>:<bay>-<row>-<tier>`), or null when the block has no room (the box stays on the pad). */
  slotId: string | null
}

// ── berthAllocation ────────────────────────────────────────────────────────

export interface BerthAllocationRequest {
  vesselId: string
  sizeClass: string
  /** Length over all (m). */
  loaM: number
  quayLengthM: number
  /** Minimum clear distance to a neighbouring vessel (m). */
  berthGapM: number
  /** Quay stretches taken by vessels mooring, berthed or unmooring (stern X → bow X), ascending. */
  occupied: { vesselId: string; fromX: number; toX: number }[]
  arrivedAtS: number
}

export interface BerthAllocationReply {
  /** Stern position along the quay, or null: no berth now (the vessel waits at anchorage). */
  berthX: number | null
}

// ── craneSplit ─────────────────────────────────────────────────────────────

export interface CraneSplitRequest {
  vesselId: string
  berthX: number
  maxSts: number
  /** Minimum distance between neighbouring gantry centres (m). */
  stsMinSpacingM: number
  /** Bays that have discharge work, ascending, with their gantry X and number of moves. */
  bays: { bay: number; x: number; moves: number }[]
  /**
   * Every STS in rail order. `vesselId` is the vessel it is assigned to (null = free);
   * `vesselBerthX` is that vessel's stern X, so a strategy can tell which side it is on.
   */
  cranes: { stsId: string; railIndex: number; gantryX: number; vesselId: string | null; vesselBerthX: number | null }[]
}

export interface CraneSplitReply {
  /**
   * Free cranes to assign, each with a contiguous ascending bay range. Crane
   * order on the rail must match bay order, every work bay must be covered
   * exactly once, and no crane of another vessel may sit between the chosen
   * cranes or on the wrong side of them. An empty list = no cranes yet (the
   * vessel waits; the split is asked again when a crane becomes free).
   */
  assignments: { stsId: string; bays: number[] }[]
}

// ── catalogue ──────────────────────────────────────────────────────────────

export interface DecisionRequests {
  stsGroundPosition: GroundPositionRequest
  shcDispatch: ShcDispatchRequest
  yardAllocation: YardAllocationRequest
  berthAllocation: BerthAllocationRequest
  craneSplit: CraneSplitRequest
}

export interface DecisionReplies {
  stsGroundPosition: GroundPositionReply
  shcDispatch: ShcDispatchReply
  yardAllocation: YardAllocationReply
  berthAllocation: BerthAllocationReply
  craneSplit: CraneSplitReply
}

export type DecisionPointId = keyof DecisionRequests

/** Bump a decision point's version when its request or reply shape changes. */
export const DECISION_CONTRACT_VERSIONS: Record<DecisionPointId, number> = {
  stsGroundPosition: 1,
  shcDispatch: 1,
  yardAllocation: 1,
  berthAllocation: 1,
  craneSplit: 1,
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

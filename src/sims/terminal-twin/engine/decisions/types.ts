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
import type { YardCandidate, YardStacks } from '../yardLayout'
import type { ContainerSize, TransitDirection, TruckTransactionKind } from '../../scenario/types'

// ── stsGroundPosition ──────────────────────────────────────────────────────

export interface GroundPositionRequest {
  stsId: string
  containerId: string
  /**
   * 'load' (TT-10): the box is an export box on its way to the crane (an ASC fetched it,
   * an SHC will deliver it); absent = a discharged box the crane is holding.
   */
  direction?: 'load'
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
  /** Where the box is (m); for a load job, the WTP pad it stands on. */
  x: number
  z: number
  /** 'load' (TT-10): an export box on a WTP pad, to be carried to `groundPositionId`; absent = a discharged box to be carried to a pad. */
  kind?: 'load'
  /** Load jobs: the pad the box stands on (the reply's `wtpPadId` is ignored for them). */
  padId?: string
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
  /**
   * Kind of the job this SHC delivered last ('discharge': it just set a box down on a WTP pad; 'load': on an STS ground
   * position). Only sent under the `paired-dual-cycle` strategy (TT-R14), so other event logs are unchanged.
   */
  lastJobKind?: 'discharge' | 'load'
  /** Open (unclaimed) jobs, oldest first. */
  jobs: ShcDispatchJob[]
  wtpPads: ShcDispatchPad[]
}

export interface ShcDispatchReply {
  /**
   * The job to take, or null (the SHC parks). A discharge job then triggers a `wtpPadSelection` request
   * for its pad (V11-11); a load job carries its own pad.
   */
  jobId: string | null
}

// ── wtpPadSelection ────────────────────────────────────────────────────────

/**
 * SHC dispatch picked a discharge job (V11-11): which WTP pad does the SHC set the box down on?
 * The SHC holds the job (it is no longer open) while the request is pending. Load jobs never ask:
 * they name the pad the box stands on.
 */
export interface WtpPadSelectionRequest {
  shcId: string
  jobId: string
  containerId: string
  stsId: string
  groundPositionId: string
  /** Where the box stands now (m): the crane's ground position. */
  x: number
  z: number
  /** Every pad, in list order, with its occupancy and claim at the time of the request. */
  wtpPads: ShcDispatchPad[]
}

export interface WtpPadSelectionReply {
  /** A free pad (`wtpPads[]` with no occupant and no claim), or null: none now (the SHC releases the job and parks). */
  wtpPadId: string | null
}

// ── yardAllocation ─────────────────────────────────────────────────────────

/**
 * A box was set down on a WTP pad: pick its stack slot in the pad's block.
 * The legal slots are derived from the stacks with `candidateSlots(request)`
 * (exported from the engine), which keeps the request small: per-stack heights
 * instead of a candidate list.
 */
/**
 * What the `grouped` yard strategy needs to know about a box (spec #106, #111): the stored properties that
 * decide which group it belongs to and where it stands in that group's stacking order.
 */
export interface YardBoxView {
  direction: TransitDirection
  line: string
  size: ContainerSize
  /** ISO type code (e.g. 22G1, 45R1). */
  isoType: string
  /** Outbound vessel of an export or transshipment box (absent: it leaves by truck or on a call outside the scenario). */
  outboundVesselId?: string
  pod: string
  weightClass: 'LIGHT' | 'MEDIUM' | 'HEAVY'
  /** Sim time (s) the box is planned to leave. */
  plannedDepartureS: number
}

export interface YardAllocationRequest extends YardStacks {
  containerId: string
  size: ContainerSize
  full: boolean
  line: string
  /** Vessel the box was discharged from, or (an export delivered by a truck) the vessel it is booked to. */
  vesselId: string
  /**
   * The WTP pad the box stands on; for a box delivered by a truck (TT-13) empty, with `stallId` set instead
   * (and `wtpX`/`wtpZ` = the stall, so distance-based strategies measure from where the box is).
   */
  wtpPadId: string
  /** TT-13: the transfer stall the delivering truck stands in. */
  stallId?: string
  /**
   * The box's grouping properties and the top box of every stack (same indexing as `heights`, null = empty). Sent
   * only when the active strategy is `grouped` (so the event log of every other run stays as it was); absent in
   * the pre-fill, whose boxes do not exist yet (the pre-fill of a grouped yard sends them from the box's planned properties).
   */
  box?: YardBoxView
  stackTops?: (YardBoxView | null)[]
  /** Pre-fill of a grouped yard (#149): never stack the box on another group (the handler may still return null for a block with no such stack). */
  sameGroupOnly?: true
  /** Uniform [0, 1) drawn from the engine's seeded RNG (the only source of randomness for strategies). */
  random: number
}

export interface YardAllocationReply {
  /** Slot (anchor cell `<block>:<bay>-<row>-<tier>`), or null when the block has no room (the box stays on the pad). */
  slotId: string | null
}

// ── ascDispatch ────────────────────────────────────────────────────────────

/** One ASC of the block that could take the job (idle now). */
export interface AscDispatchCandidate {
  ascId: string
  /** Position on the rail: waterside ASC1 or landside ASC2. */
  side: 'waterside' | 'landside'
  /** Gantry position (Z, m). */
  gantryZ: number
  /** Jobs this ASC has taken so far. */
  jobs: number
  /** Seconds spent on cycles and yield moves so far. */
  busyS: number
  /** The crane can do the job without breaking the no-passing rule (the other ASC is out of the way or can step aside). */
  canServe: boolean
  /** The other ASC (idle) would have to step aside first. */
  needsYield: boolean
}

/**
 * A block with two ASCs has an open box (allocated, SHC cleared) and at least
 * one idle ASC: which ASC takes it? Only WTP work exists so far; `kind`
 * leaves room for transfer-stall work (TT-13).
 */
export interface AscDispatchRequest {
  blockId: string
  job: {
    jobId: string
    containerId: string
    /** wtp: stack a box from a pad; transfer: truck handover (TT-13); retrieve: export box from the stack to a pad (TT-10; `yardSlotId` is its source, `wtpPadId` its destination). */
    kind: 'wtp' | 'transfer' | 'retrieve' | 'rehandle'
    /** `transfer` (TT-13): a truck at a transfer stall; `stallId` is its stall, `wtpPadId` is empty. */
    stallId?: string
    /** TT-R17: a `transfer` pick retrieval the truck has not yet arrived for (its stall is reserved); only offered with the `pre-retrieval` strategy. */
    early?: true
    wtpPadId: string
    yardSlotId: string
    /** Gantry Z of the pad and of the slot (m). */
    padZ: number
    slotZ: number
  }
  /** Idle ASCs, waterside first. */
  candidates: AscDispatchCandidate[]
  /** Both ASCs with their status (the other one may be busy). */
  ascs: { ascId: string; side: 'waterside' | 'landside'; status: string; gantryZ: number }[]
  /** Minimum distance between ASC centres (m). */
  minSeparationM: number
}

export interface AscDispatchReply {
  /** The idle ASC to take the box, or null to leave it open for now (asked again when the block changes). */
  ascId: string | null
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

// ── workPackageRelease ─────────────────────────────────────────────────────

/** One of a crane's work packages as the release decision sees it. */
export interface WorkPackageInfo {
  packageId: string
  /** `hatch-remove` / `hatch-replace` (TT-R09) are hatch cover moves: `moves` 0, section `deck`. */
  kind: 'discharge' | 'load' | 'hatch-remove' | 'hatch-replace'
  section: 'deck' | 'hold'
  bay: number
  moves: number
  status: 'planned' | 'released' | 'active' | 'complete'
}

/**
 * Which of a crane's packages to release next. Asked when the crane is assigned
 * to a vessel and whenever a package starts or completes. The default strategy
 * keeps `k` packages released ahead of the one being worked.
 */
export interface WorkPackageReleaseRequest {
  stsId: string
  vesselId: string
  /** Packages to keep released ahead of the active one (`config.workPackages.releaseAhead`, default 2). */
  k: number
  /** All the crane's packages in work order (planned, released, active and complete). */
  packages: WorkPackageInfo[]
}

export interface WorkPackageReleaseReply {
  /** Packages to release now (planned ones of this crane). Must release something while the crane has no released package left. */
  packageIds: string[]
}

// ── emptyAllocation ────────────────────────────────────────────────────────

/** An empty container in the yard that could be assigned (reachable: on top of its stack, not yet allocated). */
export interface EmptyCandidate {
  containerId: string
  blockId: string
  /** Anchor cell `<block>:<bay>-<row>-<tier>`. */
  slotId: string
  bay: number
  row: number
  tier: number
  /** Plan distance from the block's WTP pads (m). */
  distanceM: number
  /** Sim time since which the box has stood in the yard (negative for pre-filled boxes). */
  yardSince: number
  /**
   * Set only when the `iso-type-best-position` strategy is selected (spec #106; the request shape of the older
   * strategies is unchanged): the box's ISO type and line, how many boxes stand on it (0 = on top, reachable; more
   * means the ASC rehandles them first), the rank of its block by WTP pad distance to the crane's gantry (0 = the block
   * serving the vessel) and how many neighbouring stacks hold an empty already allocated to a package.
   */
  isoType?: string
  line?: string
  boxesOnTop?: number
  blockRank?: number
  adjacentAllocated?: number
}

/**
 * A released load work package needs `count` empties of `size` and `line` (TT-11): which of the
 * yard's matching empties go? Asked once at least `count` candidates exist.
 */
export interface EmptyAllocationRequest {
  packageId: string
  stsId: string
  vesselId: string
  size: ContainerSize
  line: string
  count: number
  /**
   * Set only with `iso-type-best-position`: the ISO type the empties must have, and whether the line must match
   * (`config.emptyAllocation.matchLine`). The candidates then include buried empties (see `EmptyCandidate.boxesOnTop`).
   */
  isoType?: string
  matchLine?: boolean
  /** Matching empties in the yard, in container id order. */
  candidates: EmptyCandidate[]
}

export interface EmptyAllocationReply {
  /** Exactly `count` distinct candidates, in the order the vessel loads them. */
  containerIds: string[]
}

// ── rehandleTarget ─────────────────────────────────────────────────────────

/** A legal slot for a rehandled box, with what is already stacked there. */
export interface RehandleCandidate extends YardCandidate {
  /**
   * Retrieval rank of the soonest-needed export box already in the stack (0 = the
   * next box the block must retrieve), or null when no box there will be retrieved.
   * A rehandled box placed here buries that box unless its own rank is lower.
   */
  soonestRank: number | null
}

/**
 * An export retrieval is blocked: `containerId` stands on top of the box to retrieve.
 * Where in the same block does it go? `candidates` are the legal slots (never the
 * stack being dug out or the blocker's own stack); a 40 ft blocker needs two
 * neighbouring stacks of equal height. Reply with one of them.
 */
export interface RehandleTargetRequest {
  blockId: string
  /** The rehandle's ASC job. */
  jobId: string
  /** The blocking box. */
  containerId: string
  size: ContainerSize
  vesselId: string
  /** Where the blocking box stands now. */
  from: { slotId: string; bay: number; row: number; tier: number; x: number; z: number }
  /** The export box being dug out. */
  retrieval: { containerId: string; slotId: string; jobId: string }
  /** Blockers still on the box to retrieve, this one included (top first). */
  blockersLeft: number
  /** Retrieval rank of the blocking box itself (0 = next, null = never retrieved from this yard). */
  retrievalRank: number | null
  candidates: RehandleCandidate[]
  /** Uniform [0, 1) from the engine's seeded RNG. */
  random: number
}

export interface RehandleTargetReply {
  /** One of `candidates` (anchor cell `<block>:<bay>-<row>-<tier>`), or null when there is none (the retrieval then stays blocked). */
  slotId: string | null
}

// ── gateLaneAssignment ─────────────────────────────────────────────────────

export interface GateLaneOption {
  laneId: string
  /** 0-based position across the gate (west to east). */
  index: number
  /** Free now: no truck is being processed in it. */
  free: boolean
  /** Trucks this lane has processed so far. */
  processed: number
}

/** The truck at the head of the gate queue and at least one free inbound lane: which lane processes it? */
export interface GateLaneAssignmentRequest {
  truckId: string
  transaction: TruckTransactionKind
  /** Trucks in the queue, this one included. */
  queueLength: number
  /** Seconds this truck has waited at the gate. */
  waitedS: number
  /** Every inbound lane, west to east. */
  lanes: GateLaneOption[]
}

export interface GateLaneAssignmentReply {
  /** A free inbound lane (`lanes[].laneId`), or null to leave the truck in the queue for now (asked again when something changes). */
  laneId: string | null
}

// ── transferStallSelection ─────────────────────────────────────────────────

export interface TransferStallOption {
  stallId: string
  blockId: string
  x: number
  z: number
  /** A truck holds the stall (it is assigned or standing there). */
  occupiedBy: string | null
  /** Road distance from the gate kiosk (m). */
  distanceM: number
}

/** A truck is through the gate and at least one transfer stall is free: which stall does it go to? */
export interface TransferStallSelectionRequest {
  truckId: string
  transaction: TruckTransactionKind
  /** What the truck does at the stall; `blockId` = where the box is (a pick) or null (a drop). */
  legs: { kind: 'drop' | 'pick'; purpose: 'export' | 'import' | 'empty'; containerId: string; size: ContainerSize; blockId: string | null }[]
  stalls: TransferStallOption[]
  /** Per block: trucks that hold a stall or wait for one (the ASC work queue the truck would join). */
  blockLoad: Record<string, number>
}

export interface TransferStallSelectionReply {
  /** A free stall (`stalls[].stallId`), or null to hold the truck at the gate for now (asked again when a stall frees up). */
  stallId: string | null
}

// ── catalogue ──────────────────────────────────────────────────────────────

export interface DecisionRequests {
  stsGroundPosition: GroundPositionRequest
  shcDispatch: ShcDispatchRequest
  wtpPadSelection: WtpPadSelectionRequest
  yardAllocation: YardAllocationRequest
  ascDispatch: AscDispatchRequest
  berthAllocation: BerthAllocationRequest
  craneSplit: CraneSplitRequest
  workPackageRelease: WorkPackageReleaseRequest
  emptyAllocation: EmptyAllocationRequest
  rehandleTarget: RehandleTargetRequest
  gateLaneAssignment: GateLaneAssignmentRequest
  transferStallSelection: TransferStallSelectionRequest
}

export interface DecisionReplies {
  stsGroundPosition: GroundPositionReply
  shcDispatch: ShcDispatchReply
  wtpPadSelection: WtpPadSelectionReply
  yardAllocation: YardAllocationReply
  ascDispatch: AscDispatchReply
  berthAllocation: BerthAllocationReply
  craneSplit: CraneSplitReply
  workPackageRelease: WorkPackageReleaseReply
  emptyAllocation: EmptyAllocationReply
  rehandleTarget: RehandleTargetReply
  gateLaneAssignment: GateLaneAssignmentReply
  transferStallSelection: TransferStallSelectionReply
}

export type DecisionPointId = keyof DecisionRequests

/** Bump a decision point's version when its request or reply shape changes. */
export const DECISION_CONTRACT_VERSIONS: Record<DecisionPointId, number> = {
  stsGroundPosition: 1,
  shcDispatch: 2,
  wtpPadSelection: 1,
  yardAllocation: 1,
  ascDispatch: 1,
  berthAllocation: 1,
  craneSplit: 1,
  workPackageRelease: 2,
  emptyAllocation: 1,
  rehandleTarget: 1,
  gateLaneAssignment: 1,
  transferStallSelection: 1,
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

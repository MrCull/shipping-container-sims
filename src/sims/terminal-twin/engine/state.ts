/**
 * SimState: the complete mutable engine state. It is plain JSON (no class
 * instances, Maps or functions) so a snapshot is a deep copy of it, and it
 * includes the event queue, RNG state and running event-log hash.
 */
import { createDecisionState, type DecisionState } from './decisions/runtime'
import { yardGroupingOn } from './decisions/yardGrouping'
import type { EngineEvent } from './events'
import { HASH_SEED, type HashState } from './hash'
import type { MotionSegment } from './kinematics'
import { createHatchPanels, hatchEnabled, hatchLaydownProblems } from './hatch'
import { laneGraphOf, validateLaneLayout } from './laneGraph'
import { hasLandside, landsideGraphOf } from './landsideGraph'
import type { Reservation } from './reservations'
import { nextRandom, seedState } from './rng'
import { ascStartZ, blockSpecs, PARK_UNTIL_S, railSegmentIds, travelHoistM } from './yardLayout'
import { planCargo, POOL_VESSEL_ID, type SlotPurpose } from '../scenario/bayPlan'
import type { RobBox } from '../scenario/robBays'
import { makeContainerState } from '../scenario/containerFactory'
import type { ContainerProps } from '../scenario/containerProps'
import { sampleDwell } from '../scenario/dwell'
import { planExportYard, type ExportPlacement } from '../scenario/exportYard'
import { DEFAULT_WARM_UP_S } from '../scenario/types'
import type { ContainerSize, ScenarioConfig, SubsystemMode, SubsystemModes, TruckTransactionKind, VesselSizeClass } from '../scenario/types'
import { vesselSlotId as makeVesselSlotId, type CellHalf } from '../scenario/vesselClasses'

/** Kinds of custody owner. `external`: the box left the terminal on a truck (id = the truck). */
export type CustodyKind = 'vesselSlot' | 'sts' | 'groundPosition' | 'shc' | 'wtpPad' | 'asc' | 'yardSlot' | 'truck' | 'external'

export interface CustodyRef {
  kind: CustodyKind
  id: string
}

export interface CustodyRecord {
  t: number
  owner: CustodyRef
  /** Event at which custody changed (null for the scenario's initial placement). */
  eventId: number | null
}

export interface ContainerState {
  id: string
  size: ContainerSize
  full: boolean
  line: string
  /** Vessel the box belongs to: discharged from it, or booked to it for loading. */
  vesselId: string
  custody: CustodyRef
  custodyHistory: CustodyRecord[]
  /** Reefer (R19): only in powered yard rows, at most `REEFER_MAX_TIERS` high. Absent = not a reefer. */
  reefer?: true
  /** Transshipment box (TT-11): the vessel that will load it (null/absent = not a linked transshipment box). */
  onwardVesselId?: string
  /** Transshipment box: slot on the onward vessel it is booked to. */
  onwardSlotId?: string
  /** Transshipment box: how long it stays in the yard before it may load (s). */
  dwellS?: number
  /** Transshipment box: when its dwell ended (set by `TransshipmentReady`). */
  readyAt?: number | null
  /** Sim time since which the box has stood in the yard (negative for pre-filled boxes). */
  yardSince?: number
  /** Empty allocated to a load work package (TT-11): the package id. */
  allocatedTo?: string
  /**
   * Import and empty boxes (TT-13): when a truck may collect it (stacked time + import dwell). Absent = never
   * collected (transshipment boxes and export boxes).
   */
  pickupReadyAt?: number
  /** A truck leg has claimed this box (TT-13): the truck id. Claimed boxes are not offered to other trucks or to empty allocation. */
  truckClaim?: string
  /** Stored properties set once at creation (spec #106): direction, ISO type, POL/POD, weights, carriers, booking. */
  props: ContainerProps
}

export interface VesselSlotState {
  id: string
  vesselId: string
  bay: number
  row: number
  tier: number
  /** On deck (true) or in the hold. */
  deck: boolean
  /** 20 ft half of the cell, or null for a whole (40 ft) cell. */
  half: CellHalf
  /** What the bay plan uses the slot for. Load/transshipment slots are reserved (empty) until TT-10. */
  purpose: SlotPurpose
  containerId: string | null
  /** Load slots: the export box booked to this slot (it is `containerId` once loaded). */
  plannedContainerId?: string | null
  /** Empty-container slot (TT-11): requirement it is booked for; `plannedContainerId` is set when an empty is allocated. */
  emptyReq?: { index: number; size: ContainerSize; line: string; isoType?: string }
}

/**
 * scheduled → (VesselArrived) at-anchorage → (BerthAllocated) mooring →
 * (VesselBerthed) berthed → (VesselWorkComplete) unmooring → (VesselDeparted) departed.
 * A vessel that gets a berth on arrival spends 0 s at anchorage.
 */
export type VesselStatus = 'scheduled' | 'at-anchorage' | 'mooring' | 'berthed' | 'unmooring' | 'departed'

export interface VesselState {
  id: string
  sizeClass: VesselSizeClass
  status: VesselStatus
  arrivedAt: number | null
  berthAllocatedAt: number | null
  /** Stern position along the quay (m), once a berth is allocated. */
  berthX: number | null
  berthedAt: number | null
  workCompletedAt: number | null
  departedAt: number | null
  /** Time from arrival to berth allocation (s), once allocated. */
  anchorageWaitS: number | null
  /** True once the vessel was told to wait at anchorage (no berth on arrival). */
  anchored: boolean
  /** STS cranes currently assigned (crane split), in rail order. */
  stsIds: string[]
  /** Every STS that has worked (or is working) this vessel, in assignment order. */
  stsHistory: string[]
  /** Hatch panels of the vessel's bays (TT-R09), ids into `SimState.hatchPanels`. */
  hatchPanelIds?: string[]
  /** ROB bays (spec #106): never worked, no slots in them, hatch covers stay closed. Absent without ROB bays. */
  robBays?: number[]
  /** The display-only ROB boxes in those bays (slot data, not containers: nothing but the renderers reads them). */
  robBoxes?: RobBox[]
  /** Discharge boxes still on board. */
  remainingDischarge: number
  /** Export boxes still to be loaded (TT-10). */
  remainingLoad: number
}

export type StsStatus =
  | 'idle'
  | 'moving-to-pick'
  | 'carrying'
  | 'returning'
  | 'repositioning'
  | 'waiting-for-rail'
  | 'waiting-for-decision'
  | 'waiting-for-ground-position'
  /** Load flow: the next export box is not on a ground position yet. */
  | 'waiting-for-box'
  /** Load flow: picking the box from its ground position and putting it into its slot. */
  | 'loading'

/**
 * SHC state machine (TT-05):
 *   parked → waiting-for-dispatch → (discharge job: waiting-for-pad, V11-11) → job-assigned (waits for its reservations)
 *   → routing-empty → positioning-at-pickup → locking → lifting
 *   → routing-loaded → positioning-at-dropoff → lowering → unlocking
 *   → clearing (reverses clear of the WTP pad) → available
 *   → waiting-for-dispatch … or → routing-to-parking → parked
 */
export type ShcStatus =
  | 'parked'
  | 'waiting-for-dispatch'
  | 'waiting-for-pad'
  | 'job-assigned'
  | 'routing-empty'
  | 'positioning-at-pickup'
  | 'locking'
  | 'lifting'
  | 'routing-loaded'
  | 'positioning-at-dropoff'
  | 'lowering'
  | 'unlocking'
  | 'clearing'
  | 'available'
  | 'routing-to-parking'
  /** Resting at a queue spot with a box, waiting for a free WTP pad (TT-R12). */
  | 'queuing-for-pad'
  /** Resting at a queue spot, empty, waiting for work (TT-R12, chained dispatch). */
  | 'queuing-for-work'

/** One planned phase event of an SHC trip (the next one is scheduled by the previous). */
export interface ShcPlannedEvent {
  type:
    | 'ShcRoutingEmpty'
    | 'ShcPositioningAtPickup'
    | 'ShcLocking'
    | 'ShcPicked'
    | 'ShcPickedAtWtp'
    | 'ShcRoutingLoaded'
    | 'ShcPositioningAtDropoff'
    | 'ShcLowering'
    | 'ShcUnlocking'
    | 'ShcDroppedAtWtp'
    | 'ShcDroppedAtGround'
    | 'ShcCleared'
    | 'ShcParked'
    | 'ShcQueued'
  at: number
  /** The motion leading up to this event (its payload `segments`). */
  segments: MotionSegment[]
}

export interface ShcState {
  id: string
  status: ShcStatus
  /** Lane-graph node where the SHC rests (or will rest at the end of its plan). */
  nodeId: string
  carrying: string | null
  jobId: string | null
  /** Kind of the last delivered job; set only under `paired-dual-cycle` (TT-R14). */
  lastJobKind?: 'discharge' | 'load'
  /** Current trip's motion (axes x, z, lift); the renderer interpolates from these. */
  motion: MotionSegment[]
  /** Remaining phase events of the current trip. */
  plan: ShcPlannedEvent[]
}

/** A released box waiting for (or being moved by) an SHC. */
export interface ShcJob {
  id: string
  containerId: string
  groundPositionId: string
  stsId: string
  /**
   * X where the box sits in its STS lane (discharge), or where it is to be put
   * down (load).
   */
  x: number
  /** 'load' (TT-10): carry an export box from `wtpPadId` to `groundPositionId`; absent = discharge. */
  kind?: 'load'
  readyAt: number
  /** Claiming SHC (null = open). */
  shcId: string | null
  wtpPadId: string | null
}

export interface WtpPadState {
  id: string
  blockId: string
  containerId: string | null
  /** SHC (or, for a retrieved export box, ASC) that will drop a box here. */
  claimedBy: string | null
}

/**
 * ASC state machine (TT-06):
 *   idle → job-assigned (waits for the pad zone) → routing-to-pad → positioning-at-pad
 *   → locking → lifting → routing-to-slot → positioning-at-slot → unlocking
 *   → releasing (spreader back up) → idle
 */
export type AscStatus =
  | 'idle'
  | 'job-assigned'
  | 'routing-to-pad'
  | 'positioning-at-pad'
  | 'locking'
  | 'lifting'
  | 'routing-to-slot'
  | 'positioning-at-slot'
  | 'unlocking'
  | 'releasing'
  | 'repositioning'

/** One planned phase event of an ASC cycle (the next one is scheduled by the previous). */
export interface AscPlannedEvent {
  type:
    | 'AscRoutingToPad'
    | 'AscPositioningAtPad'
    | 'AscLocking'
    | 'AscPicked'
    | 'AscRoutingToStack'
    | 'AscPositioningAtStack'
    | 'AscRetrieved'
    | 'AscRoutingToWtp'
    | 'AscPositioningAtWtp'
    | 'AscDroppedAtWtp'
    | 'AscRoutingToSlot'
    | 'AscPositioningAtSlot'
    | 'AscUnlocking'
    | 'AscStacked'
    | 'AscReady'
    | 'AscRoutingToTruck'
    | 'AscPositioningAtTruck'
    | 'AscPickedFromTruck'
    | 'AscRoutingToStall'
    | 'AscPositioningAtStall'
    | 'AscDroppedAtStall'
  at: number
  /** The motion leading up to this event (its payload `segments`). */
  segments: MotionSegment[]
}

export interface AscState {
  id: string
  blockId: string
  status: AscStatus
  carrying: string | null
  jobId: string | null
  /** Boxes stacked so far. */
  stacked: number
  /** Axis positions at the end of the currently planned motion: gantry along Z, trolley along X, hoist = box bottom height. */
  gantryZ: number
  trolleyX: number
  hoistY: number
  /** Current cycle's motion (axes gantry, trolley, hoist); the renderer interpolates from these. */
  motion: MotionSegment[]
  /** Remaining phase events of the current cycle. */
  plan: AscPlannedEvent[]
}

/**
 * A box on a WTP pad on its way into the stack. Created when the SHC drops it
 * (which asks yardAllocation); it can be picked once the slot is allocated and
 * the SHC has cleared the pad.
 */
export interface AscJob {
  id: string
  blockId: string
  containerId: string
  wtpPadId: string
  vesselId: string
  /**
   * yardAllocation progress: waiting (one request per block at a time, in drop
   * order, so each sees the stacks the previous reply claimed), asked, claimed,
   * or full (the reply had no slot: the box stays on its pad).
   */
  allocation: 'waiting' | 'asked' | 'claimed' | 'full'
  /** Allocated slot (anchor cell id), null until yardAllocation answers. */
  yardSlotId: string | null
  /** Order in which slots were allocated (stacks are filled in this order). */
  claimSeq: number | null
  /** The SHC has released the box and cleared the pad zone. */
  cleared: boolean
  /** ASC that took the job (null = open). */
  ascId: string | null
  /** An ascDispatch request for this job is pending (twin blocks). */
  dispatch?: 'asked'
  /**
   * 'retrieve' (TT-10): take an export box from the stack (`yardSlotId`) to a WTP
   * pad (`wtpPadId`, chosen when the ASC starts, '' before). Absent = stack a box.
   */
  kind?: 'retrieve' | 'rehandle'
  /**
   * 'rehandle' (TT-12): move a box that blocks an export retrieval to another slot
   * of the same block. `yardSlotId` = the blocker's slot (source), `targetSlotId` =
   * where the rehandleTarget decision sent it (null until it answers), `forJobId` =
   * the retrieval it unblocks.
   */
  targetSlotId?: string | null
  forJobId?: string
  /** Retrieval jobs: a RehandleRequired event has been sent; 'full' = no slot could take a blocker (no more tries). */
  rehandle?: 'required' | 'full'
  /**
   * Truck interchange (TT-13): the job works a transfer stall. A drop job (`kind` absent) lifts the truck's box off the
   * chassis and stacks it; a pick job (`kind` 'retrieve') takes a box out of the stack onto the chassis.
   */
  stallId?: string
  truckId?: string
}

/** Stack heights of a block. Claimed slots count: a slot is claimed when allocated, stacked later. */
export interface YardBlockState {
  id: string
  bays: number
  rows: number
  tiers: number
  /** Bay-major: index (bay-1)*rows + (row-1). */
  heights: number[]
  /** Vessel of each stack's top box (null if empty). */
  topVessels: (string | null)[]
}

/** A box in the stack. The id is its anchor cell; a 40 ft box also covers the next bay. */
export interface YardSlotState {
  id: string
  blockId: string
  bay: number
  row: number
  tier: number
  /** Bays covered (2 = 40 ft). */
  span: 1 | 2
  containerId: string | null
}

export interface ResolvedSubsystemModes {
  /** STS cranes (V11-10). */
  quay: SubsystemMode
  /** Berth allocation and mooring (V11-10). */
  berth: SubsystemMode
  /** The yard: blocks, ASCs and everything behind them (V11-10). */
  yard: SubsystemMode
  shc: SubsystemMode
  asc: SubsystemMode
  /** Trucks, gate and transfer stalls (TT-13). */
  landside: SubsystemMode
}

// ── landside (TT-13) ───────────────────────────────────────────────────────

/** One thing a truck does at its stall: bring a box (drop) or collect one (pick). */
export interface TruckLeg {
  kind: 'drop' | 'pick'
  purpose: 'export' | 'import' | 'empty'
  /** The box: created at arrival for a drop (it rides the chassis), chosen at arrival for a pick (in the yard). */
  containerId: string
  /** Export drops: the vessel the box is booked to (its export window was open on arrival). */
  vesselId?: string
  /** Export drops with a legacy or pre-filled start (V11-14): the slot added to the vessel's bay plan for the new box. */
  slotId?: string
  done: boolean
}

/**
 * queued (gate queue) → in-lane (driving to the kiosk, being processed) → waiting-for-stall → routing-to-stall → at-stall
 * → being-served (the landside ASC works the chassis) → routing-to-exit → (gone: removed at TruckDeparted).
 * With stall admission (TT-R16, `config.landside.holding`) a truck with a reserved stall goes on to routing-to-stall at
 * once, and one without drives to a holding position: in-lane → routing-to-holding → holding → routing-to-stall.
 */
export type TruckStatus =
  | 'queued'
  | 'in-lane'
  | 'waiting-for-stall'
  | 'routing-to-holding'
  | 'holding'
  | 'routing-to-stall'
  | 'at-stall'
  | 'being-served'
  | 'routing-to-exit'

/** One planned phase event of a truck's trip (the next one is scheduled by the previous). */
export interface TruckPlannedEvent {
  type: 'TruckGateIn' | 'TruckRoutingToHolding' | 'TruckAtHolding' | 'TruckRoutingToStall' | 'TruckAtStall' | 'TruckRoutingToExit' | 'TruckGateOut' | 'TruckDeparted'
  at: number
  segments: MotionSegment[]
  /** TruckGateIn: the processing time spent at the kiosk (s). */
  processingS?: number
}

export interface TruckState {
  id: string
  transaction: TruckTransactionKind
  legs: TruckLeg[]
  status: TruckStatus
  arrivedAt: number
  /** Gate queue position while queued (0 = head). */
  queueIndex: number
  laneId: string | null
  outLaneId: string | null
  stallId: string | null
  /** The holding position reserved for the truck from admission until it has left it (TT-R16), else null. */
  holdingId: string | null
  /** When the truck stood in its holding position (TT-R16). */
  holdingAt: number | null
  /** The truck has been reported waiting outside the gate (holding full, TT-R16): reported once per truck. */
  heldOutside: boolean
  /** Landside-graph node the truck is at, or will be at the end of its planned motion. */
  nodeId: string
  /** The box on the chassis. */
  carrying: string | null
  gateStartedAt: number | null
  gateInAt: number | null
  stallAssignedAt: number | null
  /** TT-R18: the truck holds an appointment (it came from the booking system). */
  booked: boolean
  /** TT-R18: seconds spent driving inside so far, and when the current drive began (null while standing). */
  driveS: number
  driveSince: number | null
  atStallAt: number | null
  serviceStartedAt: number | null
  interchangeDoneAt: number | null
  motion: MotionSegment[]
  plan: TruckPlannedEvent[]
}

export interface TransferStallState {
  id: string
  blockId: string
  x: number
  z: number
  /** The truck that holds the stall, from its stall assignment until it has reversed clear. */
  truckId: string | null
}

/** A holding position (TT-R16) and the truck that holds it, from its admission until it has driven out. */
export interface HoldingPositionState {
  id: string
  x: number
  z: number
  truckId: string | null
}

export interface LandsideState {
  /** Own RNG stream (arrivals, transactions, boxes, dwell): the landside never disturbs the other subsystems' draws. */
  rngState: number
  nextTruck: number
  nextBox: number
  /** Index of the next scripted truck. */
  nextScripted: number
  /** Trucks waiting at the gate, in arrival order (the head is served first). */
  queue: string[]
  /** Inbound lanes: the truck being processed, or null when free. */
  inLanes: Record<string, { truckId: string | null; processed: number }>
  /** The truck whose gateLaneAssignment decision is pending. */
  laneAsking: string | null
  stalls: Record<string, TransferStallState>
  /** Trucks through the gate processing but without a stall, in order. */
  stallWaiting: string[]
  /** The truck whose transferStallSelection decision is pending. */
  stallAsking: string | null
  /** Holding positions (TT-R16; empty without `config.landside.holding`). */
  holding: Record<string, HoldingPositionState>
  /** Booked appointment windows (TT-R15); present only when `config.landside.appointments` is set, filled at ScenarioStarted. */
  appointments?: AppointmentBook
}

/** One booked truck visit: its window, its arrival inside the window and the transport orders it carries. */
export interface Appointment {
  id: string
  windowIndex: number
  arriveAtS: number
  transaction: TruckTransactionKind
}

export interface AppointmentBook {
  windowS: number
  capPerWindow: number
  windows: number
  /** Bookings refused because their window was full. */
  rejected: number
  list: Appointment[]
}

export interface LandsideKpiCounters {
  trucksIn: number
  trucksOut: number
  /** Trucks that left the terminal: turn time sums (gate-in → gate-out). */
  turnSumS: number
  turnMaxS: number
  /** Queue wait: arrival → lane assigned. */
  gateWaitSumS: number
  gateWaitMaxS: number
  gateQueueMax: number
  /** Gate-in → stall assigned (a stall was free). */
  stallAllocWaitSumS: number
  stallAllocWaitMaxS: number
  /** At the stall until the landside ASC starts on the truck. */
  stallWaitSumS: number
  stallWaitMaxS: number
  stallWaitCount: number
  /** Time at the stall from arrival to the interchange being done. */
  serviceSumS: number
  /** Arrivals by transaction kind. */
  transactions: Record<TruckTransactionKind, number>
  boxesDropped: number
  boxesPicked: number
  /** Arrivals whose drawn transaction could not be served (no eligible box / vessel), served as a drop empty. */
  fallbacks: number
  /** Trucks admitted past the gate with a stall reserved (TT-R16; this and the counters below stay 0 without `config.landside.holding`). */
  admittedToStall: number
  /** Trucks admitted to a holding position (no stall could take them). */
  admittedToHolding: number
  /** Trucks that waited outside the gate because no stall and no holding position was free (counted once each). */
  heldOutside: number
  /** Most holding positions in use at once (reserved, driving there or standing). */
  holdingMax: number
  /** Standing in a holding position until its stall is assigned (s), over the trucks that got one. */
  holdingWaitSumS: number
  holdingWaitMaxS: number
  holdingWaitCount: number
  /** TT-R18: kiosk processing at the in gate (s), over the trucks that got through (`trucksIn`). */
  gateProcSumS: number
  gateProcMaxS: number
  /** Driving inside the terminal before service (gate to holding position and stall, standing time excluded), per truck that left. */
  driveSumS: number
  driveMaxS: number
  /** Arrival at the gate to gate-out, per truck that left. */
  totalTurnSumS: number
  totalTurnMaxS: number
  /** Trucks driving on the internal roads now / at most, and the integral of the count over time (truck-seconds up to `roadLastT`). */
  roadNow: number
  roadMax: number
  roadBusyS: number
  roadLastT: number
  /** Holding positions occupied (reserved to driving out), integrated over time (position-seconds up to `holdLastT`). */
  holdBusyS: number
  holdLastT: number
  /** Booked trucks that passed the gate after the end of their appointment window. */
  appointmentsDelayed: number
}

export interface StsDrop {
  containerId: string
  groundPositionId: string
  /** When the set-down is planned to end (the scheduled `StsGrounded`); set once the carry is planned (TT-R13). */
  groundAt?: number
}

export interface StsState {
  id: string
  /** Position on the shared rail (0 = lowest X). Cranes never change order. */
  railIndex: number
  status: StsStatus
  vesselId: string | null
  /** Bays of `vesselId` assigned by the crane split (ascending). */
  bays: number[]
  /** Remaining boxes of the active work package, in work order (discharge: top tier first; load: bottom tier first). */
  workQueue: string[]
  /** Axis positions at the end of the currently planned motion. */
  gantryX: number
  trolleyZ: number
  hoistY: number
  /**
   * Rail reservation: the gantry interval this crane may occupy until its
   * current motion ends. Neighbouring reservations keep `stsMinSpacingM` apart.
   */
  railLo: number
  railHi: number
  /** Gantry target the crane is waiting to reach (status `waiting-for-rail`). */
  railTargetX: number | null
  /** A second gantry position the waiting move needs as well (a hatch move visiting the laydown, TT-R09). */
  railAlsoX?: number | null
  /** Boxes on the spreader (two for a twin-20 lift), aft first. */
  carrying: string[]
  /** Ground positions chosen for the carried boxes, in set-down order. */
  drops: StsDrop[]
  /** Motion segments currently planned (renderer interpolates from these). */
  motion: MotionSegment[]
  groundPositionIds: string[]
  /** Since when the STS has been waiting for a free ground position or an export box (null = not waiting). */
  waitingSince?: number | null
  /** The crane's work packages for its current vessel, in work order. */
  packageIds: string[]
  /** The package being worked (its boxes are in `workQueue`). */
  activePackageId: string | null
  /** A work-package-release decision is pending for this crane. */
  releasing?: boolean
  /**
   * The hatch move being worked (TT-R09), from the start of a `hatch-remove` / `hatch-replace` package until the panel
   * is set down. `waiting` = the crane idles for the panel's lashing release.
   */
  hatchJob?: HatchJob | null
  /** The hatch panel on the spreader (never a container, so never in `carrying`). */
  carryingPanel?: string | null
  /** The crane idles until this panel is secured (deck load onto a replaced hatch). */
  hatchWaitPanel?: string | null
  /** Since when the crane has waited for a hatch (lashing release or securing). */
  hatchWaitSince?: number | null
}

/** One hatch move of an STS. */
export interface HatchJob {
  panelId: string
  op: 'remove' | 'replace'
  packageId: string
  /** The crane idles until the panel's lashing is released. */
  waiting: boolean
  /** Handling time (s) added on each side of the carry so the move takes the hatch cycle time. */
  padS: number
  /** Laydown bay of the move. */
  siteId: string | null
  startedAt: number | null
  /** The hatch the panel is carried to when replaced (always its own). */
  target: { vesselId: string; bay: number; index: number }
}

/** secured → unsecured (lashing released) → lifted → in-laydown → lifted → replaced → secured. */
export type HatchPanelStatus = 'secured' | 'unsecured' | 'lifted' | 'in-laydown' | 'replaced'

/**
 * One hatch panel of a vessel bay (TT-R09). Panels are not containers: no custody, no yard slot, never counted as a
 * box. `home` is where the panel lies on the hatch (centre of its top face); `pos` is where it is now (at rest;
 * while `lifted` it is on the spreader of `stsId`).
 */
export interface HatchPanelState {
  id: string
  vesselId: string
  bay: number
  /** Index across the beam, 0 on the quay side. */
  index: number
  /** Rows covered: `rowFrom` inclusive, `rowTo` exclusive. */
  rowFrom: number
  rowTo: number
  lengthM: number
  widthM: number
  weightT: number
  home: { x: number; y: number; z: number }
  pos: { x: number; y: number; z: number }
  status: HatchPanelStatus
  /** The bay has hold work under this panel, so it will be opened. */
  opens: boolean
  /** A lashing release is already scheduled for this opening. */
  lashingScheduled: boolean
  lashingReleasedAt: number | null
  liftedAt: number | null
  /** The crane that has lifted it. */
  stsId: string | null
  /** The laydown bay the panel is claimed for / lies in, and its level in the stack (0 = bottom). */
  siteId: string | null
  level: number | null
  /** Completed open and close cycles. */
  cycles: number
  /** Deck boxes standing on the panel (kept for panels that open). */
  deckBoxes: number
  /** The hatch the panel was last set down on: set by a replacement, must be its own. */
  placedOn: { vesselId: string; bay: number; index: number } | null
}

/** A laydown bay: one stack of panels of one hatch, bottom first. */
export interface HatchLaydownSite {
  id: string
  x: number
  panelIds: string[]
}

export interface GroundPositionState {
  id: string
  stsId: string
  lane: number
  containerId: string | null
  /** Load flow: the export box that will be put down here (reserved before it arrives). */
  claimedBy: string | null
}

export type WorkPackageKind = 'discharge' | 'load' | 'hatch-remove' | 'hatch-replace'
/** planned (not yet released) → released → active (the STS works it) → complete. */
export type WorkPackageStatus = 'planned' | 'released' | 'active' | 'complete'

/**
 * One STS's moves for one bay section (deck or hold) of one vessel, discharge
 * or load (TT-10). The work-package-release decision point releases them; an
 * STS only works released packages, in sequence.
 */
export interface WorkPackage {
  id: string
  stsId: string
  vesselId: string
  kind: WorkPackageKind
  section: 'deck' | 'hold'
  bay: number
  /** The boxes in work order (load: export boxes in load sequence, bottom tiers first). */
  containerIds: string[]
  /** Position in the crane's package sequence (0-based). */
  seq: number
  status: WorkPackageStatus
  releasedAt: number | null
  startedAt: number | null
  completedAt: number | null
  /**
   * Empties package (TT-11): N empties of a size and line to be picked by the `emptyAllocation` decision when the
   * package is released. `containerIds` stays empty until `stage` is 'allocated'.
   */
  emptyReq?: EmptiesRequirement
  /** Hatch packages (TT-R09): the panel this package removes or replaces. */
  hatchPanelId?: string
}

export interface EmptiesRequirement {
  index: number
  size: ContainerSize
  line: string
  /** ISO type the empties must have (`iso-type-best-position`); absent in a snapshot from before spec #106 (derive it from `size`). */
  isoType?: string
  count: number
  /** The package's booked slots in load sequence. */
  slotIds: string[]
  /** pending (not released, or waiting for enough empties) → asked (decision pending) → allocated. */
  stage: 'pending' | 'asked' | 'allocated'
}

/**
 * Load preparation of one export box: from its package's release to its
 * ground position. planned boxes wait for a ground position, then the ASC
 * retrieves them, an SHC carries them.
 */
export interface LoadOrder {
  containerId: string
  vesselId: string
  stsId: string
  packageId: string
  slotId: string
  /** Position in the crane's load sequence (0-based, over all its load packages). */
  seq: number
  stage: 'released' | 'gp-asked' | 'gp-claimed' | 'retrieving' | 'on-pad' | 'to-ground' | 'on-ground'
  groundPositionId: string | null
}

export interface StsKpiCounters {
  moves: number
  cycles: number
  twinLifts: number
  firstMoveStartS: number | null
  lastMoveEndS: number | null
  /** Time spent waiting for the rail (neighbouring cranes) (s). */
  railWaitS: number
  /** When the current rail wait started. */
  railWaitSince: number | null
}

/** Hatch moves of the STS cranes (TT-R09); present once the first one starts. */
export interface HatchKpiCounters {
  removes: number
  replaces: number
  /** STS time on hatch moves (s): start of the move to the panel set down. */
  stsTimeS: number
  /** Crane idle time waiting for a lashing release or a securing (s). */
  waitS: number
  perSts: Record<string, { moves: number; timeS: number; waitS: number }>
}

export interface KpiCounters {
  movesCompleted: number
  vesselsCompleted: number
  perSts: Record<string, StsKpiCounters>
  /** Horizontal transport (present when SHCs are configured). */
  horizontal?: HorizontalKpiCounters
  /** Yard blocks and ASCs (present when blocks are configured with SHCs). */
  yard?: YardKpiCounters
  /** Work packages (TT-10). */
  workPackages: WorkPackageKpiCounters
  /** Hatch moves (TT-R09; present once one has started). */
  hatch?: HatchKpiCounters
  /** Trucks and the gate (present when the landside is on). */
  landside?: LandsideKpiCounters
}

export interface WorkPackageKpiCounters {
  released: number
  started: number
  completed: number
  /** Sum / max of the time from release to the start of work (s). */
  leadTimeSumS: number
  leadTimeMaxS: number
  /** Export boxes loaded. */
  boxesLoaded: number
}

/** Per-ASC counters; the last three exist only for twin-ASC blocks (TT-08). */
export interface AscKpiCounters {
  jobs: number
  gantryM: number
  trolleyM: number
  hoistM: number
  padWaitS: number
  /** Seconds jobs waited for the other ASC's rail segments (twin blocks). */
  railWaitS?: number
  /** Seconds spent on cycles and yield moves (twin blocks). */
  busyS?: number
  /** Times this ASC stepped aside for the other (twin blocks). */
  yields?: number
}

export interface YardKpiCounters {
  boxesStacked: number
  /** Rehandles (blocker moves) and productive ASC moves (stack + retrieve), overall and per block (TT-12). */
  rehandles: number
  productiveMoves: number
  perBlock: Record<string, { rehandles: number; productiveMoves: number }>
  /** rehandleTarget replies with no slot (block full). */
  rehandleFailures: number
  /** yardAllocation replies with no slot (block full). */
  allocationFailures: number
  /**
   * Grouped decking only (absent for every other strategy): placements priced against the grouping preferences, and
   * how many broke one: on another group's box, in the wrong order, or opening a stack in a bay of other groups.
   */
  grouping?: { placements: number; mixedStack: number; orderBroken: number; mixedBay: number }
  perAsc: Record<string, AscKpiCounters>
}

export interface HorizontalKpiCounters {
  boxesToWtp: number
  perShc: Record<string, { jobs: number; emptyDistanceM: number; loadedDistanceM: number; reservationWaitS: number; parkingReturns: number; queueArrivals: number }>
  /** STS seconds spent waiting for a free ground position. */
  stsGroundPositionWaitS: Record<string, number>
}

export interface BerthState {
  /** Arrived vessels without a berth, in arrival order (first is asked about first). */
  queue: string[]
  /** Vessel whose berth-allocation decision is pending (one at a time). */
  allocating: string | null
  /** Berthed vessels waiting for a crane split (no free cranes yet), in berthing order. */
  craneQueue: string[]
  /** Vessel whose crane-split decision is pending. */
  splitting: string | null
}

/** Warm-up start (TT-14): KPIs and end-condition counters restart at `durationS` (`WarmUpEnded`). */
export interface WarmUpState {
  durationS: number
  ended: boolean
  /** Counters at the end of the warm-up (the default end condition counts the vessels still to complete). */
  vesselsCompletedBefore: number
  movesBefore: number
  /** Yard cells (20 ft) per block when the measured period began (the KPI series' starting gauge). */
  cellsAtEnd?: Record<string, number>
}

export interface SimState {
  now: number
  nextEventId: number
  nextSeq: number
  rngState: number
  /** Seed of the container-property streams (spec #106); they are keyed by it and the container id. */
  propsSeed: number
  logHash: HashState
  /** Pending events (binary heap; seq is -1 until processed). */
  queue: EngineEvent[]
  containers: Record<string, ContainerState>
  vesselSlots: Record<string, VesselSlotState>
  vessels: Record<string, VesselState>
  berth: BerthState
  sts: Record<string, StsState>
  groundPositions: Record<string, GroundPositionState>
  shcs: Record<string, ShcState>
  shcJobs: Record<string, ShcJob>
  nextShcJob: number
  /** Queue spot node id -> the SHC that holds it (TT-R12). Exclusive; a spot is held from assignment to departure. */
  queueClaims: Record<string, string>
  wtpPads: Record<string, WtpPadState>
  ascs: Record<string, AscState>
  ascJobs: Record<string, AscJob>
  nextAscJob: number
  nextClaimSeq: number
  yardBlocks: Record<string, YardBlockState>
  yardSlots: Record<string, YardSlotState>
  workPackages: Record<string, WorkPackage>
  nextWorkPackage: number
  /** Hatch panels of the vessels' bays, by id (TT-R09). Not containers. */
  hatchPanels: Record<string, HatchPanelState>
  /** Laydown bays in use on the quay (created on first use). */
  hatchLaydown: Record<string, HatchLaydownSite>
  /** Empties package whose `emptyAllocation` decision is pending (one at a time), or null. */
  emptiesAsking: string | null
  loadOrders: Record<string, LoadOrder>
  reservations: Reservation[]
  nextReservationId: number
  /** Trucks in the terminal (removed when they leave), TT-13. */
  trucks: Record<string, TruckState>
  /** Gate and stall state (present when the landside is on). */
  landside: LandsideState | null
  /** Warm-up start (TT-14): null for every other start. */
  warmUp: WarmUpState | null
  subsystems: ResolvedSubsystemModes
  kpis: KpiCounters
  /** Decision points: correlation counter, injector RNG, pending decisions, handler KPIs. */
  decisions: DecisionState
  /**
   * Pre-filled start (V11-13): present while the pre-run phase is placing boxes. `replies` are the slot ids the
   * yardAllocation handler has answered so far (null = no room in that block), in request order; the pre-fill
   * computation is rebuilt from them after a restore. Removed once the last box is placed.
   */
  prefill?: { replies: (string | null)[] }
  /** Boxes standing in each block at the end of the pre-run, as 20 ft cells (the KPI collector's starting gauge). */
  prefillCells?: Record<string, number>
  ended: { reason: string; t: number } | null
}

export function vesselSlotId(vesselId: string, bay: number, row: number, tier: number, half: CellHalf = null): string {
  return makeVesselSlotId(vesselId, bay, row, tier, half)
}

/** The block's ASC number `index` (1 = waterside, 2 = landside). */
export function ascIdOf(blockId: string, index = 1): string {
  return `${blockId}-ASC${index}`
}

/** 1-based position of an ASC along its block's rail (1 = waterside). */
export function ascIndexOf(ascId: string): number {
  return Number(/-ASC(\d+)$/.exec(ascId)?.[1] ?? 1)
}

export function groundPositionId(stsId: string, lane: number): string {
  return `${stsId}-GP${lane + 1}`
}

/** Check the STS list: rail order, spacing and quay bounds. */
function validateRail(config: ScenarioConfig): void {
  const { lengthM, stsMinSpacingM } = config.quay
  config.sts.forEach((s, i) => {
    if (s.gantryX < 0 || s.gantryX > lengthM) throw new Error(`${s.id}: gantryX ${s.gantryX} is off the quay (0–${lengthM} m)`)
    const prev = config.sts[i - 1]
    if (prev && s.gantryX - prev.gantryX < stsMinSpacingM - 1e-9)
      throw new Error(
        `${prev.id} and ${s.id} must be listed in rail order at least ${stsMinSpacingM} m apart (${prev.gantryX} → ${s.gantryX})`,
      )
  })
}

/** Subsystem modes: config, then overrides. Each defaults to real when its equipment exists. `yard` caps the ASC and landside modes. */
export function resolveSubsystemModes(config: ScenarioConfig, overrides: SubsystemModes = {}): ResolvedSubsystemModes {
  const hasShc = (config.shcs?.length ?? 0) > 0 && (config.yard?.blocks.length ?? 0) > 0
  const hasYard = (config.yard?.blocks.length ?? 0) > 0
  const pick = (key: keyof SubsystemModes, fallback: SubsystemMode): SubsystemMode => overrides[key] ?? config.subsystems?.[key] ?? fallback
  const modes: ResolvedSubsystemModes = {
    quay: pick('quay', config.sts.length > 0 ? 'real' : 'off'),
    berth: pick('berth', 'real'),
    yard: pick('yard', hasYard ? 'real' : 'off'),
    shc: pick('shc', hasShc ? 'real' : 'off'),
    asc: pick('asc', hasShc ? 'real' : 'off'),
    landside: pick('landside', hasLandside(config) ? 'real' : 'off'),
  }
  if (!hasYard) modes.yard = 'off'
  if (config.sts.length === 0) modes.quay = 'off'
  if (!hasShc) modes.shc = 'off'
  if (modes.yard === 'off') modes.asc = 'off'
  else if (modes.yard === 'instant' && modes.asc === 'real') modes.asc = 'instant'
  if (!hasLandside(config) || modes.asc === 'off') modes.landside = 'off'
  return modes
}

/** Landside state: own RNG stream, the gate lanes, the stalls, KPI counters; pool boxes get their pickup dwell. */
function initLandside(state: SimState, config: ScenarioConfig, seed: number): void {
  const graph = landsideGraphOf(config)
  const landside = config.landside as NonNullable<ScenarioConfig['landside']>
  const ls: LandsideState = {
    rngState: seedState((seed ^ 0x5bd1e995) >>> 0),
    nextTruck: 0,
    nextBox: 0,
    nextScripted: 0,
    queue: [],
    inLanes: Object.fromEntries(graph.inLanes.map((l) => [l.id, { truckId: null, processed: 0 }])),
    laneAsking: null,
    stalls: Object.fromEntries(graph.stalls.map((st) => [st.id, { id: st.id, blockId: st.blockId, x: st.x, z: st.z, truckId: null }])),
    stallWaiting: [],
    stallAsking: null,
    holding: Object.fromEntries(graph.holding.map((h) => [h.id, { id: h.id, x: h.x, z: h.z, truckId: null }])),
  }
  const rng = () => {
    const [v, next] = nextRandom(ls.rngState)
    ls.rngState = next
    return v
  }
  for (const box of Object.values(state.containers))
    if (box.vesselId === POOL_VESSEL_ID && box.yardSince !== undefined && box.pickupReadyAt === undefined) box.pickupReadyAt = box.yardSince + sampleDwell(landside.importDwell, rng)
  state.landside = ls
  state.kpis.landside = {
    trucksIn: 0,
    trucksOut: 0,
    turnSumS: 0,
    turnMaxS: 0,
    gateWaitSumS: 0,
    gateWaitMaxS: 0,
    gateQueueMax: 0,
    stallAllocWaitSumS: 0,
    stallAllocWaitMaxS: 0,
    stallWaitSumS: 0,
    stallWaitMaxS: 0,
    stallWaitCount: 0,
    serviceSumS: 0,
    transactions: { dropExport: 0, pickImport: 0, dropEmpty: 0, pickEmpty: 0, dual: 0 },
    boxesDropped: 0,
    boxesPicked: 0,
    fallbacks: 0,
    admittedToStall: 0,
    admittedToHolding: 0,
    heldOutside: 0,
    holdingMax: 0,
    holdingWaitSumS: 0,
    holdingWaitMaxS: 0,
    holdingWaitCount: 0,
    gateProcSumS: 0,
    gateProcMaxS: 0,
    driveSumS: 0,
    driveMaxS: 0,
    totalTurnSumS: 0,
    totalTurnMaxS: 0,
    roadNow: 0,
    roadMax: 0,
    roadBusyS: 0,
    roadLastT: 0,
    holdBusyS: 0,
    holdLastT: 0,
    appointmentsDelayed: 0,
  }
}

export function createInitialState(
  config: ScenarioConfig,
  seed: number,
  subsystems: ResolvedSubsystemModes = resolveSubsystemModes(config),
): SimState {
  validateRail(config)
  const state: SimState = {
    now: 0,
    nextEventId: 0,
    nextSeq: 0,
    rngState: seedState(seed),
    propsSeed: seed,
    logHash: [...HASH_SEED],
    queue: [],
    containers: {},
    vesselSlots: {},
    vessels: {},
    berth: { queue: [], allocating: null, craneQueue: [], splitting: null },
    sts: {},
    groundPositions: {},
    shcs: {},
    shcJobs: {},
    nextShcJob: 0,
    queueClaims: {},
    wtpPads: {},
    ascs: {},
    ascJobs: {},
    nextAscJob: 0,
    nextClaimSeq: 0,
    yardBlocks: {},
    yardSlots: {},
    workPackages: {},
    nextWorkPackage: 0,
    hatchPanels: {},
    hatchLaydown: {},
    emptiesAsking: null,
    loadOrders: {},
    reservations: [],
    nextReservationId: 0,
    trucks: {},
    landside: null,
    warmUp:
      config.yardStart?.mode === 'warmup'
        ? { durationS: config.yardStart.warmUpS ?? DEFAULT_WARM_UP_S, ended: false, vesselsCompletedBefore: 0, movesBefore: 0 }
        : null,
    subsystems,
    kpis: {
      movesCompleted: 0,
      vesselsCompleted: 0,
      perSts: {},
      workPackages: { released: 0, started: 0, completed: 0, leadTimeSumS: 0, leadTimeMaxS: 0, boxesLoaded: 0 },
    },
    decisions: createDecisionState(seed),
    ended: null,
  }
  const plan = planCargo(config, seed)
  for (const v of config.vessels) {
    state.vessels[v.id] = {
      id: v.id,
      sizeClass: v.sizeClass,
      status: 'scheduled',
      arrivedAt: null,
      berthAllocatedAt: null,
      berthX: null,
      berthedAt: null,
      workCompletedAt: null,
      departedAt: null,
      anchorageWaitS: null,
      anchored: false,
      stsIds: [],
      stsHistory: [],
      remainingDischarge: 0,
      remainingLoad: 0,
    }
  }
  for (const [id, bays] of Object.entries(plan.robBays)) {
    state.vessels[id].robBays = [...bays]
    state.vessels[id].robBoxes = plan.rob.filter((b) => b.vesselId === id)
  }
  for (const s of plan.slots) state.vesselSlots[s.id] = { ...s, containerId: null }
  const hatchCovers = hatchEnabled(config) && subsystems.quay !== 'off'
  if (hatchCovers) createHatchPanels(state, config)
  const loading = subsystems.shc !== 'off' && subsystems.asc !== 'off'
  for (const s of plan.slots) if (s.emptyReq && loading) state.vessels[s.vesselId].remainingLoad++
  const startMode = config.yardStart?.mode
  const emptyStart = startMode === 'empty' || startMode === 'warmup'
  const hasYard = blockSpecs(config).length > 0
  if (emptyStart && hasYard && loading && plan.containers.some((c) => c.flow === 'load') && (subsystems.landside === 'off' || !config.landside))
    throw new Error('An empty or warm-up yard start needs the landside: export boxes arrive by truck (add config.landside, or use a pre-filled start)')
  // a pre-filled start places its boxes in the pre-run phase (engine/subsystems/prefill.ts): until then they are outside
  const prefilled = startMode === 'prefilled' && hasYard
  if (prefilled) state.prefill = { replies: [] }
  const placements: ExportPlacement[] = (emptyStart || prefilled) && hasYard ? [] : planExportYard(config, plan)
  const exportPlacement = new Map(placements.map((p) => [p.containerId, p]))
  const outside: CustodyRef = { kind: 'external', id: 'outside' }
  for (const c of plan.containers) {
    let owner: CustodyRef
    if (c.flow === 'load') {
      state.vesselSlots[c.slotId].plannedContainerId = c.id
      if (loading) state.vessels[c.vesselId].remainingLoad++
      // an empty start: the booked box is still outside, a truck brings it during the run
      owner = (emptyStart || prefilled) && hasYard ? { ...outside } : { kind: 'yardSlot', id: (exportPlacement.get(c.id) as { slotId: string }).slotId }
    } else if (c.flow === 'pool') {
      if (emptyStart && hasYard) continue // no empty pool at the start: empties arrive by truck
      owner = prefilled ? { ...outside } : { kind: 'yardSlot', id: (exportPlacement.get(c.id) as { slotId: string }).slotId }
    } else {
      state.vesselSlots[c.slotId].containerId = c.id
      state.vessels[c.vesselId].remainingDischarge++
      owner = { kind: 'vesselSlot', id: c.slotId }
    }
    state.containers[c.id] = makeContainerState({
      id: c.id,
      size: c.size,
      full: c.full,
      line: c.line,
      vesselId: c.vesselId,
      owner,
      t: 0,
      eventId: null,
      reefer: c.reefer,
      props: c.props as ContainerProps,
      yardSince: c.flow === 'pool' ? -(c.ageS ?? 0) : undefined,
      transshipment: c.transshipment,
    })
    if (c.transshipment) {
      if (loading) state.vessels[c.transshipment.onwardVesselId].remainingLoad++
    }
  }
  config.sts.forEach((s, railIndex) => {
    const gpIds: string[] = []
    for (let lane = 0; lane < s.groundPositions; lane++) {
      const id = groundPositionId(s.id, lane)
      gpIds.push(id)
      state.groundPositions[id] = { id, stsId: s.id, lane, containerId: null, claimedBy: null }
    }
    state.sts[s.id] = {
      id: s.id,
      railIndex,
      status: 'idle',
      vesselId: null,
      bays: [],
      workQueue: [],
      gantryX: s.gantryX,
      trolleyZ: config.layout.stsGroundLaneZ0M,
      hoistY: config.layout.stsSafeHoistM,
      railLo: s.gantryX,
      railHi: s.gantryX,
      railTargetX: null,
      carrying: [],
      drops: [],
      motion: [],
      groundPositionIds: gpIds,
      packageIds: [],
      activePackageId: null,
    }
    state.kpis.perSts[s.id] = {
      moves: 0,
      cycles: 0,
      twinLifts: 0,
      firstMoveStartS: null,
      lastMoveEndS: null,
      railWaitS: 0,
      railWaitSince: null,
    }
  })
  if ((config.shcs?.length ?? 0) > 0 && (config.yard?.blocks.length ?? 0) > 0) {
    validateLaneLayout(config)
    if (hatchCovers) {
      const problems = hatchLaydownProblems(config)
      if (problems.length > 0)
        throw new Error(
          `The hatch cover laydown does not fit between the ground lanes and the STS rail without touching the SHC lane graph ` +
            `(use at most 3 ground positions per STS, or set hatch.enabled to false): ${problems.slice(0, 3).join('; ')}`,
        )
    }
    const graph = laneGraphOf(config)
    const horizontal: HorizontalKpiCounters = { boxesToWtp: 0, perShc: {}, stsGroundPositionWaitS: {} }
    for (const shc of config.shcs ?? []) {
      state.shcs[shc.id] = {
        id: shc.id,
        status: 'parked',
        nodeId: graph.parkingNode[shc.id],
        carrying: null,
        jobId: null,
        motion: [],
        plan: [],
      }
      horizontal.perShc[shc.id] = { jobs: 0, emptyDistanceM: 0, loadedDistanceM: 0, reservationWaitS: 0, parkingReturns: 0, queueArrivals: 0 }
    }
    for (const s of config.sts) horizontal.stsGroundPositionWaitS[s.id] = 0
    for (const p of graph.pads) state.wtpPads[p.id] = { id: p.id, blockId: p.blockId, containerId: null, claimedBy: null }
    const yard: YardKpiCounters = { boxesStacked: 0, rehandles: 0, productiveMoves: 0, perBlock: {}, rehandleFailures: 0, allocationFailures: 0, perAsc: {} }
    if (yardGroupingOn(config)) yard.grouping = { placements: 0, mixedStack: 0, orderBroken: 0, mixedBay: 0 }
    for (const b of blockSpecs(config)) {
      yard.perBlock[b.id] = { rehandles: 0, productiveMoves: 0 }
      state.yardBlocks[b.id] = {
        id: b.id,
        bays: b.bays,
        rows: b.rows,
        tiers: b.tiers,
        heights: new Array<number>(b.bays * b.rows).fill(0),
        topVessels: new Array<string | null>(b.bays * b.rows).fill(null),
      }
      if (subsystems.asc === 'off') continue
      const count = config.yard?.ascsPerBlock ?? 1
      for (let n = 1; n <= count; n++) {
        const id = ascIdOf(b.id, n)
        const z = count === 1 ? b.wtpZ : ascStartZ(b, n)
        state.ascs[id] = {
          id,
          blockId: b.id,
          status: 'idle',
          carrying: null,
          jobId: null,
          stacked: 0,
          gantryZ: z,
          trolleyX: b.x,
          hoistY: travelHoistM(b),
          motion: [],
          plan: [],
        }
        yard.perAsc[id] = { jobs: 0, gantryM: 0, trolleyM: 0, hoistM: 0, padWaitS: 0 }
        if (count > 1) {
          Object.assign(yard.perAsc[id], { railWaitS: 0, busyS: 0, yields: 0 })
          // a parked crane holds the rail segments around it until its first trip
          for (const zone of railSegmentIds(b, z, z))
            state.reservations.push({ id: state.nextReservationId++, zone, holder: id, from: 0, to: PARK_UNTIL_S })
        }
      }
    }
    state.kpis.yard = yard
    state.kpis.horizontal = horizontal
    if (subsystems.landside !== 'off' && config.landside) initLandside(state, config, seed)
    // export boxes booked to the vessels start in the stacks
    for (const p of exportPlacement.values()) {
      const blk = state.yardBlocks[p.blockId]
      state.yardSlots[p.slotId] = {
        id: p.slotId,
        blockId: p.blockId,
        bay: p.bay,
        row: p.row,
        tier: p.tier,
        span: p.span,
        containerId: p.containerId,
      }
      for (let k = 0; k < p.span; k++) {
        const i = (p.bay + k - 1) * blk.rows + (p.row - 1)
        blk.heights[i] = Math.max(blk.heights[i], p.tier)
        blk.topVessels[i] = p.vesselId
      }
    }
  }
  return state
}

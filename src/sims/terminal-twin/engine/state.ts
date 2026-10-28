/**
 * SimState: the complete mutable engine state. It is plain JSON (no class
 * instances, Maps or functions) so a snapshot is a deep copy of it, and it
 * includes the event queue, RNG state and running event-log hash.
 */
import { createDecisionState, type DecisionState } from './decisions/runtime'
import type { EngineEvent } from './events'
import { HASH_SEED, type HashState } from './hash'
import type { MotionSegment } from './kinematics'
import { laneGraphOf, validateLaneLayout } from './laneGraph'
import type { Reservation } from './reservations'
import { seedState } from './rng'
import { ascStartZ, blockSpecs, PARK_UNTIL_S, railSegmentIds, travelHoistM } from './yardLayout'
import { planCargo, type SlotPurpose } from '../scenario/bayPlan'
import type { ContainerSize, ScenarioConfig, SubsystemMode, VesselSizeClass } from '../scenario/types'
import { vesselSlotId as makeVesselSlotId, type CellHalf } from '../scenario/vesselClasses'

/** Kinds of custody owner. Later tickets add 'truck'. */
export type CustodyKind = 'vesselSlot' | 'sts' | 'groundPosition' | 'shc' | 'wtpPad' | 'asc' | 'yardSlot'

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
  custody: CustodyRef
  custodyHistory: CustodyRecord[]
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
  /** Discharge boxes still on board. */
  remainingDischarge: number
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

/**
 * SHC state machine (TT-05):
 *   parked → waiting-for-dispatch → job-assigned (waits for its reservations)
 *   → routing-empty → positioning-at-pickup → locking → lifting
 *   → routing-loaded → positioning-at-dropoff → lowering → unlocking
 *   → clearing (reverses clear of the WTP pad) → available
 *   → waiting-for-dispatch … or → routing-to-parking → parked
 */
export type ShcStatus =
  | 'parked'
  | 'waiting-for-dispatch'
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

/** One planned phase event of an SHC trip (the next one is scheduled by the previous). */
export interface ShcPlannedEvent {
  type:
    | 'ShcRoutingEmpty'
    | 'ShcPositioningAtPickup'
    | 'ShcLocking'
    | 'ShcPicked'
    | 'ShcRoutingLoaded'
    | 'ShcPositioningAtDropoff'
    | 'ShcLowering'
    | 'ShcUnlocking'
    | 'ShcDroppedAtWtp'
    | 'ShcCleared'
    | 'ShcParked'
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
  /** X where the box sits in its STS lane. */
  x: number
  readyAt: number
  /** Claiming SHC (null = open). */
  shcId: string | null
  wtpPadId: string | null
}

export interface WtpPadState {
  id: string
  blockId: string
  containerId: string | null
  /** SHC that will drop a box here. */
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
    | 'AscRoutingToSlot'
    | 'AscPositioningAtSlot'
    | 'AscUnlocking'
    | 'AscStacked'
    | 'AscReady'
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
  shc: SubsystemMode
  asc: SubsystemMode
}

export interface StsDrop {
  containerId: string
  groundPositionId: string
}

export interface StsState {
  id: string
  /** Position on the shared rail (0 = lowest X). Cranes never change order. */
  railIndex: number
  status: StsStatus
  vesselId: string | null
  /** Bays of `vesselId` assigned by the crane split (ascending). */
  bays: number[]
  /** Remaining discharge boxes of this crane, in work order (bay by bay, deck before hold, top tier first). */
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
  /** Boxes on the spreader (two for a twin-20 lift), aft first. */
  carrying: string[]
  /** Ground positions chosen for the carried boxes, in set-down order. */
  drops: StsDrop[]
  /** Motion segments currently planned (renderer interpolates from these). */
  motion: MotionSegment[]
  groundPositionIds: string[]
  /** Since when the STS has been waiting for a free ground position (null = not waiting). */
  waitingSince?: number | null
}

export interface GroundPositionState {
  id: string
  stsId: string
  lane: number
  containerId: string | null
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

export interface KpiCounters {
  movesCompleted: number
  vesselsCompleted: number
  perSts: Record<string, StsKpiCounters>
  /** Horizontal transport (present when SHCs are configured). */
  horizontal?: HorizontalKpiCounters
  /** Yard blocks and ASCs (present when blocks are configured with SHCs). */
  yard?: YardKpiCounters
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
  /** yardAllocation replies with no slot (block full). */
  allocationFailures: number
  perAsc: Record<string, AscKpiCounters>
}

export interface HorizontalKpiCounters {
  boxesToWtp: number
  perShc: Record<string, { jobs: number; emptyDistanceM: number; loadedDistanceM: number; reservationWaitS: number }>
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

export interface SimState {
  now: number
  nextEventId: number
  nextSeq: number
  rngState: number
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
  wtpPads: Record<string, WtpPadState>
  ascs: Record<string, AscState>
  ascJobs: Record<string, AscJob>
  nextAscJob: number
  nextClaimSeq: number
  yardBlocks: Record<string, YardBlockState>
  yardSlots: Record<string, YardSlotState>
  reservations: Reservation[]
  nextReservationId: number
  subsystems: ResolvedSubsystemModes
  kpis: KpiCounters
  /** Decision points: correlation counter, injector RNG, pending decisions, handler KPIs. */
  decisions: DecisionState
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

/** Subsystem modes: config, then overrides. SHC defaults to real when SHCs and blocks exist. */
export function resolveSubsystemModes(
  config: ScenarioConfig,
  overrides: { shc?: SubsystemMode; asc?: SubsystemMode } = {},
): ResolvedSubsystemModes {
  const hasShc = (config.shcs?.length ?? 0) > 0 && (config.yard?.blocks.length ?? 0) > 0
  const modes = {
    shc: overrides.shc ?? config.subsystems?.shc ?? (hasShc ? 'real' : 'off'),
    asc: overrides.asc ?? config.subsystems?.asc ?? (hasShc ? 'real' : 'off'),
  }
  if (!hasShc) modes.shc = 'off'
  return modes
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
    wtpPads: {},
    ascs: {},
    ascJobs: {},
    nextAscJob: 0,
    nextClaimSeq: 0,
    yardBlocks: {},
    yardSlots: {},
    reservations: [],
    nextReservationId: 0,
    subsystems,
    kpis: { movesCompleted: 0, vesselsCompleted: 0, perSts: {} },
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
    }
  }
  for (const s of plan.slots) state.vesselSlots[s.id] = { ...s, containerId: null }
  for (const c of plan.containers) {
    state.vesselSlots[c.slotId].containerId = c.id
    state.vessels[c.vesselId].remainingDischarge++
    const owner: CustodyRef = { kind: 'vesselSlot', id: c.slotId }
    state.containers[c.id] = {
      id: c.id,
      size: c.size,
      full: c.full,
      line: c.line,
      custody: owner,
      custodyHistory: [{ t: 0, owner, eventId: null }],
    }
  }
  config.sts.forEach((s, railIndex) => {
    const gpIds: string[] = []
    for (let lane = 0; lane < s.groundPositions; lane++) {
      const id = groundPositionId(s.id, lane)
      gpIds.push(id)
      state.groundPositions[id] = { id, stsId: s.id, lane, containerId: null }
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
      horizontal.perShc[shc.id] = { jobs: 0, emptyDistanceM: 0, loadedDistanceM: 0, reservationWaitS: 0 }
    }
    for (const s of config.sts) horizontal.stsGroundPositionWaitS[s.id] = 0
    for (const p of graph.pads) state.wtpPads[p.id] = { id: p.id, blockId: p.blockId, containerId: null, claimedBy: null }
    const yard: YardKpiCounters = { boxesStacked: 0, allocationFailures: 0, perAsc: {} }
    for (const b of blockSpecs(config)) {
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
  }
  return state
}

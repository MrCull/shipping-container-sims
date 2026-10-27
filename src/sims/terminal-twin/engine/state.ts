/**
 * SimState: the complete mutable engine state. It is plain JSON (no class
 * instances, Maps or functions) so a snapshot is a deep copy of it, and it
 * includes the event queue, RNG state and running event-log hash.
 */
import { createDecisionState, type DecisionState } from './decisions/runtime'
import type { EngineEvent } from './events'
import { HASH_SEED, type HashState } from './hash'
import type { MotionSegment } from './kinematics'
import { seedState } from './rng'
import { planCargo, type SlotPurpose } from '../scenario/bayPlan'
import type { ContainerSize, ScenarioConfig, VesselSizeClass } from '../scenario/types'
import { vesselSlotId as makeVesselSlotId, type CellHalf } from '../scenario/vesselClasses'

/** Kinds of custody owner. Later tickets add 'shc' | 'wtpPad' | 'asc' | 'yardSlot' | 'truck'. */
export type CustodyKind = 'vesselSlot' | 'sts' | 'groundPosition'

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
  kpis: KpiCounters
  /** Decision points: correlation counter, injector RNG, pending decisions, handler KPIs. */
  decisions: DecisionState
  ended: { reason: string; t: number } | null
}

export function vesselSlotId(vesselId: string, bay: number, row: number, tier: number, half: CellHalf = null): string {
  return makeVesselSlotId(vesselId, bay, row, tier, half)
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

export function createInitialState(config: ScenarioConfig, seed: number): SimState {
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
  return state
}

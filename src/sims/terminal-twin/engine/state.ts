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
import type { ContainerSize, ScenarioConfig, VesselConfig } from '../scenario/types'

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
  containerId: string | null
}

export type VesselStatus = 'scheduled' | 'berthed' | 'departed'

export interface VesselState {
  id: string
  status: VesselStatus
  berthedAt: number | null
  departedAt: number | null
  /** Remaining discharge sequence (container ids, next first). */
  dischargeQueue: string[]
}

export type StsStatus =
  | 'idle'
  | 'moving-to-pick'
  | 'carrying'
  | 'returning'
  | 'waiting-for-decision'
  | 'waiting-for-ground-position'

export interface StsState {
  id: string
  status: StsStatus
  vesselId: string | null
  /** Axis positions at the end of the currently planned motion. */
  gantryX: number
  trolleyZ: number
  hoistY: number
  carrying: string | null
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

export interface KpiCounters {
  movesCompleted: number
  vesselsCompleted: number
  perSts: Record<string, { moves: number; firstMoveStartS: number | null; lastMoveEndS: number | null }>
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
  sts: Record<string, StsState>
  groundPositions: Record<string, GroundPositionState>
  kpis: KpiCounters
  /** Decision points: correlation counter, injector RNG, pending decisions, handler KPIs. */
  decisions: DecisionState
  ended: { reason: string; t: number } | null
}

export function vesselSlotId(vesselId: string, bay: number, row: number, tier: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${vesselId}:${p(bay)}-${p(row)}-${p(tier)}`
}

export function groundPositionId(stsId: string, lane: number): string {
  return `${stsId}-GP${lane + 1}`
}

/** Discharge order: bay by bay, top tier first, then row. */
function dischargeOrder(config: ScenarioConfig, vessel: VesselConfig): string[] {
  return config.containers
    .filter((c) => c.initial.vesselId === vessel.id)
    .sort(
      (a, b) =>
        a.initial.bay - b.initial.bay || b.initial.tier - a.initial.tier || a.initial.row - b.initial.row,
    )
    .map((c) => c.id)
}

export function createInitialState(config: ScenarioConfig, seed: number): SimState {
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
    sts: {},
    groundPositions: {},
    kpis: { movesCompleted: 0, vesselsCompleted: 0, perSts: {} },
    decisions: createDecisionState(seed),
    ended: null,
  }
  for (const v of config.vessels) {
    state.vessels[v.id] = {
      id: v.id,
      status: 'scheduled',
      berthedAt: null,
      departedAt: null,
      dischargeQueue: dischargeOrder(config, v),
    }
    for (let bay = 0; bay < v.bays; bay++)
      for (let row = 0; row < v.rows; row++)
        for (let tier = 0; tier < v.tiersOnDeck; tier++) {
          const id = vesselSlotId(v.id, bay, row, tier)
          state.vesselSlots[id] = { id, vesselId: v.id, bay, row, tier, containerId: null }
        }
  }
  for (const c of config.containers) {
    const slotId = vesselSlotId(c.initial.vesselId, c.initial.bay, c.initial.row, c.initial.tier)
    const slot = state.vesselSlots[slotId]
    if (!slot) throw new Error(`Container ${c.id}: slot ${slotId} does not exist`)
    slot.containerId = c.id
    const owner: CustodyRef = { kind: 'vesselSlot', id: slotId }
    state.containers[c.id] = {
      id: c.id,
      size: c.size,
      full: c.full,
      line: c.line,
      custody: owner,
      custodyHistory: [{ t: 0, owner, eventId: null }],
    }
  }
  for (const s of config.sts) {
    const gpIds: string[] = []
    for (let lane = 0; lane < s.groundPositions; lane++) {
      const id = groundPositionId(s.id, lane)
      gpIds.push(id)
      state.groundPositions[id] = { id, stsId: s.id, lane, containerId: null }
    }
    state.sts[s.id] = {
      id: s.id,
      status: 'idle',
      vesselId: null,
      gantryX: s.gantryX,
      trolleyZ: config.layout.stsGroundLaneZ0M,
      hoistY: config.layout.stsSafeHoistM,
      carrying: null,
      motion: [],
      groundPositionIds: gpIds,
    }
    state.kpis.perSts[s.id] = { moves: 0, firstMoveStartS: null, lastMoveEndS: null }
  }
  return state
}

/**
 * SimState: the complete mutable engine state. It is plain JSON (no class
 * instances, Maps or functions) so a snapshot is a deep copy of it, and it
 * includes the event queue, RNG state and running event-log hash.
 */
import { createDecisionState, type DecisionState } from './decisions/runtime'
import type { EngineEvent } from './events'
import { HASH_SEED, type HashState } from './hash'
import type { MotionSegment } from './kinematics'
import { laneGraphOf } from './laneGraph'
import type { Reservation } from './reservations'
import { seedState } from './rng'
import type { ContainerSize, ScenarioConfig, SubsystemMode, VesselConfig } from '../scenario/types'

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

export type AscStatus = 'idle'

export interface AscState {
  id: string
  blockId: string
  status: AscStatus
  carrying: string | null
  /** Boxes stacked so far (numbers the stub's yard slots). */
  stacked: number
}

export interface YardSlotState {
  id: string
  blockId: string
  containerId: string | null
}

export interface ResolvedSubsystemModes {
  shc: SubsystemMode
  asc: SubsystemMode
}

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
  /** Since when the STS has been waiting for a free ground position (null = not waiting). */
  waitingSince?: number | null
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
  /** Horizontal transport (present when SHCs are configured). */
  horizontal?: HorizontalKpiCounters
}

export interface HorizontalKpiCounters {
  boxesToWtp: number
  perShc: Record<string, { jobs: number; emptyDistanceM: number; loadedDistanceM: number; reservationWaitS: number }>
  /** STS seconds spent waiting for a free ground position. */
  stsGroundPositionWaitS: Record<string, number>
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
  shcs: Record<string, ShcState>
  shcJobs: Record<string, ShcJob>
  nextShcJob: number
  wtpPads: Record<string, WtpPadState>
  ascs: Record<string, AscState>
  yardSlots: Record<string, YardSlotState>
  reservations: Reservation[]
  nextReservationId: number
  subsystems: ResolvedSubsystemModes
  kpis: KpiCounters
  /** Decision points: correlation counter, injector RNG, pending decisions, handler KPIs. */
  decisions: DecisionState
  ended: { reason: string; t: number } | null
}

export function vesselSlotId(vesselId: string, bay: number, row: number, tier: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${vesselId}:${p(bay)}-${p(row)}-${p(tier)}`
}

/** The block's (single, waterside) ASC while the ASC is a stub. */
export function ascStubId(blockId: string): string {
  return `${blockId}-ASC1`
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

/** Subsystem modes: config, then overrides. SHC defaults to real when SHCs and blocks exist. */
export function resolveSubsystemModes(
  config: ScenarioConfig,
  overrides: { shc?: SubsystemMode; asc?: SubsystemMode } = {},
): ResolvedSubsystemModes {
  const hasShc = (config.shcs?.length ?? 0) > 0 && (config.yard?.blocks.length ?? 0) > 0
  const modes = {
    shc: overrides.shc ?? config.subsystems?.shc ?? (hasShc ? 'real' : 'off'),
    asc: overrides.asc ?? config.subsystems?.asc ?? 'instant',
  }
  if (!hasShc) modes.shc = 'off'
  if (modes.asc === 'real') throw new Error("ASC mode 'real' is not implemented yet (TT-06): use 'instant' or 'off'")
  return modes
}

export function createInitialState(
  config: ScenarioConfig,
  seed: number,
  subsystems: ResolvedSubsystemModes = resolveSubsystemModes(config),
): SimState {
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
    shcs: {},
    shcJobs: {},
    nextShcJob: 0,
    wtpPads: {},
    ascs: {},
    yardSlots: {},
    reservations: [],
    nextReservationId: 0,
    subsystems,
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
  if ((config.shcs?.length ?? 0) > 0 && (config.yard?.blocks.length ?? 0) > 0) {
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
    if (subsystems.asc !== 'off') {
      for (const b of config.yard?.blocks ?? []) {
        const id = ascStubId(b.id)
        state.ascs[id] = { id, blockId: b.id, status: 'idle', carrying: null, stacked: 0 }
      }
    }
    state.kpis.horizontal = horizontal
  }
  return state
}

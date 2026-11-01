/**
 * Main thread ⇄ engine worker messages (internal; not a public seam).
 *
 * Every request carries a request id `rid`; the worker answers each with one
 * `WorkerReply` carrying the same `rid`, the compact `Delta` of everything
 * that happened while serving it, and the engine's `EngineInfo`.
 */
import type {
  CustodyRef,
  EngineEvent,
  EventPayloads,
  EventSubjects,
  EventType,
  ExportKind,
  MotionSegment,
  KpiSeriesReport,
  LandsideKpiReport,
  Reservation,
  RunCondition,
  SimSnapshot,
  TimelineReport,
} from '../engine'
import type { Breakpoint } from '../modules/breakpoints'
import type { ContainerSize, ScenarioConfig } from '../scenario/types'
import type { ContainerProps } from '../scenario/containerProps'

/** Serialisable subset of the engine's RunCondition (no predicate). */
export type WorkerRunCondition = Omit<RunCondition, 'predicate'>

/** Everything the dashboard tab shows, as of the engine's current state. */
export interface DashboardData {
  series: KpiSeriesReport
  timeline: TimelineReport
  /** Current fill of each yard block (% of cells holding a box). */
  yard: { id: string; fillPct: number }[]
  /** Whole-run truck and gate numbers (TT-R18); null without a landside. */
  landside: LandsideKpiReport | null
}

export type QueryKind =
  | 'container'
  | 'containers'
  | 'vessel'
  | 'vessels'
  | 'vesselSlots'
  /** `BayViewData` of one vessel (spec #106, #115): slots, their boxes, work packages and ROB boxes. */
  | 'bayView'
  /** `VesselStatusInput` of one vessel (spec #126): ETA, berth times, mooring time and moves per STS. */
  | 'vesselStatus'
  | 'sts'
  | 'stsList'
  | 'groundPosition'
  | 'shc'
  | 'shcList'
  | 'shcJobs'
  | 'wtpPad'
  | 'asc'
  | 'ascList'
  | 'truck'
  | 'trucks'
  /** A hatch panel (TT-R10), and all of them. */
  | 'hatch'
  | 'hatchList'
  | 'transferStalls'
  | 'yardBlocks'
  | 'yardSlots'
  | 'reservations'
  | 'kpis'
  /** Hourly, per-shift and total series of every KPI (the collector). */
  | 'kpiSeries'
  /** `{ headline, highlights }`: the KPI strip and the final report's highlights. */
  | 'kpiHeadline'
  /** `DashboardData`: KPI series, vessel/STS timeline and per-block yard fill, in one round trip. */
  | 'dashboard'
  | 'summary'
  | 'invariants'
  | 'eventLog'
  /** `Checkpoint[]`: the rewind points of the current timeline. */
  | 'checkpoints'

export type WorkerRequest =
  | { op: 'load'; config: ScenarioConfig; seed: number }
  | { op: 'reset' }
  /** Run until sim time `to` (playback look-ahead). Full delta. */
  | { op: 'advance'; to: number }
  /** Run flat out until the condition. Compact delta (latest state per entity only). */
  | { op: 'run'; condition: WorkerRunCondition }
  | { op: 'step' }
  | { op: 'query'; kind: QueryKind; id?: string }
  | { op: 'inject'; type: EventType; at: number; subjects: EventSubjects; payload: EventPayloads[EventType] }
  | { op: 'snapshot' }
  /** Resume from a snapshot (same engine version): replays its event log so the scene learns the history, then restores its exact state. Result `ReplayResult`. */
  | { op: 'restore'; snapshot: SimSnapshot }
  /** Back to a rewind point: restart the loaded scenario and replay `events` events. Result `ReplayResult`. */
  | { op: 'rewind'; events: number; hash: string }
  /** Automatic rewind points every `seconds` of sim time (default `DEFAULT_CHECKPOINT_S`); kept across load/reset. */
  | { op: 'setCheckpointInterval'; seconds: number }
  | { op: 'why'; eventId: number }
  /** The KPI report or the full event log as a JSON/CSV string. */
  | { op: 'export'; kind: ExportKind }
  /** Replace the debugger breakpoints (kept across load/reset). Runs and steps stop at the first hit. */
  | { op: 'setBreakpoints'; breakpoints: Breakpoint[] }

export type WorkerRequestMessage = WorkerRequest & { rid: number }

/** A rewind point: `events` events have been processed (all before `t`), and the log hash then was `hash`. */
export interface Checkpoint {
  t: number
  events: number
  hash: string
}

export const DEFAULT_CHECKPOINT_S = 900

/** Result of `restore` and `rewind`: did the replayed log hash equal the expected one (false only if the run had events a replay cannot make, e.g. injected ones). */
export interface ReplayResult {
  hashMatched: boolean
}

/** A new motion plan of one crane, SHC or ASC (all axes, sequential). */
export interface MotionPlan {
  entityId: string
  segments: MotionSegment[]
}

export interface CustodyChange {
  containerId: string
  t: number
  owner: CustodyRef
  eventId: number | null
  /** Ground positions only: X along the quay where the box was set down. */
  x?: number
  /** STS only: offset of the box from the spreader centre along X (twin-20: aft −, fore +). */
  dx?: number
}

/**
 * A hatch panel changes state (TT-R10): from a hatch event of the panel. The scene draws a `lifted` panel from its
 * crane's pose, a panel `in-laydown` at `x` and `level` of its laydown bay, and any other panel on its own hatch.
 */
export interface HatchPanelChange {
  panelId: string
  t: number
  status: 'secured' | 'unsecured' | 'lifted' | 'in-laydown' | 'replaced'
  /** `lifted`: the crane that holds it. */
  stsId?: string
  /** `in-laydown`: the laydown bay, its X along the quay and the panel's level in the stack (0 = bottom). */
  siteId?: string
  x?: number
  level?: number
}

export interface EntityStateChange {
  kind: 'sts' | 'vessel' | 'shc' | 'asc' | 'truck'
  id: string
  t: number
  status: string
  /** Vessels only: stern X along the quay once a berth is allocated (null before). */
  berthX?: number | null
  /** Vessels only: the first move of any STS working it, once known (#141; a view field, not an event). */
  firstMoveS?: number | null
  /** Trucks only: size of the box on its first leg (the model's load position: a 20 ft box sits on the front pins). */
  loadSize?: ContainerSize
}

/** A summarised event for feeds and the dev API. */
export interface EventSummary {
  id: number
  seq: number
  t: number
  type: EventType
  causedBy: number | null
  subjects: EventSubjects
}

/** The breakpoint a run or step stopped on, and the event that hit it. */
export interface BreakpointHit {
  breakpointId: number
  event: EventSummary
}

/** A container created while the run is going (a box a truck brings, TT-13): the scene learns it here. */
export interface NewContainer {
  id: string
  size: ContainerSize
  line: string
  /** Laden, ISO type and heavy rating, for the close-up markings (#119). Absent = laden general-purpose box. */
  full?: boolean
  isoType?: string
  heavy?: boolean
  /** Stored properties, for the colour modes (#130). */
  props?: ContainerProps
}

export interface Delta {
  /** Containers created in this batch (before their first custody change). */
  newContainers?: NewContainer[]
  motion: MotionPlan[]
  custody: CustodyChange[]
  /** Hatch panel state changes in this batch (TT-R10; absent when none). */
  hatch?: HatchPanelChange[]
  entities: EntityStateChange[]
  /** Conflict-zone reservations made in this batch (overlay). */
  reservations: Reservation[]
  /** The most recent events of this batch (capped at EVENT_SUMMARY_CAP). */
  events: EventSummary[]
  /** Number of events of each type in this batch. */
  eventCounts: Partial<Record<EventType, number>>
  /** Set when this request stopped at a breakpoint (the hit event is the last one processed). */
  breakpoint: BreakpointHit | null
}

export interface EngineInfo {
  /** Engine time: everything up to here has been processed (the playback horizon). */
  now: number
  status: 'ready' | 'ended' | 'failed'
  /** Sim time of `ScenarioEnded` (null while running). */
  endT: number | null
  endReason: string | null
  eventsTotal: number
  movesCompleted: number
  vesselsCompleted: number
  eventLogHash: string
  firstError: string | null
}

export type WorkerReply =
  | { rid: number; ok: true; result: unknown; delta: Delta; info: EngineInfo }
  | { rid: number; ok: false; error: string }

export const EVENT_SUMMARY_CAP = 200

export function summarizeEvent(e: EngineEvent): EventSummary {
  return { id: e.id, seq: e.seq, t: e.t, type: e.type, causedBy: e.causedBy, subjects: e.subjects }
}

/** The panel change a hatch event makes (null for events that do not change what the scene draws). */
export function hatchChangeOf(e: EngineEvent): HatchPanelChange | null {
  switch (e.type) {
    case 'HatchLashingReleased':
      return { panelId: e.payload.panelId, t: e.t, status: 'unsecured' }
    case 'HatchLifted':
      return { panelId: e.payload.panelId, t: e.t, status: 'lifted', stsId: e.payload.stsId }
    case 'HatchSetInLaydown':
      return { panelId: e.payload.panelId, t: e.t, status: 'in-laydown', siteId: e.payload.siteId, x: e.payload.x, level: e.payload.level }
    case 'HatchReplaced':
      return { panelId: e.payload.panelId, t: e.t, status: 'replaced' }
    case 'HatchSecured':
      return { panelId: e.payload.panelId, t: e.t, status: 'secured' }
    default:
      return null
  }
}

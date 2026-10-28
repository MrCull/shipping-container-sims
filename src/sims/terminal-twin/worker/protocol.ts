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
  Reservation,
  RunCondition,
  TimelineReport,
} from '../engine'
import type { Breakpoint } from '../modules/breakpoints'
import type { ContainerSize, ScenarioConfig } from '../scenario/types'

/** Serialisable subset of the engine's RunCondition (no predicate). */
export type WorkerRunCondition = Omit<RunCondition, 'predicate'>

/** Everything the dashboard tab shows, as of the engine's current state. */
export interface DashboardData {
  series: KpiSeriesReport
  timeline: TimelineReport
  /** Current fill of each yard block (% of cells holding a box). */
  yard: { id: string; fillPct: number }[]
}

export type QueryKind =
  | 'container'
  | 'containers'
  | 'vessel'
  | 'vessels'
  | 'vesselSlots'
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
  | { op: 'why'; eventId: number }
  /** The KPI report or the full event log as a JSON/CSV string. */
  | { op: 'export'; kind: ExportKind }
  /** Replace the debugger breakpoints (kept across load/reset). Runs and steps stop at the first hit. */
  | { op: 'setBreakpoints'; breakpoints: Breakpoint[] }

export type WorkerRequestMessage = WorkerRequest & { rid: number }

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

export interface EntityStateChange {
  kind: 'sts' | 'vessel' | 'shc' | 'asc' | 'truck'
  id: string
  t: number
  status: string
  /** Vessels only: stern X along the quay once a berth is allocated (null before). */
  berthX?: number | null
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
}

export interface Delta {
  /** Containers created in this batch (before their first custody change). */
  newContainers?: NewContainer[]
  motion: MotionPlan[]
  custody: CustodyChange[]
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

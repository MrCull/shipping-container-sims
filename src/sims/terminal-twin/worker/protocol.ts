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
  MotionSegment,
  Reservation,
  RunCondition,
} from '../engine'
import type { ScenarioConfig } from '../scenario/types'

/** Serialisable subset of the engine's RunCondition (no predicate). */
export type WorkerRunCondition = Omit<RunCondition, 'predicate'>

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
  | 'wtpPad'
  | 'reservations'
  | 'kpis'
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

export type WorkerRequestMessage = WorkerRequest & { rid: number }

/** A new motion plan of one crane or SHC (all axes, sequential). */
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
  kind: 'sts' | 'vessel' | 'shc'
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

export interface Delta {
  motion: MotionPlan[]
  custody: CustodyChange[]
  entities: EntityStateChange[]
  /** Conflict-zone reservations made in this batch (overlay). */
  reservations: Reservation[]
  /** The most recent events of this batch (capped at EVENT_SUMMARY_CAP). */
  events: EventSummary[]
  /** Number of events of each type in this batch. */
  eventCounts: Partial<Record<EventType, number>>
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

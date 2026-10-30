/**
 * Event inspector model (TT-18): what the debugger shows for one engine event.
 * Pure TS; the component formats it through the message catalogue.
 */
import type { EngineEvent } from '../engine'

export type SubjectKind = 'container' | 'equipment' | 'vessel' | 'job'

export interface EventSubjectLink {
  kind: SubjectKind
  id: string
}

export interface DecisionView {
  decisionPoint: string
  correlationId: string
  version: number | null
  /** 'strategy:x' | 'custom' | 'fallback:x' (resolved only). */
  handler: string | null
  /** 'ok' | 'fallback' (resolved only). */
  outcome: string | null
  /** Failure kind and fallback (DecisionFailed only). */
  failure: string | null
  message: string | null
  requestJson: string | null
  replyJson: string | null
}

export interface EventDescription {
  id: number
  seq: number
  t: number
  type: string
  causedBy: number | null
  subjects: EventSubjectLink[]
  /** Pretty JSON of the payload; motion segments are summarised, decision request/reply are listed apart. */
  payloadJson: string
  decision: DecisionView | null
}

const SUBJECT_KINDS: [keyof EngineEvent['subjects'], SubjectKind][] = [
  ['containers', 'container'],
  ['equipment', 'equipment'],
  ['vessels', 'vessel'],
  ['jobs', 'job'],
]

const pretty = (value: unknown): string => JSON.stringify(value, null, 2)

export function describeEvent(event: EngineEvent): EventDescription {
  const subjects: EventSubjectLink[] = []
  for (const [key, kind] of SUBJECT_KINDS) for (const id of event.subjects[key] ?? []) subjects.push({ kind, id })

  const payload = { ...(event.payload as unknown as Record<string, unknown>) }
  let decision: DecisionView | null = null
  if (event.type === 'DecisionRequested' || event.type === 'DecisionResolved' || event.type === 'DecisionFailed') {
    const p = payload as Record<string, unknown>
    decision = {
      decisionPoint: String(p.decisionPoint),
      correlationId: String(p.correlationId),
      version: typeof p.version === 'number' ? p.version : null,
      handler: typeof p.handler === 'string' ? p.handler : null,
      outcome: typeof p.outcome === 'string' ? p.outcome : null,
      failure: typeof p.failure === 'string' ? p.failure : null,
      message: typeof p.message === 'string' ? p.message : null,
      requestJson: 'request' in p ? pretty(p.request) : null,
      replyJson: 'reply' in p ? pretty(p.reply) : null,
    }
    delete payload.request
    delete payload.reply
  }
  if (Array.isArray(payload.segments)) payload.segments = `${payload.segments.length} motion segment(s)`
  return {
    id: event.id,
    seq: event.seq,
    t: event.t,
    type: event.type,
    causedBy: event.causedBy,
    subjects,
    payloadJson: pretty(payload),
    decision,
  }
}

/**
 * Event envelope and event catalogue.
 *
 * Every happening in the engine is an event with a common envelope. To add an
 * event type, add an entry to `EventPayloads`; `EngineEvent` and the
 * reactor/subscriber types pick it up automatically.
 */
import type { DecisionPointId, DecisionReplies, DecisionRequests } from './decisions/types'
import type { MotionSegment } from './kinematics'
import type { CustodyRef } from './state'

/** Ids of the domain objects an event involves (for filtering and `why`). */
export interface EventSubjects {
  containers?: string[]
  equipment?: string[]
  vessels?: string[]
  jobs?: string[]
}

export interface EventEnvelope<T extends string, P> {
  /** Unique id, assigned when the event is scheduled. */
  id: number
  /** Processing order (0-based), assigned when the event is processed. */
  seq: number
  /** Sim time in seconds from scenario start. */
  t: number
  type: T
  /** Id of the event whose processing scheduled this one (null for roots). */
  causedBy: number | null
  subjects: EventSubjects
  payload: P
}

/**
 * Payload convention for equipment events: `segments` is the motion that
 * LED UP TO this event (planned when the event was scheduled), so
 * `t === max(segments.t1) + fixed handling time`. The live plan is also
 * kept in state (e.g. `StsState.motion`) for renderers.
 *
 * Decision events are unions with one variant per decision point, so
 * `request` / `reply` narrow on `payload.decisionPoint`.
 */

/** A decision request was sent to its handler (see `engine/decisions/`). */
export type DecisionRequestedPayload = {
  [K in DecisionPointId]: { correlationId: string; decisionPoint: K; version: number; request: DecisionRequests[K] }
}[DecisionPointId]

/** A decision's reply reached the engine; the waiting equipment acts on it. */
export type DecisionResolvedPayload = {
  [K in DecisionPointId]: {
    correlationId: string
    decisionPoint: K
    version: number
    /** ok = the handler's reply; fallback = the fallback strategy's reply after a DecisionFailed. */
    outcome: 'ok' | 'fallback'
    /** "strategy:<name>", "custom" or "fallback:<name>". */
    handler: string
    request: DecisionRequests[K]
    reply: DecisionReplies[K]
  }
}[DecisionPointId]

export interface EventPayloads {
  ScenarioStarted: { scenario: string; seed: number }
  VesselBerthed: { vesselId: string; berthX: number }
  /** STS is free and takes the next box of its vessel's discharge sequence. */
  StsMoveStarted: { stsId: string; vesselId: string; segments: MotionSegment[] }
  /** Spreader locked on the box: custody vessel slot → STS. */
  StsPicked: { stsId: string; containerId: string; from: CustodyRef; segments: MotionSegment[] }
  /** Box released on an STS ground position: custody STS → ground position. */
  StsGrounded: { stsId: string; containerId: string; groundPositionId: string; segments: MotionSegment[] }
  /** The ground-position decision returned no position; the STS holds the box and idles. */
  StsWaitingForGroundPosition: { stsId: string; containerId: string }
  StsWorkComplete: { stsId: string; vesselId: string }
  VesselDeparted: { vesselId: string }
  DecisionRequested: DecisionRequestedPayload
  /** The handler timed out or returned an error; the fallback strategy answers next. */
  DecisionFailed: {
    correlationId: string
    decisionPoint: DecisionPointId
    failure: 'timeout' | 'error'
    message: string
    /** The fallback that will answer, e.g. "fallback:lowest-free-lane". */
    fallback: string
  }
  DecisionResolved: DecisionResolvedPayload
  ScenarioEnded: { reason: string }
  InvariantViolated: { invariant: string; message: string; offendingEventId: number }
}

export type EventType = keyof EventPayloads

export type EventOf<K extends EventType> = EventEnvelope<K, EventPayloads[K]>

export type EngineEvent = { [K in EventType]: EventOf<K> }[EventType]

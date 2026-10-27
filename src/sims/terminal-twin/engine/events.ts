/**
 * Event envelope and event catalogue.
 *
 * Every happening in the engine is an event with a common envelope. To add an
 * event type, add an entry to `EventPayloads`; `EngineEvent` and the
 * reactor/subscriber types pick it up automatically.
 */
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
 */
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
  ScenarioEnded: { reason: string }
  InvariantViolated: { invariant: string; message: string; offendingEventId: number }
}

export type EventType = keyof EventPayloads

export type EventOf<K extends EventType> = EventEnvelope<K, EventPayloads[K]>

export type EngineEvent = { [K in EventType]: EventOf<K> }[EventType]

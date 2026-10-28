/**
 * Event envelope and event catalogue.
 *
 * Every happening in the engine is an event with a common envelope. To add an
 * event type, add an entry to `EventPayloads`; `EngineEvent` and the
 * reactor/subscriber types pick it up automatically.
 */
import type { DecisionPointId, DecisionReplies, DecisionRequests } from './decisions/types'
import type { MotionSegment } from './kinematics'
import type { Reservation } from './reservations'
import type { CustodyRef } from './state'

/** Common payload of the SHC trip phase events. `segments` = the motion that led up to the event. */
export interface ShcPhasePayload {
  shcId: string
  jobId: string
  containerId: string
  segments: MotionSegment[]
}

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
  /** The vessel reached the port; it asks for a berth (berthAllocation). */
  VesselArrived: { vesselId: string }
  /** No berth was free on arrival: the vessel waits at anchorage until one is allocated. */
  VesselAtAnchorage: { vesselId: string }
  /** Berth allocated: the quay stretch is taken from now; mooring starts. */
  BerthAllocated: { vesselId: string; berthX: number; anchorageWaitS: number }
  /** All fast: the crane split is asked next. */
  VesselBerthed: { vesselId: string; berthX: number }
  /**
   * The STS takes its next box (two for a twin-20 lift) and moves to it:
   * gantry to the bay (rail reserved), trolley out, hoist down, lock.
   */
  StsMoveStarted: { stsId: string; vesselId: string; containerIds: string[]; segments: MotionSegment[] }
  /** The STS cannot gantry to its next bay yet: a neighbouring crane is in the way. */
  StsWaitingForRail: { stsId: string; targetX: number; blockedBy: string }
  /** A free STS gantries out of a neighbour's way. */
  StsRepositionStarted: { stsId: string; toX: number }
  StsRepositionCompleted: { stsId: string; gantryX: number; segments: MotionSegment[] }
  /**
   * Spreader locked: custody vessel slot → STS. A twin-20 lift picks a
   * second box (`twin`) in the same cycle.
   */
  StsPicked: {
    stsId: string
    containerId: string
    from: CustodyRef
    twin?: { containerId: string; from: CustodyRef }
    segments: MotionSegment[]
  }
  /** Box released on an STS ground position: custody STS → ground position. */
  StsGrounded: {
    stsId: string
    containerId: string
    groundPositionId: string
    /** X along the quay where the box was set down (gantry ± twin-20 offset). */
    x: number
    segments: MotionSegment[]
  }
  /** The ground-position decision returned no position; the STS holds the box and idles. */
  StsWaitingForGroundPosition: { stsId: string; containerId: string }
  /** A ground position freed up; the waiting STS asks for one again. */
  StsGroundPositionWaitEnded: { stsId: string; containerId: string; waitedS: number }
  /**
   * The SHC dispatch reply claimed a job: the whole trip (pickup, drop at the
   * WTP pad, clearing) is planned and its conflict zones reserved. The SHC
   * departs at `departAt` (later than now if a zone is busy).
   */
  ShcJobAssigned: {
    shcId: string
    jobId: string
    containerId: string
    groundPositionId: string
    wtpPadId: string
    departAt: number
    distanceM: number
    reservations: Reservation[]
  }
  ShcRoutingEmpty: ShcPhasePayload
  ShcPositioningAtPickup: ShcPhasePayload
  ShcLocking: ShcPhasePayload
  /** Spreader locked: custody ground position → SHC; the ground position is free again. */
  ShcPicked: ShcPhasePayload & { groundPositionId: string }
  ShcRoutingLoaded: ShcPhasePayload
  ShcPositioningAtDropoff: ShcPhasePayload
  ShcLowering: ShcPhasePayload
  ShcUnlocking: ShcPhasePayload
  /** Box released on the WTP pad: custody SHC → WTP pad. */
  ShcDroppedAtWtp: ShcPhasePayload & { wtpPadId: string }
  /** The SHC reversed clear of the pad and is available. */
  ShcCleared: ShcPhasePayload & { nodeId: string }
  /** An idle SHC heads for its parking spot. */
  ShcRoutingToParking: { shcId: string; departAt: number; reservations: Reservation[] }
  ShcParked: { shcId: string; nodeId: string; segments: MotionSegment[] }
  /** ASC took the box off the WTP pad: custody WTP pad → ASC (the instant stub raises it at the drop time). */
  AscPicked: { ascId: string; blockId: string; containerId: string; wtpPadId: string }
  /** ASC set the box down in the stack: custody ASC → yard slot. */
  AscStacked: { ascId: string; blockId: string; containerId: string; yardSlotId: string }
  /** The STS finished its bays of the vessel and is free again. */
  StsWorkComplete: { stsId: string; vesselId: string }
  /** All the vessel's moves are done: unmooring starts. */
  VesselWorkComplete: { vesselId: string }
  /** The vessel has left; its quay stretch is free. */
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

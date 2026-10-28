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
import type { ContainerSize } from '../scenario/types'

/** Common payload of the SHC trip phase events. `segments` = the motion that led up to the event. */
export interface ShcPhasePayload {
  shcId: string
  jobId: string
  containerId: string
  segments: MotionSegment[]
}

/** Common payload of the ASC job phase events. `segments` = the motion that led up to the event. */
export interface AscPhasePayload {
  ascId: string
  blockId: string
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
  /**
   * The ASC took the oldest stackable box (allocated, SHC cleared): the whole
   * cycle (pad, lift, slot, set down) is planned and the pad zone reserved.
   * The ASC departs at `departAt` (later than now if the pad zone is busy).
   */
  AscJobAssigned: {
    ascId: string
    blockId: string
    jobId: string
    containerId: string
    wtpPadId: string
    yardSlotId: string
    departAt: number
    reservations: Reservation[]
    /** Twin-ASC blocks: seconds the departure waits for the other ASC's rail segments. */
    railWaitS?: number
    /** The job is a rehandle (TT-12): `yardSlotId` is the blocker's slot, `targetSlotId` where it goes. */
    rehandle?: true
    targetSlotId?: string
  }
  /**
   * Twin-ASC blocks: the ASC steps aside along the rail so the other ASC can
   * do its job. It heads for `toZ` at `departAt` and is ready again (AscReady)
   * when it gets there.
   */
  AscYieldAssigned: {
    ascId: string
    blockId: string
    /** The ASC that needs the room. */
    forAscId: string
    toZ: number
    departAt: number
    reservations: Reservation[]
  }
  /**
   * An export retrieval found its box buried (TT-12): `blockerIds` (top first) stand on it, so
   * each is rehandled to another slot of the block before the productive move. A rehandleTarget
   * decision follows for the top blocker, and for each next one when the previous move is done.
   */
  RehandleRequired: { blockId: string; jobId: string; containerId: string; yardSlotId: string; blockerIds: string[] }
  /** Spreader up, gantry and trolley heading for the WTP pad. */
  AscRoutingToPad: AscPhasePayload
  /** Over the pad; the hoist lowers the spreader onto the box. */
  AscPositioningAtPad: AscPhasePayload
  /** Spreader on the box; twist-locks closing. */
  AscLocking: AscPhasePayload
  /** Box locked and ready to lift: custody WTP pad → ASC; the pad is free. */
  AscPicked: AscPhasePayload & { wtpPadId: string }
  /** Box up; gantry and trolley heading for the slot. */
  AscRoutingToSlot: AscPhasePayload
  /** Over the slot; the hoist lowers the box onto the stack. */
  AscPositioningAtSlot: AscPhasePayload
  /** Box on the stack; twist-locks opening. */
  AscUnlocking: AscPhasePayload
  /** Box released in its slot: custody ASC → yard slot. */
  AscStacked: AscPhasePayload & { yardSlotId: string; /** A rehandle (TT-12): a blocker set down in its new slot, not a productive move. */ rehandle?: true }
  /** Spreader back at travel height: the ASC is available for its next box. */
  AscReady: { ascId: string; blockId: string; segments: MotionSegment[] }
  /** An STS load pick from a WTP pad by an SHC: custody WTP pad → SHC; the pad is free. */
  ShcPickedAtWtp: ShcPhasePayload & { wtpPadId: string }
  /** Export box released on an STS ground position: custody SHC → ground position. */
  ShcDroppedAtGround: ShcPhasePayload & { groundPositionId: string; x: number },
  /** Spreader up, gantry and trolley heading for the box in the stack (export retrieval). */
  AscRoutingToStack: AscPhasePayload
  /** Over the stack; the hoist lowers the spreader onto the box. */
  AscPositioningAtStack: AscPhasePayload
  /** Export box locked and lifted out of its stack: custody yard slot → ASC. */
  AscRetrieved: AscPhasePayload & { yardSlotId: string; /** A rehandle (TT-12): a blocker lifted out of the way. */ rehandle?: true }
  /** Box up; gantry and trolley heading for the WTP pad. */
  AscRoutingToWtp: AscPhasePayload
  /** Over the pad; the hoist lowers the box onto it. */
  AscPositioningAtWtp: AscPhasePayload
  /** Export box released on the WTP pad: custody ASC → WTP pad. */
  AscDroppedAtWtp: AscPhasePayload & { wtpPadId: string }
  /**
   * A work package was released by the workPackageRelease decision. `ahead` =
   * released packages waiting behind the active one, after this release.
   */
  WorkPackageReleased: {
    packageId: string
    stsId: string
    vesselId: string
    kind: 'discharge' | 'load'
    section: 'deck' | 'hold'
    bay: number
    moves: number
    ahead: number
  }
  /** The STS starts its next released package; `leadTimeS` = time since its release. */
  WorkPackageStarted: { packageId: string; stsId: string; vesselId: string; kind: 'discharge' | 'load'; moves: number; leadTimeS: number }
  /** The package's last move is done. */
  WorkPackageCompleted: { packageId: string; stsId: string; vesselId: string; kind: 'discharge' | 'load'; moves: number; durationS: number }
  /**
   * A released load package needs N empty containers of a size and line (TT-11). `available` = matching empties in
   * the yard that an ASC could take now; with fewer than `count` the package waits for more (asked again when an
   * empty is stacked or becomes reachable).
   */
  EmptiesRequired: { packageId: string; stsId: string; vesselId: string; size: ContainerSize; line: string; count: number; available: number }
  /** The emptyAllocation decision assigned these empties to the package; they are booked to its vessel slots. */
  EmptiesAllocated: { packageId: string; stsId: string; vesselId: string; containerIds: string[] }
  /** A transshipment box finished its yard dwell: it may now be fetched for its onward vessel (TT-11). */
  TransshipmentReady: { containerId: string; onwardVesselId: string; dwellS: number }
  /** The STS takes its next export box from its ground position and puts it in its vessel slot. */
  StsLoadStarted: { stsId: string; vesselId: string; packageId: string; containerId: string; slotId: string; segments: MotionSegment[] }
  /** The next export box is not on a ground position yet; the STS waits (counts as waiting for the SHC). */
  StsWaitingForBox: { stsId: string; containerId: string }
  /** The export box reached a ground position; the waiting STS goes on. */
  StsBoxWaitEnded: { stsId: string; containerId: string; waitedS: number }
  /** Spreader locked on the export box: custody ground position → STS. */
  StsLoadPicked: { stsId: string; containerId: string; groundPositionId: string; segments: MotionSegment[] }
  /** Box released in its vessel slot: custody STS → vessel slot. */
  StsLoaded: { stsId: string; vesselId: string; containerId: string; slotId: string; segments: MotionSegment[] }
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

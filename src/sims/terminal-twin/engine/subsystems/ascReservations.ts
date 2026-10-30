/**
 * ASC trips, rail and reservations (V11-09): turns a job into a planned cycle.
 *
 * Builds each job kind's relative trip (gantry/trolley/hoist segments and phase
 * marks), plans it against the pad/stall zone and, in twin blocks, the shared
 * rail (partner step-aside included, pure helpers in ascRail.ts), and commits
 * a partner's step-aside. Starting the job itself is ascDispatch.ts.
 */
import type { EngineContext } from '../context'
import { ascKpi, blockOf, isTruckJob, kinematics, partnerOf, stallOf } from './ascStorage'
import { truckStallEta } from './landside'
import { planSegment, positionAt, type AxisProfile, type MotionSegment } from '../kinematics'
import { laneGraphOf } from '../laneGraph'
import { earliestStart, earliestStartAmong, reserve, type Reservation, type WindowSpec } from '../reservations'
import { ascIndexOf, type AscJob, type AscPlannedEvent, type AscState } from '../state'
import {
  PARK_UNTIL_S,
  boxSpan,
  parseYardSlotId,
  rowX,
  slotZ,
  tierBaseY,
  travelHoistM,
  TRUCK_DECK_M,
} from '../yardLayout'
import {
  isBlockedStart,
  isParkHold,
  occupancyPieces,
  parkWindows,
  pieceWindows,
  sweepOf,
  truncateParkHolds,
  yieldTarget,
} from './ascRail'

export type PlannedType = AscPlannedEvent['type']

/** Position of an axis at time `t` from a motion plan; `rest` when the plan never moves that axis. */
function axisAt(motion: MotionSegment[], axis: MotionSegment['axis'], t: number, rest: number): number {
  let last: MotionSegment | null = null
  let first: MotionSegment | null = null
  for (const s of motion) {
    if (s.axis !== axis) continue
    first ??= s
    if (s.t0 <= t) last = s
  }
  if (last) return positionAt(last, t)
  return first ? first.from : rest
}

/** Where the ASC's spreader is at `t`: gantry Z, trolley X, hoist (box bottom) height. */
export function ascPoseAt(asc: Pick<AscState, 'motion' | 'gantryZ' | 'trolleyX' | 'hoistY'>, t: number): { z: number; x: number; hoistY: number } {
  return {
    z: axisAt(asc.motion, 'gantry', t, asc.gantryZ),
    x: axisAt(asc.motion, 'trolley', t, asc.trolleyX),
    hoistY: axisAt(asc.motion, 'hoist', t, asc.hoistY),
  }
}

/**
 * Builds one ASC cycle as motion segments (relative times from 0), phase marks
 * and the time the ASC spends over the WTP pad.
 */
export class AscTrip {
  t = 0
  gantry: number
  trolley: number
  hoist: number
  readonly segments: MotionSegment[] = []
  readonly marks: { type: PlannedType; at: number }[] = []
  /** Time over the pad (relative): from arrival until the spreader has lifted clear. */
  padFrom = 0
  padTo = 0

  constructor(
    private ascId: string,
    start: { z: number; x: number; hoistY: number },
    private instant: boolean,
  ) {
    this.gantry = start.z
    this.trolley = start.x
    this.hoist = start.hoistY
  }

  private plan(axis: 'gantry' | 'trolley' | 'hoist', from: number, to: number, profile: AxisProfile): MotionSegment {
    const seg = planSegment(this.ascId, axis, from, to, this.t, profile)
    if (this.instant) seg.t1 = seg.t0
    this.segments.push(seg)
    return seg
  }

  mark(type: PlannedType): void {
    this.marks.push({ type, at: this.t })
  }

  /** Stand still even in instant mode (waiting for a truck, not working). */
  wait(seconds: number): void {
    this.t += seconds
  }

  dwell(seconds: number): void {
    if (!this.instant) this.t += seconds
  }

  hoistTo(y: number, profile: AxisProfile): void {
    if (Math.abs(y - this.hoist) < 1e-9) return
    this.t = this.plan('hoist', this.hoist, y, profile).t1
    this.hoist = y
  }

  /** Gantry and trolley move together. */
  moveTo(z: number, x: number, gantry: AxisProfile, trolley: AxisProfile): void {
    let end = this.t
    if (Math.abs(z - this.gantry) > 1e-9) end = Math.max(end, this.plan('gantry', this.gantry, z, gantry).t1)
    if (Math.abs(x - this.trolley) > 1e-9) end = Math.max(end, this.plan('trolley', this.trolley, x, trolley).t1)
    this.t = end
    this.gantry = z
    this.trolley = x
  }

  windows(padId: string): WindowSpec[] {
    return padId === '' ? [] : [{ zone: padId, from: this.padFrom, to: this.padTo }]
  }
}

/** Shift a relative cycle to start at `start` and install it as the ASC's plan. */
export function install(asc: AscState, trip: AscTrip, start: number): void {
  const segments = trip.segments.map((s) => ({ ...s, t0: s.t0 + start, t1: s.t1 + start }))
  asc.motion = segments
  let prevAt = -Infinity
  asc.plan = trip.marks.map((m) => {
    const at = m.at + start
    const mine = segments.filter((s) => s.t1 <= at + 1e-9 && s.t1 > prevAt + 1e-9)
    prevAt = at
    return { type: m.type, at, segments: mine }
  })
}

/** An export retrieval as a relative trip (stack → lock → lift → pad → set down → spreader up). */
function buildRetrieveTrip(ctx: EngineContext, asc: AscState, job: AscJob): { trip: AscTrip; padId: string } {
  const { state } = ctx
  const k = kinematics(ctx)
  const block = blockOf(ctx, asc.blockId)
  const pad = laneGraphOf(ctx.config).pads.find((p) => p.id === job.wtpPadId)
  if (!pad) throw new Error(`Unknown WTP pad ${job.wtpPadId}`)
  const cell = parseYardSlotId(job.yardSlotId ?? '')
  const span = boxSpan(state.containers[job.containerId].size)
  const travel = travelHoistM(block)
  const trip = new AscTrip(asc.id, { z: asc.gantryZ, x: asc.trolleyX, hoistY: asc.hoistY }, state.subsystems.asc === 'instant')
  trip.mark('AscRoutingToStack')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.moveTo(slotZ(block, cell.bay, span), rowX(block, cell.row), k.gantry, k.trolley)
  trip.mark('AscPositioningAtStack')
  trip.hoistTo(tierBaseY(cell.tier), k.hoistEmpty)
  trip.mark('AscLocking')
  trip.dwell(k.lockS)
  trip.mark('AscRetrieved')
  trip.mark('AscRoutingToWtp')
  trip.hoistTo(travel, k.hoistLoaded)
  trip.moveTo(pad.z, pad.x, k.gantry, k.trolley)
  trip.padFrom = trip.t
  trip.mark('AscPositioningAtWtp')
  trip.hoistTo(0, k.hoistLoaded)
  trip.mark('AscUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('AscDroppedAtWtp')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.padTo = trip.t
  trip.mark('AscReady')
  return { trip, padId: pad.id }
}

/** A rehandle as a relative trip (blocker's stack → lock → lift → new slot → set down → spreader up); no pad. */
function buildRehandleTrip(ctx: EngineContext, asc: AscState, job: AscJob): { trip: AscTrip; padId: string } {
  const { state } = ctx
  const k = kinematics(ctx)
  const block = blockOf(ctx, asc.blockId)
  const from = parseYardSlotId(job.yardSlotId ?? '')
  const to = parseYardSlotId(job.targetSlotId ?? '')
  const span = boxSpan(state.containers[job.containerId].size)
  const travel = travelHoistM(block)
  const trip = new AscTrip(asc.id, { z: asc.gantryZ, x: asc.trolleyX, hoistY: asc.hoistY }, state.subsystems.asc === 'instant')
  trip.mark('AscRoutingToStack')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.moveTo(slotZ(block, from.bay, span), rowX(block, from.row), k.gantry, k.trolley)
  trip.mark('AscPositioningAtStack')
  trip.hoistTo(tierBaseY(from.tier), k.hoistEmpty)
  trip.mark('AscLocking')
  trip.dwell(k.lockS)
  trip.mark('AscRetrieved')
  trip.mark('AscRoutingToSlot')
  trip.hoistTo(travel, k.hoistLoaded)
  trip.moveTo(slotZ(block, to.bay, span), rowX(block, to.row), k.gantry, k.trolley)
  trip.mark('AscPositioningAtSlot')
  trip.hoistTo(tierBaseY(to.tier), k.hoistLoaded)
  trip.mark('AscUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('AscStacked')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.mark('AscReady')
  return { trip, padId: '' }
}

/** Truck drop as a relative trip: stall → lock → lift off the chassis → slot → set down → spreader up. */
function buildTruckDropTrip(ctx: EngineContext, asc: AscState, job: AscJob): { trip: AscTrip; padId: string } {
  const { state } = ctx
  const k = kinematics(ctx)
  const block = blockOf(ctx, asc.blockId)
  const stall = stallOf(ctx, job.stallId as string)
  const cell = parseYardSlotId(job.yardSlotId ?? '')
  const span = boxSpan(state.containers[job.containerId].size)
  const travel = travelHoistM(block)
  const trip = new AscTrip(asc.id, { z: asc.gantryZ, x: asc.trolleyX, hoistY: asc.hoistY }, state.subsystems.asc === 'instant')
  trip.mark('AscRoutingToTruck')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.moveTo(stall.z, stall.x, k.gantry, k.trolley)
  trip.padFrom = trip.t
  trip.mark('AscPositioningAtTruck')
  trip.hoistTo(TRUCK_DECK_M, k.hoistEmpty)
  trip.mark('AscLocking')
  trip.dwell(k.lockS)
  trip.mark('AscPickedFromTruck')
  trip.mark('AscRoutingToSlot')
  trip.hoistTo(travel, k.hoistLoaded)
  trip.padTo = trip.t
  trip.moveTo(slotZ(block, cell.bay, span), rowX(block, cell.row), k.gantry, k.trolley)
  trip.mark('AscPositioningAtSlot')
  trip.hoistTo(tierBaseY(cell.tier), k.hoistLoaded)
  trip.mark('AscUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('AscStacked')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.mark('AscReady')
  return { trip, padId: stall.id }
}

/** Truck pick as a relative trip: stack → lock → lift → stall → set down on the chassis → spreader up. */
function buildTruckPickTrip(ctx: EngineContext, asc: AscState, job: AscJob): { trip: AscTrip; padId: string } {
  const { state } = ctx
  const k = kinematics(ctx)
  const block = blockOf(ctx, asc.blockId)
  const stall = stallOf(ctx, job.stallId as string)
  const cell = parseYardSlotId(job.yardSlotId ?? '')
  const span = boxSpan(state.containers[job.containerId].size)
  const travel = travelHoistM(block)
  const trip = new AscTrip(asc.id, { z: asc.gantryZ, x: asc.trolleyX, hoistY: asc.hoistY }, state.subsystems.asc === 'instant')
  trip.mark('AscRoutingToStack')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.moveTo(slotZ(block, cell.bay, span), rowX(block, cell.row), k.gantry, k.trolley)
  trip.mark('AscPositioningAtStack')
  trip.hoistTo(tierBaseY(cell.tier), k.hoistEmpty)
  trip.mark('AscLocking')
  trip.dwell(k.lockS)
  trip.mark('AscRetrieved')
  trip.mark('AscRoutingToStall')
  trip.hoistTo(travel, k.hoistLoaded)
  trip.moveTo(stall.z, stall.x, k.gantry, k.trolley)
  trip.padFrom = trip.t
  // TT-R17: fetched ahead of the truck: hover over the stall until it is planned to stand there
  const eta = truckStallEta(state, job.truckId)
  if (eta !== null && state.trucks[job.truckId as string].atStallAt === null) trip.wait(Math.max(0, eta - (state.now + trip.t)))
  trip.mark('AscPositioningAtStall')
  trip.hoistTo(TRUCK_DECK_M, k.hoistLoaded)
  trip.mark('AscUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('AscDroppedAtStall')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.padTo = trip.t
  trip.mark('AscReady')
  return { trip, padId: stall.id }
}

/** The ASC's whole cycle for `job` as a relative trip (pad → lift → slot → set down → spreader up). */
function buildJobTrip(ctx: EngineContext, asc: AscState, job: AscJob): { trip: AscTrip; padId: string } {
  if (isTruckJob(job)) return job.kind === 'retrieve' ? buildTruckPickTrip(ctx, asc, job) : buildTruckDropTrip(ctx, asc, job)
  if (job.kind === 'retrieve') return buildRetrieveTrip(ctx, asc, job)
  if (job.kind === 'rehandle') return buildRehandleTrip(ctx, asc, job)
  const { state } = ctx
  const k = kinematics(ctx)
  const block = blockOf(ctx, asc.blockId)
  const pad = laneGraphOf(ctx.config).pads.find((p) => p.id === job.wtpPadId)
  if (!pad) throw new Error(`Unknown WTP pad ${job.wtpPadId}`)
  const cell = parseYardSlotId(job.yardSlotId ?? '')
  const span = boxSpan(state.containers[job.containerId].size)
  const slotXm = rowX(block, cell.row)
  const slotZm = slotZ(block, cell.bay, span)
  const travel = travelHoistM(block)
  const instant = state.subsystems.asc === 'instant'

  const trip = new AscTrip(asc.id, { z: asc.gantryZ, x: asc.trolleyX, hoistY: asc.hoistY }, instant)
  trip.mark('AscRoutingToPad')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.moveTo(pad.z, pad.x, k.gantry, k.trolley)
  trip.padFrom = trip.t
  trip.mark('AscPositioningAtPad')
  trip.hoistTo(0, k.hoistEmpty)
  trip.mark('AscLocking')
  trip.dwell(k.lockS)
  trip.mark('AscPicked')
  trip.mark('AscRoutingToSlot')
  trip.hoistTo(travel, k.hoistLoaded)
  trip.padTo = trip.t
  trip.moveTo(slotZm, slotXm, k.gantry, k.trolley)
  trip.mark('AscPositioningAtSlot')
  trip.hoistTo(tierBaseY(cell.tier), k.hoistLoaded)
  trip.mark('AscUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('AscStacked')
  trip.hoistTo(travel, k.hoistEmpty)
  trip.mark('AscReady')
  return { trip, padId: pad.id }
}

/** A partner stepping aside along the rail (planned, not yet committed). */
interface YieldPlan {
  asc: AscState
  trip: AscTrip
  toZ: number
  start: number
  finite: WindowSpec[]
  park: WindowSpec[]
}

/** A planned job: the trip, when it departs, and (twin blocks) the partner's step-aside. */
export interface JobPlan {
  trip: AscTrip
  padWindows: WindowSpec[]
  railWindows: WindowSpec[]
  park: WindowSpec[]
  start: number
  /** Departure delay caused by the pad zone alone (the SHC is there), and by the rail. */
  padWaitS: number
  railWaitS: number
  yield: YieldPlan | null
}

/** Plan the partner's step-aside to `toZ`; null if it cannot start (blocked by the requester or the rail end). */
function planYield(ctx: EngineContext, partner: AscState, requester: AscState, sweep: { lo: number; hi: number }): YieldPlan | null {
  const { state } = ctx
  const k = kinematics(ctx)
  const block = blockOf(ctx, partner.blockId)
  const toZ = yieldTarget(block, ascIndexOf(partner.id) > ascIndexOf(requester.id), sweep)
  if (toZ === null) return null
  const trip = new AscTrip(partner.id, { z: partner.gantryZ, x: partner.trolleyX, hoistY: partner.hoistY }, false)
  trip.moveTo(toZ, partner.trolleyX, k.gantry, k.trolley)
  trip.mark('AscReady')
  const pieces = occupancyPieces(partner.gantryZ, trip.segments, trip.t)
  const finite = pieceWindows(block, pieces)
  const park = parkWindows(block, toZ, trip.t)
  const others = state.reservations.filter((r) => r.holder !== partner.id)
  const start = earliestStartAmong(others, [...finite, ...park], state.now)
  if (isBlockedStart(start)) return null
  return { asc: partner, trip, toZ, start, finite, park }
}

/** Reservations as they would be if the partner had stepped aside (nothing is changed). */
function withYield(list: readonly Reservation[], y: YieldPlan): Reservation[] {
  const out = list.filter((r) => r.holder !== y.asc.id || !isParkHold(r))
  for (const w of y.finite) out.push({ id: -1, zone: w.zone, holder: y.asc.id, from: y.start + w.from, to: y.start + w.to })
  for (const w of y.park) out.push({ id: -1, zone: w.zone, holder: y.asc.id, from: y.start + w.from, to: PARK_UNTIL_S })
  return out
}

/**
 * Plan `job` for `asc` without changing anything. Single-ASC blocks only wait
 * for the pad zone. Twin blocks also reserve rail segments; if the other ASC
 * is parked in the way and idle it steps aside first, if it is busy the job
 * cannot be served now (null).
 */
export function planJob(ctx: EngineContext, asc: AscState, job: AscJob): JobPlan | null {
  const { state } = ctx
  const { trip, padId } = buildJobTrip(ctx, asc, job)
  const padWindows = trip.windows(padId)
  const partner = state.subsystems.asc === 'real' ? partnerOf(state, asc) : null
  if (!partner) {
    const start = earliestStart(state, padWindows, state.now)
    return { trip, padWindows, railWindows: [], park: [], start, padWaitS: start - state.now, railWaitS: 0, yield: null }
  }
  const block = blockOf(ctx, asc.blockId)
  const pieces = occupancyPieces(asc.gantryZ, trip.segments, trip.t)
  const railWindows = pieceWindows(block, pieces)
  const park = parkWindows(block, trip.gantry, trip.t)
  const check = [...padWindows, ...railWindows, ...park]
  let others: readonly Reservation[] = state.reservations.filter((r) => r.holder !== asc.id)
  const padStart = earliestStartAmong(others, padWindows, state.now)
  let start = earliestStartAmong(others, check, state.now)
  let yielded: YieldPlan | null = null
  if (isBlockedStart(start)) {
    if (partner.status !== 'idle') return null
    yielded = planYield(ctx, partner, asc, sweepOf(pieces))
    if (!yielded) return null
    others = withYield(others, yielded)
    start = earliestStartAmong(others, check, state.now)
    if (isBlockedStart(start)) return null
  }
  return { trip, padWindows, railWindows, park, start, padWaitS: padStart - state.now, railWaitS: start - padStart, yield: yielded }
}

export function countGantry(trip: AscTrip): { gantry: number; trolley: number; hoist: number } {
  const sum = { gantry: 0, trolley: 0, hoist: 0 }
  for (const s of trip.segments) sum[s.axis as 'gantry' | 'trolley' | 'hoist'] += Math.abs(s.to - s.from)
  return sum
}

/** Make the partner's step-aside real: reserve its rail windows, install its plan, announce it. */
export function commitYield(ctx: EngineContext, y: YieldPlan, forAsc: AscState): void {
  const { state } = ctx
  state.reservations = truncateParkHolds(state.reservations, y.asc.id, y.start)
  const made = reserve(state, y.asc.id, y.finite, y.start)
  for (const w of y.park)
    state.reservations.push({ id: state.nextReservationId++, zone: w.zone, holder: y.asc.id, from: y.start + w.from, to: PARK_UNTIL_S })
  install(y.asc, y.trip, y.start)
  y.asc.gantryZ = y.toZ
  y.asc.status = 'repositioning'
  const kpi = ascKpi(state, y.asc.id)
  kpi.yields = (kpi.yields ?? 0) + 1
  kpi.gantryM += countGantry(y.trip).gantry
  kpi.busyS = (kpi.busyS ?? 0) + y.trip.t
  ctx.schedule('AscYieldAssigned', state.now, { equipment: [y.asc.id] }, {
    ascId: y.asc.id,
    blockId: y.asc.blockId,
    forAscId: forAsc.id,
    toZ: y.toZ,
    departAt: y.start,
    reservations: made,
  })
}


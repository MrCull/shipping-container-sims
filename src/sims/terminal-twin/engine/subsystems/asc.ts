/**
 * ASC subsystem (TT-06): one automated stacking crane per yard block takes
 * boxes from the WTP pads and stacks them.
 *
 * Flow per box:
 *   ShcDroppedAtWtp → yardAllocation decision (slot in the pad's block, claimed
 *   on the reply) … ShcCleared (the SHC has released the box and left the pad)
 *   → AscJobAssigned → AscRoutingToPad → AscPositioningAtPad → AscLocking
 *   → AscPicked (custody pad → ASC) → AscRoutingToSlot → AscPositioningAtSlot
 *   → AscUnlocking → AscStacked (custody ASC → yard slot) → AscReady
 *
 * The ASC takes the open job with the oldest slot claim that is allocated and
 * cleared, unless an older claim shares a stack with it (a lower box must land
 * first, so stacks fill from the bottom). The whole cycle is planned at once as
 * gantry (Z), trolley (X) and hoist segments; gantry and trolley move together,
 * the hoist moves alone. The pad zone is reserved (engine/reservations.ts) from
 * the ASC's arrival over the pad until its spreader has cleared the pad, so an
 * SHC planned later is delayed and the ASC never enters a pad's lifting
 * envelope while an SHC is there.
 *
 * Modes: real (kinematics), instant (same events, zero durations), off (no
 * ASC: boxes stay on the pads, which fill up).
 */
import type { EngineContext, ReactorMap } from '../context'
import type { EventOf } from '../events'
import { planSegment, positionAt, type AxisProfile, type MotionSegment } from '../kinematics'
import { laneGraphOf } from '../laneGraph'
import { earliestStart, earliestStartAmong, reserve, type Reservation, type WindowSpec } from '../reservations'
import { ascIndexOf, type AscJob, type AscPlannedEvent, type AscState, type AscStatus, type SimState } from '../state'
import {
  ASC_MIN_SEPARATION_M,
  PARK_UNTIL_S,
  blockSpec,
  boxSpan,
  parseYardSlotId,
  rowX,
  slotZ,
  stackIndex,
  tierBaseY,
  travelHoistM,
  type BlockSpec,
} from '../yardLayout'
import { DEFAULT_ASC_KINEMATICS } from '../../scenario/builder'
import type { AscKinematics } from '../../scenario/types'
import { parseVesselSlotId } from '../../scenario/vesselClasses'
import { maybeDispatch } from './shc'
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

type PlannedType = AscPlannedEvent['type']

const STATUS_AFTER: Record<PlannedType, AscStatus> = {
  AscRoutingToPad: 'routing-to-pad',
  AscPositioningAtPad: 'positioning-at-pad',
  AscLocking: 'locking',
  AscPicked: 'lifting',
  AscRoutingToSlot: 'routing-to-slot',
  AscPositioningAtSlot: 'positioning-at-slot',
  AscUnlocking: 'unlocking',
  AscStacked: 'releasing',
  AscReady: 'idle',
}

const kinematics = (ctx: EngineContext): AscKinematics => ctx.config.kinematics.asc ?? DEFAULT_ASC_KINEMATICS

function blockOf(ctx: EngineContext, blockId: string): BlockSpec {
  const block = ctx.config.yard?.blocks.find((b) => b.id === blockId)
  if (!block) throw new Error(`Unknown yard block ${blockId}`)
  return blockSpec(ctx.config, block)
}

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
class AscTrip {
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
    return [{ zone: padId, from: this.padFrom, to: this.padTo }]
  }
}

function ascKpi(state: SimState, ascId: string) {
  const k = state.kpis.yard?.perAsc[ascId]
  if (!k) throw new Error(`No ASC KPIs for ${ascId}`)
  return k
}

/** Shift a relative cycle to start at `start` and install it as the ASC's plan. */
function install(asc: AscState, trip: AscTrip, start: number): void {
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

function scheduleNext(ctx: EngineContext, asc: AscState): void {
  const next = asc.plan[0]
  if (!next) return
  if (next.type === 'AscReady') {
    ctx.schedule('AscReady', next.at, { equipment: [asc.id] }, { ascId: asc.id, blockId: asc.blockId, segments: next.segments })
    return
  }
  const job = asc.jobId ? ctx.state.ascJobs[asc.jobId] : null
  if (!job) throw new Error(`${asc.id}: ${next.type} without a job`)
  const base = { ascId: asc.id, blockId: asc.blockId, jobId: job.id, containerId: job.containerId, segments: next.segments }
  const subjects = { equipment: [asc.id], containers: [job.containerId], jobs: [job.id] }
  switch (next.type) {
    case 'AscPicked':
      ctx.schedule(next.type, next.at, subjects, { ...base, wtpPadId: job.wtpPadId })
      break
    case 'AscStacked':
      ctx.schedule(next.type, next.at, subjects, { ...base, yardSlotId: job.yardSlotId ?? '' })
      break
    default:
      ctx.schedule(next.type, next.at, subjects, base)
  }
}

/** Common phase handling: pop the plan, set the status, schedule the next phase. */
function advance(ctx: EngineContext, e: EventOf<PlannedType>): AscState {
  const asc = ctx.state.ascs[e.payload.ascId]
  const head = asc.plan.shift()
  if (head?.type !== e.type) throw new Error(`${asc.id}: unexpected ${e.type} (planned ${head?.type ?? 'nothing'})`)
  asc.status = STATUS_AFTER[e.type]
  scheduleNext(ctx, asc)
  return asc
}

/** Columns (bay, row) a job's slot covers. */
function columnsOf(state: SimState, job: AscJob): string[] {
  if (!job.yardSlotId) return []
  const cell = parseYardSlotId(job.yardSlotId)
  const span = boxSpan(state.containers[job.containerId].size)
  return span === 1 ? [`${cell.bay}-${cell.row}`] : [`${cell.bay}-${cell.row}`, `${cell.bay + 1}-${cell.row}`]
}

/** An older claim that shares a stack must be stacked first (stacks fill from the bottom). */
function blockedByOlderClaim(state: SimState, job: AscJob): boolean {
  const mine = new Set(columnsOf(state, job))
  return Object.values(state.ascJobs).some(
    (k) =>
      k !== job &&
      k.blockId === job.blockId &&
      k.claimSeq !== null &&
      (job.claimSeq as number) > k.claimSeq &&
      columnsOf(state, k).some((c) => mine.has(c)),
  )
}

/** The crane sharing the rail with `asc` (twin blocks), or null. */
const partnerOf = (state: SimState, asc: AscState): AscState | null =>
  Object.values(state.ascs).find((a) => a.blockId === asc.blockId && a.id !== asc.id) ?? null

/** The ASC's whole cycle for `job` as a relative trip (pad → lift → slot → set down → spreader up). */
function buildJobTrip(ctx: EngineContext, asc: AscState, job: AscJob): { trip: AscTrip; padId: string } {
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
interface JobPlan {
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
function planJob(ctx: EngineContext, asc: AscState, job: AscJob): JobPlan | null {
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

function countGantry(trip: AscTrip): { gantry: number; trolley: number; hoist: number } {
  const sum = { gantry: 0, trolley: 0, hoist: 0 }
  for (const s of trip.segments) sum[s.axis as 'gantry' | 'trolley' | 'hoist'] += Math.abs(s.to - s.from)
  return sum
}

/** Make the partner's step-aside real: reserve its rail windows, install its plan, announce it. */
function commitYield(ctx: EngineContext, y: YieldPlan, forAsc: AscState): void {
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

/** Commit a planned job: reserve, install the plan, update KPIs, announce. */
function startJob(ctx: EngineContext, asc: AscState, job: AscJob, plan: JobPlan): void {
  const { state } = ctx
  const { trip, start } = plan
  const twin = plan.railWindows.length > 0 || plan.yield !== null || plan.park.length > 0
  if (plan.yield) commitYield(ctx, plan.yield, asc)

  job.ascId = asc.id
  asc.jobId = job.id
  state.reservations = truncateParkHolds(state.reservations, asc.id, start)
  const reservations = reserve(state, asc.id, plan.padWindows.concat(plan.railWindows), start)
  for (const w of plan.park)
    state.reservations.push({ id: state.nextReservationId++, zone: w.zone, holder: asc.id, from: start + w.from, to: PARK_UNTIL_S })
  install(asc, trip, start)
  asc.gantryZ = trip.gantry
  asc.trolleyX = trip.trolley
  asc.hoistY = trip.hoist
  asc.status = 'job-assigned'

  const kpi = ascKpi(state, asc.id)
  kpi.jobs++
  kpi.padWaitS += plan.padWaitS
  if (twin) {
    kpi.railWaitS = (kpi.railWaitS ?? 0) + plan.railWaitS
    kpi.busyS = (kpi.busyS ?? 0) + trip.t
  }
  const d = countGantry(trip)
  kpi.gantryM += d.gantry
  kpi.trolleyM += d.trolley
  kpi.hoistM += d.hoist
  ctx.schedule('AscJobAssigned', state.now, { equipment: [asc.id], containers: [job.containerId], jobs: [job.id] }, {
    ascId: asc.id,
    blockId: asc.blockId,
    jobId: job.id,
    containerId: job.containerId,
    wtpPadId: job.wtpPadId,
    yardSlotId: job.yardSlotId ?? '',
    departAt: start,
    reservations,
    ...(twin ? { railWaitS: Math.round(plan.railWaitS * 1000) / 1000 } : {}),
  })
}

/** Next open job of the block: allocated, cleared, oldest claim, not blocked by an older claim on its stacks. */
function nextOpenJob(state: SimState, blockId: string): AscJob | undefined {
  const open = Object.values(state.ascJobs)
    .filter((j) => j.blockId === blockId && j.ascId === null && j.cleared && j.claimSeq !== null)
    .sort((a, b) => (a.claimSeq as number) - (b.claimSeq as number))
  return open.find((j) => !blockedByOlderClaim(state, j))
}

const ascsOfBlock = (state: SimState, blockId: string): AscState[] =>
  Object.values(state.ascs)
    .filter((a) => a.blockId === blockId)
    .sort((a, b) => ascIndexOf(a.id) - ascIndexOf(b.id))

/**
 * Give the block's open box to an idle ASC. One ASC: it takes the box. Two
 * ASCs: the ascDispatch decision point picks (one request per block at a time).
 */
export function maybeDispatchAsc(ctx: EngineContext, blockId: string): void {
  const { state } = ctx
  const ascs = ascsOfBlock(state, blockId)
  const idle = ascs.filter((a) => a.status === 'idle')
  if (idle.length === 0) return
  if (ascs.length === 1) {
    const next = nextOpenJob(state, blockId)
    if (next) startJob(ctx, idle[0], next, planJob(ctx, idle[0], next) as JobPlan)
    return
  }
  if (Object.values(state.ascJobs).some((j) => j.blockId === blockId && j.dispatch === 'asked')) return
  const job = nextOpenJob(state, blockId)
  if (!job) return
  requestDispatch(ctx, job, ascs, idle)
}

function requestDispatch(ctx: EngineContext, job: AscJob, ascs: AscState[], idle: AscState[]): void {
  const { state } = ctx
  const block = blockOf(ctx, job.blockId)
  const pad = laneGraphOf(ctx.config).pads.find((p) => p.id === job.wtpPadId)
  if (!pad) throw new Error(`Unknown WTP pad ${job.wtpPadId}`)
  const cell = parseYardSlotId(job.yardSlotId ?? '')
  const span = boxSpan(state.containers[job.containerId].size)
  const sideOf = (a: AscState) => (ascIndexOf(a.id) === 1 ? 'waterside' : 'landside') as 'waterside' | 'landside'
  job.dispatch = 'asked'
  ctx.requestDecision(
    'ascDispatch',
    {
      blockId: job.blockId,
      job: {
        jobId: job.id,
        containerId: job.containerId,
        kind: 'wtp',
        wtpPadId: job.wtpPadId,
        yardSlotId: job.yardSlotId ?? '',
        padZ: pad.z,
        slotZ: slotZ(block, cell.bay, span),
      },
      candidates: idle.map((a) => {
        const plan = planJob(ctx, a, job)
        const kpi = ascKpi(state, a.id)
        return {
          ascId: a.id,
          side: sideOf(a),
          gantryZ: a.gantryZ,
          jobs: kpi.jobs,
          busyS: Math.round((kpi.busyS ?? 0) * 1000) / 1000,
          canServe: plan !== null,
          needsYield: plan?.yield != null,
        }
      }),
      ascs: ascs.map((a) => ({ ascId: a.id, side: sideOf(a), status: a.status, gantryZ: a.gantryZ })),
      minSeparationM: ASC_MIN_SEPARATION_M,
    },
    { equipment: idle.map((a) => a.id), jobs: [job.id], containers: [job.containerId] },
  )
}

/** The TOS named an ASC for the box: start the cycle if that ASC can still serve it. */
function resolveDispatch(ctx: EngineContext, jobId: string, ascId: string | null): void {
  const { state } = ctx
  const job = state.ascJobs[jobId]
  if (!job) return
  delete job.dispatch
  if (ascId === null) return // left open; asked again when the block changes
  const asc = state.ascs[ascId]
  if (!asc || asc.blockId !== job.blockId) throw new Error(`ascDispatch handler returned ${ascId}, which is not an ASC of block ${job.blockId}`)
  if (asc.status !== 'idle' || job.ascId !== null) {
    maybeDispatchAsc(ctx, job.blockId) // the reply was stale (keep-running latency)
    return
  }
  const plan = planJob(ctx, asc, job)
  if (!plan) return // cannot serve it now (the other ASC is busy in the way); asked again later
  startJob(ctx, asc, job, plan)
  maybeDispatchAsc(ctx, job.blockId)
}

/**
 * Ask yardAllocation for the oldest waiting box of the block, if no request is
 * pending: one at a time per block, so a slow TOS never answers from stale stacks.
 */
function pumpAllocation(ctx: EngineContext, blockId: string): void {
  const { state } = ctx
  const jobs = Object.values(state.ascJobs).filter((j) => j.blockId === blockId)
  if (jobs.some((j) => j.allocation === 'asked')) return
  const next = jobs.find((j) => j.allocation === 'waiting')
  if (!next) return
  next.allocation = 'asked'
  requestAllocation(ctx, next)
}

/** Ask the yardAllocation decision point for a slot for the box on the pad. */
function requestAllocation(ctx: EngineContext, job: AscJob): void {
  const { state } = ctx
  const box = state.containers[job.containerId]
  const block = blockOf(ctx, job.blockId)
  const yard = state.yardBlocks[job.blockId]
  const pad = laneGraphOf(ctx.config).pads.find((p) => p.id === job.wtpPadId)
  if (!pad) throw new Error(`Unknown WTP pad ${job.wtpPadId}`)
  ctx.requestDecision(
    'yardAllocation',
    {
      containerId: box.id,
      size: box.size,
      full: box.full,
      line: box.line,
      vesselId: job.vesselId,
      wtpPadId: pad.id,
      blockId: block.id,
      bays: block.bays,
      rows: block.rows,
      tiers: block.tiers,
      blockX: block.x,
      firstBayZ: block.firstBayZ,
      wtpX: pad.x,
      wtpZ: pad.z,
      heights: yard.heights.slice(),
      topVessels: yard.topVessels.slice(),
      random: ctx.random(),
    },
    { containers: [box.id] },
  )
}

/** Claim the slot a yardAllocation reply named (the engine trusts the TOS; invariants catch bad replies). */
function claimSlot(ctx: EngineContext, job: AscJob, slotId: string): void {
  const { state } = ctx
  const yard = state.yardBlocks[job.blockId]
  const cell = parseYardSlotId(slotId)
  const span = boxSpan(state.containers[job.containerId].size)
  if (
    cell.blockId !== job.blockId ||
    cell.bay < 1 ||
    cell.bay + span - 1 > yard.bays ||
    cell.row < 1 ||
    cell.row > yard.rows ||
    cell.tier < 1
  )
    throw new Error(`yardAllocation handler returned slot ${slotId}, which is outside block ${job.blockId} for a ${span * 20} ft box`)
  for (let b = 0; b < span; b++) {
    const i = stackIndex(yard, cell.bay + b, cell.row)
    yard.heights[i] = Math.max(yard.heights[i], cell.tier)
    yard.topVessels[i] = job.vesselId
  }
  job.yardSlotId = slotId
  job.claimSeq = state.nextClaimSeq++
}

const jobOfBox = (state: SimState, containerId: string): AscJob | undefined =>
  Object.values(state.ascJobs).find((j) => j.containerId === containerId)

type PhaseReactor<K extends PlannedType> = (e: EventOf<K>, ctx: EngineContext) => void

const phase = <K extends PlannedType>(extra?: (e: EventOf<K>, ctx: EngineContext, asc: AscState) => void): PhaseReactor<K> =>
  (e, ctx) => {
    const asc = advance(ctx, e as EventOf<PlannedType>)
    extra?.(e, ctx, asc)
  }

export const ascReactors: ReactorMap = {
  /** The SHC set the box on the pad: ask where it goes in the stack. */
  ShcDroppedAtWtp: (e, ctx) => {
    const { state } = ctx
    if (state.subsystems.asc === 'off') return
    const pad = state.wtpPads[e.payload.wtpPadId]
    const box = state.containers[e.payload.containerId]
    const job: AscJob = {
      id: `A${++state.nextAscJob}`,
      blockId: pad.blockId,
      containerId: box.id,
      wtpPadId: pad.id,
      vesselId: parseVesselSlotId(box.custodyHistory[0].owner.id).vesselId,
      allocation: 'waiting',
      yardSlotId: null,
      claimSeq: null,
      cleared: false,
      ascId: null,
    }
    state.ascJobs[job.id] = job
    pumpAllocation(ctx, job.blockId)
  },

  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint === 'ascDispatch') {
      resolveDispatch(ctx, e.payload.request.job.jobId, e.payload.reply.ascId)
      return
    }
    if (e.payload.decisionPoint !== 'yardAllocation') return
    const { state } = ctx
    const job = jobOfBox(state, e.payload.request.containerId)
    if (!job) return
    const { slotId } = e.payload.reply
    if (slotId === null) {
      job.allocation = 'full' // the block is full: the box stays on its pad
      if (state.kpis.yard) state.kpis.yard.allocationFailures++
    } else {
      claimSlot(ctx, job, slotId)
      job.allocation = 'claimed'
    }
    pumpAllocation(ctx, job.blockId)
    maybeDispatchAsc(ctx, job.blockId)
  },

  /** The SHC released the box and left the pad: the ASC may take it. */
  ShcCleared: (e, ctx) => {
    const job = jobOfBox(ctx.state, e.payload.containerId)
    if (!job) return
    job.cleared = true
    maybeDispatchAsc(ctx, job.blockId)
  },

  AscJobAssigned: (e, ctx) => scheduleNext(ctx, ctx.state.ascs[e.payload.ascId]),
  AscYieldAssigned: (e, ctx) => scheduleNext(ctx, ctx.state.ascs[e.payload.ascId]),

  AscRoutingToPad: phase(),
  AscPositioningAtPad: phase(),
  AscLocking: phase((e, ctx) => {
    const job = ctx.state.ascJobs[e.payload.jobId]
    const pad = ctx.state.wtpPads[job.wtpPadId]
    if (pad.containerId !== job.containerId)
      throw new Error(`${e.payload.ascId}: box ${job.containerId} is not on ${pad.id} (found ${pad.containerId ?? 'nothing'})`)
  }),
  AscPicked: phase((e, ctx, asc) => {
    const { state } = ctx
    const pad = state.wtpPads[e.payload.wtpPadId]
    pad.containerId = null
    asc.carrying = e.payload.containerId
    ctx.transferCustody(e.payload.containerId, { kind: 'asc', id: asc.id })
    maybeDispatch(ctx) // a pad is free again (the pad zone stays reserved until the spreader is clear)
  }),
  AscRoutingToSlot: phase(),
  AscPositioningAtSlot: phase(),
  AscUnlocking: phase(),
  AscStacked: phase((e, ctx, asc) => {
    const { state } = ctx
    const cell = parseYardSlotId(e.payload.yardSlotId)
    const span = boxSpan(state.containers[e.payload.containerId].size)
    state.yardSlots[e.payload.yardSlotId] = {
      id: e.payload.yardSlotId,
      blockId: asc.blockId,
      bay: cell.bay,
      row: cell.row,
      tier: cell.tier,
      span,
      containerId: e.payload.containerId,
    }
    asc.carrying = null
    asc.stacked++
    asc.jobId = null
    delete state.ascJobs[e.payload.jobId]
    ctx.transferCustody(e.payload.containerId, { kind: 'yardSlot', id: e.payload.yardSlotId })
    if (state.kpis.yard) state.kpis.yard.boxesStacked++
  }),
  AscReady: phase((e, ctx) => maybeDispatchAsc(ctx, e.payload.blockId)),
}

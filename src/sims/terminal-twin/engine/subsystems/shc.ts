/**
 * SHC subsystem (TT-05): shuttle carriers move discharged boxes from STS
 * ground positions to WTP pads over the waterside lane graph.
 *
 * Work release: every `StsGrounded` adds a job to the released pool.
 * Dispatch (pull): a free SHC asks the `shcDispatch` decision point for its
 * next job and WTP pad. On a reply it plans the WHOLE trip at once:
 *
 *   ShcJobAssigned → ShcRoutingEmpty → ShcPositioningAtPickup → ShcLocking
 *   → ShcPicked (custody GP → SHC) → ShcRoutingLoaded → ShcPositioningAtDropoff
 *   → ShcLowering → ShcUnlocking → ShcDroppedAtWtp (custody SHC → WTP pad)
 *   → ShcCleared (reversed clear of the pad; available)
 *
 * Each phase event schedules the next from `ShcState.plan`, so `why` walks
 * the whole trip. Before the trip starts, every conflict zone on the route
 * is reserved (engine/reservations.ts); if one is busy, the departure is
 * delayed (status `job-assigned`). Vehicles wait only where they rest:
 * parking spots and pad clear positions, which are not conflict zones.
 * Idle SHCs drive back to their parking spot.
 *
 * Export load jobs (TT-10) run the same trip backwards: pad → ShcPickedAtWtp → lane →
 * ShcDroppedAtGround (custody SHC → ground position) → ShcCleared at the lane exit.
 *
 * Modes: real (kinematics), instant (same events, zero durations), off (no
 * jobs; boxes stay on the ground positions).
 */
import type { EngineContext, ReactorMap } from '../context'
import type { EventOf, ShcPhasePayload } from '../events'
import { cornerSpeedCap, planSegment, positionAt, travelTime, type AxisProfile, type CornerModel, type MotionSegment } from '../kinematics'
import { edgeBetween, laneAccess, laneGraphOf, pathLength, shortestPath, type LaneGraph, type PathGraph, type QueueArea } from '../laneGraph'
import { earliestStart, mergeWindows, reserve, type WindowSpec } from '../reservations'
import type { ShcDispatchPad } from '../decisions/types'
import type { ShcJob, ShcPlannedEvent, ShcState, ShcStatus, SimState } from '../state'
import { DEFAULT_SHC_CORNER, DEFAULT_SHC_KINEMATICS } from '../../scenario/builder'
import { DEFAULT_PREDISPATCH_MARGIN_S, type ShcKinematics } from '../../scenario/types'
import { predictedReady } from '../predictions'
import { resumeStsWaitingForBox, resumeStsWaitingForGroundPosition } from './quay'
import { maybeDispatchAsc } from './asc'
import { pumpLoadPrep } from './loadPrep'

type PlannedType = ShcPlannedEvent['type']

const STATUS_AFTER: Record<PlannedType, ShcStatus> = {
  ShcRoutingEmpty: 'routing-empty',
  ShcPositioningAtPickup: 'positioning-at-pickup',
  ShcLocking: 'locking',
  ShcPicked: 'lifting',
  ShcPickedAtWtp: 'lifting',
  ShcRoutingLoaded: 'routing-loaded',
  ShcPositioningAtDropoff: 'positioning-at-dropoff',
  ShcLowering: 'lowering',
  ShcUnlocking: 'unlocking',
  ShcDroppedAtWtp: 'clearing',
  ShcDroppedAtGround: 'clearing',
  ShcCleared: 'available',
  ShcParked: 'parked',
  ShcQueued: 'queuing-for-work',
}

/** Where an SHC is at `t` (plan view), from its current trip's motion; at rest it is at its node. */
export function shcPositionAt(graph: LaneGraph, shc: ShcState, t: number): { x: number; z: number } {
  const node = graph.nodes[shc.nodeId]
  const axis = (a: 'x' | 'z', rest: number): number => {
    let last: MotionSegment | null = null
    let first: MotionSegment | null = null
    for (const s of shc.motion) {
      if (s.axis !== a) continue
      first ??= s
      if (s.t0 <= t) last = s
    }
    if (last) return positionAt(last, t)
    return first ? first.from : rest
  }
  return { x: axis('x', node.x), z: axis('z', node.z) }
}

function kinematics(ctx: EngineContext): ShcKinematics {
  return ctx.config.kinematics.shc ?? DEFAULT_SHC_KINEMATICS
}

/** The SHC's turn model (assumed radius and lateral acceleration); radius 0 turns cornering off. */
export function cornerOf(ctx: EngineContext): CornerModel {
  const k = kinematics(ctx)
  return { radiusM: k.cornerRadiusM ?? DEFAULT_SHC_CORNER.radiusM, lateralAccel: k.maxLateralAccel ?? DEFAULT_SHC_CORNER.lateralAccel }
}

/** Scale a profile so every travel time is multiplied by `f`. */
function scaled(p: AxisProfile, f: number): AxisProfile {
  return { vMax: p.vMax / f, accel: p.accel / (f * f), decel: p.decel / (f * f) }
}

/** Driver-variability factor for one trip (1 ± driverVariabilityPct %). */
function driverFactor(ctx: EngineContext): number {
  const pct = ctx.config.driverVariabilityPct ?? 0
  if (pct === 0) return 1
  return 1 + ((ctx.random() * 2 - 1) * pct) / 100
}

export interface Waypoint {
  nodeId: string
  x: number
  z: number
  /** Conflict zone of this point (null = free). */
  zone: string | null
  /** Conflict zone of the stretch from the previous waypoint to this one. */
  edgeZone: string | null
}

/**
 * Builds one trip as motion segments (relative times from 0), phase marks
 * and the conflict-zone windows it needs. Straight collinear stretches are
 * one move. Without a `corner` model every run is rest to rest (trucks, and
 * SHCs with cornering off); with one, the vehicle takes each turn at a speed
 * capped by the turn angle and radius (`cornerSpeedCap`) and the two runs
 * share that speed, so end times are still known when the trip is planned.
 */
export class TripBuilder<M extends string = PlannedType> {
  t = 0
  s = 0
  x: number
  z: number
  lift: number
  readonly segments: MotionSegment[] = []
  readonly marks: { type: M; at: number }[] = []
  /** Driven runs: path distance ↔ time. */
  private runs: { s0: number; s1: number; seg: MotionSegment }[] = []
  /** Zone visits as path-distance intervals. */
  private visits: { zone: string; s0: number; s1: number }[] = []

  constructor(
    private graph: { layout: { zoneClearanceM: number } },
    private shcId: string,
    start: Waypoint,
    private instant: boolean,
    private corner?: CornerModel,
  ) {
    this.x = start.x
    this.z = start.z
    this.lift = 0
    if (start.zone) this.addVisit(start.zone, 0, 0)
  }

  private plan(axis: 'x' | 'z' | 'lift', from: number, to: number, profile: AxisProfile, v0 = 0, v1 = 0): MotionSegment {
    const seg = planSegment(this.shcId, axis, from, to, this.t, profile, v0, v1)
    if (this.instant) seg.t1 = seg.t0
    this.segments.push(seg)
    this.t = seg.t1
    return seg
  }

  private addVisit(zone: string, s0: number, s1: number): void {
    const last = this.visits[this.visits.length - 1]
    if (last && last.zone === zone && s0 <= last.s1 + 1e-9) last.s1 = Math.max(last.s1, s1)
    else this.visits.push({ zone, s0, s1 })
  }

  mark(type: M): void {
    this.marks.push({ type, at: this.t })
  }

  dwell(seconds: number): void {
    if (!this.instant) this.t += seconds
  }

  liftTo(height: number, profile: AxisProfile): void {
    if (height === this.lift) return
    this.plan('lift', this.lift, height, profile)
    this.lift = height
  }

  /**
   * Drive through `points` (the first is the next waypoint after the current
   * position). `lastRunMark` is marked when the final straight run starts.
   */
  driveThrough(points: Waypoint[], profile: AxisProfile, lastRunMark?: M): void {
    // Split into straight runs.
    const runs: Waypoint[][] = []
    let pending: Waypoint[] = []
    let prev = { x: this.x, z: this.z }
    let dir = ''
    for (const p of points) {
      const dx = p.x - prev.x
      const dz = p.z - prev.z
      if (dx === 0 && dz === 0) {
        if (runs.length) runs[runs.length - 1].push(p)
        else pending.push(p)
        prev = p
        continue
      }
      const d = dx !== 0 ? `x${Math.sign(dx)}` : `z${Math.sign(dz)}`
      if (d !== dir || runs.length === 0) {
        runs.push([...pending, p])
        pending = []
      } else runs[runs.length - 1].push(p)
      dir = d
      prev = p
    }
    const speeds = this.cornerSpeeds(runs, profile)
    runs.forEach((run, i) => {
      if (i === runs.length - 1 && lastRunMark) this.mark(lastRunMark)
      const end = run[run.length - 1]
      const axis = end.x !== this.x ? 'x' : 'z'
      const s0 = this.s
      const seg = this.plan(axis, axis === 'x' ? this.x : this.z, axis === 'x' ? end.x : end.z, profile, speeds[i], speeds[i + 1])
      // zone visits along the run, waypoint by waypoint
      let px = this.x
      let pz = this.z
      for (const p of run) {
        const len = Math.abs(p.x - px) + Math.abs(p.z - pz)
        if (p.edgeZone) this.addVisit(p.edgeZone, this.s, this.s + len)
        this.s += len
        if (p.zone) this.addVisit(p.zone, this.s, this.s)
        px = p.x
        pz = p.z
      }
      this.runs.push({ s0, s1: this.s, seg })
      this.x = end.x
      this.z = end.z
    })
    if (runs.length === 0 && lastRunMark) this.mark(lastRunMark)
  }

  /**
   * Speed at the start of each run and after the last one (`runs.length + 1`
   * entries; the first and last are 0, the trip starts and ends at rest).
   * A corner is capped by its turn angle, by the profile's top speed and by
   * what the shorter neighbouring run can accelerate or brake to.
   */
  private cornerSpeeds(runs: Waypoint[][], profile: AxisProfile): number[] {
    const speeds = new Array<number>(runs.length + 1).fill(0)
    if (!this.corner || this.instant) return speeds
    const dirs: { axis: 'x' | 'z'; len: number }[] = []
    let px = this.x
    let pz = this.z
    for (const run of runs) {
      const end = run[run.length - 1]
      const dx = end.x - px
      const dz = end.z - pz
      dirs.push(dx !== 0 ? { axis: 'x', len: Math.abs(dx) } : { axis: 'z', len: Math.abs(dz) })
      px = end.x
      pz = end.z
    }
    const a = Math.min(profile.accel, profile.decel)
    for (let i = 1; i < runs.length; i++) {
      const prev = dirs[i - 1]
      const next = dirs[i]
      const angle = prev.axis === next.axis ? Math.PI : Math.PI / 2
      speeds[i] = Math.min(cornerSpeedCap(angle, this.corner), profile.vMax, Math.sqrt(a * prev.len), Math.sqrt(a * next.len))
    }
    return speeds
  }

  /** First time (relative) the SHC reaches path distance `s`. */
  private timeAt(s: number): number {
    for (const r of this.runs) {
      if (s <= r.s0 + 1e-9) return r.seg.t0
      if (s <= r.s1 + 1e-9) {
        const target = s - r.s0
        let lo = r.seg.t0
        let hi = r.seg.t1
        for (let i = 0; i < 50 && hi - lo > 1e-6; i++) {
          const mid = (lo + hi) / 2
          if (Math.abs(positionAt(r.seg, mid) - r.seg.from) >= target) hi = mid
          else lo = mid
        }
        return hi
      }
    }
    return this.runs.length ? this.runs[this.runs.length - 1].seg.t1 : 0
  }

  /** Reservation windows: each zone visit ± the clearance distance. */
  windows(): WindowSpec[] {
    const clearance = this.graph.layout.zoneClearanceM
    return mergeWindows(
      this.visits.map((v) => ({
        zone: v.zone,
        from: this.timeAt(Math.max(0, v.s0 - clearance)),
        to: Math.min(this.t, this.timeAt(Math.min(this.s, v.s1 + clearance))),
      })),
    )
  }
}

/** Waypoints of a node path, with node and edge zones. */
export function waypoints(graph: PathGraph & { nodes: Record<string, { zone: string | null }> }, path: string[]): Waypoint[] {
  return path.map((id, i) => ({
    nodeId: id,
    x: graph.nodes[id].x,
    z: graph.nodes[id].z,
    zone: graph.nodes[id].zone,
    edgeZone: i === 0 ? null : edgeBetween(graph, path[i - 1], id).zone,
  }))
}

function route(graph: LaneGraph, from: string, to: string): string[] {
  const path = shortestPath(graph, from, to)
  if (!path) throw new Error(`No lane-graph route ${from} → ${to}`)
  return path
}

function shcKpi(state: SimState, shcId: string) {
  const k = state.kpis.horizontal?.perShc[shcId]
  if (!k) throw new Error(`No SHC KPIs for ${shcId}`)
  return k
}

/** Shift a relative trip to start at `start` and install it as the SHC's plan. */
function install(shc: ShcState, trip: TripBuilder, start: number): void {
  const segments = trip.segments.map((s) => ({ ...s, t0: s.t0 + start, t1: s.t1 + start }))
  shc.motion = segments
  let prevAt = -Infinity
  shc.plan = trip.marks.map((m) => {
    const at = m.at + start
    const mine = segments.filter((s) => s.t1 <= at + 1e-9 && s.t1 > prevAt + 1e-9)
    prevAt = at
    return { type: m.type, at, segments: mine }
  })
}

function scheduleNext(ctx: EngineContext, shc: ShcState): void {
  const next = shc.plan[0]
  if (!next) return
  const subjects = { equipment: [shc.id], containers: shc.carrying ? [shc.carrying] : undefined }
  if (next.type === 'ShcParked') {
    ctx.schedule('ShcParked', next.at, { equipment: [shc.id] }, { shcId: shc.id, nodeId: shc.nodeId, segments: next.segments })
    return
  }
  if (next.type === 'ShcQueued') {
    const areaId = laneGraphOf(ctx.config).queueAreaOf[shc.nodeId]
    ctx.schedule('ShcQueued', next.at, { equipment: [shc.id], containers: shc.carrying ? [shc.carrying] : undefined, jobs: shc.jobId ? [shc.jobId] : undefined }, {
      shcId: shc.id,
      nodeId: shc.nodeId,
      areaId,
      jobId: shc.jobId,
      loaded: shc.carrying !== null,
      segments: next.segments,
    })
    return
  }
  const job = shc.jobId ? ctx.state.shcJobs[shc.jobId] : null
  if (!job) throw new Error(`${shc.id}: ${next.type} without a job`)
  const base: ShcPhasePayload = { shcId: shc.id, jobId: job.id, containerId: job.containerId, segments: next.segments }
  const withBox = { ...subjects, containers: [job.containerId], jobs: [job.id] }
  switch (next.type) {
    case 'ShcPicked':
      ctx.schedule(next.type, next.at, withBox, { ...base, groundPositionId: job.groundPositionId })
      break
    case 'ShcDroppedAtWtp':
      ctx.schedule(next.type, next.at, withBox, { ...base, wtpPadId: job.wtpPadId ?? '' })
      break
    case 'ShcPickedAtWtp':
      ctx.schedule(next.type, next.at, withBox, { ...base, wtpPadId: job.wtpPadId ?? '' })
      break
    case 'ShcDroppedAtGround':
      ctx.schedule(next.type, next.at, withBox, { ...base, groundPositionId: job.groundPositionId, x: job.x })
      break
    case 'ShcCleared':
      ctx.schedule(next.type, next.at, withBox, { ...base, nodeId: shc.nodeId })
      break
    default:
      ctx.schedule(next.type, next.at, withBox, base)
  }
}

/** Common phase handling: pop the plan, set the status, schedule the next phase. */
function advance(ctx: EngineContext, e: EventOf<PlannedType>): ShcState {
  const shc = ctx.state.shcs[e.payload.shcId]
  const head = shc.plan.shift()
  if (head?.type !== e.type) throw new Error(`${shc.id}: unexpected ${e.type} (planned ${head?.type ?? 'nothing'})`)
  shc.status = STATUS_AFTER[e.type]
  scheduleNext(ctx, shc)
  return shc
}

/** Plan and start an SHC's drive to its parking spot (or park it if it is there). */
function goPark(ctx: EngineContext, shc: ShcState): void {
  const graph = laneGraphOf(ctx.config)
  const target = graph.parkingNode[shc.id]
  releaseQueue(ctx.state, shc.id)
  if (shc.nodeId === target) {
    shc.status = 'parked'
    return
  }
  const instant = ctx.state.subsystems.shc === 'instant'
  const k = kinematics(ctx)
  const trip = new TripBuilder(graph, shc.id, waypoints(graph, [shc.nodeId])[0], instant, cornerOf(ctx))
  const path = route(graph, shc.nodeId, target)
  trip.driveThrough(waypoints(graph, path).slice(1), scaled(k.driveEmpty, driverFactor(ctx)))
  trip.mark('ShcParked')
  const windows = trip.windows()
  const start = earliestStart(ctx.state, windows, ctx.state.now)
  const reservations = reserve(ctx.state, shc.id, windows, start)
  install(shc, trip, start)
  shc.nodeId = target
  shc.status = 'routing-to-parking'
  const kpi = shcKpi(ctx.state, shc.id)
  kpi.emptyDistanceM += pathLength(graph, path)
  kpi.reservationWaitS += start - ctx.state.now
  kpi.parkingReturns++
  ctx.schedule('ShcRoutingToParking', ctx.state.now, { equipment: [shc.id] }, {
    shcId: shc.id,
    departAt: start,
    reservations,
  })
}

// ── Queue areas and chained dispatch (TT-R12) ─────────────────────────────

/** True when the shcDispatch decision point runs the `chained-nearest` strategy (SHCs take work straight away and park only without work). */
export function isChained(ctx: EngineContext): boolean {
  const strategy = ctx.config.decisions?.points?.shcDispatch?.strategy
  return strategy === 'chained-nearest' || strategy === 'predispatch' || strategy === 'paired-dual-cycle'
}

/** True when the shcDispatch strategy is `paired-dual-cycle` (chained dispatch that pairs a discharge delivery with a nearby load pickup and back, TT-R14). */
export function isPaired(ctx: EngineContext): boolean {
  return ctx.config.decisions?.points?.shcDispatch?.strategy === 'paired-dual-cycle'
}

/** True when the shcDispatch strategy is `predispatch` (chained dispatch plus SHCs sent ahead of predicted ready times, TT-R13). */
export function isPredispatch(ctx: EngineContext): boolean {
  return ctx.config.decisions?.points?.shcDispatch?.strategy === 'predispatch'
}

/** Is there still work an idle SHC could be asked to do soon: an open job, or a vessel at the berth? */
export function workRemains(state: SimState): boolean {
  if (Object.values(state.shcJobs).some((j) => j.shcId === null)) return true
  return Object.values(state.vessels).some((v) => v.status === 'berthed' || v.status === 'mooring')
}

function releaseQueue(state: SimState, shcId: string): void {
  for (const [node, holder] of Object.entries(state.queueClaims)) if (holder === shcId) delete state.queueClaims[node]
}

function freeQueueSlot(state: SimState, nodes: string[]): string | null {
  return nodes.find((n) => state.queueClaims[n] === undefined) ?? null
}

/** Free queue spots in the block areas (where loaded SHCs wait for a pad). */
function freeBlockQueueSlots(ctx: EngineContext): number {
  const { state } = ctx
  let n = 0
  for (const a of laneGraphOf(ctx.config).queueAreas) if (a.kind === 'block') n += a.nodes.filter((id) => state.queueClaims[id] === undefined).length
  return n
}

/** The free queue spot nearest by route to `from` (first free spot of each area; ties by id), or null. */
function nearestQueueSpot(ctx: EngineContext, from: string, kinds: ('sts' | 'block')[]): string | null {
  const graph = laneGraphOf(ctx.config)
  let best: { node: string; d: number } | null = null
  for (const area of graph.queueAreas) {
    if (!kinds.includes(area.kind)) continue
    const node = freeQueueSlot(ctx.state, area.nodes)
    if (!node) continue
    const path = shortestPath(graph, from, node)
    if (!path) continue
    const d = pathLength(graph, path)
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && node < best.node)) best = { node, d }
  }
  return best?.node ?? null
}

/** An idle SHC with no job: chained dispatch waits at the nearest queue spot while there is work, otherwise it parks. */
function goIdle(ctx: EngineContext, shc: ShcState): void {
  const { state } = ctx
  if (isChained(ctx) && workRemains(state)) {
    if (state.queueClaims[shc.nodeId] === shc.id) {
      shc.status = 'queuing-for-work'
      return
    }
    if (isPredispatch(ctx)) {
      // wait where the next box is predicted rather than at the nearest area
      const target = predictionDeficits(ctx).deficits[0]
      const spot = target ? freeQueueSlot(ctx.state, target.area.nodes) : null
      if (target && spot) {
        goQueue(ctx, shc, spot, { areaId: target.area.id, readyAt: target.pred.readyAt, source: target.pred.source })
        return
      }
    }
    const spot = nearestQueueSpot(ctx, shc.nodeId, ['sts', 'block'])
    if (spot) {
      goQueue(ctx, shc, spot)
      return
    }
  }
  goPark(ctx, shc)
}

/** Drive an empty SHC to a queue spot and wait there (it holds the spot from now on). */
function goQueue(ctx: EngineContext, shc: ShcState, spot: string, predicted?: ShcRoutingPredicted): void {
  const graph = laneGraphOf(ctx.config)
  releaseQueue(ctx.state, shc.id)
  if (shc.nodeId === spot) {
    ctx.state.queueClaims[spot] = shc.id
    shc.status = 'queuing-for-work'
    return
  }
  const instant = ctx.state.subsystems.shc === 'instant'
  const k = kinematics(ctx)
  const trip = new TripBuilder(graph, shc.id, waypoints(graph, [shc.nodeId])[0], instant, cornerOf(ctx))
  const path = route(graph, shc.nodeId, spot)
  trip.driveThrough(waypoints(graph, path).slice(1), scaled(k.driveEmpty, driverFactor(ctx)))
  trip.mark('ShcQueued')
  const windows = trip.windows()
  const start = earliestStart(ctx.state, windows, ctx.state.now)
  const reservations = reserve(ctx.state, shc.id, windows, start)
  install(shc, trip, start)
  shc.nodeId = spot
  ctx.state.queueClaims[spot] = shc.id
  shc.status = 'routing-to-parking'
  const kpi = shcKpi(ctx.state, shc.id)
  kpi.emptyDistanceM += pathLength(graph, path)
  kpi.reservationWaitS += start - ctx.state.now
  ctx.schedule('ShcRoutingToParking', ctx.state.now, { equipment: [shc.id] }, {
    shcId: shc.id,
    departAt: start,
    reservations,
    ...(predicted ? { predicted } : {}),
  })
}

type ShcRoutingPredicted = NonNullable<EventOf<'ShcRoutingToParking'>['payload']['predicted']>

// ── Pre-dispatch (TT-R13) ───────────────────────────────────────────────────

interface PredictionDeficit {
  pred: ReturnType<typeof predictedReady>[number]
  area: QueueArea
}

/**
 * Predictions no idle SHC covers yet, soonest first, and the idle SHCs that could be sent: parked ones and those
 * waiting at an area with more idle SHCs than predicted boxes. A prediction is covered by an idle SHC that waits at
 * (or drives to) its queue area. Loaded SHCs and SHCs holding a job are never candidates.
 */
function predictionDeficits(ctx: EngineContext): { deficits: PredictionDeficit[]; spare: ShcState[] } {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  const areaOf = (source: 'sts' | 'asc', ownerId: string) => graph.queueAreas.find((a) => a.kind === (source === 'sts' ? 'sts' : 'block') && a.ownerId === ownerId)
  const idleAt = new Map<string, ShcState[]>()
  for (const [spot, shcId] of Object.entries(state.queueClaims)) {
    const shc = state.shcs[shcId]
    if (shc.carrying !== null || shc.jobId !== null) continue
    const area = graph.queueAreaOf[spot]
    idleAt.set(area, [...(idleAt.get(area) ?? []), shc])
  }
  const deficits: PredictionDeficit[] = []
  const demand = new Map<string, number>()
  for (const pred of predictedReady(ctx)) {
    const area = areaOf(pred.source, pred.ownerId)
    if (!area) continue
    const n = (demand.get(area.id) ?? 0) + 1
    demand.set(area.id, n)
    if ((idleAt.get(area.id)?.length ?? 0) < n) deficits.push({ pred, area })
  }
  const spare: ShcState[] = Object.values(state.shcs).filter((s) => s.status === 'parked' && s.plan.length === 0)
  for (const [area, shcs] of idleAt) {
    const settled = shcs.filter((s) => s.status === 'queuing-for-work' && s.plan.length === 0).sort((a, b) => (a.id < b.id ? -1 : 1))
    spare.push(...settled.slice(demand.get(area) ?? 0))
  }
  return { deficits, spare: spare.sort((a, b) => (a.id < b.id ? -1 : 1)) }
}

/**
 * Pre-dispatch: send an idle SHC to a queue area when a box there is predicted ready within the SHC's travel time
 * plus `queueAreas.predispatchMarginS`. The SHC claims a queue spot, not a job: the box is dispatched only once it
 * exists, so nothing is collected early and STS/ASC set-downs never wait for an SHC (they need only a free buffer).
 */
export function maybePredispatch(ctx: EngineContext): void {
  const { state } = ctx
  if (!isPredispatch(ctx) || state.subsystems.shc === 'off') return
  const graph = laneGraphOf(ctx.config)
  if (graph.queueAreas.length === 0) return
  const margin = ctx.config.queueAreas?.predispatchMarginS ?? DEFAULT_PREDISPATCH_MARGIN_S
  const empty = kinematics(ctx).driveEmpty
  const { deficits, spare } = predictionDeficits(ctx)
  for (const { pred, area } of deficits) {
    const spot = freeQueueSlot(state, area.nodes)
    if (!spot) continue
    let best: { shc: ShcState; travelS: number } | null = null
    for (const shc of spare) {
      const path = shortestPath(graph, shc.nodeId, spot)
      if (!path) continue
      const travelS = travelTime(pathLength(graph, path), empty)
      if (!best || travelS < best.travelS - 1e-9) best = { shc, travelS }
    }
    if (!best || pred.readyAt - state.now > best.travelS + margin) continue
    spare.splice(spare.indexOf(best.shc), 1)
    goQueue(ctx, best.shc, spot, { areaId: area.id, readyAt: pred.readyAt, source: pred.source })
  }
}

/** Queued SHCs carrying a box ask `wtpPadSelection` again while a free pad is not already being asked for. */
function serveQueues(ctx: EngineContext): void {
  const { state } = ctx
  const waiting = Object.values(state.shcs)
    .filter((s) => s.status === 'queuing-for-pad' && s.plan.length === 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  if (waiting.length === 0) return
  const freePads = Object.values(state.wtpPads).filter((p) => p.containerId === null && p.claimedBy === null).length
  let asking = Object.values(state.shcs).filter((s) => s.status === 'waiting-for-pad' && s.carrying).length
  for (const shc of waiting) {
    if (asking >= freePads) break
    requestPadSelection(ctx, shc, state.shcJobs[shc.jobId as string])
    asking++
  }
}

/** Ask the dispatch decision point on behalf of one free SHC. */
function requestDispatch(ctx: EngineContext, shc: ShcState): void {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  const here = graph.nodes[shc.nodeId]
  shc.status = 'waiting-for-dispatch'
  const jobs = Object.values(state.shcJobs)
    .filter((j) => j.shcId === null)
    .sort((a, b) => a.readyAt - b.readyAt || (a.id < b.id ? -1 : 1))
    .map((j) => {
      if (j.kind === 'load') {
        const pad = graph.pads.find((p) => p.id === j.wtpPadId)
        if (!pad) throw new Error(`Load job ${j.id} names unknown pad ${j.wtpPadId}`)
        return {
          jobId: j.id,
          containerId: j.containerId,
          groundPositionId: j.groundPositionId,
          stsId: j.stsId,
          readyAt: j.readyAt,
          x: pad.x,
          z: pad.z,
          kind: 'load' as const,
          padId: pad.id,
          distanceM: Math.round(pathLength(graph, route(graph, shc.nodeId, graph.padNode[pad.id])) * 1000) / 1000,
        }
      }
      const lane = state.groundPositions[j.groundPositionId].lane
      const entry = graph.nodes[laneAccess(graph, lane, j.x).walk[0]]
      return {
        jobId: j.id,
        containerId: j.containerId,
        groundPositionId: j.groundPositionId,
        stsId: j.stsId,
        readyAt: j.readyAt,
        x: j.x,
        z: graph.laneZ[lane],
        distanceM: Math.round((pathLength(graph, route(graph, shc.nodeId, entry.id)) + (j.x - entry.x)) * 1000) / 1000,
      }
    })
  ctx.requestDecision(
    'shcDispatch',
    {
      shcId: shc.id,
      nodeId: shc.nodeId,
      x: here.x,
      z: here.z,
      ...(isPaired(ctx) && shc.lastJobKind ? { lastJobKind: shc.lastJobKind } : {}),
      jobs,
      wtpPads: padOptions(ctx),
    },
    { equipment: [shc.id] },
  )
}

/** Every pad with its occupancy and claim now (the pad list of the dispatch and pad-selection requests). */
function padOptions(ctx: EngineContext): ShcDispatchPad[] {
  const { state } = ctx
  return laneGraphOf(ctx.config).pads.map((p) => ({
    id: p.id,
    blockId: p.blockId,
    x: p.x,
    z: p.z,
    occupiedBy: state.wtpPads[p.id].containerId,
    claimedBy: state.wtpPads[p.id].claimedBy,
  }))
}

/**
 * V11-11: dispatch picked a discharge job. The SHC holds it (no longer open) and asks `wtpPadSelection`
 * for the pad; the trip is planned in that decision's reactor.
 */
function requestPadSelection(ctx: EngineContext, shc: ShcState, job: ShcJob): void {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  job.shcId = shc.id
  shc.jobId = job.id
  shc.status = 'waiting-for-pad'
  ctx.requestDecision(
    'wtpPadSelection',
    {
      shcId: shc.id,
      jobId: job.id,
      containerId: job.containerId,
      stsId: job.stsId,
      groundPositionId: job.groundPositionId,
      x: job.x,
      z: graph.laneZ[state.groundPositions[job.groundPositionId].lane],
      wtpPads: padOptions(ctx),
    },
    { equipment: [shc.id] },
  )
}

/**
 * Pull dispatch: while there are more open jobs (and free pads) than SHCs
 * already asking, a free SHC (available ones first, then parked, by id)
 * asks for its next job.
 */
export function maybeDispatch(ctx: EngineContext): void {
  const { state } = ctx
  if (state.subsystems.shc === 'off') return
  serveQueues(ctx)
  const shcs = Object.values(state.shcs)
  const openJobs = Object.values(state.shcJobs).filter((j) => j.shcId === null)
  const open = openJobs.filter((j) => j.kind !== 'load').length
  const openLoad = openJobs.length - open
  const freePads = Object.values(state.wtpPads).filter((p) => p.containerId === null && p.claimedBy === null).length
  const queueFree = freeBlockQueueSlots(ctx)
  let asking = shcs.filter((s) => s.status === 'waiting-for-dispatch').length
  const rank = (s: ShcState) => (s.status === 'available' ? 0 : s.status === 'queuing-for-work' ? 1 : 2)
  const free = shcs
    .filter((s) => s.status === 'available' || s.status === 'parked' || s.status === 'queuing-for-work')
    .sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))
  for (const shc of free) {
    if (asking >= Math.min(open, freePads + queueFree) + openLoad) break
    requestDispatch(ctx, shc)
    asking++
  }
  maybePredispatch(ctx)
}

/** Plan a whole job trip for `shc` (origin → box → WTP pad → clear position). */
function assignJob(ctx: EngineContext, shc: ShcState, jobId: string, padId: string): void {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  const job = state.shcJobs[jobId]
  if (!job) throw new Error(`shcDispatch handler returned unknown job ${jobId}`)
  if (job.kind === 'load') {
    assignLoadJob(ctx, shc, job)
    return
  }
  const pad = state.wtpPads[padId]
  if (!pad) throw new Error(`wtpPadSelection handler returned unknown WTP pad ${padId}`)
  if (shc.carrying) {
    resumeFromQueue(ctx, shc, job, pad.id)
    return
  }
  releaseQueue(state, shc.id)
  // The engine trusts the TOS reply; invariants catch double claims and double occupancy.
  job.shcId = shc.id
  job.wtpPadId = pad.id
  pad.claimedBy = shc.id
  shc.jobId = job.id

  const k = kinematics(ctx)
  const f = driverFactor(ctx)
  const empty = scaled(k.driveEmpty, f)
  const loaded = scaled(k.driveLoaded, f)
  const instant = state.subsystems.shc === 'instant'
  const pNode = graph.padNode[pad.id]
  const cNode = graph.padClearNode[pad.id]
  // The box lies on its STS lane at job.x: enter at the spine before it, leave at the spine after it.
  const { walk, before } = laneAccess(graph, state.groundPositions[job.groundPositionId].lane, job.x)
  const toEntry = route(graph, shc.nodeId, walk[0])
  const lane = waypoints(graph, walk)
  const pickup: Waypoint = {
    nodeId: walk[before],
    x: job.x,
    z: lane[before].z,
    zone: null,
    edgeZone: edgeBetween(graph, walk[before], walk[before + 1]).zone,
  }
  const toPad = route(graph, walk[walk.length - 1], pNode)
  const trip = new TripBuilder(graph, shc.id, waypoints(graph, [shc.nodeId])[0], instant, cornerOf(ctx))
  trip.mark('ShcRoutingEmpty')
  trip.driveThrough(
    [...waypoints(graph, toEntry).slice(1), ...lane.slice(1, before + 1), pickup],
    empty,
    'ShcPositioningAtPickup',
  )
  trip.mark('ShcLocking')
  trip.dwell(k.lockS)
  trip.mark('ShcPicked')
  trip.liftTo(k.liftHeightM, k.lift)
  trip.mark('ShcRoutingLoaded')
  const emptyM = trip.s
  trip.driveThrough(
    [{ ...lane[before + 1], edgeZone: pickup.edgeZone }, ...lane.slice(before + 2), ...waypoints(graph, toPad).slice(1)],
    loaded,
    'ShcPositioningAtDropoff',
  )
  const loadedM = trip.s - emptyM
  trip.mark('ShcLowering')
  trip.liftTo(0, k.lift)
  trip.mark('ShcUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('ShcDroppedAtWtp')
  trip.driveThrough(waypoints(graph, [pNode, cNode]).slice(1), empty)
  trip.mark('ShcCleared')

  commitTrip(ctx, shc, job, trip, emptyM, loadedM, pad.id, cNode)
}

/** Reserve the trip's zones, install it as the SHC's plan, count its distances and announce it. */
function commitTrip(
  ctx: EngineContext,
  shc: ShcState,
  job: ShcJob,
  trip: TripBuilder,
  emptyM: number,
  loadedM: number,
  padId: string,
  endNode: string,
  resumed = false,
): void {
  const { state } = ctx
  const windows = trip.windows()
  const start = earliestStart(state, windows, state.now)
  const reservations = reserve(state, shc.id, windows, start)
  install(shc, trip, start)
  shc.nodeId = endNode
  const kpi = shcKpi(state, shc.id)
  if (resumed) {
    // The loaded leg from a queue spot (TT-R12): the job and its empty drive were counted when it was assigned.
    shc.status = 'queuing-for-pad'
    kpi.loadedDistanceM += loadedM
    kpi.reservationWaitS += start - state.now
    ctx.schedule('ShcQueueDeparted', state.now, { equipment: [shc.id], containers: [job.containerId], jobs: [job.id] }, {
      shcId: shc.id,
      jobId: job.id,
      wtpPadId: padId,
      nodeId: shc.nodeId,
      departAt: start,
      distanceM: Math.round(trip.s * 1000) / 1000,
      reservations,
    })
    return
  }
  shc.status = 'job-assigned'
  kpi.jobs++
  kpi.emptyDistanceM += emptyM + (trip.s - emptyM - loadedM)
  kpi.loadedDistanceM += loadedM
  kpi.reservationWaitS += start - state.now
  ctx.schedule('ShcJobAssigned', state.now, { equipment: [shc.id], containers: [job.containerId], jobs: [job.id] }, {
    shcId: shc.id,
    jobId: job.id,
    containerId: job.containerId,
    groundPositionId: job.groundPositionId,
    wtpPadId: padId,
    departAt: start,
    distanceM: Math.round(trip.s * 1000) / 1000,
    reservations,
  })
}

/**
 * TT-R12: a discharge job taken while no WTP pad is free. The SHC fetches the box and carries it to a queue spot of
 * a block (the nearest area with room, held from now on) and waits there, loaded, until a pad frees.
 */
function assignQueuedJob(ctx: EngineContext, shc: ShcState, job: ShcJob, spot: string): void {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  releaseQueue(state, shc.id)
  state.queueClaims[spot] = shc.id
  job.shcId = shc.id
  shc.jobId = job.id
  const k = kinematics(ctx)
  const f = driverFactor(ctx)
  const empty = scaled(k.driveEmpty, f)
  const loaded = scaled(k.driveLoaded, f)
  const instant = state.subsystems.shc === 'instant'
  const { walk, before } = laneAccess(graph, state.groundPositions[job.groundPositionId].lane, job.x)
  const toEntry = route(graph, shc.nodeId, walk[0])
  const lane = waypoints(graph, walk)
  const pickup: Waypoint = {
    nodeId: walk[before],
    x: job.x,
    z: lane[before].z,
    zone: null,
    edgeZone: edgeBetween(graph, walk[before], walk[before + 1]).zone,
  }
  const toSpot = route(graph, walk[walk.length - 1], spot)
  const trip = new TripBuilder(graph, shc.id, waypoints(graph, [shc.nodeId])[0], instant, cornerOf(ctx))
  trip.mark('ShcRoutingEmpty')
  trip.driveThrough([...waypoints(graph, toEntry).slice(1), ...lane.slice(1, before + 1), pickup], empty, 'ShcPositioningAtPickup')
  trip.mark('ShcLocking')
  trip.dwell(k.lockS)
  trip.mark('ShcPicked')
  trip.liftTo(k.liftHeightM, k.lift)
  trip.mark('ShcRoutingLoaded')
  const emptyM = trip.s
  trip.driveThrough([{ ...lane[before + 1], edgeZone: pickup.edgeZone }, ...lane.slice(before + 2), ...waypoints(graph, toSpot).slice(1)], loaded)
  const loadedM = trip.s - emptyM
  trip.mark('ShcQueued')
  commitTrip(ctx, shc, job, trip, emptyM, loadedM, '', spot)
}

/** TT-R12: a queued SHC with a box got a free pad: plan the loaded drive from its queue spot, the drop and the reverse out. */
function resumeFromQueue(ctx: EngineContext, shc: ShcState, job: ShcJob, padId: string): void {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  const pad = state.wtpPads[padId]
  job.wtpPadId = pad.id
  pad.claimedBy = shc.id
  releaseQueue(state, shc.id)
  const k = kinematics(ctx)
  const f = driverFactor(ctx)
  const empty = scaled(k.driveEmpty, f)
  const loaded = scaled(k.driveLoaded, f)
  const instant = state.subsystems.shc === 'instant'
  const pNode = graph.padNode[pad.id]
  const cNode = graph.padClearNode[pad.id]
  const trip = new TripBuilder(graph, shc.id, waypoints(graph, [shc.nodeId])[0], instant, cornerOf(ctx))
  trip.lift = k.liftHeightM
  trip.mark('ShcRoutingLoaded')
  trip.driveThrough(waypoints(graph, route(graph, shc.nodeId, pNode)).slice(1), loaded, 'ShcPositioningAtDropoff')
  const loadedM = trip.s
  trip.mark('ShcLowering')
  trip.liftTo(0, k.lift)
  trip.mark('ShcUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('ShcDroppedAtWtp')
  trip.driveThrough(waypoints(graph, [pNode, cNode]).slice(1), empty)
  trip.mark('ShcCleared')
  commitTrip(ctx, shc, job, trip, 0, loadedM, pad.id, cNode, true)
}

/**
 * Plan an export load job: the SHC drives to the WTP pad, lifts the box,
 * carries it along its STS lane to the drop X and puts it down, then leaves the
 * lane at the next up spine (where it rests: lane exits are conflict zones, but
 * a resting vehicle holds no reservation, as everywhere in this model).
 */
function assignLoadJob(ctx: EngineContext, shc: ShcState, job: ShcJob): void {
  const { state } = ctx
  const graph = laneGraphOf(ctx.config)
  job.shcId = shc.id
  shc.jobId = job.id
  releaseQueue(state, shc.id)
  const k = kinematics(ctx)
  const f = driverFactor(ctx)
  const empty = scaled(k.driveEmpty, f)
  const loaded = scaled(k.driveLoaded, f)
  const instant = state.subsystems.shc === 'instant'
  const padId = job.wtpPadId as string
  const pNode = graph.padNode[padId]
  const { walk, before } = laneAccess(graph, state.groundPositions[job.groundPositionId].lane, job.x)
  const lane = waypoints(graph, walk)
  const dropPoint: Waypoint = {
    nodeId: walk[before],
    x: job.x,
    z: lane[before].z,
    zone: null,
    edgeZone: edgeBetween(graph, walk[before], walk[before + 1]).zone,
  }
  const trip = new TripBuilder(graph, shc.id, waypoints(graph, [shc.nodeId])[0], instant, cornerOf(ctx))
  trip.mark('ShcRoutingEmpty')
  trip.driveThrough(waypoints(graph, route(graph, shc.nodeId, pNode)).slice(1), empty, 'ShcPositioningAtPickup')
  trip.mark('ShcLocking')
  trip.dwell(k.lockS)
  trip.mark('ShcPickedAtWtp')
  trip.liftTo(k.liftHeightM, k.lift)
  trip.mark('ShcRoutingLoaded')
  const emptyM = trip.s
  trip.driveThrough(
    [...waypoints(graph, route(graph, pNode, walk[0])).slice(1), ...lane.slice(1, before + 1), dropPoint],
    loaded,
    'ShcPositioningAtDropoff',
  )
  const loadedM = trip.s - emptyM
  trip.mark('ShcLowering')
  trip.liftTo(0, k.lift)
  trip.mark('ShcUnlocking')
  trip.dwell(k.unlockS)
  trip.mark('ShcDroppedAtGround')
  trip.driveThrough([{ ...lane[before + 1], edgeZone: dropPoint.edgeZone }, ...lane.slice(before + 2)], empty)
  trip.mark('ShcCleared')
  commitTrip(ctx, shc, job, trip, emptyM, loadedM, padId, walk[walk.length - 1])
}

type PhaseReactor<K extends PlannedType> = (e: EventOf<K>, ctx: EngineContext) => void

const phase = <K extends PlannedType>(extra?: (e: EventOf<K>, ctx: EngineContext, shc: ShcState) => void): PhaseReactor<K> =>
  (e, ctx) => {
    const shc = advance(ctx, e as EventOf<PlannedType>)
    extra?.(e, ctx, shc)
  }

export const shcReactors: ReactorMap = {
  /** Work release: a grounded box becomes an open job in the pool. */
  StsGrounded: (e, ctx) => {
    const { state } = ctx
    if (state.subsystems.shc === 'off') return
    const id = `J${++state.nextShcJob}`
    state.shcJobs[id] = {
      id,
      containerId: e.payload.containerId,
      groundPositionId: e.payload.groundPositionId,
      stsId: e.payload.stsId,
      x: state.sts[e.payload.stsId].gantryX,
      readyAt: e.t,
      shcId: null,
      wtpPadId: null,
    }
    maybeDispatch(ctx)
  },

  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint === 'shcDispatch') {
      const { request, reply } = e.payload
      const shc = ctx.state.shcs[request.shcId]
      if (reply.jobId === null) {
        shc.status = 'available'
        goIdle(ctx, shc)
        return
      }
      const job = ctx.state.shcJobs[reply.jobId]
      if (!job) throw new Error(`shcDispatch handler returned unknown job ${reply.jobId}`)
      if (job.shcId !== null && e.payload.handler.startsWith('strategy:')) {
        // Two SHCs asked at the same sim time and a built-in strategy named the job the other one took (its request was
        // built before the other's reply): ask again with the jobs that are left. A custom handler is trusted, as ever.
        shc.status = 'available'
        maybeDispatch(ctx)
        if (shc.status === 'available') goIdle(ctx, shc)
        return
      }
      if (job.kind === 'load') {
        assignJob(ctx, shc, reply.jobId, '')
        maybeDispatch(ctx)
      } else if (Object.values(ctx.state.wtpPads).some((p) => p.containerId === null && p.claimedBy === null)) {
        requestPadSelection(ctx, shc, job)
      } else {
        // No pad is free: take the box and wait with it at a block queue spot (TT-R12), or leave the job open.
        const spot = nearestQueueSpot(ctx, laneGraphOf(ctx.config).laneNodes[ctx.state.groundPositions[job.groundPositionId].lane][0], ['block'])
        if (spot) {
          assignQueuedJob(ctx, shc, job, spot)
          maybeDispatch(ctx)
        } else {
          shc.status = 'available'
          goIdle(ctx, shc)
        }
      }
      return
    }
    if (e.payload.decisionPoint === 'stsGroundPosition') {
      maybePredispatch(ctx) // the crane has planned its set-down: a new exact prediction
      return
    }
    if (e.payload.decisionPoint === 'wtpPadSelection') {
      const { request, reply } = e.payload
      const shc = ctx.state.shcs[request.shcId]
      if (reply.wtpPadId === null && shc.carrying) {
        shc.status = 'queuing-for-pad' // asked from a queue spot: keep waiting there
        return
      }
      if (reply.wtpPadId === null) {
        // No pad: the SHC gives the job back (open again) and parks.
        ctx.state.shcJobs[request.jobId].shcId = null
        shc.jobId = null
        shc.status = 'available'
        goIdle(ctx, shc)
        return
      }
      const pad = ctx.state.wtpPads[reply.wtpPadId]
      if (pad && (pad.claimedBy !== null || pad.containerId !== null) && e.payload.handler.startsWith('strategy:')) {
        // Same race as for jobs: another SHC took the pad a built-in strategy chose from a request built before. Ask again.
        requestPadSelection(ctx, shc, ctx.state.shcJobs[request.jobId])
        return
      }
      assignJob(ctx, shc, request.jobId, reply.wtpPadId)
      maybeDispatch(ctx)
    }
  },

  // Predictions change when a crane plans a carry or a hatch move, and when an ASC plans a retrieval.
  StsMoveStarted: (_e, ctx) => maybePredispatch(ctx),
  StsHatchStarted: (_e, ctx) => maybePredispatch(ctx),
  AscJobAssigned: (_e, ctx) => maybePredispatch(ctx),

  ShcJobAssigned: (e, ctx) => scheduleNext(ctx, ctx.state.shcs[e.payload.shcId]),
  ShcRoutingToParking: (e, ctx) => scheduleNext(ctx, ctx.state.shcs[e.payload.shcId]),
  ShcQueueDeparted: (e, ctx) => scheduleNext(ctx, ctx.state.shcs[e.payload.shcId]),
  ShcQueued: phase((e, ctx, shc) => {
    const kpi = shcKpi(ctx.state, shc.id)
    kpi.queueArrivals++
    if (e.payload.loaded) shc.status = 'queuing-for-pad'
    maybeDispatch(ctx) // a pad may be free already; a job may have appeared
  }),
  VesselWorkComplete: (_e, ctx) => {
    // Chained dispatch parks only when there is no work left.
    if (workRemains(ctx.state)) return
    for (const shc of Object.values(ctx.state.shcs)) if (shc.status === 'queuing-for-work' && shc.plan.length === 0) goPark(ctx, shc)
  },

  ShcRoutingEmpty: phase(),
  ShcPositioningAtPickup: phase(),
  ShcLocking: phase((e, ctx) => {
    const job = ctx.state.shcJobs[e.payload.jobId]
    if (job.kind === 'load') {
      const pad = ctx.state.wtpPads[job.wtpPadId as string]
      if (pad.containerId !== job.containerId)
        throw new Error(`${e.payload.shcId}: box ${job.containerId} is not on ${pad.id} (found ${pad.containerId ?? 'nothing'})`)
      return
    }
    const gp = ctx.state.groundPositions[job.groundPositionId]
    if (gp.containerId !== job.containerId)
      throw new Error(`${e.payload.shcId}: box ${job.containerId} is not on ${gp.id} (found ${gp.containerId ?? 'nothing'})`)
  }),
  ShcPicked: phase((e, ctx, shc) => {
    const { state } = ctx
    const gp = state.groundPositions[e.payload.groundPositionId]
    gp.containerId = null
    shc.carrying = e.payload.containerId
    ctx.transferCustody(e.payload.containerId, { kind: 'shc', id: shc.id })
    resumeStsWaitingForGroundPosition(ctx, gp.stsId)
    pumpLoadPrep(ctx)
  }),
  /** Export load: the SHC lifted the box off its WTP pad. */
  ShcPickedAtWtp: phase((e, ctx, shc) => {
    const { state } = ctx
    const pad = state.wtpPads[e.payload.wtpPadId]
    pad.containerId = null
    shc.carrying = e.payload.containerId
    ctx.transferCustody(e.payload.containerId, { kind: 'shc', id: shc.id })
    const order = state.loadOrders[e.payload.containerId]
    if (order) order.stage = 'to-ground'
    maybeDispatch(ctx)
    maybeDispatchAsc(ctx, pad.blockId) // a pad is free: the ASC may bring the next export box
  }),
  /** Export load: the SHC set the box down on its STS ground position. */
  ShcDroppedAtGround: phase((e, ctx, shc) => {
    const { state } = ctx
    const gp = state.groundPositions[e.payload.groundPositionId]
    gp.containerId = e.payload.containerId
    if (gp.claimedBy === e.payload.containerId) gp.claimedBy = null
    shc.carrying = null
    ctx.transferCustody(e.payload.containerId, { kind: 'groundPosition', id: gp.id })
    const order = state.loadOrders[e.payload.containerId]
    if (order) order.stage = 'on-ground'
    resumeStsWaitingForBox(ctx, gp.stsId, e.payload.containerId)
  }),
  ShcRoutingLoaded: phase(),
  ShcPositioningAtDropoff: phase(),
  ShcLowering: phase(),
  ShcUnlocking: phase(),
  ShcDroppedAtWtp: phase((e, ctx, shc) => {
    const { state } = ctx
    const pad = state.wtpPads[e.payload.wtpPadId]
    // Trusts the dispatch reply; the occupancy and custody invariants catch a bad one.
    pad.containerId = e.payload.containerId
    if (pad.claimedBy === shc.id) pad.claimedBy = null
    shc.carrying = null
    ctx.transferCustody(e.payload.containerId, { kind: 'wtpPad', id: pad.id })
    if (state.kpis.horizontal) state.kpis.horizontal.boxesToWtp++
  }),
  ShcCleared: phase((e, ctx, shc) => {
    if (isPaired(ctx)) shc.lastJobKind = ctx.state.shcJobs[e.payload.jobId]?.kind === 'load' ? 'load' : 'discharge'
    delete ctx.state.shcJobs[e.payload.jobId]
    shc.jobId = null
    maybeDispatch(ctx)
    if (shc.status === 'available') goIdle(ctx, shc)
  }),
  ShcParked: phase((_e, ctx) => maybeDispatch(ctx)),
}

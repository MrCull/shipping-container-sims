/**
 * Berth subsystem: vessel calls on the continuous quay.
 *
 *   VesselArrived → berthAllocation decision (one vessel at a time, arrival
 *   order) → BerthAllocated (or VesselAtAnchorage; the vessel is asked about
 *   again whenever a vessel departs; with `quay.berthOvertaking` the vessels
 *   behind it are asked about too) → mooring → VesselBerthed → craneSplit
 *   decision (one vessel at a time) → STS work (quay.ts) → StsWorkComplete per
 *   crane → VesselWorkComplete → unmooring → VesselDeparted.
 *
 * The quay stretch is taken from berth allocation until departure. A vessel
 * that gets no cranes waits berthed; the split is asked again whenever a
 * crane becomes free.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { BerthAllocationRequest, CraneSplitReply, CraneSplitRequest } from '../decisions/types'
import type { VesselState } from '../state'
import { CONTAINER_HEIGHT_M, slotX, slotZ, tierBaseY, vesselClass } from '../../scenario/vesselClasses'
import type { ScenarioConfig, VesselSizeClass } from '../../scenario/types'
import { continueWork, wakeQuayRail } from './quay'
import { askRelease, createPackages, isLoadSlot, loadActive } from './workPackages'
import { inRailReach, railOrder, railReach } from './rail'
import { firstFitBerth } from '../decisions/quayStrategies'
import { closeCrane, finishPlan, registerCrane } from '../cranePlan/plan'
import { positionHatchPanels } from '../hatch'
import { boomReal, releaseBoomHolds, startBoom, whenBoomsUp } from './boom'
import { STS_WATER_RAIL_Z, stsBoom, stsLimits } from '../state'

const ON_QUAY = new Set(['mooring', 'berthed', 'unmooring'])

function vesselConfig(ctx: EngineContext, id: string) {
  const v = ctx.config.vessels.find((x) => x.id === id)
  if (!v) throw new Error(`Unknown vessel ${id}`)
  return v
}

/** Quay stretches taken by vessels mooring, berthed or unmooring. */
function occupied(ctx: EngineContext): BerthAllocationRequest['occupied'] {
  return Object.values(ctx.state.vessels)
    .filter((v) => ON_QUAY.has(v.status) && v.berthX !== null)
    .map((v) => ({ vesselId: v.id, fromX: v.berthX as number, toX: (v.berthX as number) + vesselClass(v.sizeClass).loaM }))
    .sort((a, b) => a.fromX - b.fromX)
}

/**
 * Ask for a berth for the first vessel waiting, unless a berth decision is already pending.
 *
 * First come, first served by default: only the head of the queue is asked about. With
 * `quay.berthOvertaking` the first queued vessel not yet asked about since the quay last changed is
 * asked instead, so a vessel further back can take a stretch the head does not fit in.
 */
function tryAllocateBerth(ctx: EngineContext): void {
  const { berth, vessels } = ctx.state
  if (berth.allocating !== null || berth.queue.length === 0) return
  if (ctx.state.subsystems.berth === 'off') {
    placeFirstFit(ctx)
    return
  }
  let vesselId: string | undefined = berth.queue[0]
  if (ctx.config.quay.berthOvertaking) {
    const { asked } = berth
    vesselId = berth.queue.find((id) => !asked.includes(id))
    if (vesselId === undefined) return // every waiting vessel was refused on this quay state
    asked.push(vesselId)
  }
  const vessel = vessels[vesselId]
  berth.allocating = vessel.id
  ctx.requestDecision('berthAllocation', berthRequest(ctx, vessel), { vessels: [vessel.id] })
}

/** The berth allocation request for a waiting vessel (also what berth mode off places it by). */
function berthRequest(ctx: EngineContext, vessel: VesselState): BerthAllocationRequest {
  return {
    vesselId: vessel.id,
    sizeClass: vessel.sizeClass,
    loaM: vesselClass(vessel.sizeClass).loaM,
    quayLengthM: ctx.config.quay.lengthM,
    berthGapM: ctx.config.quay.berthGapM,
    occupied: occupied(ctx),
    arrivedAtS: vessel.arrivedAt ?? ctx.state.now,
    ...reachWindow(ctx, vessel),
  }
}

/** Mooring and unmooring take no time in the instant and off modes. */
const mooringS = (ctx: EngineContext): number => (ctx.state.subsystems.berth === 'real' ? ctx.config.quay.mooringS : 0)
const unmooringS = (ctx: EngineContext): number => (ctx.state.subsystems.berth === 'real' ? ctx.config.quay.unmooringS : 0)

/** Berth mode off: no TOS decision, vessels take the first free stretch (within the crane reach window) in arrival order. */
function placeFirstFit(ctx: EngineContext): void {
  const { berth, vessels } = ctx.state
  while (berth.queue.length > 0) {
    const vessel = vessels[berth.queue[0]]
    const x = firstFitBerth(berthRequest(ctx, vessel)).berthX
    if (x === null) {
      if (!vessel.anchored) {
        vessel.anchored = true
        ctx.schedule('VesselAtAnchorage', ctx.state.now, { vessels: [vessel.id] }, { vesselId: vessel.id })
      }
      return
    }
    assignBerth(ctx, vessel, x, ctx.state.now)
  }
}

/** Take the berth: the vessel leaves the queue, starts mooring and BerthAllocated is raised. */
function assignBerth(ctx: EngineContext, vessel: VesselState, berthX: number, t: number): void {
  const { state } = ctx
  state.berth.queue = state.berth.queue.filter((id) => id !== vessel.id)
  state.berth.asked = [] // the quay changed: every waiting vessel may be asked about again
  vessel.status = 'mooring'
  vessel.berthX = berthX
  vessel.berthAllocatedAt = t
  positionHatchPanels(state, vessel.id, berthX)
  vessel.anchorageWaitS = t - (vessel.arrivedAt ?? t)
  ctx.schedule('BerthAllocated', t, { vessels: [vessel.id] }, {
    vesselId: vessel.id,
    berthX,
    anchorageWaitS: vessel.anchorageWaitS,
  })
}

/**
 * #365: the stern positions at which the lowest and highest crane that can work the vessel (#303) reach its first and
 * last bay within their `railReach` (three small cranes at the low end kept a ULCV berthed at 0 m from ever having its
 * first bays worked: the peak day went idle at 2 of 5 vessels). Only the bounds tighter than the quay itself are
 * returned. Throws when no stern position on the quay is inside the window: the vessel could never be worked.
 */
function reachWindow(ctx: EngineContext, vessel: VesselState): Pick<BerthAllocationRequest, 'minBerthX' | 'maxBerthX'> {
  const able = ctx.config.sts.flatMap((c, i) => (stsCanWork(ctx.config, c.id, vessel.sizeClass) ? [i] : [])) // config order is rail order
  if (able.length === 0) return {}
  const spec = vesselClass(vessel.sizeClass)
  const { lengthM } = ctx.config.quay
  if (spec.loaM > lengthM) return {} // never fits the quay: it waits at anchorage, as it always has; no window applies
  const lo = railReach(ctx.config, able[0]).lo - slotX(spec, 0, 0, 'aft')
  const hi = railReach(ctx.config, able[able.length - 1]).hi - slotX(spec, 0, spec.bays - 1, 'fore')
  if (Math.max(lo, 0) > Math.min(hi, lengthM - spec.loaM) + 1e-9)
    throw new Error(
      `berth: no stern position on the ${lengthM} m quay lets the cranes able to work ${vessel.id} (${vessel.sizeClass}, LOA ${spec.loaM} m) reach every bay: the window is ${lo.toFixed(2)} to ${hi.toFixed(2)} m`,
    )
  return {
    ...(lo > 1e-9 ? { minBerthX: lo } : {}),
    ...(hi < lengthM - spec.loaM - 1e-9 ? { maxBerthX: hi } : {}),
  }
}

function validateBerth(ctx: EngineContext, vessel: VesselState, berthX: number): void {
  const loa = vesselClass(vessel.sizeClass).loaM
  const { lengthM, berthGapM } = ctx.config.quay
  if (!Number.isFinite(berthX) || berthX < 0 || berthX + loa > lengthM + 1e-9)
    throw new Error(`berthAllocation: ${vessel.id} at ${berthX} m does not fit on the ${lengthM} m quay (LOA ${loa} m)`)
  for (const o of occupied(ctx)) {
    if (berthX < o.toX + berthGapM - 1e-9 && berthX + loa > o.fromX - berthGapM + 1e-9)
      throw new Error(`berthAllocation: ${vessel.id} at ${berthX} m overlaps ${o.vesselId} (${o.fromX}–${o.toX} m, gap ${berthGapM} m)`)
  }
}

/** Bays of a vessel with discharge boxes on board or export boxes to load, with their gantry X and moves. */
function workBays(ctx: EngineContext, vessel: VesselState): CraneSplitRequest['bays'] {
  const spec = vesselClass(vessel.sizeClass)
  const moves = new Map<number, number>()
  for (const s of Object.values(ctx.state.vesselSlots))
    if (
      s.vesselId === vessel.id &&
      ((s.containerId !== null && s.purpose === 'discharge') || (loadActive(ctx.state) && isLoadSlot(s)))
    )
      moves.set(s.bay, (moves.get(s.bay) ?? 0) + 1)
  return [...moves.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bay, n]) => ({ bay, x: slotX(spec, vessel.berthX ?? 0, bay), moves: n }))
}

/**
 * #303: can this crane work a vessel of this class? Its lift height must clear the top of a high-cube box in the top
 * deck tier and its outreach (from the waterside rail) must reach the outer row. Cranes that cannot are left out of
 * the vessel's crane split.
 */
export function stsCanWork(config: ScenarioConfig, stsId: string, sizeClass: VesselSizeClass): boolean {
  const spec = vesselClass(sizeClass)
  const limits = stsLimits(config, stsId)
  const boxTopM = tierBaseY(spec, spec.holdTiers + spec.deckTiers - 1) + CONTAINER_HEIGHT_M['40HC']
  const outerRowM = STS_WATER_RAIL_Z - slotZ(spec, spec.rows - 1)
  return boxTopM <= limits.liftHeightM && outerRowM <= limits.outreachM
}

/**
 * #369: the work bays with a slot (either 20 ft half included) outside the `railReach` of the crane at `railIndex`. The
 * berth reach window (#365) only keeps the lowest and highest able crane in reach of the vessel's ends; a crane further
 * in (STS102 on the peak day, 27 m up) can still be unable to reach a bay at the quay start.
 */
function unreachableBays(ctx: EngineContext, vessel: VesselState, railIndex: number, bays: CraneSplitRequest['bays']): number[] {
  const spec = vesselClass(vessel.sizeClass)
  const reach = railReach(ctx.config, railIndex)
  const berthX = vessel.berthX ?? 0
  return bays
    .filter((b) => !inRailReach(reach, slotX(spec, berthX, b.bay, 'aft')) || !inRailReach(reach, slotX(spec, berthX, b.bay, 'fore')))
    .map((b) => b.bay)
}

/** Ask for a crane split for the first berthed vessel without cranes, unless one is pending. */
function trySplit(ctx: EngineContext): void {
  const { berth, vessels, sts } = ctx.state
  if (berth.splitting !== null || berth.craneQueue.length === 0) return
  if (!Object.values(sts).some((c) => c.vesselId === null)) return
  const vessel = vessels[berth.craneQueue[0]]
  berth.splitting = vessel.id
  const bays = workBays(ctx, vessel)
  ctx.requestDecision(
    'craneSplit',
    {
      vesselId: vessel.id,
      berthX: vessel.berthX as number,
      maxSts: vesselConfig(ctx, vessel.id).maxSts,
      stsMinSpacingM: ctx.config.quay.stsMinSpacingM,
      bays,
      cranes: railOrder(ctx.state).map((c) => {
        const unreachable = unreachableBays(ctx, vessel, c.railIndex, bays)
        return {
        stsId: c.id,
        railIndex: c.railIndex,
        gantryX: c.gantryX,
        vesselId: c.vesselId,
        vesselBerthX: c.vesselId ? vessels[c.vesselId].berthX : null,
        // Only when true, so the event log of a fleet that reaches every vessel is unchanged (#303).
        ...(stsCanWork(ctx.config, c.id, vessel.sizeClass) ? {} : { outOfReach: true as const }),
          // #369: only when the crane's rail reach leaves out a work bay, so the event log of a split every crane can cover is unchanged.
          ...(unreachable.length > 0 ? { unreachableBays: unreachable } : {}),
        }
      }),
    },
    { vessels: [vessel.id] },
  )
}

/** Reject a crane split that would make cranes pass each other or leave work uncovered. */
function validateSplit(ctx: EngineContext, req: CraneSplitRequest, reply: CraneSplitReply): void {
  const fail = (why: string) => {
    throw new Error(`craneSplit for ${req.vesselId}: ${why}`)
  }
  const { sts, vessels } = ctx.state
  const a = reply.assignments
  if (a.length > req.maxSts) fail(`${a.length} cranes exceed max STS ${req.maxSts}`)
  if (a.length === 0) return
  const seen = new Set<string>()
  for (const x of a) {
    const crane = sts[x.stsId]
    if (!crane) fail(`unknown STS ${x.stsId}`)
    if (seen.has(x.stsId)) fail(`${x.stsId} assigned twice`)
    seen.add(x.stsId)
    if (crane.vesselId !== null) fail(`${x.stsId} is busy with ${crane.vesselId}`)
    if (x.bays.length === 0) fail(`${x.stsId} has no bays`)
    if (!stsCanWork(ctx.config, x.stsId, vessels[req.vesselId].sizeClass))
      fail(`${x.stsId} cannot reach the top deck tier or the outer row of ${req.vesselId} (class limits)`)
  }
  const byRail = [...a].sort((p, q) => sts[p.stsId].railIndex - sts[q.stsId].railIndex)
  const covered: number[] = []
  byRail.forEach((x, i) => {
    const bays = [...x.bays]
    if (bays.some((b, k) => k > 0 && b <= bays[k - 1])) fail(`${x.stsId} bays must be ascending`)
    if (i > 0 && bays[0] <= Math.max(...byRail[i - 1].bays)) fail(`bay ranges must follow crane rail order (${byRail[i - 1].stsId} before ${x.stsId})`)
    covered.push(...bays)
  })
  const want = req.bays.map((b) => b.bay)
  if (covered.length !== want.length || covered.some((b, i) => b !== want[i]))
    fail(`bays covered [${covered.join(',')}] must equal the work bays [${want.join(',')}]`)
  const lo = sts[byRail[0].stsId].railIndex
  const hi = sts[byRail[byRail.length - 1].stsId].railIndex
  for (const c of Object.values(sts)) {
    if (c.vesselId === null || c.vesselId === req.vesselId) continue
    if (c.railIndex > lo && c.railIndex < hi) fail(`${c.id} (working ${c.vesselId}) is between the assigned cranes`)
    const otherX = vessels[c.vesselId].berthX as number
    if (c.railIndex < lo && otherX > req.berthX) fail(`${c.id} would have to pass the assigned cranes to reach ${c.vesselId}`)
    if (c.railIndex > hi && otherX < req.berthX) fail(`${c.id} would have to pass the assigned cranes to reach ${c.vesselId}`)
  }
}

export const berthReactors: ReactorMap = {
  ScenarioStarted: (_e, ctx) => {
    for (const v of ctx.config.vessels) ctx.schedule('VesselArrived', v.arrivalS, { vessels: [v.id] }, { vesselId: v.id })
  },

  VesselArrived: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'at-anchorage'
    vessel.arrivedAt = e.t
    ctx.state.berth.queue.push(vessel.id)
    tryAllocateBerth(ctx)
  },

  DecisionResolved: (e, ctx) => {
    const { state } = ctx
    if (e.payload.decisionPoint === 'berthAllocation') {
      const vessel = state.vessels[e.payload.request.vesselId]
      state.berth.allocating = null
      const { berthX } = e.payload.reply
      if (berthX === null) {
        if (!vessel.anchored) {
          vessel.anchored = true
          ctx.schedule('VesselAtAnchorage', e.t, { vessels: [vessel.id] }, { vesselId: vessel.id })
        }
        // first come, first served: the queue waits until a vessel departs. With overtaking the next
        // vessel not yet asked about gets its turn.
        if (ctx.config.quay.berthOvertaking) tryAllocateBerth(ctx)
        return
      }
      validateBerth(ctx, vessel, berthX)
      assignBerth(ctx, vessel, berthX, e.t)
      tryAllocateBerth(ctx)
      return
    }
    if (e.payload.decisionPoint === 'craneSplit') {
      const { request, reply } = e.payload
      const vessel = state.vessels[request.vesselId]
      state.berth.splitting = null
      validateSplit(ctx, request, reply)
      if (reply.assignments.length > 0) {
        state.berth.craneQueue = state.berth.craneQueue.filter((id) => id !== vessel.id)
        const order = [...reply.assignments].sort((p, q) => state.sts[p.stsId].railIndex - state.sts[q.stsId].railIndex)
        for (const x of order) {
          const sts = state.sts[x.stsId]
          sts.vesselId = vessel.id
          sts.bays = [...x.bays]
          sts.workQueue = []
          createPackages(ctx, sts, vessel.id, x.bays)
          registerCrane(ctx, vessel.id, planStrategyName(ctx), sts, x.bays)
          vessel.stsIds.push(sts.id)
          vessel.stsHistory.push(sts.id)
          // boom mode real (#298): a crane assigned at t0 (a pre-filled working vessel) starts boom down
          if (boomReal(ctx) && e.t === 0 && sts.status === 'idle') sts.boomDeg = stsBoom(ctx.config).workingDeg
          if (sts.status === 'waiting-for-rail') {
            // it was stepping aside for another crane: drop that and start work
            sts.status = 'idle'
            sts.railTargetX = null
          }
          askRelease(ctx, sts)
          if (sts.status === 'idle') continueWork(ctx, sts, e.t)
          // a repositioning crane starts its work at StsRepositionCompleted
        }
        finishPlan(ctx, vessel.id)
        vessel.stsIds.sort((p, q) => state.sts[p].railIndex - state.sts[q].railIndex)
        trySplit(ctx) // the next vessel in the queue
      }
      // An empty split keeps the vessel at the head of the queue; it is asked again when a crane is freed (StsWorkComplete)
      // or a vessel is berthed. Asking again here would loop at one instant while a free crane cannot take the vessel.
    }
  },

  BerthAllocated: (e, ctx) => {
    // boom mode real (#298): all fast once mooring is complete and every boom over the vessel is up
    whenBoomsUp(ctx, ctx.state.vessels[e.payload.vesselId], 'VesselBerthed', e.t + mooringS(ctx), 0)
  },

  VesselBerthed: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'berthed'
    vessel.berthedAt = e.t
    releaseBoomHolds(ctx, vessel.id, (sts) => continueWork(ctx, sts, e.t)) // #297 review: held busy cranes lower and carry on
    if (ctx.state.subsystems.quay === 'off' || (vessel.remainingDischarge === 0 && (vessel.remainingLoad === 0 || !loadActive(ctx.state)))) {
      ctx.schedule('VesselWorkComplete', e.t, { vessels: [vessel.id] }, { vesselId: vessel.id })
      return
    }
    ctx.state.berth.craneQueue.push(vessel.id)
    trySplit(ctx)
  },

  StsWorkComplete: (e, ctx) => {
    const { state } = ctx
    const sts = state.sts[e.payload.stsId]
    sts.vesselId = null
    sts.bays = []
    sts.status = 'idle'
    if (boomReal(ctx)) startBoom(ctx, sts, e.t, 'raise') // boom mode real (#298): idle cranes park boom up
    closeCrane(state, e.payload.vesselId, sts.id)
    const vessel = state.vessels[e.payload.vesselId]
    vessel.stsIds = vessel.stsIds.filter((id) => id !== sts.id)
    if (vessel.stsIds.length === 0 && vessel.remainingDischarge === 0 && (vessel.remainingLoad === 0 || !loadActive(state)) && vessel.status === 'berthed') {
      ctx.schedule('VesselWorkComplete', e.t, { vessels: [vessel.id] }, { vesselId: vessel.id })
    }
    trySplit(ctx)
    wakeQuayRail(ctx)
  },

  VesselWorkComplete: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'unmooring'
    vessel.workCompletedAt = e.t
    // boom mode real (#298): unmooring starts once every boom over the vessel is up
    whenBoomsUp(ctx, vessel, 'VesselDeparted', e.t, unmooringS(ctx))
  },

  VesselDeparted: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'departed'
    vessel.departedAt = e.t
    releaseBoomHolds(ctx, vessel.id, (sts) => continueWork(ctx, sts, e.t))
    ctx.state.kpis.vesselsCompleted++
    ctx.state.berth.asked = []
    tryAllocateBerth(ctx)
  },
}

/** The configured plan strategy (`craneSplit`, or its alias `cranePlan`); `as-today` when none. */
function planStrategyName(ctx: EngineContext): string {
  const pts = ctx.config.decisions?.points
  return pts?.craneSplit?.strategy ?? pts?.cranePlan?.strategy ?? 'as-today'
}

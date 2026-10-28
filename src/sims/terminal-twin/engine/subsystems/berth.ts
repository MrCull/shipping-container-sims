/**
 * Berth subsystem: vessel calls on the continuous quay.
 *
 *   VesselArrived → berthAllocation decision (one vessel at a time, arrival
 *   order) → BerthAllocated (or VesselAtAnchorage; the vessel is asked about
 *   again whenever a vessel departs) → mooring → VesselBerthed → craneSplit
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
import { slotX, vesselClass } from '../../scenario/vesselClasses'
import { continueWork, wakeQuayRail } from './quay'
import { askRelease, createPackages, loadActive } from './workPackages'
import { railOrder } from './rail'

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

/** Ask for a berth for the first vessel waiting, unless a berth decision is already pending. */
function tryAllocateBerth(ctx: EngineContext): void {
  const { berth, vessels } = ctx.state
  if (berth.allocating !== null || berth.queue.length === 0) return
  const vessel = vessels[berth.queue[0]]
  berth.allocating = vessel.id
  ctx.requestDecision(
    'berthAllocation',
    {
      vesselId: vessel.id,
      sizeClass: vessel.sizeClass,
      loaM: vesselClass(vessel.sizeClass).loaM,
      quayLengthM: ctx.config.quay.lengthM,
      berthGapM: ctx.config.quay.berthGapM,
      occupied: occupied(ctx),
      arrivedAtS: vessel.arrivedAt ?? ctx.state.now,
    },
    { vessels: [vessel.id] },
  )
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
      ((s.containerId !== null && s.purpose === 'discharge') ||
        (loadActive(ctx.state) && s.purpose === 'load' && s.plannedContainerId && s.containerId === null))
    )
      moves.set(s.bay, (moves.get(s.bay) ?? 0) + 1)
  return [...moves.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bay, n]) => ({ bay, x: slotX(spec, vessel.berthX ?? 0, bay), moves: n }))
}

/** Ask for a crane split for the first berthed vessel without cranes, unless one is pending. */
function trySplit(ctx: EngineContext): void {
  const { berth, vessels, sts } = ctx.state
  if (berth.splitting !== null || berth.craneQueue.length === 0) return
  if (!Object.values(sts).some((c) => c.vesselId === null)) return
  const vessel = vessels[berth.craneQueue[0]]
  berth.splitting = vessel.id
  ctx.requestDecision(
    'craneSplit',
    {
      vesselId: vessel.id,
      berthX: vessel.berthX as number,
      maxSts: vesselConfig(ctx, vessel.id).maxSts,
      stsMinSpacingM: ctx.config.quay.stsMinSpacingM,
      bays: workBays(ctx, vessel),
      cranes: railOrder(ctx.state).map((c) => ({
        stsId: c.id,
        railIndex: c.railIndex,
        gantryX: c.gantryX,
        vesselId: c.vesselId,
        vesselBerthX: c.vesselId ? vessels[c.vesselId].berthX : null,
      })),
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
        return // first come, first served: the queue waits until a vessel departs
      }
      validateBerth(ctx, vessel, berthX)
      state.berth.queue = state.berth.queue.filter((id) => id !== vessel.id)
      vessel.status = 'mooring'
      vessel.berthX = berthX
      vessel.berthAllocatedAt = e.t
      vessel.anchorageWaitS = e.t - (vessel.arrivedAt ?? e.t)
      ctx.schedule('BerthAllocated', e.t, { vessels: [vessel.id] }, {
        vesselId: vessel.id,
        berthX,
        anchorageWaitS: vessel.anchorageWaitS,
      })
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
          vessel.stsIds.push(sts.id)
          vessel.stsHistory.push(sts.id)
          if (sts.status === 'waiting-for-rail') {
            // it was stepping aside for another crane: drop that and start work
            sts.status = 'idle'
            sts.railTargetX = null
          }
          askRelease(ctx, sts)
          if (sts.status === 'idle') continueWork(ctx, sts, e.t)
          // a repositioning crane starts its work at StsRepositionCompleted
        }
        vessel.stsIds.sort((p, q) => state.sts[p].railIndex - state.sts[q].railIndex)
      }
      trySplit(ctx)
    }
  },

  BerthAllocated: (e, ctx) => {
    ctx.schedule('VesselBerthed', e.t + ctx.config.quay.mooringS, { vessels: [e.payload.vesselId] }, {
      vesselId: e.payload.vesselId,
      berthX: e.payload.berthX,
    })
  },

  VesselBerthed: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'berthed'
    vessel.berthedAt = e.t
    if (vessel.remainingDischarge === 0 && (vessel.remainingLoad === 0 || !loadActive(ctx.state))) {
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
    ctx.schedule('VesselDeparted', e.t + ctx.config.quay.unmooringS, { vessels: [vessel.id] }, { vesselId: vessel.id })
  },

  VesselDeparted: (e, ctx) => {
    const vessel = ctx.state.vessels[e.payload.vesselId]
    vessel.status = 'departed'
    vessel.departedAt = e.t
    ctx.state.kpis.vesselsCompleted++
    tryAllocateBerth(ctx)
  },
}

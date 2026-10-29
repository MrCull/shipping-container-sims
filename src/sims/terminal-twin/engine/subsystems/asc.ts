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
 *
 * Split (V11-09): this file keeps the event reactors and the phase chain; stack
 * storage is ascStorage.ts, trips/rail/reservations ascReservations.ts, job
 * dispatch ascDispatch.ts. The exports below are the subsystem's interface.
 */
import type { EngineContext, ReactorMap } from '../context'
import { ascPoseAt, type PlannedType } from './ascReservations'
import { maybeDispatchAsc, resolveDispatch } from './ascDispatch'
import { claimSlot, placeInStack, removeFromStack, jobOfBox, isTruckJob, pumpAllocation, resolveRehandleTarget } from './ascStorage'
export { ascPoseAt, maybeDispatchAsc, pumpAllocation, isTruckJob }
import type { EventOf } from '../events'
import { type AscJob, type AscState, type AscStatus } from '../state'
import { parseVesselSlotId } from '../../scenario/vesselClasses'
import { maybeDispatch } from './shc'
import { pumpLoadPrep, slotGantryX } from './loadPrep'

const STATUS_AFTER: Record<PlannedType, AscStatus> = {
  AscRoutingToStack: 'routing-to-slot',
  AscPositioningAtStack: 'positioning-at-slot',
  AscRetrieved: 'lifting',
  AscRoutingToWtp: 'routing-to-pad',
  AscPositioningAtWtp: 'positioning-at-pad',
  AscDroppedAtWtp: 'releasing',
  AscRoutingToPad: 'routing-to-pad',
  AscPositioningAtPad: 'positioning-at-pad',
  AscLocking: 'locking',
  AscPicked: 'lifting',
  AscRoutingToSlot: 'routing-to-slot',
  AscPositioningAtSlot: 'positioning-at-slot',
  AscUnlocking: 'unlocking',
  AscStacked: 'releasing',
  AscReady: 'idle',
  AscRoutingToTruck: 'routing-to-pad',
  AscPositioningAtTruck: 'positioning-at-pad',
  AscPickedFromTruck: 'lifting',
  AscRoutingToStall: 'routing-to-pad',
  AscPositioningAtStall: 'positioning-at-pad',
  AscDroppedAtStall: 'releasing',
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
      ctx.schedule(next.type, next.at, subjects, {
        ...base,
        yardSlotId: (job.kind === 'rehandle' ? job.targetSlotId : job.yardSlotId) ?? '',
        ...(job.kind === 'rehandle' ? { rehandle: true as const } : {}),
      })
      break
    case 'AscRetrieved':
      ctx.schedule(next.type, next.at, subjects, {
        ...base,
        yardSlotId: job.yardSlotId ?? '',
        ...(job.kind === 'rehandle' ? { rehandle: true as const } : {}),
      })
      break
    case 'AscDroppedAtWtp':
      ctx.schedule(next.type, next.at, subjects, { ...base, wtpPadId: job.wtpPadId })
      break
    case 'AscPickedFromTruck':
    case 'AscDroppedAtStall':
      ctx.schedule(next.type, next.at, subjects, { ...base, stallId: job.stallId as string, truckId: job.truckId as string })
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
    if (e.payload.decisionPoint === 'rehandleTarget') {
      resolveRehandleTarget(ctx, e.payload.request, e.payload.reply.slotId)
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
    if (job.kind === 'retrieve' || job.kind === 'rehandle') {
      if (ctx.state.yardSlots[job.yardSlotId ?? '']?.containerId !== job.containerId)
        throw new Error(`${e.payload.ascId}: box ${job.containerId} is not in ${job.yardSlotId}`)
      return
    }
    if (isTruckJob(job)) {
      const truck = ctx.state.trucks[job.truckId as string]
      if (truck?.carrying !== job.containerId)
        throw new Error(`${e.payload.ascId}: box ${job.containerId} is not on the chassis of ${job.truckId} (found ${truck?.carrying ?? 'nothing'})`)
      return
    }
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
  AscRoutingToStack: phase(),
  AscPositioningAtStack: phase(),
  /** Export retrieval: the box is lifted out of its stack. */
  AscRetrieved: phase((e, ctx, asc) => {
    const { state } = ctx
    removeFromStack(state, e.payload.yardSlotId)
    asc.carrying = e.payload.containerId
    ctx.transferCustody(e.payload.containerId, { kind: 'asc', id: asc.id })
  }),
  AscRoutingToWtp: phase(),
  AscPositioningAtWtp: phase(),
  /** Export retrieval: the box stands on the WTP pad, ready for an SHC. */
  AscDroppedAtWtp: phase((e, ctx, asc) => {
    const { state } = ctx
    const pad = state.wtpPads[e.payload.wtpPadId]
    pad.containerId = e.payload.containerId
    pad.claimedBy = null
    asc.carrying = null
    asc.jobId = null
    delete state.ascJobs[e.payload.jobId]
    if (state.kpis.yard) {
      state.kpis.yard.productiveMoves++
      state.kpis.yard.perBlock[asc.blockId].productiveMoves++
    }
    ctx.transferCustody(e.payload.containerId, { kind: 'wtpPad', id: pad.id })
    const order = state.loadOrders[e.payload.containerId]
    if (!order) return
    order.stage = 'on-pad'
    const gp = state.groundPositions[order.groundPositionId as string]
    const id = `J${++state.nextShcJob}`
    state.shcJobs[id] = {
      id,
      containerId: order.containerId,
      groundPositionId: gp.id,
      stsId: order.stsId,
      x: slotGantryX(state, order.slotId),
      kind: 'load',
      readyAt: e.t,
      shcId: null,
      wtpPadId: pad.id,
    }
    maybeDispatch(ctx)
  }),
  AscRoutingToTruck: phase(),
  AscPositioningAtTruck: phase(),
  /** Truck drop: the box is lifted off the chassis. */
  AscPickedFromTruck: phase((e, ctx, asc) => {
    asc.carrying = e.payload.containerId
    ctx.transferCustody(e.payload.containerId, { kind: 'asc', id: asc.id })
  }),
  AscRoutingToStall: phase(),
  AscPositioningAtStall: phase(),
  /** Truck pick: the box stands on the chassis. */
  AscDroppedAtStall: phase((e, ctx, asc) => {
    const { state } = ctx
    asc.carrying = null
    asc.jobId = null
    delete state.ascJobs[e.payload.jobId]
    if (state.kpis.yard) {
      state.kpis.yard.productiveMoves++
      state.kpis.yard.perBlock[asc.blockId].productiveMoves++
    }
    ctx.transferCustody(e.payload.containerId, { kind: 'truck', id: e.payload.truckId })
  }),
  AscRoutingToSlot: phase(),
  AscPositioningAtSlot: phase(),
  AscUnlocking: phase(),
  AscStacked: phase((e, ctx, asc) => {
    const { state } = ctx
    placeInStack(state, asc.blockId, e.payload.yardSlotId, e.payload.containerId)
    asc.carrying = null
    asc.jobId = null
    const rehandle = state.ascJobs[e.payload.jobId]?.kind === 'rehandle'
    delete state.ascJobs[e.payload.jobId]
    ctx.transferCustody(e.payload.containerId, { kind: 'yardSlot', id: e.payload.yardSlotId })
    const yard = state.kpis.yard
    if (rehandle) {
      // the box has a new address: a retrieval waiting for it follows it
      for (const j of Object.values(state.ascJobs))
        if (j.kind === 'retrieve' && j.containerId === e.payload.containerId) j.yardSlotId = e.payload.yardSlotId
      if (yard) {
        yard.rehandles++
        yard.perBlock[asc.blockId].rehandles++
      }
      return
    }
    asc.stacked++
    if (yard) {
      yard.boxesStacked++
      yard.productiveMoves++
      yard.perBlock[asc.blockId].productiveMoves++
    }
    pumpLoadPrep(ctx) // an export box a truck delivered (empty start) may be the next one to load
  }),
  AscReady: phase((e, ctx) => maybeDispatchAsc(ctx, e.payload.blockId)),
}

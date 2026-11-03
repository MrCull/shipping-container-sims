/**
 * Load preparation (TT-10): getting a released load package's export boxes
 * from the stacks to the STS ground positions, in load sequence.
 *
 *   WorkPackageReleased (load) → one LoadOrder per box (stage `released`)
 *   → `pumpLoadPrep` asks the stsGroundPosition decision (direction 'load', one
 *   box at a time per crane, in load sequence) → ground position claimed
 *   → ASC retrieval job (asc.ts: stack → WTP pad) → SHC load job (shc.ts: pad →
 *   ground position) → StsLoadPicked (quay.ts).
 *
 * Pad staging ahead (#186, `yard.loadReleaseAhead`): while the crane still discharges, up to N of its next load boxes
 * (in load sequence) are retrieved to WTP pads without a ground position (stage `staging`, then `padded`). They take no
 * ground position: the crane's discharge never waits for them. Once the crane's discharge before the box is done, a padded
 * box asks the ground-position decision like any other and an SHC load job is created at once (no ASC retrieval left).
 *
 * Two rules keep the flow free of deadlocks:
 * - a crane's load boxes are fetched only after its discharge packages are done
 *   (otherwise boxes waiting for the crane would fill the ground positions and
 *   WTP pads its discharge needs);
 * - at most as many boxes are staged per crane as it has ground positions, in
 *   load sequence, so the box the crane needs next always finds a position.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { AscJob, LoadOrder, SimState, StsState } from '../state'
import { slotX, vesselClass } from '../../scenario/vesselClasses'
import { laneGraphOf } from '../laneGraph'
import { maybeDispatchAsc } from './ascDispatch'
import { requestGroundPosition } from './quay'
import { maybeDispatch } from './shc'
import { cellIsEmpty, packagesOf } from './workPackages'

/** Stages that hold (or are about to hold) one of the crane's ground positions. */
const STAGED = new Set<LoadOrder['stage']>(['gp-asked', 'gp-claimed', 'retrieving', 'on-pad', 'to-ground', 'on-ground'])

/** Gantry X at which the crane loads a slot (and where its box is set down on the lane). */
export function slotGantryX(state: SimState, slotId: string): number {
  const slot = state.vesselSlots[slotId]
  const vessel = state.vessels[slot.vesselId]
  return slotX(vesselClass(vessel.sizeClass), vessel.berthX ?? 0, slot.bay, slot.half)
}

/** Every discharge package the crane works before package `seq` is complete (with hatch covers a bay's load follows its own discharge). */
const dischargeDone = (state: SimState, sts: StsState, seq = Infinity): boolean =>
  packagesOf(state, sts).every((p) => p.kind !== 'discharge' || p.seq > seq || p.status === 'complete')

/** Load boxes the crane may hold on pads (or on their way there) ahead of a ground position (0 = off). */
const releaseAhead = (ctx: EngineContext): number => ctx.config.yard?.loadReleaseAhead ?? 0

/** The SHC load job (pad to ground position) of a box standing on a WTP pad. */
export function createLoadShcJob(ctx: EngineContext, order: LoadOrder, padId: string, readyAt: number): void {
  const { state } = ctx
  const id = `J${++state.nextShcJob}`
  state.shcJobs[id] = {
    id,
    containerId: order.containerId,
    groundPositionId: order.groundPositionId as string,
    stsId: order.stsId,
    x: slotGantryX(state, order.slotId),
    kind: 'load',
    readyAt,
    shcId: null,
    wtpPadId: padId,
  }
}

function retrieveJobFor(state: SimState, order: LoadOrder): AscJob {
  const box = state.containers[order.containerId]
  const job: AscJob = {
    id: `A${++state.nextAscJob}`,
    blockId: box.custody.id.split(':')[0],
    containerId: box.id,
    wtpPadId: '',
    vesselId: order.vesselId,
    allocation: 'claimed',
    yardSlotId: box.custody.id,
    claimSeq: null,
    cleared: true,
    ascId: null,
    kind: 'retrieve',
  }
  state.ascJobs[job.id] = job
  return job
}

/**
 * Cranes other than `exceptStsId` that will need a pad of `blockId` for their head load box (first in load sequence): the
 * head is still `released` and stacked there, or the crane has load packages not complete yet but no order (its package is not
 * released yet, so its block is not known; it counts for every block). Each such crane keeps one pad free (#213).
 */
function headsWithoutPad(ctx: EngineContext, blockId: string, exceptStsId: string): number {
  const { state } = ctx
  let n = 0
  for (const sts of Object.values(state.sts)) {
    if (sts.id === exceptStsId || !sts.vesselId) continue
    let head: LoadOrder | null = null
    for (const o of Object.values(state.loadOrders)) if (o.stsId === sts.id && (!head || o.seq < head.seq)) head = o
    if (head) {
      const c = state.containers[head.containerId].custody
      if (head.stage === 'released' && c.kind === 'yardSlot' && c.id.split(':')[0] === blockId) n++
    } else if (packagesOf(state, sts).some((p) => p.kind === 'load' && p.status !== 'complete')) n++
  }
  return n
}

/** Retrieve the crane's next load boxes to pads ahead of their ground positions, at most `loadReleaseAhead` at a time. */
function stageAhead(ctx: EngineContext, orders: LoadOrder[]): void {
  const { state } = ctx
  const limit = releaseAhead(ctx)
  if (limit <= 0) return
  let ahead = orders.filter((o) => o.stage === 'staging' || o.stage === 'padded').length
  const pads = laneGraphOf(ctx.config).pads
  for (const order of orders) {
    if (ahead >= limit) return
    if (order.stage !== 'released') continue
    const box = state.containers[order.containerId]
    if (box.custody.kind !== 'yardSlot') return // the sequence waits for this box (an empty start not delivered yet)
    if (box.onwardVesselId && box.readyAt == null) return
    const blockId = box.custody.id.split(':')[0]
    // keep one pad of the block free for discharge boxes: staged loads only leave their pads after the discharge is done
    const free = pads.filter((p) => p.blockId === blockId && state.wtpPads[p.id].containerId === null && state.wtpPads[p.id].claimedBy === null).length
    const held = Object.values(state.ascJobs).filter((j) => j.kind === 'retrieve' && j.blockId === blockId && j.wtpPadId === '' && j.ascId === null).length
    // a box that is not its crane's head also leaves a pad for the head box of every crane (in this block) that has none yet (#213)
    const reserve = order === orders[0] ? 0 : headsWithoutPad(ctx, blockId, order.stsId)
    if (free - held - reserve < 2) return
    order.stage = 'staging'
    ahead++
    maybeDispatchAsc(ctx, retrieveJobFor(state, order).blockId)
  }
}

/** Start the next ground-position request of every crane that may stage another export box. */
export function pumpLoadPrep(ctx: EngineContext): void {
  const { state } = ctx
  for (const sts of Object.values(state.sts)) {
    if (!sts.vesselId) continue
    const orders = Object.values(state.loadOrders)
      .filter((o) => o.stsId === sts.id)
      .sort((a, b) => a.seq - b.seq)
    if (orders.length === 0) continue
    stageAhead(ctx, orders)
    if (orders.some((o) => o.stage === 'gp-asked')) continue
    // an earlier empties package whose empties are not allocated yet keeps the later boxes back (load sequence)
    const waiting = packagesOf(state, sts).find((p) => p.emptyReq && p.emptyReq.stage !== 'allocated' && p.status === 'released')
    if (orders.filter((o) => STAGED.has(o.stage)).length >= sts.groundPositionIds.length) continue
    const next = orders.find((o) => o.stage === 'released' || o.stage === 'padded' || o.stage === 'staging')
    if (!next || next.stage === 'staging' || !dischargeDone(state, sts, state.workPackages[next.packageId].seq)) continue
    if (waiting && state.workPackages[next.packageId].seq > waiting.seq) continue
    if (!cellIsEmpty(state, next.slotId)) continue // a shared cell (#203): the discharge box has not left yet
    const box = state.containers[next.containerId]
    if (next.stage !== 'padded' && box.custody.kind !== 'yardSlot') continue // an empty start: the booked box has not been delivered and stacked yet (asked again when it is)
    if (next.stage !== 'padded' && box.onwardVesselId && box.readyAt == null) continue // transshipment box still dwelling (or still on its first vessel)
    next.stage = 'gp-asked'
    requestGroundPosition(ctx, sts, next.containerId, 'load')
  }
}

export const loadPrepReactors: ReactorMap = {
  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint !== 'stsGroundPosition' || e.payload.request.direction !== 'load') return
    const { state } = ctx
    const { request, reply } = e.payload
    const order = state.loadOrders[request.containerId]
    if (!order) return
    const padded = state.containers[order.containerId].custody.kind === 'wtpPad'
    if (reply.groundPositionId === null) {
      order.stage = padded ? 'padded' : 'released' // asked again when a ground position frees up
      return
    }
    const gp = state.groundPositions[reply.groundPositionId]
    if (!gp || gp.stsId !== order.stsId) throw new Error(`stsGroundPosition handler returned ${reply.groundPositionId}, which is not a ground position of ${order.stsId}`)
    if (gp.containerId !== null || gp.claimedBy !== null)
      throw new Error(`stsGroundPosition handler returned ${gp.id} for export box ${order.containerId}, but it is taken`)
    gp.claimedBy = order.containerId
    order.stage = 'gp-claimed'
    order.groundPositionId = gp.id
    if (padded) {
      order.stage = 'on-pad'
      createLoadShcJob(ctx, order, state.containers[order.containerId].custody.id, e.t)
      maybeDispatch(ctx)
      pumpLoadPrep(ctx)
      return
    }
    const job = retrieveJobFor(state, order)
    maybeDispatchAsc(ctx, job.blockId)
    pumpLoadPrep(ctx)
  },
}

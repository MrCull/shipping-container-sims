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
import { maybeDispatchAsc } from './asc'
import { requestGroundPosition } from './quay'
import { packagesOf } from './workPackages'

const STAGED = new Set<LoadOrder['stage']>(['gp-asked', 'gp-claimed', 'retrieving', 'on-pad', 'to-ground', 'on-ground'])

/** Gantry X at which the crane loads a slot (and where its box is set down on the lane). */
export function slotGantryX(state: SimState, slotId: string): number {
  const slot = state.vesselSlots[slotId]
  const vessel = state.vessels[slot.vesselId]
  return slotX(vesselClass(vessel.sizeClass), vessel.berthX ?? 0, slot.bay, slot.half)
}

const dischargeDone = (state: SimState, sts: StsState): boolean =>
  packagesOf(state, sts).every((p) => p.kind !== 'discharge' || p.status === 'complete')

/** Start the next ground-position request of every crane that may stage another export box. */
export function pumpLoadPrep(ctx: EngineContext): void {
  const { state } = ctx
  for (const sts of Object.values(state.sts)) {
    if (!sts.vesselId) continue
    const orders = Object.values(state.loadOrders)
      .filter((o) => o.stsId === sts.id)
      .sort((a, b) => a.seq - b.seq)
    if (orders.length === 0 || !dischargeDone(state, sts)) continue
    if (orders.some((o) => o.stage === 'gp-asked')) continue
    // an earlier empties package whose empties are not allocated yet keeps the later boxes back (load sequence)
    const waiting = packagesOf(state, sts).find((p) => p.emptyReq && p.emptyReq.stage !== 'allocated' && p.status === 'released')
    if (orders.filter((o) => STAGED.has(o.stage)).length >= sts.groundPositionIds.length) continue
    const next = orders.find((o) => o.stage === 'released')
    if (!next) continue
    if (waiting && state.workPackages[next.packageId].seq > waiting.seq) continue
    const box = state.containers[next.containerId]
    if (box.onwardVesselId && box.readyAt == null) continue // transshipment box still dwelling (or still on its first vessel)
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
    if (reply.groundPositionId === null) {
      order.stage = 'released' // asked again when a ground position frees up
      return
    }
    const gp = state.groundPositions[reply.groundPositionId]
    if (!gp || gp.stsId !== order.stsId) throw new Error(`stsGroundPosition handler returned ${reply.groundPositionId}, which is not a ground position of ${order.stsId}`)
    if (gp.containerId !== null || gp.claimedBy !== null)
      throw new Error(`stsGroundPosition handler returned ${gp.id} for export box ${order.containerId}, but it is taken`)
    gp.claimedBy = order.containerId
    order.stage = 'gp-claimed'
    order.groundPositionId = gp.id
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
    maybeDispatchAsc(ctx, job.blockId)
    pumpLoadPrep(ctx)
  },
}

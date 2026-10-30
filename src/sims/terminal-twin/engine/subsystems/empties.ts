/**
 * Empty containers (TT-11): a load work package can require N empties of a
 * size and shipping line.
 *
 *   WorkPackageReleased → EmptiesRequired {count, available}
 *   → (once >= count matching empties are reachable in the yard) emptyAllocation
 *   decision → EmptiesAllocated: the empties are booked to the package's vessel
 *   slots and load orders are created, so the box then flows like any export box
 *   (stack → ASC → WTP pad → SHC → ground position → STS → slot).
 *
 * One request is pending at a time (`state.emptiesAsking`), so two packages never
 * claim the same empty. A package with too few empties waits; it is asked again
 * when an empty is stacked or an ASC retrieves a box (an empty may become reachable).
 * Reachable = on top of its stack and not allocated to another package.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { EmptyCandidate } from '../decisions/types'
import type { SimState, WorkPackage, YardSlotState } from '../state'
import { blockSpecs, rowX, slotZ, stackIndex } from '../yardLayout'
import { allocateEmptyProps } from '../../scenario/containerProps'
import type { ContainerSize } from '../../scenario/types'
import { continueWork } from './quay'
import { pumpLoadPrep } from './loadPrep'
import { createLoadOrders } from './workPackages'

function onTop(state: SimState, slot: YardSlotState): boolean {
  const yard = state.yardBlocks[slot.blockId]
  for (let k = 0; k < slot.span; k++) if (yard.heights[stackIndex(yard, slot.bay + k, slot.row)] !== slot.tier) return false
  return true
}

/** Matching empties an ASC could take now, in container id order. */
export function emptyCandidates(ctx: EngineContext, size: ContainerSize, line: string): EmptyCandidate[] {
  const { state } = ctx
  const specs = new Map(blockSpecs(ctx.config).map((b) => [b.id, b]))
  const out: EmptyCandidate[] = []
  for (const slot of Object.values(state.yardSlots)) {
    if (!slot.containerId) continue
    const box = state.containers[slot.containerId]
    if (box.full || box.size !== size || box.line !== line || box.allocatedTo !== undefined || box.truckClaim !== undefined) continue
    if (box.custody.kind !== 'yardSlot' || box.custody.id !== slot.id || !onTop(state, slot)) continue
    const spec = specs.get(slot.blockId)
    if (!spec) continue
    out.push({
      containerId: box.id,
      blockId: slot.blockId,
      slotId: slot.id,
      bay: slot.bay,
      row: slot.row,
      tier: slot.tier,
      distanceM: Math.round((Math.abs(rowX(spec, slot.row) - spec.x) + Math.abs(slotZ(spec, slot.bay, slot.span) - spec.wtpZ)) * 1000) / 1000,
      yardSince: box.yardSince ?? 0,
    })
  }
  return out.sort((a, b) => (a.containerId < b.containerId ? -1 : 1))
}

/** The package was released: announce the requirement (the allocation decision is asked from that event). */
export function raiseEmptiesRequired(ctx: EngineContext, pkg: WorkPackage): void {
  const req = pkg.emptyReq
  if (!req) return
  ctx.schedule('EmptiesRequired', ctx.state.now, { equipment: [pkg.stsId], vessels: [pkg.vesselId] }, {
    packageId: pkg.id,
    stsId: pkg.stsId,
    vesselId: pkg.vesselId,
    size: req.size,
    line: req.line,
    count: req.count,
    available: emptyCandidates(ctx, req.size, req.line).length,
  })
}

/** Ask the allocation decision for the first released package that has enough empties, if none is pending. */
function tryAllocate(ctx: EngineContext): void {
  const { state } = ctx
  if (state.emptiesAsking !== null) return
  for (const pkg of Object.values(state.workPackages)) {
    const req = pkg.emptyReq
    if (!req || req.stage !== 'pending' || pkg.status !== 'released') continue
    const candidates = emptyCandidates(ctx, req.size, req.line)
    if (candidates.length < req.count) continue
    req.stage = 'asked'
    state.emptiesAsking = pkg.id
    ctx.requestDecision(
      'emptyAllocation',
      { packageId: pkg.id, stsId: pkg.stsId, vesselId: pkg.vesselId, size: req.size, line: req.line, count: req.count, candidates },
      { vessels: [pkg.vesselId] },
    )
    return
  }
}

export const emptiesReactors: ReactorMap = {
  EmptiesRequired: (_e, ctx) => tryAllocate(ctx),
  AscStacked: (_e, ctx) => tryAllocate(ctx),
  AscRetrieved: (_e, ctx) => tryAllocate(ctx),

  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint !== 'emptyAllocation') return
    const { state } = ctx
    const { request, reply } = e.payload
    const pkg = state.workPackages[request.packageId]
    const req = pkg.emptyReq
    if (!req) throw new Error(`emptyAllocation: ${pkg.id} requires no empties`)
    state.emptiesAsking = null
    const ids = reply.containerIds
    const valid = new Set(emptyCandidates(ctx, req.size, req.line).map((c) => c.containerId))
    if (ids.length !== req.count || new Set(ids).size !== ids.length)
      throw new Error(`emptyAllocation for ${pkg.id}: expected exactly ${req.count} distinct empties, got ${ids.length}`)
    for (const id of ids)
      if (!valid.has(id)) throw new Error(`emptyAllocation for ${pkg.id}: ${id} is not a reachable empty ${req.size} of line ${req.line}`)
    ids.forEach((id, i) => {
      state.vesselSlots[req.slotIds[i]].plannedContainerId = id
      state.containers[id].allocatedTo = pkg.id
      state.containers[id].props = allocateEmptyProps(ctx.config, state.propsSeed, id, state.containers[id].props, pkg.vesselId)
    })
    pkg.containerIds = [...ids]
    req.stage = 'allocated'
    ctx.schedule('EmptiesAllocated', e.t, { equipment: [pkg.stsId], vessels: [pkg.vesselId], containers: [...ids] }, {
      packageId: pkg.id,
      stsId: pkg.stsId,
      vesselId: pkg.vesselId,
      containerIds: [...ids],
    })
    createLoadOrders(state, pkg)
    const sts = state.sts[pkg.stsId]
    if (sts.vesselId && sts.status === 'idle' && !sts.activePackageId) continueWork(ctx, sts, e.t)
    pumpLoadPrep(ctx)
    tryAllocate(ctx)
  },
}

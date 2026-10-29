/**
 * ASC stack storage (V11-09): what the ASC subsystem knows about the yard stacks.
 *
 * Slot allocation (yardAllocation request, claim), stack locking, the
 * retrievable-on-top test, rehandle generation (rehandleTarget request and
 * reply), the block/stall/kinematics lookups, and the stack mutations an ASC
 * lift and set-down make. No motion planning and no rail: those live in
 * ascReservations.ts; job selection and dispatch in ascDispatch.ts.
 */
import type { EngineContext } from '../context'
import { maybeDispatchAsc } from './ascDispatch'
import type { DecisionRequests } from '../decisions/types'
import { laneGraphOf } from '../laneGraph'
import { ascIndexOf, type AscJob, type AscState, type SimState, type YardSlotState } from '../state'
import {
  blockSpec,
  boxSpan,
  parseYardSlotId,
  rowX,
  slotZ,
  stackIndex,
  type BlockSpec,
} from '../yardLayout'
import { DEFAULT_ASC_KINEMATICS } from '../../scenario/builder'
import { columnKey, indexYardSlotAdded, indexYardSlotRemoved, yardIndexOf } from '../yardIndex'
import { blockersOf, nextBlocker, rehandleCandidates, retrievalRanks, retrievalSlot } from './rehandle'
import type { AscKinematics } from '../../scenario/types'
import { landsideGraphOf } from '../landsideGraph'

export const kinematics = (ctx: EngineContext): AscKinematics => ctx.config.kinematics.asc ?? DEFAULT_ASC_KINEMATICS

export function blockOf(ctx: EngineContext, blockId: string): BlockSpec {
  const block = ctx.config.yard?.blocks.find((b) => b.id === blockId)
  if (!block) throw new Error(`Unknown yard block ${blockId}`)
  return blockSpec(ctx.config, block)
}

export function ascKpi(state: SimState, ascId: string) {
  const k = state.kpis.yard?.perAsc[ascId]
  if (!k) throw new Error(`No ASC KPIs for ${ascId}`)
  return k
}

/** Columns (bay, row) a job's slot covers. */
export function columnsOf(state: SimState, job: AscJob): string[] {
  const slotId = job.kind === 'rehandle' ? job.targetSlotId : job.yardSlotId
  if (!slotId) return []
  const cell = parseYardSlotId(slotId)
  const span = boxSpan(state.containers[job.containerId].size)
  return span === 1 ? [`${cell.bay}-${cell.row}`] : [`${cell.bay}-${cell.row}`, `${cell.bay + 1}-${cell.row}`]
}

/** An older claim that shares a stack must be stacked first (stacks fill from the bottom). */
export function blockedByOlderClaim(state: SimState, job: AscJob): boolean {
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
export const partnerOf = (state: SimState, asc: AscState): AscState | null =>
  Object.values(state.ascs).find((a) => a.blockId === asc.blockId && a.id !== asc.id) ?? null

/** A truck's transfer stall (landside), from the landside graph. */
export function stallOf(ctx: EngineContext, stallId: string): { id: string; x: number; z: number } {
  const stall = landsideGraphOf(ctx.config).stalls.find((s) => s.id === stallId)
  if (!stall) throw new Error(`Unknown transfer stall ${stallId}`)
  return stall
}

/** A truck job: its box is on a truck chassis at the stall (drop) or goes to it (pick). */
export const isTruckJob = (job: AscJob): boolean => job.truckId !== undefined

/**
 * Close the stack an ASC is about to lift from: its height reads "full" until the lift, so a
 * slot allocated meanwhile (stacking or rehandle) cannot land above a box that is about to leave
 * (it would float). `AscRetrieved` sets the true height.
 */
export function lockStack(state: SimState, job: AscJob): void {
  const slot = state.yardSlots[job.yardSlotId ?? '']
  if (!slot) return
  const yard = state.yardBlocks[slot.blockId]
  for (let k = 0; k < slot.span; k++) yard.heights[stackIndex(yard, slot.bay + k, slot.row)] = yard.tiers
}

/** A free pad of the block for an export box, nearest to its stack's row; null if every pad is busy. */
export function freePadFor(ctx: EngineContext, job: AscJob): string | null {
  const { state } = ctx
  const block = blockOf(ctx, job.blockId)
  const row = parseYardSlotId(job.yardSlotId ?? '').row
  const x = rowX(block, row)
  const free = laneGraphOf(ctx.config).pads.filter(
    (p) => p.blockId === job.blockId && state.wtpPads[p.id].containerId === null && state.wtpPads[p.id].claimedBy === null,
  )
  free.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) || (a.id < b.id ? -1 : 1))
  return free[0]?.id ?? null
}

/** The box is on top of its stack (nothing stacked or claimed above it). */
export function isRetrievable(state: SimState, job: AscJob): boolean {
  const slot = state.yardSlots[job.yardSlotId ?? '']
  if (!slot || slot.containerId !== job.containerId) return false
  const yard = state.yardBlocks[slot.blockId]
  for (let k = 0; k < slot.span; k++) if (yard.heights[stackIndex(yard, slot.bay + k, slot.row)] !== slot.tier) return false
  return true
}

export const ascsOfBlock = (state: SimState, blockId: string): AscState[] =>
  Object.values(state.ascs)
    .filter((a) => a.blockId === blockId)
    .sort((a, b) => ascIndexOf(a.id) - ascIndexOf(b.id))

/**
 * Rehandles (TT-12). An export retrieval whose box has boxes on top cannot start: the
 * blockers move first, top box first, one rehandle at a time per block:
 *   RehandleRequired (once per retrieval) → rehandleTarget decision → target claimed
 *   → ASC job (stack → new slot, events AscRetrieved/AscStacked carry `rehandle: true`)
 *   → next blocker … → the retrieval is retrievable and starts as usual.
 */
export function pumpRehandle(ctx: EngineContext, blockId: string): void {
  const { state } = ctx
  const jobs = Object.values(state.ascJobs).filter((j) => j.blockId === blockId)
  if (jobs.some((j) => j.kind === 'rehandle')) return
  for (const retr of jobs) {
    if (retr.kind !== 'retrieve' || retr.ascId !== null || retr.dispatch === 'asked' || retr.rehandle === 'full') continue
    const blocker = nextBlocker(state, retr)
    // an earlier export retrieval that is free to go runs before any later dig: otherwise a blocker is shuttled between
    // the stacks of two pending retrievals (each dig buries the other box) and neither is ever retrieved
    if (!blocker) {
      if (!isTruckJob(retr) && isRetrievable(state, retr)) return
      continue
    }
    const box = state.containers[blocker.containerId as string]
    const job: AscJob = {
      id: `A${++state.nextAscJob}`,
      blockId,
      containerId: box.id,
      wtpPadId: '',
      vesselId: box.vesselId,
      allocation: 'claimed',
      yardSlotId: blocker.id,
      claimSeq: null,
      cleared: true,
      ascId: null,
      kind: 'rehandle',
      targetSlotId: null,
      forJobId: retr.id,
    }
    state.ascJobs[job.id] = job
    if (!retr.rehandle) {
      retr.rehandle = 'required'
      const slot = retrievalSlot(state, retr)
      ctx.schedule('RehandleRequired', state.now, { containers: [retr.containerId], jobs: [retr.id] }, {
        blockId,
        jobId: retr.id,
        containerId: retr.containerId,
        yardSlotId: retr.yardSlotId ?? '',
        blockerIds: slot ? boxesAboveIds(state, slot) : [],
      })
    }
    requestRehandleTarget(ctx, job, retr)
    return
  }
}

function boxesAboveIds(state: SimState, slot: NonNullable<ReturnType<typeof retrievalSlot>>): string[] {
  return blockersOf(state, slot).flatMap((s) => (s.containerId ? [s.containerId] : []))
}

/** Ask rehandleTarget where the blocker of `retr` goes (nothing is claimed until the reply). */
function requestRehandleTarget(ctx: EngineContext, job: AscJob, retr: AscJob): void {
  const { state } = ctx
  const blocker = state.yardSlots[job.yardSlotId ?? '']
  const digging = retrievalSlot(state, retr)
  if (!blocker || !digging) {
    delete state.ascJobs[job.id] // the situation changed; the pump starts over
    return
  }
  const block = blockOf(ctx, job.blockId)
  const candidates = rehandleCandidates(state, ctx.config, block, blocker, digging)
  if (candidates.length === 0) {
    delete state.ascJobs[job.id]
    retr.rehandle = 'full' // the block has no room for the blocker: the retrieval stays blocked
    if (state.kpis.yard) state.kpis.yard.rehandleFailures++
    return
  }
  const box = state.containers[job.containerId]
  const ranks = retrievalRanks(state, ctx.config, job.blockId)
  const ascs = ascsOfBlock(state, job.blockId)
  ctx.requestDecision(
    'rehandleTarget',
    {
      blockId: job.blockId,
      jobId: job.id,
      containerId: box.id,
      size: box.size,
      vesselId: box.vesselId,
      from: {
        slotId: blocker.id,
        bay: blocker.bay,
        row: blocker.row,
        tier: blocker.tier,
        x: rowX(block, blocker.row),
        z: slotZ(block, blocker.bay, blocker.span),
      },
      retrieval: { containerId: retr.containerId, slotId: digging.id, jobId: retr.id },
      blockersLeft: blockersOf(state, digging).length,
      retrievalRank: ranks.get(box.id) ?? null,
      candidates,
      random: ctx.random(),
    },
    { equipment: ascs.filter((a) => a.status === 'idle').map((a) => a.id), jobs: [job.id], containers: [box.id] },
  )
}

/** The rehandleTarget reply: claim the slot (or ask again if it was taken meanwhile). */
export function resolveRehandleTarget(ctx: EngineContext, request: DecisionRequests['rehandleTarget'], slotId: string | null): void {
  const { state } = ctx
  const job = state.ascJobs[request.jobId]
  if (!job || job.kind !== 'rehandle' || job.targetSlotId) return
  const retr = state.ascJobs[job.forJobId ?? '']
  if (slotId === null) {
    delete state.ascJobs[job.id]
    if (retr) retr.rehandle = 'full'
    if (state.kpis.yard) state.kpis.yard.rehandleFailures++
    return
  }
  if (!request.candidates.some((c) => c.slotId === slotId))
    throw new Error(`rehandleTarget handler returned slot ${slotId}, which is not one of the ${request.candidates.length} legal slots for ${request.containerId}`)
  const blocker = state.yardSlots[job.yardSlotId ?? '']
  const digging = retr && retrievalSlot(state, retr)
  if (!blocker || !digging) {
    delete state.ascJobs[job.id]
    maybeDispatchAsc(ctx, job.blockId)
    return
  }
  const block = blockOf(ctx, job.blockId)
  const top = state.yardBlocks[job.blockId]
  if (![...Array(blocker.span).keys()].every((k) => top.heights[stackIndex(top, blocker.bay + k, blocker.row)] === blocker.tier)) {
    // an allocation answered at the same instant put a box on the blocker (it is no longer on top): the new box blocks too, so start over
    delete state.ascJobs[job.id]
    maybeDispatchAsc(ctx, job.blockId)
    return
  }
  if (!rehandleCandidates(state, ctx.config, block, blocker, digging).some((c) => c.slotId === slotId)) {
    requestRehandleTarget(ctx, job, retr) // the slot was taken while the reply was on its way (latency)
    return
  }
  const yard = state.yardBlocks[job.blockId]
  const cell = parseYardSlotId(slotId)
  for (let b = 0; b < blocker.span; b++) {
    const i = stackIndex(yard, cell.bay + b, cell.row)
    yard.heights[i] = Math.max(yard.heights[i], cell.tier)
    yard.topVessels[i] = job.vesselId
  }
  job.targetSlotId = slotId
  job.claimSeq = state.nextClaimSeq++
  // the blocker stays put until an ASC is free: close its stack now, so no allocation lands on it meanwhile (it would float once the blocker leaves)
  lockStack(state, job)
  maybeDispatchAsc(ctx, job.blockId)
}

/**
 * Ask yardAllocation for the oldest waiting box of the block, if no request is
 * pending: one at a time per block, so a slow TOS never answers from stale stacks.
 */
export function pumpAllocation(ctx: EngineContext, blockId: string): void {
  const { state } = ctx
  const jobs = Object.values(state.ascJobs).filter((j) => j.blockId === blockId)
  if (jobs.some((j) => j.allocation === 'asked')) return
  const next = jobs.find((j) => j.allocation === 'waiting')
  if (!next) return
  next.allocation = 'asked'
  requestAllocation(ctx, next)
}

/**
 * Stack heights as the allocation decision sees them: a stack holding a box a truck is coming for (TT-13) reads
 * full, so no box is piled on it (the TOS knows the pickup; otherwise the truck would wait for a rehandle).
 */
export function withoutPendingPickups(state: SimState, blockId: string, yard: SimState['yardBlocks'][string]): number[] {
  const heights = yard.heights.slice()
  for (const j of Object.values(state.ascJobs)) {
    if (j.kind !== 'retrieve' || j.truckId === undefined || j.blockId !== blockId) continue
    const slot = state.yardSlots[j.yardSlotId ?? '']
    if (!slot || slot.containerId !== j.containerId) continue
    for (let k = 0; k < slot.span; k++) heights[stackIndex(yard, slot.bay + k, slot.row)] = yard.tiers
  }
  return heights
}

/** Ask the yardAllocation decision point for a slot for the box on the pad. */
function requestAllocation(ctx: EngineContext, job: AscJob): void {
  const { state } = ctx
  const box = state.containers[job.containerId]
  const block = blockOf(ctx, job.blockId)
  const yard = state.yardBlocks[job.blockId]
  const stall = isTruckJob(job) ? stallOf(ctx, job.stallId as string) : null
  const pad = stall ? null : laneGraphOf(ctx.config).pads.find((p) => p.id === job.wtpPadId)
  if (!pad && !stall) throw new Error(`Unknown WTP pad ${job.wtpPadId}`)
  const from = (stall ?? pad) as { x: number; z: number }
  ctx.requestDecision(
    'yardAllocation',
    {
      containerId: box.id,
      size: box.size,
      full: box.full,
      line: box.line,
      vesselId: job.vesselId,
      wtpPadId: pad?.id ?? '',
      ...(stall ? { stallId: stall.id } : {}),
      blockId: block.id,
      bays: block.bays,
      rows: block.rows,
      tiers: block.tiers,
      blockX: block.x,
      firstBayZ: block.firstBayZ,
      wtpX: from.x,
      wtpZ: from.z,
      heights: withoutPendingPickups(state, block.id, yard),
      topVessels: yard.topVessels.slice(),
      random: ctx.random(),
    },
    { containers: [box.id] },
  )
}

/** Claim the slot a yardAllocation reply named (the engine trusts the TOS; invariants catch bad replies). */
export function claimSlot(ctx: EngineContext, job: AscJob, slotId: string): void {
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

export const jobOfBox = (state: SimState, containerId: string): AscJob | undefined =>
  Object.values(state.ascJobs).find((j) => j.containerId === containerId && j.kind !== 'rehandle')


/** AscRetrieved: the box leaves its slot; the stack's height and top vessel fall back to the box below. */
export function removeFromStack(state: SimState, yardSlotId: string): void {
  const slot = state.yardSlots[yardSlotId]
  const yard = state.yardBlocks[slot.blockId]
  delete state.yardSlots[slot.id]
  indexYardSlotRemoved(state, slot)
  for (let k = 0; k < slot.span; k++) {
    const i = stackIndex(yard, slot.bay + k, slot.row)
    yard.heights[i] = slot.tier - 1
    const below = yardIndexOf(state)
      .byColumn.get(columnKey(slot.blockId, slot.bay + k, slot.row))
      ?.find((s) => s.tier === slot.tier - 1)
    yard.topVessels[i] = below?.containerId ? state.containers[below.containerId].vesselId : null
  }
}

/** AscStacked: the box now occupies its slot (heights were set when the slot was claimed). */
export function placeInStack(state: SimState, blockId: string, yardSlotId: string, containerId: string): void {
  const cell = parseYardSlotId(yardSlotId)
  const span = boxSpan(state.containers[containerId].size)
  const placed: YardSlotState = { id: yardSlotId, blockId, bay: cell.bay, row: cell.row, tier: cell.tier, span, containerId }
  state.yardSlots[placed.id] = placed
  indexYardSlotAdded(state, placed)
}

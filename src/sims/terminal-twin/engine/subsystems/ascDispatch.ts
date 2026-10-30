/**
 * ASC job dispatch (V11-09): which job an idle ASC takes next.
 *
 * Candidate jobs (stacking, rehandle, truck pick, pad retrieval), the single-ASC
 * pick and the twin-block ascDispatch decision (request and reply), and the
 * commit that starts a planned job (reservations, plan, KPIs, AscJobAssigned).
 */
import type { EngineContext } from '../context'
import { commitYield, countGantry, install, planJob, type JobPlan } from './ascReservations'
import { ascKpi, ascsOfBlock, blockOf, blockedByOlderClaim, freePadFor, isRetrievable, isTruckJob, lockStack, pumpRehandle, stallOf } from './ascStorage'
import { laneGraphOf } from '../laneGraph'
import { reserve } from '../reservations'
import { ascIndexOf, type AscJob, type AscState, type SimState } from '../state'
import {
  ASC_MIN_SEPARATION_M,
  PARK_UNTIL_S,
  boxSpan,
  parseYardSlotId,
  slotZ,
} from '../yardLayout'
import { earlyPickReady, preRetrievalOn, truckReadyForPick } from './landside'
import { truncateParkHolds } from './ascRail'

/** Commit a planned job: reserve, install the plan, update KPIs, announce. */
export function startJob(ctx: EngineContext, asc: AscState, job: AscJob, plan: JobPlan): void {
  const { state } = ctx
  const { trip, start } = plan
  const twin = plan.railWindows.length > 0 || plan.yield !== null || plan.park.length > 0
  if (plan.yield) commitYield(ctx, plan.yield, asc)

  job.ascId = asc.id
  asc.jobId = job.id
  if (job.kind === 'retrieve' && !isTruckJob(job)) state.wtpPads[job.wtpPadId].claimedBy = asc.id
  if (job.kind === 'retrieve' || job.kind === 'rehandle') lockStack(state, job)
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
    ...(job.kind === 'rehandle' ? { rehandle: true as const, targetSlotId: job.targetSlotId ?? '' } : {}),
    ...(isTruckJob(job) ? { stallId: job.stallId as string, truckId: job.truckId as string } : {}),
    ...(isEarly(state, job) ? { early: true as const } : {}),
  })
}

/** TT-R17: a pick retrieval that starts before its truck stands in its stall (the truck is still driving in). */
export function isEarly(state: SimState, job: AscJob): boolean {
  return job.kind === 'retrieve' && isTruckJob(job) && state.trucks[job.truckId as string]?.atStallAt === null
}

/**
 * TT-R17: pick retrievals the ASC may start ahead of the truck (only with the `pre-retrieval` ascDispatch strategy): the
 * stall is reserved, the truck is close, the box is on top of its stack and nothing digs it out.
 */
function earlyTruckPicks(ctx: EngineContext, blockId: string): AscJob[] {
  const { state } = ctx
  if (!preRetrievalOn(ctx.config)) return []
  return Object.values(state.ascJobs).filter(
    (j) =>
      j.kind === 'retrieve' &&
      isTruckJob(j) &&
      j.blockId === blockId &&
      j.ascId === null &&
      earlyPickReady(state, j) &&
      isRetrievable(state, j) &&
      !Object.values(state.ascJobs).some((r) => r.kind === 'rehandle' && r.containerId === j.containerId),
  )
}

/** Truck pick retrievals that can start now: the truck stands at its stall with a free chassis, the box is on top of its stack. */
function readyTruckPicks(state: SimState, blockId: string): AscJob[] {
  return Object.values(state.ascJobs).filter(
    (j) =>
      j.kind === 'retrieve' &&
      isTruckJob(j) &&
      j.blockId === blockId &&
      j.ascId === null &&
      truckReadyForPick(state, j) &&
      isRetrievable(state, j) &&
      !Object.values(state.ascJobs).some((r) => r.kind === 'rehandle' && r.containerId === j.containerId),
  )
}

/** Next export retrieval to a WTP pad that can start now: oldest first, box on top, a pad free (set on the job). */
function nextPadRetrieval(ctx: EngineContext, blockId: string): AscJob | undefined {
  const { state } = ctx
  const open = Object.values(state.ascJobs).filter((j) => j.kind === 'retrieve' && j.blockId === blockId && j.ascId === null && !isTruckJob(j))
  for (const job of open) {
    if (!isRetrievable(state, job)) continue
    if (Object.values(state.ascJobs).some((j) => j.kind === 'rehandle' && j.containerId === job.containerId)) continue
    const pad = freePadFor(ctx, job)
    if (!pad) return undefined // every pad is busy: all retrievals wait (jobs stay in claim order)
    job.wtpPadId = pad
    return job
  }
  return undefined
}

/**
 * The block's jobs that can start now, in priority order: stacking jobs (oldest claim first), rehandles, truck picks,
 * then the next pad retrieval. The first is what a single-ASC block works on next; a twin block takes the first one an
 * idle ASC can serve (a pad job the waterside ASC is in the way of does not hold up the landside ASC's truck work).
 */
function candidateJobs(ctx: EngineContext, blockId: string): AscJob[] {
  const { state } = ctx
  const stacks = Object.values(state.ascJobs)
    .filter((j) => j.kind === undefined && j.blockId === blockId && j.ascId === null && j.cleared && j.claimSeq !== null)
    .sort((a, b) => (a.claimSeq as number) - (b.claimSeq as number))
    .filter((j) => !blockedByOlderClaim(state, j))
  const rehandles = Object.values(state.ascJobs).filter(
    (j) => j.kind === 'rehandle' && j.blockId === blockId && j.ascId === null && j.targetSlotId && !blockedByOlderClaim(state, j),
  )
  const pad = nextPadRetrieval(ctx, blockId)
  return [...stacks, ...rehandles, ...readyTruckPicks(state, blockId), ...(pad ? [pad] : []), ...earlyTruckPicks(ctx, blockId)]
}

/**
 * Give the block's open box to an idle ASC. One ASC: it takes the box. Two
 * ASCs: the ascDispatch decision point picks (one request per block at a time).
 */
export function maybeDispatchAsc(ctx: EngineContext, blockId: string): void {
  const { state } = ctx
  const ascs = ascsOfBlock(state, blockId)
  const idle = ascs.filter((a) => a.status === 'idle')
  if (idle.length === 0) return
  pumpRehandle(ctx, blockId)
  if (ascs.length === 1) {
    const next = candidateJobs(ctx, blockId)[0]
    if (!next) return
    if (isEarly(state, next)) {
      // TT-R17: a retrieval ahead of the truck is the strategy's call, even with one ASC
      if (next.dispatch !== 'asked' && planJob(ctx, idle[0], next) !== null) requestDispatch(ctx, next, ascs, idle)
      return
    }
    startJob(ctx, idle[0], next, planJob(ctx, idle[0], next) as JobPlan)
    return
  }
  if (Object.values(state.ascJobs).some((j) => j.blockId === blockId && j.dispatch === 'asked')) return
  const jobs = candidateJobs(ctx, blockId)
  if (jobs.length === 0) return
  // with trucks, the landside ASC may have work the waterside ASC's pad job cannot start yet: take the first job an idle ASC can serve
  const job = (state.subsystems.landside !== 'off' ? jobs.find((j) => idle.some((a) => planJob(ctx, a, j) !== null)) : undefined) ?? jobs[0]
  requestDispatch(ctx, job, ascs, idle)
}

function requestDispatch(ctx: EngineContext, job: AscJob, ascs: AscState[], idle: AscState[]): void {
  const { state } = ctx
  const block = blockOf(ctx, job.blockId)
  const stall = isTruckJob(job) ? stallOf(ctx, job.stallId as string) : null
  const pad = laneGraphOf(ctx.config).pads.find((p) => p.id === job.wtpPadId)
  if (!pad && !stall && job.kind !== 'rehandle') throw new Error(`Unknown WTP pad ${job.wtpPadId}`)
  const cell = job.yardSlotId ? parseYardSlotId(job.yardSlotId) : { bay: 1, row: 1, tier: 1 }
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
        kind: stall ? 'transfer' : (job.kind ?? 'wtp'),
        ...(stall ? { stallId: stall.id } : {}),
        ...(isEarly(state, job) ? { early: true as const } : {}),
        wtpPadId: job.wtpPadId,
        yardSlotId: job.yardSlotId ?? '',
        padZ: stall?.z ?? pad?.z ?? slotZ(block, cell.bay, span),
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
export function resolveDispatch(ctx: EngineContext, jobId: string, ascId: string | null): void {
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
  if (job.kind === 'retrieve' && isTruckJob(job)) {
    // the reply may be late: the box may have been rehandled or the chassis may be taken
    if (!isRetrievable(state, job) || !(truckReadyForPick(state, job) || (preRetrievalOn(ctx.config) && earlyPickReady(state, job)))) {
      maybeDispatchAsc(ctx, job.blockId) // the job is no longer a candidate: the idle ASC must look at the block's other work
      return
    }
  } else if (job.kind === 'retrieve') {
    // the reply may be late (keep-running latency): the pad or the stack may have changed meanwhile
    const pad = state.wtpPads[job.wtpPadId]
    if (!isRetrievable(state, job) || pad.containerId !== null || pad.claimedBy !== null) {
      const again = freePadFor(ctx, job)
      if (!isRetrievable(state, job) || !again) {
        // e.g. a rehandle target claimed on top of the box at the same instant: without this the idle ASCs would never look at the block again
        maybeDispatchAsc(ctx, job.blockId)
        return
      }
      job.wtpPadId = again
    }
  }
  const plan = planJob(ctx, asc, job)
  if (!plan) return // cannot serve it now (the other ASC is busy in the way); asked again later
  startJob(ctx, asc, job, plan)
  maybeDispatchAsc(ctx, job.blockId)
}


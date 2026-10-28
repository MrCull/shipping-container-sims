/**
 * Work packages (TT-10): one STS's moves for one bay section (deck or hold) of
 * one vessel, discharge or load. An STS only works packages the
 * `workPackageRelease` decision point has released, in sequence.
 *
 *   crane split → createPackages (all discharge packages, bay by bay with deck
 *   before hold, then all load packages, bay by bay with hold before deck)
 *   → workPackageRelease (asked at assignment and whenever a package starts or
 *   completes) → WorkPackageReleased → [load: pumpLoadPrep starts the yard work]
 *   → WorkPackageStarted (the crane starts it: `lead time` = release → start)
 *   → … moves … → WorkPackageCompleted → next package, or StsWorkComplete.
 *
 * `StsState.workQueue` holds the boxes of the active package.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { SimState, StsState, WorkPackage } from '../state'
import { compareKeys, loadSequenceKey } from '../../scenario/exportYard'
import { continueWork } from './quay'
import { pumpLoadPrep } from './loadPrep'

/** Export boxes are loaded only when the SHC and ASC subsystems run (they carry and fetch the boxes). */
export const loadActive = (state: SimState): boolean => state.subsystems.shc !== 'off' && state.subsystems.asc !== 'off'

/** Packages kept released ahead of the active one (`config.workPackages.releaseAhead`, default 2). */
export const releaseAhead = (ctx: EngineContext): number => ctx.config.workPackages?.releaseAhead ?? 2

const section = (deck: boolean): 'deck' | 'hold' => (deck ? 'deck' : 'hold')

/** The crane's packages in work order. */
export const packagesOf = (state: SimState, sts: StsState): WorkPackage[] => sts.packageIds.map((id) => state.workPackages[id])

/** Create the packages of a crane for its bays of a vessel (all `planned`). */
export function createPackages(ctx: EngineContext, sts: StsState, vesselId: string, bays: number[]): void {
  const { state } = ctx
  const inBays = new Set(bays)
  const slots = Object.values(state.vesselSlots).filter((s) => s.vesselId === vesselId && inBays.has(s.bay))
  const discharge = slots
    .filter((s) => s.purpose === 'discharge' && s.containerId !== null)
    .sort(
      (a, b) =>
        a.bay - b.bay ||
        Number(b.deck) - Number(a.deck) ||
        b.tier - a.tier ||
        a.row - b.row ||
        (a.half === 'fore' ? 1 : 0) - (b.half === 'fore' ? 1 : 0),
    )
  const load = loadActive(state)
    ? slots
        .filter((s) => s.purpose === 'load' && s.plannedContainerId && s.containerId === null)
        .sort((a, b) => compareKeys(loadSequenceKey(a), loadSequenceKey(b)))
    : []
  sts.packageIds = []
  sts.activePackageId = null
  const add = (kind: 'discharge' | 'load', group: typeof slots) => {
    let current: WorkPackage | null = null
    for (const s of group) {
      if (!current || current.bay !== s.bay || current.section !== section(s.deck)) {
        current = {
          id: `WP${++state.nextWorkPackage}`,
          stsId: sts.id,
          vesselId,
          kind,
          section: section(s.deck),
          bay: s.bay,
          containerIds: [],
          seq: sts.packageIds.length,
          status: 'planned',
          releasedAt: null,
          startedAt: null,
          completedAt: null,
        }
        state.workPackages[current.id] = current
        sts.packageIds.push(current.id)
      }
      current.containerIds.push((kind === 'discharge' ? s.containerId : s.plannedContainerId) as string)
    }
  }
  add('discharge', discharge)
  add('load', load)
}

/** Ask the release decision for the crane, unless a request is pending. */
export function askRelease(ctx: EngineContext, sts: StsState): void {
  if (sts.releasing || !sts.vesselId) return
  const { state } = ctx
  const packages = packagesOf(state, sts)
  if (packages.every((p) => p.status === 'complete')) return
  sts.releasing = true
  ctx.requestDecision(
    'workPackageRelease',
    {
      stsId: sts.id,
      vesselId: sts.vesselId,
      k: releaseAhead(ctx),
      packages: packages.map((p) => ({
        packageId: p.id,
        kind: p.kind,
        section: p.section,
        bay: p.bay,
        moves: p.containerIds.length,
        status: p.status,
      })),
    },
    { equipment: [sts.id], vessels: [sts.vesselId] },
  )
}

/** Where the crane stands in its package sequence. */
export type PackageStep = 'ready' | 'waiting' | 'done'

/**
 * Make sure the crane has boxes to work: complete the active package when its
 * boxes are all done, then start the next released one. `waiting` = the next
 * package is not released yet (the release decision is asked); `done` = every
 * package is complete.
 */
export function prepareNextPackage(ctx: EngineContext, sts: StsState, at: number): PackageStep {
  const { state } = ctx
  if (sts.workQueue.length > 0) return 'ready'
  if (sts.activePackageId) {
    const done = state.workPackages[sts.activePackageId]
    done.status = 'complete'
    done.completedAt = at
    state.kpis.workPackages.completed++
    sts.activePackageId = null
    ctx.schedule('WorkPackageCompleted', at, { equipment: [sts.id], vessels: [done.vesselId] }, {
      packageId: done.id,
      stsId: sts.id,
      vesselId: done.vesselId,
      kind: done.kind,
      moves: done.containerIds.length,
      durationS: Math.round((at - (done.startedAt ?? at)) * 1000) / 1000,
    })
    pumpLoadPrep(ctx) // the crane may have finished its discharge: load preparation can start
  }
  const next = packagesOf(state, sts).find((p) => p.status !== 'complete')
  if (!next) return 'done'
  if (next.status === 'planned') {
    askRelease(ctx, sts)
    return 'waiting'
  }
  next.status = 'active'
  next.startedAt = at
  sts.activePackageId = next.id
  sts.workQueue = [...next.containerIds]
  const lead = at - (next.releasedAt ?? at)
  const k = state.kpis.workPackages
  k.started++
  k.leadTimeSumS += lead
  k.leadTimeMaxS = Math.max(k.leadTimeMaxS, lead)
  ctx.schedule('WorkPackageStarted', at, { equipment: [sts.id], vessels: [next.vesselId] }, {
    packageId: next.id,
    stsId: sts.id,
    vesselId: next.vesselId,
    kind: next.kind,
    moves: next.containerIds.length,
    leadTimeS: Math.round(lead * 1000) / 1000,
  })
  return 'ready'
}

export const workPackageReactors: ReactorMap = {
  WorkPackageStarted: (e, ctx) => askRelease(ctx, ctx.state.sts[e.payload.stsId]),
  WorkPackageCompleted: (e, ctx) => askRelease(ctx, ctx.state.sts[e.payload.stsId]),

  DecisionResolved: (e, ctx) => {
    if (e.payload.decisionPoint !== 'workPackageRelease') return
    const { state } = ctx
    const { request, reply } = e.payload
    const sts = state.sts[request.stsId]
    sts.releasing = false
    for (const id of reply.packageIds) {
      const pkg = state.workPackages[id]
      if (!pkg || pkg.stsId !== sts.id) throw new Error(`workPackageRelease: ${id} is not a package of ${sts.id}`)
      if (pkg.status !== 'planned') throw new Error(`workPackageRelease: ${id} is already ${pkg.status}`)
    }
    const packages = packagesOf(state, sts)
    const fresh: WorkPackage[] = []
    for (const id of reply.packageIds) {
      const pkg = state.workPackages[id]
      pkg.status = 'released'
      pkg.releasedAt = e.t
      fresh.push(pkg)
    }
    // released packages waiting behind the one being worked (the next one is "being worked" while the crane is between packages)
    const ahead = () =>
      Math.max(0, packages.filter((p) => p.status === 'released').length - (sts.activePackageId ? 0 : 1))
    const open = packages.filter((p) => p.status === 'released' || p.status === 'active').length
    if (open === 0 && packages.some((p) => p.status === 'planned'))
      throw new Error(`workPackageRelease for ${sts.id} released nothing while the crane has no package to work`)
    for (const pkg of fresh) {
      state.kpis.workPackages.released++
      if (pkg.kind === 'load') {
        const before = packages.filter((p) => p.kind === 'load' && p.seq < pkg.seq).reduce((n, p) => n + p.containerIds.length, 0)
        const slotOf = new Map(
          Object.values(state.vesselSlots)
            .filter((s) => s.vesselId === pkg.vesselId && s.bay === pkg.bay && s.plannedContainerId)
            .map((s) => [s.plannedContainerId, s.id]),
        )
        pkg.containerIds.forEach((containerId, i) => {
          state.loadOrders[containerId] = {
            containerId,
            vesselId: pkg.vesselId,
            stsId: sts.id,
            packageId: pkg.id,
            slotId: slotOf.get(containerId) as string,
            seq: before + i,
            stage: 'released',
            groundPositionId: null,
          }
        })
      }
      ctx.schedule('WorkPackageReleased', e.t, { equipment: [sts.id], vessels: [pkg.vesselId] }, {
        packageId: pkg.id,
        stsId: sts.id,
        vesselId: pkg.vesselId,
        kind: pkg.kind,
        section: pkg.section,
        bay: pkg.bay,
        moves: pkg.containerIds.length,
        ahead: ahead(),
      })
    }
    if (sts.vesselId && sts.status === 'idle' && !sts.activePackageId) continueWork(ctx, sts, e.t)
    pumpLoadPrep(ctx)
  },
}

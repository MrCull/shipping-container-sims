/**
 * Crane plan (#288), engine side: builds the plan record when a vessel's cranes are assigned, validates it, predicts
 * package times and conflicts, answers the plan read (lazy recalculation) and holds the re-plan hook.
 *
 * The crane split decision point stays `craneSplit` in the event log (so the log is byte-identical to before); the
 * plan module is applied to its resolved reply. State only, no events.
 */
import type { ScenarioConfig } from '../../scenario/types'
import { slotX, vesselClass } from '../../scenario/vesselClasses'
import { stsCycleGeometry, stsNominalCycle } from '../cycleTime'
import { hatchEnabled, hatchSettings } from '../hatch'
import type { SimState, StsState, VesselSlotState, WorkPackage } from '../state'
import { predictConflicts, type CranePath } from './conflicts'
import { estimateTimes, type EstimatorParams } from './estimate'
import type { ConflictWindow, CranePlanRecord, PackageTime, PlanCrane, PlanPackage } from './types'
import { validatePlan } from './validate'

type PlanCtx = { state: SimState; config: ScenarioConfig }

/** The crane's packages in plan order: the plan is the source, `StsState.packageIds` only before it exists. */
export function cranePackageIds(state: SimState, sts: StsState): string[] {
  const plan = sts.vesselId ? state.cranePlans?.[sts.vesselId] : undefined
  return plan?.cranes.find((c) => c.stsId === sts.id)?.packageIds ?? sts.packageIds
}

export function estimatorParams(ctx: PlanCtx, vesselId: string): EstimatorParams {
  const { state, config } = ctx
  const instant = state.subsystems.quay === 'instant'
  return {
    cycleS: instant ? 0 : stsNominalCycle(config.kinematics.sts, config.layout.stsSafeHoistM, stsCycleGeometry(config)).cycleS,
    hatchCycleS: instant || !hatchEnabled(config) ? 0 : hatchSettings(config, state.vessels[vesselId].sizeClass).cycleS,
    gantry: config.kinematics.sts.gantry,
  }
}

const moves = (p: WorkPackage): number => (p.emptyReq ? p.emptyReq.count : p.containerIds.length)

/** Plan-function view of a vessel's packages. */
export function planPackages(state: SimState, vesselId: string): Record<string, PlanPackage> {
  const vessel = state.vessels[vesselId]
  const spec = vesselClass(vessel.sizeClass)
  const slots = Object.values(state.vesselSlots).filter((s) => s.vesselId === vesselId)
  const byBox = new Map<string, VesselSlotState>()
  for (const s of slots) {
    if (s.containerId) byBox.set(s.containerId, s)
    if (s.plannedContainerId) byBox.set(s.plannedContainerId, s)
  }
  const out: Record<string, PlanPackage> = {}
  for (const p of Object.values(state.workPackages)) {
    if (p.vesselId !== vesselId) continue
    const cells: PlanPackage['cells'] = p.emptyReq
      ? p.emptyReq.slotIds.map((id) => state.vesselSlots[id]).filter(Boolean).map((s) => ({ row: s.row, tier: s.tier }))
      : p.containerIds.map((id) => byBox.get(id)).filter((s): s is VesselSlotState => !!s).map((s) => ({ row: s.row, tier: s.tier }))
    out[p.id] = {
      id: p.id,
      kind: p.kind,
      section: p.section,
      bay: p.bay,
      bayX: slotX(spec, vessel.berthX ?? 0, p.bay),
      moves: moves(p),
      status: p.status,
      cells,
    }
  }
  return out
}

/** Conflict windows of cranes on one rail, plus the cranes of other vessels as fixed obstacles. */
function conflictsOf(
  ctx: PlanCtx,
  vesselId: string,
  paths: CranePath[],
): ConflictWindow[] {
  const { state, config } = ctx
  const fixed: CranePath[] = Object.values(state.sts)
    .filter((c) => c.vesselId !== null && c.vesselId !== vesselId)
    .map((c) => ({ stsId: c.id, railIndex: c.railIndex, from: { x: c.gantryX, s: state.now }, packages: [], fixed: true }))
  return predictConflicts([...paths, ...fixed], config.quay.stsMinSpacingM, config.kinematics.sts.gantry)
}

/** Register a crane's package list in the vessel's plan record (created on the first crane). */
export function registerCrane(ctx: PlanCtx, vesselId: string, strategy: string, sts: StsState, bays: number[]): void {
  const { state } = ctx
  const plan = (state.cranePlans[vesselId] ??= {
    vesselId,
    strategy,
    revision: 1,
    madeAtS: state.now,
    cranes: [],
    predictedConflictS: 0,
    railWaitStartS: {},
    railWaitEndS: {},
  })
  plan.cranes.push({ stsId: sts.id, railIndex: sts.railIndex, bays: [...bays], packageIds: [...sts.packageIds] })
  plan.railWaitStartS[sts.id] = state.kpis.perSts[sts.id]?.railWaitS ?? 0
  plan.railWaitEndS[sts.id] = null
}

/** Validate the plan and attach predicted times. A broken plan is an error. */
export function finishPlan(ctx: PlanCtx, vesselId: string): void {
  const { state } = ctx
  const plan = state.cranePlans[vesselId]
  const packages = planPackages(state, vesselId)
  const workBays = [...new Set(plan.cranes.flatMap((c) => c.bays))].sort((a, b) => a - b)
  const why = validatePlan({ workBays, cranes: plan.cranes, packages })
  if (why) throw new Error(`cranePlan for ${vesselId}: ${why}`)
  const params = estimatorParams(ctx, vesselId)
  const paths: CranePath[] = []
  for (const c of plan.cranes) {
    const sts = state.sts[c.stsId]
    const list = c.packageIds.map((id) => packages[id])
    const times = estimateTimes(params, { x: sts.gantryX, s: state.now }, list)
    c.packageIds.forEach((id, i) => {
      state.workPackages[id].predictedStartS = times[i].startS
      state.workPackages[id].predictedEndS = times[i].endS
    })
    paths.push({ stsId: c.stsId, railIndex: c.railIndex, from: { x: sts.gantryX, s: state.now }, packages: list.map((p, i) => ({ bayX: p.bayX, ...times[i] })) })
  }
  plan.predictedConflictS = conflictsOf(ctx, vesselId, paths).reduce((n, w) => n + (w.toS - w.fromS), 0)
}

/** A crane is through with a vessel: remember its rail wait so far. */
export function closeCrane(state: SimState, vesselId: string, stsId: string): void {
  const plan = state.cranePlans?.[vesselId]
  if (plan && plan.railWaitEndS[stsId] === null) plan.railWaitEndS[stsId] = state.kpis.perSts[stsId]?.railWaitS ?? 0
}

/**
 * Re-plan hook (called at WorkPackageCompleted). A policy returns the new crane lists, or null to keep the plan.
 * v1 policy: keep. A later policy may reorder a crane's `planned` packages; the validator keeps the rest in place.
 */
export type ReplanPolicy = (ctx: PlanCtx, plan: CranePlanRecord) => PlanCrane[] | null
export const keepPolicy: ReplanPolicy = () => null
let replanPolicy: ReplanPolicy = keepPolicy
export const setReplanPolicy = (p: ReplanPolicy): void => {
  replanPolicy = p
}

export function maybeReplan(ctx: PlanCtx, vesselId: string): void {
  const plan = ctx.state.cranePlans?.[vesselId]
  if (!plan) return
  const next = replanPolicy(ctx, plan)
  if (!next) return
  const packages = planPackages(ctx.state, vesselId)
  const previous = Object.fromEntries(plan.cranes.map((c) => [c.stsId, c.packageIds]))
  const workBays = [...new Set(next.flatMap((c) => c.bays))].sort((a, b) => a - b)
  const why = validatePlan({ workBays, cranes: next, packages, previous })
  if (why) throw new Error(`cranePlan for ${vesselId}: ${why}`)
  plan.cranes = next
  plan.revision++
}

// ── the plan read ────────────────────────────────────────────────────────

export interface PlanPackageView {
  id: string
  stsId: string
  kind: WorkPackage['kind']
  section: 'deck' | 'hold'
  bay: number
  bayX: number
  moves: number
  status: WorkPackage['status']
  /** As predicted when the plan was made. */
  plannedStartS: number
  plannedEndS: number
  /** Recalculated from where the crane is now (equal to the actual times once worked). */
  predictedStartS: number
  predictedEndS: number
  actualStartS: number | null
  actualEndS: number | null
}

export interface CranePlanView {
  vesselId: string
  strategy: string
  revision: number
  now: number
  cranes: { stsId: string; railIndex: number; bays: number[]; packages: PlanPackageView[] }[]
  conflicts: ConflictWindow[]
  /** Cranes of other vessels, with their gantry X (fixed obstacles). */
  obstacles: { stsId: string; vesselId: string; x: number }[]
  /** Gantry X of the work bays, by internal bay. */
  bayX: Record<number, number>
  minSpacingM: number
}

/** The plan with times recalculated from each crane's position now. Reads only; costs the engine nothing. */
export function readCranePlan(ctx: PlanCtx, vesselId: string): CranePlanView | null {
  const { state } = ctx
  const plan = state.cranePlans?.[vesselId]
  if (!plan) return null
  const packages = planPackages(state, vesselId)
  const params = estimatorParams(ctx, vesselId)
  const now = state.now
  const paths: CranePath[] = []
  const bayX: Record<number, number> = {}
  const cranes = plan.cranes.map((c) => {
    const sts = state.sts[c.stsId]
    const list = c.packageIds.map((id) => packages[id])
    list.forEach((p) => (bayX[p.bay] = p.bayX))
    const open = list.filter((p) => p.status !== 'complete')
    // remaining work of the active package counts only its boxes still in the queue
    const adj = open.map((p) => (p.id === sts.activePackageId && p.kind !== 'hatch-remove' && p.kind !== 'hatch-replace' ? { ...p, moves: sts.workQueue.length } : p))
    const done = estimateTimes(params, { x: sts.gantryX, s: now }, adj)
    const times = new Map<string, PackageTime>(open.map((p, i) => [p.id, done[i]]))
    const views = list.map((p): PlanPackageView => {
      const wp = state.workPackages[p.id]
      const t = times.get(p.id)
      const startS = wp.startedAt ?? t?.startS ?? now
      return {
        id: p.id,
        stsId: c.stsId,
        kind: p.kind,
        section: p.section,
        bay: p.bay,
        bayX: p.bayX,
        moves: p.moves,
        status: p.status,
        plannedStartS: wp.predictedStartS ?? startS,
        plannedEndS: wp.predictedEndS ?? startS,
        predictedStartS: startS,
        predictedEndS: wp.completedAt ?? t?.endS ?? now,
        actualStartS: wp.startedAt,
        actualEndS: wp.completedAt,
      }
    })
    paths.push({
      stsId: c.stsId,
      railIndex: c.railIndex,
      from: { x: sts.gantryX, s: now },
      packages: views.filter((v) => v.status !== 'complete').map((v) => ({ bayX: v.bayX, startS: v.predictedStartS, endS: v.predictedEndS })),
    })
    return { stsId: c.stsId, railIndex: c.railIndex, bays: c.bays, packages: views }
  })
  const obstacles = Object.values(state.sts)
    .filter((c) => c.vesselId !== null && c.vesselId !== vesselId)
    .map((c) => ({ stsId: c.id, vesselId: c.vesselId as string, x: c.gantryX }))
  return {
    vesselId,
    strategy: plan.strategy,
    revision: plan.revision,
    now,
    cranes,
    conflicts: conflictsOf(ctx, vesselId, paths),
    obstacles,
    bayX,
    minSpacingM: ctx.config.quay.stsMinSpacingM,
  }
}

// ── plan accuracy ────────────────────────────────────────────────────────

export interface PlanAccuracy {
  vesselId: string
  strategy: string
  revision: number
  predictedFinishS: number | null
  actualFinishS: number | null
  predictedConflictS: number
  actualRailWaitS: number
  meanStartErrorS: number | null
  packages: number
  worked: number
}

/** Per vessel: predicted against actual finish, predicted conflict against actual rail wait, mean start error. */
export function planAccuracy(state: SimState): PlanAccuracy[] {
  const out: PlanAccuracy[] = []
  for (const plan of Object.values(state.cranePlans ?? {})) {
    const ids = plan.cranes.flatMap((c) => c.packageIds)
    const pkgs = ids.map((id) => state.workPackages[id])
    const ends = pkgs.map((p) => p.predictedEndS).filter((x): x is number => x !== undefined)
    const allDone = pkgs.length > 0 && pkgs.every((p) => p.status === 'complete')
    const errs = pkgs.filter((p) => p.startedAt !== null && p.predictedStartS !== undefined).map((p) => Math.abs((p.startedAt as number) - (p.predictedStartS as number)))
    let wait = 0
    for (const c of plan.cranes) {
      const end = plan.railWaitEndS[c.stsId] ?? state.kpis.perSts[c.stsId]?.railWaitS ?? 0
      wait += end - (plan.railWaitStartS[c.stsId] ?? 0)
    }
    out.push({
      vesselId: plan.vesselId,
      strategy: plan.strategy,
      revision: plan.revision,
      predictedFinishS: ends.length ? Math.max(...ends) : null,
      actualFinishS: allDone ? Math.max(...pkgs.map((p) => p.completedAt as number)) : null,
      predictedConflictS: Math.round(plan.predictedConflictS * 1000) / 1000,
      actualRailWaitS: Math.round(wait * 1000) / 1000,
      meanStartErrorS: errs.length ? Math.round((errs.reduce((a, b) => a + b, 0) / errs.length) * 1000) / 1000 : null,
      packages: pkgs.length,
      worked: errs.length,
    })
  }
  return out
}

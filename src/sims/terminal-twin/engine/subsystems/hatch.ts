/**
 * Hatch covers (TT-R09): STS cranes remove and replace the hatch panels of a bay when its hold has work.
 *
 * Work order within a bay (`workPackages.ts`): deck discharge → `hatch-remove` per panel that has hold work under it →
 * hold discharge → hold load → `hatch-replace` per panel (last removed first) → deck load.
 *
 *   deck boxes above a panel gone → [lashing delay] → HatchLashingReleased (panel `unsecured`)
 *   hatch-remove:  StsHatchStarted (rail, gantry, trolley, hoist, lock) → HatchLifted (`lifted`)
 *                  → (hoist, gantry to the laydown bay, trolley, down, unlock) → HatchSetInLaydown (`in-laydown`)
 *   hatch-replace: StsHatchStarted → HatchLifted (from the laydown) → HatchReplaced (`replaced`) → [secure delay]
 *                  → HatchSecured (`secured`)
 *
 * Panels are not containers: they never take custody, never occupy yard slots and are never counted as moves. The
 * crane idles (`StsWaitingForHatch`) for a lashing release before a removal and for securing before a deck load.
 * A hatch move takes the hatch cycle time (default 240 s): the motion is planned like a box move and the remainder is
 * handling time (hooking up the cover spreader), split over the lock and the unlock.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { MotionSegment } from '../kinematics'
import type { HatchJob, HatchPanelState, HatchKpiCounters, StsState, WorkPackage } from '../state'
import {
  hatchEnabled,
  hatchSettings,
  laydownCentreZ,
  laydownSites,
  laydownTopY,
  type HatchSettings,
} from '../hatch'
import { hatchPanelId, hatchPanelOfRow, vesselClass } from '../../scenario/vesselClasses'
import { continueWork, isInstant, planSequence, stsKinematics, variation, wakeQuayRail } from './quay'
import { releaseRail, reserveRail } from './rail'

/** Hatch covers apply when enabled in the scenario and the quay subsystem runs. */
export const hatchActive = (ctx: EngineContext): boolean => hatchEnabled(ctx.config) && ctx.state.subsystems.quay !== 'off'

/** Hatch settings of the vessel of a panel. */
function settingsOf(ctx: EngineContext, panel: HatchPanelState): HatchSettings {
  return hatchSettings(ctx.config, ctx.state.vessels[panel.vesselId].sizeClass)
}

/** Lashing and securing are crew work; the instant quay mode takes them to zero with every crane time. */
const delayS = (ctx: EngineContext, s: number): number => (isInstant(ctx) ? 0 : s)

/** The panel above a row of a bay, or undefined when the vessel has no panels (hatch covers off). */
export function panelAbove(ctx: EngineContext, vesselId: string, bay: number, row: number): HatchPanelState | undefined {
  const spec = vesselClass(ctx.state.vessels[vesselId].sizeClass)
  return ctx.state.hatchPanels[hatchPanelId(vesselId, bay, hatchPanelOfRow(spec, row))]
}

/** Panels of a bay in index order (those that exist). */
export function panelsOfBay(ctx: EngineContext, vesselId: string, bay: number): HatchPanelState[] {
  const spec = vesselClass(ctx.state.vessels[vesselId].sizeClass)
  const out: HatchPanelState[] = []
  for (let i = 0; i < spec.hatch.panels; i++) {
    const p = ctx.state.hatchPanels[hatchPanelId(vesselId, bay, i)]
    if (p) out.push(p)
  }
  return out
}

/** The hatch KPI counters (created with the first hatch move). */
function hatchTotals(ctx: EngineContext): HatchKpiCounters {
  return (ctx.state.kpis.hatch ??= { removes: 0, replaces: 0, stsTimeS: 0, waitS: 0, perSts: {} })
}

function hatchKpi(ctx: EngineContext, stsId: string): HatchKpiCounters['perSts'][string] {
  return (hatchTotals(ctx).perSts[stsId] ??= { moves: 0, timeS: 0, waitS: 0 })
}

/** The panels of the crane's bays that have hold work under them (they open), computed from the bay plan. */
export function openingPanels(ctx: EngineContext, vesselId: string, bays: number[], holdWork: (bay: number, row: number) => boolean): HatchPanelState[] {
  const out: HatchPanelState[] = []
  for (const bay of bays) {
    for (const panel of panelsOfBay(ctx, vesselId, bay)) {
      let work = false
      for (let r = panel.rowFrom; r < panel.rowTo && !work; r++) work = holdWork(bay, r)
      if (work) out.push(panel)
    }
  }
  return out
}

/** Mark the panels that will open, count the deck boxes on them, and start the lashing release of those already clear. */
export function prepareHatches(ctx: EngineContext, vesselId: string, bays: number[], panels: HatchPanelState[]): void {
  const { state } = ctx
  const spec = vesselClass(state.vessels[vesselId].sizeClass)
  const inBays = new Set(bays)
  for (const slot of Object.values(state.vesselSlots)) {
    if (slot.vesselId !== vesselId || !slot.deck || !slot.containerId || !inBays.has(slot.bay)) continue
    const panel = state.hatchPanels[hatchPanelId(vesselId, slot.bay, hatchPanelOfRow(spec, slot.row))]
    if (panel) panel.deckBoxes++
  }
  for (const panel of panels) {
    panel.opens = true
    maybeReleaseLashing(ctx, panel)
  }
}

/** Start the lashing release of an opening panel once no deck box stands on it. */
export function maybeReleaseLashing(ctx: EngineContext, panel: HatchPanelState): void {
  if (!panel.opens || panel.lashingScheduled || panel.status !== 'secured' || panel.deckBoxes > 0) return
  panel.lashingScheduled = true
  const delay = delayS(ctx, settingsOf(ctx, panel).lashingReleaseS)
  ctx.schedule('HatchLashingReleased', ctx.state.now + delay, { vessels: [panel.vesselId], equipment: [panel.id] }, {
    vesselId: panel.vesselId,
    bay: panel.bay,
    panelId: panel.id,
    delayS: delay,
  })
}

/** A deck box left (`-1`) or entered (`+1`) the slot at `bay`/`row`: keep the panel's count and maybe start its release. */
export function deckBoxChanged(ctx: EngineContext, vesselId: string, bay: number, row: number, change: 1 | -1): void {
  if (!ctx.state.vessels[vesselId].hatchPanelIds) return
  const panel = panelAbove(ctx, vesselId, bay, row)
  if (!panel) return
  panel.deckBoxes += change
  if (change < 0) maybeReleaseLashing(ctx, panel)
}

/** An opened (not secured) panel of the bay that blocks a deck load, or null. */
export function hatchBlocker(ctx: EngineContext, pkg: WorkPackage): string | null {
  if (!ctx.state.vessels[pkg.vesselId].hatchPanelIds) return null
  for (const p of panelsOfBay(ctx, pkg.vesselId, pkg.bay)) if (p.status !== 'secured') return p.id
  return null
}

/** A panel of the crane's bays that is not secured (the crane has no work left but must not release the vessel yet), or null. */
export function hatchOpenPanel(ctx: EngineContext, sts: StsState): string | null {
  if (!sts.vesselId || !ctx.state.vessels[sts.vesselId].hatchPanelIds) return null
  for (const bay of sts.bays) for (const p of panelsOfBay(ctx, sts.vesselId, bay)) if (p.status !== 'secured') return p.id
  return null
}

/** Idle the crane until `panelId` is secured; raises StsWaitingForHatch once per wait. */
export function waitForHatch(ctx: EngineContext, sts: StsState, panelId: string, reason: 'lashing' | 'securing', at: number): void {
  sts.status = 'idle'
  if (sts.hatchWaitSince == null) {
    sts.hatchWaitSince = at
    ctx.schedule('StsWaitingForHatch', at, { equipment: [sts.id, panelId], vessels: [sts.vesselId as string] }, {
      stsId: sts.id,
      vesselId: sts.vesselId as string,
      panelId,
      reason,
    })
  }
  if (reason === 'securing') sts.hatchWaitPanel = panelId
}

/** End a crane's hatch wait: add the idle time to the KPIs. */
function endWait(ctx: EngineContext, sts: StsState, at: number): void {
  if (sts.hatchWaitSince == null) return
  const waited = at - sts.hatchWaitSince
  sts.hatchWaitSince = null
  hatchKpi(ctx, sts.id).waitS += waited
  hatchTotals(ctx).waitS += waited
}

/** Build the job record of a hatch package when the crane starts it. */
export function startHatchJob(ctx: EngineContext, pkg: WorkPackage): HatchJob {
  const panel = ctx.state.hatchPanels[pkg.hatchPanelId as string]
  return {
    panelId: panel.id,
    op: pkg.kind === 'hatch-remove' ? 'remove' : 'replace',
    packageId: pkg.id,
    waiting: false,
    padS: 0,
    siteId: pkg.kind === 'hatch-replace' ? panel.siteId : null,
    startedAt: null,
    target: { vesselId: panel.vesselId, bay: panel.bay, index: panel.index },
  }
}

/** Laydown bay for a panel: the nearest bay to its hatch with room, whose stack holds only panels of the same hatch. */
function claimLaydown(ctx: EngineContext, panel: HatchPanelState): string {
  const { state } = ctx
  const limit = settingsOf(ctx, panel).laydownStackLimit
  const sites = laydownSites(ctx.config).sort((a, b) => Math.abs(a.x - panel.home.x) - Math.abs(b.x - panel.home.x) || a.x - b.x)
  const bySite = new Map<string, HatchPanelState[]>()
  for (const p of Object.values(state.hatchPanels)) if (p.siteId) bySite.set(p.siteId, [...(bySite.get(p.siteId) ?? []), p])
  for (const site of sites) {
    const claimed = bySite.get(site.id) ?? []
    if (claimed.length >= limit) continue
    if (claimed.some((p) => p.vesselId !== panel.vesselId || p.bay !== panel.bay)) continue
    panel.siteId = site.id
    return site.id
  }
  throw new Error(`No hatch laydown capacity for ${panel.id} (every laydown bay is full or holds another hatch)`)
}

const siteX = (ctx: EngineContext, siteId: string): number => {
  const site = laydownSites(ctx.config).find((s) => s.id === siteId)
  if (!site) throw new Error(`Unknown hatch laydown bay ${siteId}`)
  return site.x
}

/** Level the next panel takes in a laydown bay (panels set down so far). */
const stackCount = (ctx: EngineContext, siteId: string): number => ctx.state.hatchLaydown[siteId]?.panelIds.length ?? 0

/** Move legs of a hatch move: before the lock and carrying to the destination. */
function legs(ctx: EngineContext, panel: HatchPanelState, op: 'remove' | 'replace', siteId: string) {
  const { config } = ctx
  const k = stsKinematics(ctx)
  const safe = config.layout.stsSafeHoistM
  const sx = siteX(ctx, siteId)
  const lz = laydownCentreZ(config, panel.widthM)
  const count = stackCount(ctx, siteId)
  const leg1 =
    op === 'remove'
      ? [
          { axis: 'hoist' as const, to: safe, profile: k.hoistEmpty },
          { axis: 'gantry' as const, to: panel.home.x, profile: k.gantry },
          { axis: 'trolley' as const, to: panel.home.z, profile: k.trolley },
          { axis: 'hoist' as const, to: panel.home.y, profile: k.hoistEmpty },
        ]
      : [
          { axis: 'hoist' as const, to: safe, profile: k.hoistEmpty },
          { axis: 'gantry' as const, to: sx, profile: k.gantry },
          { axis: 'trolley' as const, to: lz, profile: k.trolley },
          { axis: 'hoist' as const, to: laydownTopY(count), profile: k.hoistEmpty },
        ]
  const leg2 =
    op === 'remove'
      ? [
          { axis: 'hoist' as const, to: safe, profile: k.hoistLoaded },
          { axis: 'gantry' as const, to: sx, profile: k.gantry },
          { axis: 'trolley' as const, to: lz, profile: k.trolley },
          { axis: 'hoist' as const, to: laydownTopY(count + 1), profile: k.hoistLoaded },
        ]
      : [
          { axis: 'hoist' as const, to: safe, profile: k.hoistLoaded },
          { axis: 'gantry' as const, to: panel.home.x, profile: k.gantry },
          { axis: 'trolley' as const, to: panel.home.z, profile: k.trolley },
          { axis: 'hoist' as const, to: panel.home.y, profile: k.hoistLoaded },
        ]
  return { leg1, leg2, sx }
}

/** Handling time (s) added on each side of the carry so a hatch move takes the cycle time (0 in the instant mode). */
function padOf(ctx: EngineContext, sts: StsState, panel: HatchPanelState, op: 'remove' | 'replace', siteId: string): number {
  if (isInstant(ctx)) return 0
  const k = stsKinematics(ctx)
  const { leg1, leg2 } = legs(ctx, panel, op, siteId)
  const dry = { ...sts }
  const a = planSequence(dry, 0, 1, leg1)
  const b = planSequence(dry, a.end, 1, leg2)
  return Math.max(0, (settingsOf(ctx, panel).cycleS - b.end - k.lockS - k.unlockS) / 2)
}

/** A hatch move ends: the crane carries on with its next package (the package completes on the next call). */
function finishMove(ctx: EngineContext, sts: StsState, segments: MotionSegment[], end: number, startedAt: number): void {
  const kpi = ctx.state.kpis.perSts[sts.id]
  kpi.lastMoveEndS = end
  const k = hatchKpi(ctx, sts.id)
  const total = hatchTotals(ctx)
  k.moves++
  k.timeS += end - startedAt
  total.stsTimeS += end - startedAt
  sts.hatchJob = null
  sts.status = 'returning'
  continueWork(ctx, sts, end, segments)
}

export const hatchReactors: ReactorMap = {
  StsHatchStarted: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const job = sts.hatchJob as HatchJob
    const panel = state.hatchPanels[e.payload.panelId]
    const kpi = state.kpis.perSts[sts.id]
    if (job.op === 'remove' && panel.status === 'secured') {
      job.waiting = true
      waitForHatch(ctx, sts, panel.id, 'lashing', e.t)
      return
    }
    job.siteId ??= claimLaydown(ctx, panel)
    if (job.op === 'replace' && state.hatchLaydown[job.siteId]?.panelIds.slice(-1)[0] !== panel.id)
      throw new Error(`${panel.id} is not on top of laydown bay ${job.siteId}`)
    const { leg1, sx } = legs(ctx, panel, job.op, job.siteId)
    const blockedBy = reserveRail(state, config, sts, job.op === 'remove' ? panel.home.x : sx, job.op === 'remove' ? sx : panel.home.x)
    if (blockedBy !== null) {
      sts.status = 'waiting-for-rail'
      sts.railTargetX = job.op === 'remove' ? panel.home.x : sx
      sts.railAlsoX = job.op === 'remove' ? sx : panel.home.x
      kpi.railWaitSince ??= e.t
      ctx.schedule('StsWaitingForRail', e.t, { equipment: [sts.id], vessels: [panel.vesselId] }, {
        stsId: sts.id,
        targetX: sts.railTargetX,
        blockedBy,
      })
      return
    }
    if (kpi.railWaitSince !== null) {
      kpi.railWaitS += e.t - kpi.railWaitSince
      kpi.railWaitSince = null
    }
    endWait(ctx, sts, e.t)
    job.startedAt = e.t
    job.padS = padOf(ctx, sts, panel, job.op, job.siteId)
    kpi.firstMoveStartS ??= e.t
    sts.status = 'moving-to-pick'
    const k = stsKinematics(ctx)
    const { segments, end } = planSequence(sts, e.t, variation(ctx), leg1, isInstant(ctx))
    ctx.schedule('HatchLifted', end + k.lockS + job.padS, { equipment: [sts.id, panel.id], vessels: [panel.vesselId] }, {
      stsId: sts.id,
      vesselId: panel.vesselId,
      panelId: panel.id,
      from: job.op === 'remove' ? 'hatch' : 'laydown',
      weightT: panel.weightT,
      segments,
    })
  },

  StsWaitingForHatch: () => undefined,

  /** Lashing released: a crane waiting to remove the panel goes on. */
  HatchLashingReleased: (e, ctx) => {
    const { state } = ctx
    const panel = state.hatchPanels[e.payload.panelId]
    panel.status = 'unsecured'
    panel.lashingReleasedAt = e.t
    for (const sts of Object.values(state.sts)) {
      if (sts.hatchJob?.panelId !== panel.id || !sts.hatchJob.waiting) continue
      sts.hatchJob.waiting = false
      endWait(ctx, sts, e.t)
      if (sts.status === 'idle') continueWork(ctx, sts, e.t)
    }
  },

  /** Spreader locked on the panel and lifted: carry it to the laydown (removal) or back to its hatch (replacement). */
  HatchLifted: (e, ctx) => {
    const { state } = ctx
    const sts = state.sts[e.payload.stsId]
    const job = sts.hatchJob as HatchJob
    const panel = state.hatchPanels[e.payload.panelId]
    panel.status = 'lifted'
    panel.liftedAt = e.t
    panel.stsId = sts.id
    sts.carryingPanel = panel.id
    if (job.op === 'replace') {
      // off the stack: the next panel below becomes the top
      const site = state.hatchLaydown[job.siteId as string]
      site.panelIds.pop()
    }
    const { leg2 } = legs(ctx, panel, job.op, job.siteId as string)
    const k = stsKinematics(ctx)
    sts.status = 'carrying'
    const { segments, end } = planSequence(sts, e.t, variation(ctx), leg2, isInstant(ctx))
    const at = end + k.unlockS + job.padS
    if (job.op === 'remove') {
      const level = stackCount(ctx, job.siteId as string)
      ctx.schedule('HatchSetInLaydown', at, { equipment: [sts.id, panel.id], vessels: [panel.vesselId] }, {
        stsId: sts.id,
        vesselId: panel.vesselId,
        panelId: panel.id,
        siteId: job.siteId as string,
        level,
        x: siteX(ctx, job.siteId as string),
        segments,
      })
    } else {
      ctx.schedule('HatchReplaced', at, { equipment: [sts.id, panel.id], vessels: [panel.vesselId] }, {
        stsId: sts.id,
        vesselId: panel.vesselId,
        panelId: panel.id,
        hatch: { ...job.target },
        segments,
      })
    }
  },

  HatchSetInLaydown: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const job = sts.hatchJob as HatchJob
    const panel = state.hatchPanels[e.payload.panelId]
    const site = (state.hatchLaydown[e.payload.siteId] ??= { id: e.payload.siteId, x: e.payload.x, panelIds: [] })
    site.panelIds.push(panel.id)
    panel.status = 'in-laydown'
    panel.siteId = site.id
    panel.level = e.payload.level
    panel.pos = { x: site.x, y: laydownTopY(e.payload.level + 1), z: laydownCentreZ(config, panel.widthM) }
    panel.stsId = null
    sts.carryingPanel = null
    hatchTotals(ctx).removes++
    releaseRail(sts)
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: config.kinematics.sts.hoistEmpty },
    ], isInstant(ctx))
    finishMove(ctx, sts, segments, end, job.startedAt ?? e.t)
    wakeQuayRail(ctx)
  },

  HatchReplaced: (e, ctx) => {
    const { state, config } = ctx
    const sts = state.sts[e.payload.stsId]
    const job = sts.hatchJob as HatchJob
    const panel = state.hatchPanels[e.payload.panelId]
    const target = state.hatchPanels[hatchPanelId(e.payload.hatch.vesselId, e.payload.hatch.bay, e.payload.hatch.index)] ?? panel
    panel.status = 'replaced'
    panel.placedOn = { ...e.payload.hatch }
    panel.pos = { ...target.home }
    panel.siteId = null
    panel.level = null
    panel.stsId = null
    sts.carryingPanel = null
    hatchTotals(ctx).replaces++
    releaseRail(sts)
    const delay = delayS(ctx, settingsOf(ctx, panel).lashingSecureS)
    ctx.schedule('HatchSecured', e.t + delay, { vessels: [panel.vesselId], equipment: [panel.id] }, {
      vesselId: panel.vesselId,
      bay: panel.bay,
      panelId: panel.id,
      delayS: delay,
    })
    const { segments, end } = planSequence(sts, e.t, variation(ctx), [
      { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: config.kinematics.sts.hoistEmpty },
    ], isInstant(ctx))
    finishMove(ctx, sts, segments, end, job.startedAt ?? e.t)
    wakeQuayRail(ctx)
  },

  /** Panel secured: a crane waiting to load deck boxes onto the bay's hatch goes on. */
  HatchSecured: (e, ctx) => {
    const { state } = ctx
    const panel = state.hatchPanels[e.payload.panelId]
    panel.status = 'secured'
    panel.opens = false
    panel.lashingScheduled = false
    panel.lashingReleasedAt = null
    panel.liftedAt = null
    panel.placedOn = null
    panel.cycles++
    for (const sts of Object.values(state.sts)) {
      if (sts.hatchWaitPanel !== panel.id) continue
      sts.hatchWaitPanel = null
      endWait(ctx, sts, e.t)
      if (sts.status === 'idle') continueWork(ctx, sts, e.t)
    }
  },
}

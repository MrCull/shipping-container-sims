/**
 * STS booms (#298), boom subsystem mode `real` only (mode `off` never reaches this file's motion: every boom stays at
 * the working angle, no segments, no gating, every log unchanged).
 *
 *   t0: every crane boom up (stowed); a crane assigned at t0 (a pre-filled working vessel) starts boom down.
 *   BerthAllocated: every crane over the vessel raises if down; VesselBerthed = later of mooring and those booms up.
 *   First move on a vessel: the crane lowers its boom (`continueWork` in quay.ts).
 *   StsWorkComplete: the crane, now idle, raises (idle cranes stay up until assigned).
 *   VesselWorkComplete: every crane over the vessel raises if down; unmooring ends `unmooringS` after all are up.
 *
 * A free crane over the vessel raises at once. A busy crane (working another vessel) over it is held (`boomHolds`):
 * it finishes its current cycle, raises, waits boom up and lowers again once VesselBerthed or VesselDeparted releases
 * it, then carries on with its own vessel. The vessel event waits for it (`VesselState.boomWait`, `checkBoomWaits`).
 *
 * A raise first hoists the spreader to the crane's lift height and parks the trolley on the backreach (class geometry,
 * `stsParkPose`); hoist and trolley never move while the boom is off the working angle, and the crane never gantries
 * during a transition (status `boom`: it is not asked to step aside). Rail order and spacing ignore the boom angle.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { AxisProfile } from '../kinematics'
import { stsBoom, stsLimits, stsParkPose, type StsState, type VesselState } from '../state'
import { vesselClass } from '../../scenario/vesselClasses'
import { isInstant, planSequence, type StsMove } from './stsMotion'

export const boomReal = (ctx: Pick<EngineContext, 'state'>): boolean => ctx.state.subsystems.boom === 'real'

/** A rest-to-rest profile that turns `spanDeg` degrees in exactly `seconds` (triangular: half accelerating, half braking). */
export function boomProfile(spanDeg: number, seconds: number): AxisProfile {
  const d = Math.max(Math.abs(spanDeg), 1e-9)
  const accel = (4 * d) / (seconds * seconds)
  return { vMax: (2 * d) / seconds, accel, decel: accel }
}

/** The configured raise or lower profile: working to stowed in `transitionS`. */
function configuredBoomProfile(ctx: Pick<EngineContext, 'config'>): AxisProfile {
  const b = stsBoom(ctx.config)
  return boomProfile(b.stowedDeg - b.workingDeg, b.transitionS)
}

/** True when the crane must lower its boom before working (boom mode real, boom not at the working angle). */
export function needsLowering(ctx: EngineContext, sts: StsState): boolean {
  return boomReal(ctx) && sts.boomDeg !== stsBoom(ctx.config).workingDeg
}

/** The park moves before a raise (#298): spreader to the crane's lift height, trolley onto its backreach. */
function parkMoves(ctx: EngineContext, sts: StsState): StsMove[] {
  const k = ctx.config.kinematics.sts
  const park = stsParkPose(ctx.config, sts.id)
  return [
    { axis: 'hoist', to: park.hoistY, profile: k.hoistEmpty },
    { axis: 'trolley', to: park.trolleyZ, profile: k.trolley },
  ]
}

/**
 * Start a raise or lower at `at` (now or the end of the crane's planned motion). The segments are planned here so the
 * end time (`boomUntil`) is known at once; StsBoomStarted makes them the crane's live motion.
 */
export function startBoom(ctx: EngineContext, sts: StsState, at: number, op: 'raise' | 'lower'): void {
  const b = stsBoom(ctx.config)
  const profile = configuredBoomProfile(ctx)
  const moves: StsMove[] =
    op === 'raise' ? [...parkMoves(ctx, sts), { axis: 'boom', to: b.stowedDeg, profile }] : [{ axis: 'boom', to: b.workingDeg, profile }]
  const live = sts.motion
  const { segments, end } = planSequence(sts, at, 1, moves, isInstant(ctx))
  // the motion still under way (a cycle's last hoist) stays live; the boom segments follow it, so the angle before them is known
  sts.motion = [...live, ...segments]
  sts.boomUntil = end
  sts.status = 'boom'
  ctx.schedule('StsBoomStarted', at, { equipment: [sts.id] }, { stsId: sts.id, op, toDeg: sts.boomDeg ?? b.workingDeg, segments })
}

/** True when the crane body (`stsMinSpacingM` long, centred on the gantry, over its rail reservation) overlaps the vessel's stretch widened by the clearance margin. */
export function craneOverVessel(ctx: Pick<EngineContext, 'config'>, sts: StsState, vessel: VesselState): boolean {
  if (vessel.berthX === null) return false
  const half = ctx.config.quay.stsMinSpacingM / 2
  const margin = stsBoom(ctx.config).clearanceMarginM
  const lo = vessel.berthX - margin
  const hi = vessel.berthX + vesselClass(vessel.sizeClass).loaM + margin
  return sts.railLo - half < hi && sts.railHi + half > lo
}

/** True while a vessel mooring or unmooring under this busy crane holds its boom up (#297 review). */
export const boomHeld = (sts: StsState): boolean => (sts.boomHolds?.length ?? 0) > 0

/**
 * Raise the booms over `vessel`. Free cranes that are down raise now; busy cranes are held (they raise after their
 * current cycle). Returns when the last free crane is up (`now` when none is raising), or null when a busy crane is
 * held and the vessel must wait for it.
 */
function raiseOver(ctx: EngineContext, vessel: VesselState): number | null {
  const { state } = ctx
  const b = stsBoom(ctx.config)
  let ready = state.now
  let held = false
  for (const sts of Object.values(state.sts)) {
    if (!craneOverVessel(ctx, sts, vessel)) continue
    if (sts.vesselId !== null) {
      const holds = (sts.boomHolds ??= [])
      if (!holds.includes(vessel.id)) holds.push(vessel.id)
      held = true
      // idle between cycles (waiting for a package release, or held already): raise now
      if (sts.status === 'idle' && sts.boomDeg !== b.stowedDeg) startBoom(ctx, sts, state.now, 'raise')
      continue
    }
    if (sts.boomDeg !== b.stowedDeg && sts.status === 'idle') startBoom(ctx, sts, state.now, 'raise')
    if (sts.boomDeg === b.stowedDeg) ready = Math.max(ready, sts.boomUntil ?? state.now)
  }
  return held ? null : ready
}

type VesselBoomEvent = 'VesselBerthed' | 'VesselDeparted'

function scheduleVesselEvent(ctx: EngineContext, vessel: VesselState, event: VesselBoomEvent, at: number): void {
  if (event === 'VesselBerthed') ctx.schedule('VesselBerthed', at, { vessels: [vessel.id] }, { vesselId: vessel.id, berthX: vessel.berthX ?? 0 })
  else ctx.schedule('VesselDeparted', at, { vessels: [vessel.id] }, { vesselId: vessel.id })
}

/**
 * Schedule VesselBerthed or VesselDeparted once every boom over the vessel is up: `delayS` after the booms are up and
 * never before `notBefore`. Boom mode off: at `max(notBefore, now + delayS)`.
 */
export function whenBoomsUp(ctx: EngineContext, vessel: VesselState, event: VesselBoomEvent, notBefore: number, delayS: number): void {
  const up = boomReal(ctx) ? raiseOver(ctx, vessel) : ctx.state.now
  if (up !== null) {
    scheduleVesselEvent(ctx, vessel, event, Math.max(notBefore, up + delayS))
    return
  }
  vessel.boomWait = { event, notBefore, delayS, upAt: Math.max(ctx.state.now, upOfFree(ctx, vessel)) }
  checkBoomWaits(ctx)
}

/** When the free cranes raised over `vessel` are up (the held ones are tracked by `boomHolds`). */
function upOfFree(ctx: EngineContext, vessel: VesselState): number {
  let up = ctx.state.now
  for (const sts of Object.values(ctx.state.sts))
    if (sts.vesselId === null && craneOverVessel(ctx, sts, vessel)) up = Math.max(up, sts.boomUntil ?? up)
  return up
}

/** Schedule the vessel event of every vessel waiting for held busy cranes whose booms are now all up. */
export function checkBoomWaits(ctx: EngineContext): void {
  const { state } = ctx
  const stowed = stsBoom(ctx.config).stowedDeg
  for (const vessel of Object.values(state.vessels)) {
    const wait = vessel.boomWait
    if (!wait) continue
    const holders = Object.values(state.sts).filter((s) => s.boomHolds?.includes(vessel.id))
    if (holders.some((s) => s.status === 'boom' || s.boomDeg !== stowed || (s.boomUntil ?? 0) > state.now)) continue
    delete vessel.boomWait
    scheduleVesselEvent(ctx, vessel, wait.event, Math.max(wait.notBefore, Math.max(wait.upAt, state.now) + wait.delayS))
  }
}

/** VesselBerthed or VesselDeparted: release the busy cranes held for `vesselId`; each lowers and carries on with its work. */
export function releaseBoomHolds(ctx: EngineContext, vesselId: string, resume: (sts: StsState) => void): void {
  for (const sts of Object.values(ctx.state.sts)) {
    if (!sts.boomHolds?.includes(vesselId)) continue
    sts.boomHolds = sts.boomHolds.filter((id) => id !== vesselId)
    if (sts.boomHolds.length === 0) delete sts.boomHolds
    if (sts.status === 'idle' && sts.vesselId !== null) resume(sts)
  }
}

const ON_QUAY = new Set(['mooring', 'berthed', 'unmooring'])

/**
 * #302: the first vessel on the quay whose superstructure (accommodation block X range) lies on the gantry path
 * `[fromX, toX]` and is taller than the lowered boom can clear (boom underside below air draft plus clearance), or
 * null. The boom is taken as a line at the gantry position [A].
 */
export function superstructureOnPath(
  ctx: Pick<EngineContext, 'state' | 'config'>,
  fromX: number,
  toX: number,
  stsId?: string,
): VesselState | null {
  const b = stsBoom(ctx.config)
  // #303: each crane class has its own boom underside height.
  const undersideM = stsId === undefined ? b.undersideM : stsLimits(ctx.config, stsId).boomUndersideM
  const lo = Math.min(fromX, toX)
  const hi = Math.max(fromX, toX)
  for (const v of Object.values(ctx.state.vessels)) {
    if (v.berthX === null || !ON_QUAY.has(v.status)) continue
    const s = vesselClass(v.sizeClass).superstructure
    if (undersideM >= s.airDraftM + b.superstructureClearanceM) continue
    if (lo <= v.berthX + s.houseToM && hi >= v.berthX + s.houseFromM) return v
  }
  return null
}

/**
 * #302: a work cycle's moves (spreader to travel height first, then the gantry move) adjusted for a superstructure on
 * the gantry path: park the trolley, raise, gantry boom up, lower, then the rest. Boom mode off, a boom not at the
 * working angle or a clear path: the moves unchanged.
 */
export function passSuperstructure(ctx: EngineContext, sts: StsState, moves: StsMove[]): StsMove[] {
  const g = moves.findIndex((m) => m.axis === 'gantry')
  if (g < 0 || !crossing(ctx, sts, moves[g].to)) return moves
  const b = stsBoom(ctx.config)
  const profile = configuredBoomProfile(ctx)
  return [
    ...moves.slice(0, g),
    ...parkMoves(ctx, sts),
    { axis: 'boom', to: b.stowedDeg, profile },
    moves[g],
    { axis: 'boom', to: b.workingDeg, profile },
    ...moves.slice(g + 1),
  ]
}

/** #302: the superstructure a lowered boom would hit on the gantry move to `targetX` (boom mode real, boom down), or null. */
function crossing(ctx: EngineContext, sts: StsState, targetX: number): VesselState | null {
  if (!boomReal(ctx) || needsLowering(ctx, sts)) return null
  return superstructureOnPath(ctx, sts.gantryX, targetX, sts.id)
}

/** #302: the vessel whose superstructure blocks the gantry move to `targetX` when `canGantryWithBoomRaised` is false, or null. */
export function gantryBlockedBy(ctx: EngineContext, sts: StsState, targetX: number): string | null {
  if (stsBoom(ctx.config).canGantryWithBoomRaised) return null
  return crossing(ctx, sts, targetX)?.id ?? null
}

/** StsBoomCompleted lives in quay.ts (it resumes the crane's work), so this file never imports quay.ts. */
export const boomReactors: ReactorMap = {
  StsGantryBlocked: () => undefined,

  StsBoomStarted: (e, ctx) => {
    const sts = ctx.state.sts[e.payload.stsId]
    sts.motion = e.payload.segments
    ctx.schedule('StsBoomCompleted', sts.boomUntil ?? e.t, { equipment: [sts.id] }, {
      stsId: sts.id,
      op: e.payload.op,
      boomDeg: sts.boomDeg ?? stsBoom(ctx.config).workingDeg,
    })
  },
}

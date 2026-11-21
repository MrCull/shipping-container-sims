/**
 * STS booms (#298), boom subsystem mode `real` only (mode `off` never reaches this file's motion: every boom stays at
 * the working angle, no segments, no gating, every log unchanged).
 *
 *   t0: every crane boom up (stowed); a crane assigned at t0 (a pre-filled working vessel) starts boom down.
 *   BerthAllocated: idle cranes over the vessel raise if down; VesselBerthed = later of mooring and those booms up.
 *   First move on a vessel: the crane lowers its boom (`continueWork` in quay.ts).
 *   StsWorkComplete: the crane, now idle, raises (idle cranes stay up until assigned).
 *   VesselWorkComplete: idle cranes over the vessel raise if down; unmooring ends `unmooringS` after all are up.
 *
 * A raise first hoists the spreader to its travel height and parks the trolley at the first ground lane (landside of
 * the boom hinge); hoist and trolley never move while the boom is off the working angle, and the crane never gantries
 * during a transition (status `boom`: it is not asked to step aside). Rail order and spacing ignore the boom angle.
 */
import type { EngineContext, ReactorMap } from '../context'
import type { AxisProfile } from '../kinematics'
import { stsBoom, type StsState, type VesselState } from '../state'
import { vesselClass } from '../../scenario/vesselClasses'
import { continueWork, isInstant, planSequence, wakeQuayRail } from './quay'

export const boomReal = (ctx: Pick<EngineContext, 'state'>): boolean => ctx.state.subsystems.boom === 'real'

/** A rest-to-rest profile that turns `spanDeg` degrees in exactly `seconds` (triangular: half accelerating, half braking). */
export function boomProfile(spanDeg: number, seconds: number): AxisProfile {
  const d = Math.max(Math.abs(spanDeg), 1e-9)
  const accel = (4 * d) / (seconds * seconds)
  return { vMax: (2 * d) / seconds, accel, decel: accel }
}

/** True when the crane must lower its boom before working (boom mode real, boom not at the working angle). */
export function needsLowering(ctx: EngineContext, sts: StsState): boolean {
  return boomReal(ctx) && (sts.boomDeg ?? 0) !== stsBoom(ctx.config).workingDeg
}

/**
 * Start a raise or lower at `at` (now or the end of the crane's planned motion). The segments are planned here so the
 * end time (`boomUntil`) is known at once; StsBoomStarted makes them the crane's live motion.
 */
export function startBoom(ctx: EngineContext, sts: StsState, at: number, op: 'raise' | 'lower'): void {
  const { config } = ctx
  const b = stsBoom(config)
  const profile = boomProfile(b.stowedDeg - b.workingDeg, b.transitionS)
  const k = config.kinematics.sts
  const moves: Parameters<typeof planSequence>[3] =
    op === 'raise'
      ? [
          { axis: 'hoist', to: config.layout.stsSafeHoistM, profile: k.hoistEmpty },
          { axis: 'trolley', to: config.layout.stsGroundLaneZ0M, profile: k.trolley },
          { axis: 'boom', to: b.stowedDeg, profile },
        ]
      : [{ axis: 'boom', to: b.workingDeg, profile }]
  const live = sts.motion
  const { segments, end } = planSequence(sts, at, 1, moves, isInstant(ctx))
  sts.motion = live
  sts.boomUntil = end
  sts.status = 'boom'
  ctx.schedule('StsBoomStarted', at, { equipment: [sts.id] }, { stsId: sts.id, op, toDeg: sts.boomDeg ?? 0, segments })
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

/**
 * Raise the booms of the free cranes over `vessel` that are down and return when the last of them is up (`now` when
 * none is raising). Cranes working another vessel are left alone (they are over their own vessel).
 */
export function raiseOver(ctx: EngineContext, vessel: VesselState): number {
  const { state } = ctx
  const b = stsBoom(ctx.config)
  let ready = state.now
  for (const sts of Object.values(state.sts)) {
    if (sts.vesselId !== null || !craneOverVessel(ctx, sts, vessel)) continue
    if ((sts.boomDeg ?? 0) !== b.stowedDeg && sts.status === 'idle') startBoom(ctx, sts, state.now, 'raise')
    if ((sts.boomDeg ?? 0) === b.stowedDeg) ready = Math.max(ready, sts.boomUntil ?? state.now)
  }
  return ready
}

export const boomReactors: ReactorMap = {
  StsBoomStarted: (e, ctx) => {
    const sts = ctx.state.sts[e.payload.stsId]
    sts.motion = e.payload.segments
    ctx.schedule('StsBoomCompleted', sts.boomUntil ?? e.t, { equipment: [sts.id] }, {
      stsId: sts.id,
      op: e.payload.op,
      boomDeg: sts.boomDeg ?? 0,
    })
  },

  StsBoomCompleted: (e, ctx) => {
    const sts = ctx.state.sts[e.payload.stsId]
    sts.status = 'idle'
    // assigned to a vessel meanwhile: lower (if it was raising) and start work
    if (sts.vesselId) continueWork(ctx, sts, e.t)
    wakeQuayRail(ctx)
  },
}

/**
 * STS motion planning shared by the quay cycle (`quay.ts`), hatch moves (`hatch.ts`) and booms (`boom.ts`): one module
 * all three import, so neither `quay.ts` nor `boom.ts` imports the other's planner.
 */
import type { EngineContext } from '../context'
import { planSegment, type Axis, type AxisProfile, type MotionSegment } from '../kinematics'
import type { StsState } from '../state'

/** One planned STS axis move. */
export type StsMove = { axis: Axis; to: number; profile: AxisProfile }

/** Quay mode instant: crane motions, locks and unlocks take no time (same events, zero durations). */
export const isInstant = (ctx: Pick<EngineContext, 'state'>): boolean => ctx.state.subsystems.quay === 'instant'

/** Scale a profile so every travel time is multiplied by `f`. */
function scaled(p: AxisProfile, f: number): AxisProfile {
  return { vMax: p.vMax / f, accel: p.accel / (f * f), decel: p.decel / (f * f) }
}

/**
 * Plan sequential axis moves starting at `t0`; updates the crane's axis
 * positions and live `motion`. Returns the segments and the end time.
 */
export function planSequence(
  sts: StsState,
  t0: number,
  f: number,
  moves: StsMove[],
  instant = false,
): { segments: MotionSegment[]; end: number } {
  const segments: MotionSegment[] = []
  let t = t0
  for (const m of moves) {
    if (m.axis === 'boom') {
      // #298: boom moves are planned only in boom mode real, where every crane has a boom angle
      const from = sts.boomDeg
      if (from === undefined) throw new Error(`${sts.id}: boom move planned without a boom angle (boom mode off)`)
      if (from === m.to) continue
      const seg = planSegment(sts.id, 'boom', from, m.to, t, scaled(m.profile, f))
      if (instant) seg.t1 = seg.t0
      segments.push(seg)
      sts.boomDeg = m.to
      sts.boomUntil = seg.t1
      t = seg.t1
      continue
    }
    const key = m.axis === 'gantry' ? 'gantryX' : m.axis === 'trolley' ? 'trolleyZ' : 'hoistY'
    if (sts[key] === m.to) continue
    const seg = planSegment(sts.id, m.axis, sts[key], m.to, t, scaled(m.profile, f))
    if (instant) seg.t1 = seg.t0 // quay mode instant: the move happens at once
    segments.push(seg)
    sts[key] = m.to
    t = seg.t1
  }
  sts.motion = segments
  return { segments, end: t }
}

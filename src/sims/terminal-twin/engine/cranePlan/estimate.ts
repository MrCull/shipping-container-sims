/**
 * Package time estimator (#288), pure. Duration = moves times the nominal STS cycle, plus the hatch cycle for a
 * hatch package, plus gantry travel between consecutive bays. It ignores horizontal transport delays, so it is an
 * optimistic lower bound. One function serves plan making and recalculation.
 */
import { travelTime, type AxisProfile } from '../kinematics'
import type { PackageTime, PlanPackage } from './types'

export interface EstimatorParams {
  /** Nominal STS cycle (s per move). */
  cycleS: number
  /** Seconds of one hatch cover move. */
  hatchCycleS: number
  gantry: AxisProfile
}

/** Predicted times for the packages in order, for a crane standing at `from.x` at `from.s`. */
export function estimateTimes(
  params: EstimatorParams,
  from: { x: number; s: number },
  packages: readonly Pick<PlanPackage, 'kind' | 'moves' | 'bayX'>[],
): PackageTime[] {
  let t = from.s
  let x = from.x
  return packages.map((p) => {
    if (Math.abs(p.bayX - x) > 1e-9) t += travelTime(p.bayX - x, params.gantry)
    x = p.bayX
    const startS = t
    t += p.kind === 'hatch-remove' || p.kind === 'hatch-replace' ? params.hatchCycleS : p.moves * params.cycleS
    return { startS, endS: t }
  })
}

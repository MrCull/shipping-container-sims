/**
 * Predicted ready times (TT-R13): when a box is expected to be physically available for an SHC to collect.
 *
 * The quay subsystem publishes them for upcoming STS ground-position boxes (`predictedGroundings`: the planned
 * set-down of boxes in flight, exact, and the next boxes of the crane's work packages, estimated from the nominal cycle
 * plus the hatch cycle where a hatch package comes first). The ASC subsystem publishes them for WTP pad work
 * (`predictedPadReady`: the planned set-down of an export box retrieved from the stack, exact). SHC pre-dispatch
 * (`subsystems/shc.ts`) reads the union; it never claims a job from a prediction, so no box is collected before it exists.
 */
import type { EngineContext } from './context'
import { predictedGroundings } from './subsystems/quay'
import { predictedPadReady } from './subsystems/asc'

export interface PredictedReady {
  source: 'sts' | 'asc'
  /** The STS (source 'sts') or yard block (source 'asc') the box becomes ready at. */
  ownerId: string
  /** Sim time the box is expected to be collectable. */
  readyAt: number
  containerId: string | null
  /** True when the time is a planned event (known), false when estimated from nominal cycles. */
  exact: boolean
}

/** Every prediction now, soonest first (ties by owner id). */
export function predictedReady(ctx: Pick<EngineContext, 'state' | 'config'>): PredictedReady[] {
  return [...predictedGroundings(ctx), ...predictedPadReady(ctx)].sort(
    (a, b) => a.readyAt - b.readyAt || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0),
  )
}

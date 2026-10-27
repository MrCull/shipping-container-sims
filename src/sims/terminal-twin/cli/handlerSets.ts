/**
 * Named handler sets selectable with `--handlers` on the CLI.
 * `broken-*` sets are deliberately wrong and exist to prove that the
 * invariant checker and failure exit codes work.
 */
import type { HandlerSet } from '../engine'

export const handlerSets: Record<string, Partial<HandlerSet>> = {
  default: {},
  /** Valid alternative strategy (for run diffs): highest free lane instead of lowest. */
  'highest-free-lane': {
    stsGroundPosition: (req) => ({
      groundPositionId: [...req.groundPositions].reverse().find((gp) => gp.occupiedBy === null)?.id ?? null,
    }),
  },
  /** Always answers ground position lane 1, even when it is occupied. */
  'broken-first-lane': {
    stsGroundPosition: (req) => ({ groundPositionId: req.groundPositions[0].id }),
  },
}

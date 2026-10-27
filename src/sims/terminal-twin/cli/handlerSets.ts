/**
 * Named handler sets selectable with `--handlers` on the CLI.
 * `broken-*` sets are deliberately wrong and exist to prove that the
 * invariant checker and failure exit codes work.
 */
import type { HandlerSet } from '../engine'

export const handlerSets: Record<string, Partial<HandlerSet>> = {
  default: {},
  /** Always answers ground position lane 1, even when it is occupied. */
  'broken-first-lane': {
    stsGroundPosition: (req) => ({ groundPositionId: req.groundPositions[0].id }),
  },
}

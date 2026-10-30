/**
 * Named handler sets selectable with `--handlers` on the CLI.
 * `broken-*` sets are deliberately wrong and exist to prove that the
 * invariant checker and failure exit codes work.
 */
import { getStrategy, type HandlerSet } from '../engine'

export const handlerSets: Record<string, Partial<HandlerSet>> = {
  default: {},
  /** Valid alternative strategy (for run diffs): highest free lane instead of lowest. */
  'highest-free-lane': { stsGroundPosition: getStrategy('stsGroundPosition', 'highest-free-lane') },
  /** Valid alternative SHC dispatch strategy (TT-05): nearest job, nearest free WTP pad (V11-11: two decision points). */
  'nearest-job': {
    shcDispatch: getStrategy('shcDispatch', 'nearest-job'),
    wtpPadSelection: getStrategy('wtpPadSelection', 'nearest-box'),
  },
  /** Always answers ground position lane 1, even when it is occupied. */
  'broken-first-lane': {
    stsGroundPosition: (msg) => ({ groundPositionId: msg.payload.groundPositions[0].id }),
  },
}

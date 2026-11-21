/**
 * Rendering budget (#326): the most draw calls and triangles one High-quality frame of the TTI Algeciras baseline may
 * cost at each fixed camera of `terminal-twin-render-budget.smoke.ts` (1280x720, run point and poses fixed there).
 *
 * Raising a budget is a reviewed edit in the same PR as the change that makes the scene heavier: say in the PR body
 * what got heavier and why it is worth it. Lower a budget when a change makes the scene lighter, so the room is not
 * spent silently. The counts are deterministic (no frame rate involved), so the tolerance only absorbs rounding-size
 * drift, not a new feature.
 */
import type { RenderCounts } from './renderBudget'

export const RENDER_BUDGET_FILE = 'src/sims/terminal-twin/tests/browser/renderBudget.budget.ts'

/** Allowed overshoot over each budget, as a fraction (0.02 is 2 %). */
export const RENDER_BUDGET_TOLERANCE = 0.02

export const RENDER_BUDGETS: Record<'start' | 'overview' | 'yard-closeup', RenderCounts> = {
  // measured 21 Nov 2026 (#326) on the smoke build, software WebGL, run point and poses as in the spec
  start: { calls: 782, triangles: 1_076_151 },
  overview: { calls: 299, triangles: 392_683 },
  'yard-closeup': { calls: 457, triangles: 716_439 },
}

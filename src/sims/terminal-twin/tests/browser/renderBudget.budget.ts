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
  // measured 21 Nov 2026 (#326) on the smoke build, software WebGL, run point and poses as in the spec; re-measured
  // 22 Nov 2026 for spec #297 (STS booms, crane classes, boom visuals). Overview 299 to 310 calls: 9 from the new crane
  // class and boom detail (#300, #303; 308 with every boom down) and 2 from raised booms. Start (782 to 761 calls) and the
  // yard close-up (457 to 449) got lighter, so their budgets come down to keep the room from being spent silently.
  start: { calls: 761, triangles: 1_078_015 },
  overview: { calls: 310, triangles: 392_463 },
  'yard-closeup': { calls: 449, triangles: 723_029 },
}

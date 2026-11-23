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
  // Re-measured 22 Nov 2026 for #270 (booked boxes stack up their own group in the pre-fill): the baseline yard holds the
  // same 60 % of cells, but booked exports and empties now stand in taller stacks, so more box sides face the cameras.
  // Start 1,078,015 to 1,141,631 triangles (761 to 774 calls), overview 310 to 322 calls, yard close-up 449 to 464 calls
  // and 723,029 to 742,903 triangles. Worth it: it is the yard layout the peak day needs to reach its 75 % target.
  // Re-measured 22 Nov 2026 for spec #309 (#310, one RNG stream per source, engine 0.59.0): no renderer change, but the
  // new per-source draws put different equipment and boxes in view at the fixed run point (sim time 2684 s). Start 761
  // to 797 calls (lod0 boxes 221), yard close-up 449 to 472; overview unchanged at 310.
  // Re-measured 23 Nov 2026 on the merge of #270 and spec #309 (engine 0.60.0): both changes together give start 727
  // calls, overview 324 and yard close-up 436 (smoke build, software WebGL), so start and the close-up come down.
  start: { calls: 727, triangles: 1_127_657 },
  overview: { calls: 324, triangles: 394_343 },
  'yard-closeup': { calls: 436, triangles: 729_441 },
}

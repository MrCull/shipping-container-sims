/**
 * Rendering-budget guard (#326), the pure part: compares the draw calls and triangles one frame drew at a fixed camera
 * with that camera's budget and words the failure. The smoke spec `terminal-twin-render-budget.smoke.ts` measures;
 * the budgets live in `renderBudget.budget.ts`. Unit test: `tests/render-budget.test.ts`.
 */

export interface RenderCounts {
  calls: number
  triangles: number
}

/** One message per count over `budget * (1 + tolerance)`; empty when the frame is within budget. */
export function renderBudgetFailures(camera: string, measured: RenderCounts, budget: RenderCounts, tolerance: number, file: string): string[] {
  const counts: [keyof RenderCounts, string][] = [
    ['calls', 'draw calls'],
    ['triangles', 'triangles'],
  ]
  const failures: string[] = []
  for (const [key, label] of counts) {
    const allowed = Math.floor(budget[key] * (1 + tolerance))
    if (measured[key] <= allowed) continue
    failures.push(
      `${camera}: ${measured[key]} ${label} is over the budget of ${budget[key]} (+${Math.round(tolerance * 100)} % tolerance allows ${allowed}). ` +
        `A heavier scene is a reviewed change: raise the budget in ${file} in the same PR.`,
    )
  }
  return failures
}

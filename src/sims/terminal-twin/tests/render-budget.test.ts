/** #326 rendering-budget guard, the pure part: which counts are over budget and what the failure says. */
import { describe, expect, it } from 'vitest'
import { renderBudgetFailures } from './browser/renderBudget'

const FILE = 'src/sims/terminal-twin/tests/browser/renderBudget.budget.ts'
const budget = { calls: 800, triangles: 1_000_000 }

describe('renderBudgetFailures', () => {
  it('passes counts at or under the budget plus its tolerance', () => {
    expect(renderBudgetFailures('overview', { calls: 800, triangles: 1_000_000 }, budget, 0.02, FILE)).toEqual([])
    expect(renderBudgetFailures('overview', { calls: 816, triangles: 1_020_000 }, budget, 0.02, FILE)).toEqual([])
  })

  it('names the camera, the measured value, the budget and the file to edit for each count over it', () => {
    const failures = renderBudgetFailures('yard-closeup', { calls: 817, triangles: 1_020_001 }, budget, 0.02, FILE)
    expect(failures).toEqual([
      `yard-closeup: 817 draw calls is over the budget of 800 (+2 % tolerance allows 816). A heavier scene is a reviewed change: raise the budget in ${FILE} in the same PR.`,
      `yard-closeup: 1020001 triangles is over the budget of 1000000 (+2 % tolerance allows 1020000). A heavier scene is a reviewed change: raise the budget in ${FILE} in the same PR.`,
    ])
  })
})

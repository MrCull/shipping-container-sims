// Run: node --test scripts/test-smoke-budget.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_BUDGET_S, GROUP_BUDGETS_S, budgetFor, groupOfTags, overBudget, overBudgetLine } from './smoke-budget.mjs'

test('the default is the 30 s repo limit; yardshift has a 10 s override', () => {
  assert.equal(DEFAULT_BUDGET_S, 30)
  assert.equal(GROUP_BUDGETS_S.yardshift, 10)
  assert.deepEqual(budgetFor('yardshift'), { seconds: 10, source: 'yardshift' })
  assert.deepEqual(budgetFor('camera'), { seconds: 30, source: 'repo limit' })
  assert.deepEqual(budgetFor(null), { seconds: 30, source: 'repo limit' })
})

test('a group override never exceeds the repo limit', () => {
  for (const s of Object.values(GROUP_BUDGETS_S)) assert.ok(s <= DEFAULT_BUDGET_S)
})

test('the group of a test is its one group tag; other tags are ignored', () => {
  assert.equal(groupOfTags(['@load', '@yardshift']), 'yardshift')
  assert.equal(groupOfTags(['@load']), null)
  assert.equal(groupOfTags(undefined), null)
})

test('over budget: strictly over its group budget, slowest first, with the budget it broke', () => {
  const rows = [
    { file: 'a.smoke.ts', title: 'fast', project: 'dev', ms: 9000, group: 'yardshift' },
    { file: 'a.smoke.ts', title: 'exact', project: 'dev', ms: 10000, group: 'yardshift' },
    { file: 'a.smoke.ts', title: 'slow', project: 'dev', ms: 12345, group: 'yardshift' },
    { file: 'b.smoke.ts', title: 'twenty', project: 'dev', ms: 20000, group: 'camera' },
    { file: 'b.smoke.ts', title: 'long', project: 'prod', ms: 31000, group: 'camera' },
  ]
  const over = overBudget(rows)
  assert.deepEqual(over.map((o) => [o.title, o.budget.seconds]), [['long', 30], ['slow', 10]])
})

test('the line names the spec, the test, the project, the time and the budget', () => {
  const [slow, long] = [
    { file: 'yardshift/tutorial.smoke.ts', title: 'plays the tutorial', project: 'dev', ms: 12345, group: 'yardshift' },
    { file: 'b.smoke.ts', title: 'long', project: 'prod', ms: 31000, group: null },
  ].map((r) => overBudget([r])[0])
  assert.equal(overBudgetLine(slow), 'OVER BUDGET: yardshift/tutorial.smoke.ts > plays the tutorial [dev] 12.3 s, budget 10 s (yardshift)')
  assert.equal(overBudgetLine(long), 'OVER BUDGET: b.smoke.ts > long [prod] 31.0 s, budget 30 s (repo limit)')
})

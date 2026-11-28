/**
 * Smoke test time budgets, in one place: the repo limit for every smoke test (the smoke spec review rules in
 * docs/agents/tooling.md) and tighter per-group targets. A test's time is its duration summed over its attempts.
 *
 * Over budget only warns: the SMOKE line reporter (scripts/smoke-summary-reporter.mjs, local runs) and the CI shard
 * merge (scripts/smoke-merge.mjs) print one `OVER BUDGET:` line per test over its budget, just above the `SMOKE:` line,
 * and never change the exit code. Wall time on a shared 4-core machine or a CI runner is load-sensitive (the same
 * spec measured 4 to 14 s across one spec's tickets), retries add to it, and the review rules let a test over 30 s
 * stay with a comment saying why, so a hard fail would turn timing noise into red runs. Whoever reads the SMOKE line
 * sees the overrun and owns it.
 *
 * Test: node --test scripts/test-smoke-budget.mjs
 */
import { GROUPS } from './smoke-groups.mjs'

/** The repo limit per smoke test, in seconds. */
export const DEFAULT_BUDGET_S = 30

/** Per-group targets in seconds, each at most the repo limit. A group not listed takes the repo limit. */
export const GROUP_BUDGETS_S = {
  yardshift: 10,
}

/** @returns {{ seconds: number, source: string }} `source` is the group name, or `repo limit` */
export function budgetFor(group) {
  const s = group ? GROUP_BUDGETS_S[group] : undefined
  return s === undefined ? { seconds: DEFAULT_BUDGET_S, source: 'repo limit' } : { seconds: s, source: group }
}

/** The smoke group of a test from its Playwright tags (`@yardshift`), or null when none is a group. */
export function groupOfTags(tags) {
  for (const t of tags ?? []) {
    const g = String(t).replace(/^@/, '')
    if (GROUPS.includes(g)) return g
  }
  return null
}

/**
 * Tests strictly over their budget, slowest first.
 * @param {{ file: string, title: string, project: string, ms: number, group: string | null }[]} rows
 */
export function overBudget(rows) {
  return rows
    .map((r) => ({ ...r, budget: budgetFor(r.group) }))
    .filter((r) => r.ms > r.budget.seconds * 1000)
    .sort((a, b) => b.ms - a.ms)
}

/** `OVER BUDGET: <file> > <title> [<project>] 12.3 s, budget 10 s (yardshift)` */
export function overBudgetLine(r) {
  return `OVER BUDGET: ${r.file} > ${r.title} [${r.project}] ${(r.ms / 1000).toFixed(1)} s, budget ${r.budget.seconds} s (${r.budget.source})`
}

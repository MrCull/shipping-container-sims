/**
 * Playwright reporter that ends a smoke run with one line, `SMOKE: <n> passed, <n> failed, <n> flaky, <n> skipped`.
 * A piped run (`... | tail`) loses the exit code; this line does not. Wired in playwright.config.ts.
 * Above it, one `OVER BUDGET:` line per test over its time budget (scripts/smoke-budget.mjs; a warning, the exit code
 * is Playwright's). `summaryLine` is exported for `node --test scripts/test-smoke-summary-reporter.mjs`.
 */
import { relative } from 'node:path'
import { groupOfTags, overBudget, overBudgetLine } from './smoke-budget.mjs'

export function summaryLine(counts) {
  return `SMOKE: ${counts.passed} passed, ${counts.failed} failed, ${counts.flaky} flaky, ${counts.skipped} skipped`
}

export default class SmokeSummaryReporter {
  constructor() {
    /** Last outcome per test id: a retry replaces the earlier attempt. */
    this.last = new Map()
    /** Per test id: file, title, project, group and the time summed over its attempts. */
    this.timing = new Map()
    this.rootDir = ''
  }

  onBegin(config) {
    this.rootDir = config?.rootDir ?? ''
  }

  onTestEnd(test, result) {
    this.last.set(test.id, test.outcome())
    const row = this.timing.get(test.id) ?? {
      file: test.location?.file ? relative(this.rootDir, test.location.file).replaceAll('\\', '/') : '',
      title: test.title ?? test.id,
      project: test.parent?.project?.()?.name ?? '',
      group: groupOfTags(test.tags),
      ms: 0,
    }
    row.ms += result?.duration ?? 0
    this.timing.set(test.id, row)
  }

  onEnd() {
    const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
    for (const outcome of this.last.values()) {
      if (outcome === 'expected') counts.passed++
      else if (outcome === 'unexpected') counts.failed++
      else if (outcome === 'flaky') counts.flaky++
      else counts.skipped++
    }
    for (const r of overBudget([...this.timing.values()])) console.log(overBudgetLine(r))
    console.log(summaryLine(counts))
  }

  printsToStdio() {
    return false
  }
}

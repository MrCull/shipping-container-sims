/**
 * Playwright reporter that ends a smoke run with one line, `SMOKE: <n> passed, <n> failed, <n> flaky, <n> skipped`.
 * A piped run (`... | tail`) loses the exit code; this line does not. Wired in playwright.config.ts.
 * `summaryLine` is exported for `node --test scripts/test-smoke-summary-reporter.mjs`.
 */
export function summaryLine(counts) {
  return `SMOKE: ${counts.passed} passed, ${counts.failed} failed, ${counts.flaky} flaky, ${counts.skipped} skipped`
}

export default class SmokeSummaryReporter {
  constructor() {
    /** Last outcome per test id: a retry replaces the earlier attempt. */
    this.last = new Map()
  }

  onTestEnd(test) {
    this.last.set(test.id, test.outcome())
  }

  onEnd() {
    const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
    for (const outcome of this.last.values()) {
      if (outcome === 'expected') counts.passed++
      else if (outcome === 'unexpected') counts.failed++
      else if (outcome === 'flaky') counts.flaky++
      else counts.skipped++
    }
    console.log(summaryLine(counts))
  }

  printsToStdio() {
    return false
  }
}

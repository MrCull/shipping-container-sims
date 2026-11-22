/**
 * Playwright reporter that appends one JSON line per finished test attempt to `outputFile`, as each attempt ends.
 * A run that times out or is cancelled keeps every line written so far, unlike the JSON reporter, which writes only
 * in onEnd. `scripts/smoke-timing.mjs <file>.jsonl` builds the timing table from it (a half-written last line is
 * skipped). Shards can each write their own file; `cat` them together for one table.
 *
 * Line: {id, file, title, project, status, outcome, retry, ms}. `file` is relative to the test dir (like the JSON
 * report), `status` is this attempt's status, `outcome` the test's outcome so far (expected, unexpected, flaky,
 * skipped), `ms` this attempt's duration.
 *
 * Wired in playwright.config.ts when SMOKE_JSONL_REPORT=<file> is set. Test: node --test scripts/test-smoke-jsonl-reporter.mjs
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, relative } from 'node:path'

export default class SmokeJsonlReporter {
  constructor(options = {}) {
    // Named on the command line (`--reporter=...,./scripts/smoke-jsonl-reporter.mjs`, which replaces the config's reporters) it takes the env file.
    this.outputFile = options.outputFile ?? process.env.SMOKE_JSONL_REPORT
    this.rootDir = ''
  }

  onBegin(config) {
    this.rootDir = config.rootDir ?? ''
    if (this.outputFile) mkdirSync(dirname(this.outputFile), { recursive: true })
  }

  onTestEnd(test, result) {
    if (!this.outputFile) return
    const line = {
      id: test.id,
      file: relative(this.rootDir, test.location.file).replaceAll('\\', '/'),
      title: test.title,
      project: test.parent?.project()?.name ?? '',
      status: result.status,
      outcome: test.outcome(),
      retry: result.retry,
      ms: result.duration,
    }
    appendFileSync(this.outputFile, JSON.stringify(line) + '\n')
  }

  printsToStdio() {
    return false
  }
}

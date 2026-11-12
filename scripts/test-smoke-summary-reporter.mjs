import assert from 'node:assert/strict'
import { test } from 'node:test'
import SmokeSummaryReporter, { summaryLine } from './smoke-summary-reporter.mjs'

test('formats the one-line result', () => {
  assert.equal(summaryLine({ passed: 13, failed: 1, flaky: 0, skipped: 2 }), 'SMOKE: 13 passed, 1 failed, 0 flaky, 2 skipped')
})

test('counts the last outcome of each test', () => {
  const r = new SmokeSummaryReporter()
  const t = (id, outcome) => ({ id, outcome: () => outcome })
  r.onTestEnd(t('a', 'unexpected'))
  r.onTestEnd(t('a', 'flaky')) // the retry passed
  r.onTestEnd(t('b', 'expected'))
  r.onTestEnd(t('c', 'unexpected'))
  r.onTestEnd(t('d', 'skipped'))
  const lines = []
  const log = console.log
  console.log = (s) => lines.push(s)
  try {
    r.onEnd()
  } finally {
    console.log = log
  }
  assert.deepEqual(lines, ['SMOKE: 1 passed, 1 failed, 1 flaky, 1 skipped'])
})

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

test('prints an OVER BUDGET line per test over its group budget, summed over retries, above the SMOKE line', () => {
  const r = new SmokeSummaryReporter()
  r.onBegin({ rootDir: '/repo/src' })
  const t = (id, outcome, tags, title = id) => ({
    id,
    title,
    tags,
    location: { file: `/repo/src/sims/x/${id}.smoke.ts` },
    parent: { project: () => ({ name: 'dev' }) },
    outcome: () => outcome,
  })
  r.onTestEnd(t('tut', 'unexpected', ['@yardshift'], 'plays the tutorial'), { duration: 6000 })
  r.onTestEnd(t('tut', 'flaky', ['@yardshift'], 'plays the tutorial'), { duration: 5000 })
  r.onTestEnd(t('cam', 'expected', ['@camera']), { duration: 12000 })
  const lines = []
  const log = console.log
  console.log = (s) => lines.push(s)
  try {
    r.onEnd()
  } finally {
    console.log = log
  }
  assert.deepEqual(lines, [
    'OVER BUDGET: sims/x/tut.smoke.ts > plays the tutorial [dev] 11.0 s, budget 10 s (yardshift)',
    'SMOKE: 1 passed, 0 failed, 1 flaky, 0 skipped',
  ])
})

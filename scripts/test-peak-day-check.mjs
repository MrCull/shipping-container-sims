// Run: node --test scripts/test-peak-day-check.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgePeakDay, peakDayReport } from './peak-day-check.mjs'

const run = (vesselsCompleted, violations = 0, firstError = null) => ({
  eventLogHash: 'abc',
  kpis: { vesselsCompleted, movesCompleted: 100, simTimeS: 3600 },
  invariants: { violations },
  firstError,
})

test('a run that finishes every vessel cleanly passes', () => {
  assert.deepEqual(judgePeakDay(run(5), 5), [])
})

test('a run that stops idle short of its vessels fails, even with 0 violations', () => {
  assert.deepEqual(judgePeakDay(run(2), 5), ['2 of 5 vessels finished'])
})

test('violations and a first error fail the run', () => {
  const problems = judgePeakDay(run(5, 3, { eventId: 9, t: 12, message: 'yard.no-progress' }), 5)
  assert.equal(problems.length, 2)
  assert.match(problems[1], /event #9 at 12 s: yard\.no-progress/)
})

test('a missing summary (crash or timeout) fails', () => {
  assert.match(judgePeakDay(null, 5)[0], /no summary/)
})

test('the report names the problems, the commit and the run', () => {
  const body = peakDayReport({ problems: ['2 of 5 vessels finished'], summary: run(2), sha: '0123456789', runUrl: 'https://x/run' })
  assert.match(body, /`0123456`/)
  assert.match(body, /- 2 of 5 vessels finished/)
  assert.match(body, /Run: https:\/\/x\/run/)
})

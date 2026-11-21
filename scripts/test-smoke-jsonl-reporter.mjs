// Run: node --test scripts/test-smoke-jsonl-reporter.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import SmokeJsonlReporter from './smoke-jsonl-reporter.mjs'
import { renderTable, rowsOfJsonl } from './smoke-timing.mjs'

const fakeTest = (id, title, file, outcome) => ({
  id,
  title,
  location: { file: `/repo/src/${file}` },
  parent: { project: () => ({ name: 'dev' }) },
  outcome: () => outcome,
})

test('writes one line per finished attempt, before the run ends', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'jsonl-')), 'sub', 'results.jsonl')
  const r = new SmokeJsonlReporter({ outputFile: out })
  r.onBegin({ rootDir: '/repo/src' })
  r.onTestEnd(fakeTest('a', 'opens menu', 'a/ui.smoke.ts', 'expected'), { status: 'passed', duration: 1500, retry: 0 })
  // The run is cancelled here: onEnd never comes. The file already holds the finished test.
  const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(lines, [
    { id: 'a', file: 'a/ui.smoke.ts', title: 'opens menu', project: 'dev', status: 'passed', outcome: 'expected', retry: 0, ms: 1500 },
  ])
})

test('no outputFile: writes nothing and stays quiet', () => {
  const r = new SmokeJsonlReporter({})
  r.onBegin({ rootDir: '/repo/src' })
  r.onTestEnd(fakeTest('a', 't', 'a.smoke.ts', 'expected'), { status: 'passed', duration: 1, retry: 0 })
  assert.equal(r.printsToStdio(), false)
})

test('timing table builds from a partial file cut off mid-line', () => {
  const text = [
    JSON.stringify({ id: 'b', file: 'b/scene.smoke.ts', title: 'draws', project: 'dev', status: 'failed', outcome: 'unexpected', retry: 0, ms: 20000 }),
    JSON.stringify({ id: 'b', file: 'b/scene.smoke.ts', title: 'draws', project: 'dev', status: 'passed', outcome: 'flaky', retry: 1, ms: 15000 }),
    JSON.stringify({ id: 'a', file: 'a/ui.smoke.ts', title: 'opens menu', project: 'dev', status: 'passed', outcome: 'expected', retry: 0, ms: 1500 }),
    '{"id":"c","file":"c.smo', // the job was killed while this line was being written
  ].join('\n')
  assert.deepEqual(rowsOfJsonl(text), [
    { file: 'b/scene.smoke.ts', title: 'draws', project: 'dev', ms: 35000, status: 'flaky' },
    { file: 'a/ui.smoke.ts', title: 'opens menu', project: 'dev', ms: 1500, status: 'expected' },
  ])
  const lines = renderTable(rowsOfJsonl(text), () => '').split('\n')
  assert.match(lines.find((l) => l.startsWith('| b/')), /\| 35\.0 s \(over 30 s\) \| flaky \|/)
})

test('reporter output round-trips through the timing script', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'jsonl-')), 'r.jsonl')
  const r = new SmokeJsonlReporter({ outputFile: out })
  r.onBegin({ rootDir: '/repo/src' })
  r.onTestEnd(fakeTest('a', 'opens menu', 'a/ui.smoke.ts', 'expected'), { status: 'passed', duration: 2500, retry: 0 })
  assert.deepEqual(rowsOfJsonl(readFileSync(out, 'utf8')), [{ file: 'a/ui.smoke.ts', title: 'opens menu', project: 'dev', ms: 2500, status: 'expected' }])
})

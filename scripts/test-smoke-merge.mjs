// Run: node --test scripts/test-smoke-merge.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mergeShards } from './smoke-merge.mjs'

const line = (id, outcome, ms = 1000, retry = 0) =>
  JSON.stringify({ id, file: `${id}.smoke.ts`, title: `t ${id}`, project: 'dev', status: outcome === 'unexpected' ? 'failed' : 'passed', outcome, retry, ms })

/** Six shards of three tests each; shard 4 has one failure, shard 2 one flaky test (failed, then passed on retry). */
function sixShards() {
  const shards = []
  for (let s = 1; s <= 6; s++) {
    const lines = []
    for (let t = 1; t <= 3; t++) {
      const id = `s${s}t${t}`
      if (s === 4 && t === 2) lines.push(line(id, 'unexpected', 5000), line(id, 'unexpected', 5000, 1))
      else if (s === 2 && t === 1) lines.push(line(id, 'unexpected', 2000), line(id, 'flaky', 1000, 1))
      else lines.push(line(id, 'expected', s === 1 && t === 3 ? 31000 : 1000))
    }
    shards.push({ name: `shard-${s}`, text: lines.join('\n') + '\n' })
  }
  return shards
}

test('six shards merge into one summary over every test once; a failure in one shard fails the result', () => {
  const m = mergeShards(sixShards(), { expect: 18 })
  assert.equal(m.summary, 'SMOKE: 16 passed, 1 failed, 1 flaky, 0 skipped')
  assert.equal(m.rows.length, 18)
  assert.equal(m.ok, false)
  assert.deepEqual(m.problems, ['1 test failed'])
})

test('all green with the expected count is ok', () => {
  const shards = [
    { name: 'a', text: line('x', 'expected') + '\n' },
    { name: 'b', text: line('y', 'flaky', 1, 1) + '\n' },
  ]
  const m = mergeShards(shards, { expect: 2 })
  assert.equal(m.summary, 'SMOKE: 1 passed, 0 failed, 1 flaky, 0 skipped')
  assert.equal(m.ok, true)
  assert.deepEqual(m.problems, [])
})

test('a test missing from every shard (a shard cancelled or timed out) fails the result', () => {
  const m = mergeShards([{ name: 'a', text: line('x', 'expected') + '\n' }], { expect: 3 })
  assert.equal(m.ok, false)
  assert.deepEqual(m.problems, ['1 of 3 tests reported (2 missing)'])
})

test('no shard results at all fails the result', () => {
  const m = mergeShards([])
  assert.equal(m.ok, false)
  assert.deepEqual(m.problems, ['no test results'])
})

test('a test reported by two shards is flagged as run twice', () => {
  const m = mergeShards(
    [
      { name: 'a', text: line('x', 'expected') + '\n' },
      { name: 'b', text: line('x', 'expected') + '\n' },
    ],
    { expect: 1 },
  )
  assert.equal(m.ok, false)
  assert.deepEqual(m.problems, ['1 test reported by more than one shard: x.smoke.ts > t x (a, b)'])
})

test('tests over their group budget give OVER BUDGET lines (a warning: the result stays ok)', () => {
  const shards = [{ name: 'a', text: [line('ys', 'expected', 12000), line('cam', 'expected', 12000)].join('\n') + '\n' }]
  const groupOf = (file) => (file === 'ys.smoke.ts' ? 'yardshift' : 'camera')
  const m = mergeShards(shards, { expect: 2, groupOf })
  assert.equal(m.ok, true)
  assert.deepEqual(m.overBudget, ['OVER BUDGET: ys.smoke.ts > t ys [dev] 12.0 s, budget 10 s (yardshift)'])
  assert.deepEqual(mergeShards(shards).overBudget, [], 'with no group known, the 30 s repo limit applies')
})

test('a half-written last line is skipped', () => {
  const m = mergeShards([{ name: 'a', text: line('x', 'expected') + '\n{"id":"y","fi' }])
  assert.equal(m.rows.length, 1)
  assert.equal(m.ok, true)
})

function writeShards(shards) {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-merge-'))
  const files = shards.map((s) => {
    const p = join(dir, `${s.name}.jsonl`)
    writeFileSync(p, s.text)
    return p
  })
  return { dir, files }
}

test('CLI: prints the SMOKE line, appends the timing table with budget flags to --summary, exits 1 on a failure', () => {
  const { dir, files } = writeShards(sixShards())
  const summary = join(dir, 'summary.md')
  let out = ''
  let code = 0
  try {
    execFileSync(process.execPath, ['scripts/smoke-merge.mjs', ...files, '--expect', '18', '--summary', summary], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    out = e.stdout
    code = e.status
  }
  assert.equal(code, 1)
  assert.match(out, /^SMOKE: 16 passed, 1 failed, 1 flaky, 0 skipped$/m)
  assert.match(out, /^smoke-merge: 1 test failed$/m)
  assert.match(out, /^smoke-merge: failed: s4t2\.smoke\.ts > t s4t2$/m)
  assert.match(out, /^smoke-merge: flaky: s2t1\.smoke\.ts > t s2t1$/m)
  assert.match(out.trimEnd().split('\n').at(-1), /^SMOKE: /, 'the SMOKE line is the last line, so a short log tail holds it')
  assert.equal(out.trimEnd().split('\n').at(-2), 'OVER BUDGET: s1t3.smoke.ts > t s1t3 [dev] 31.0 s, budget 30 s (repo limit)')
  const md = readFileSync(summary, 'utf8')
  assert.match(md, /^- `OVER BUDGET: s1t3\.smoke\.ts > t s1t3 \[dev\] 31\.0 s, budget 30 s \(repo limit\)`$/m)
  assert.match(md, /^## Smoke timing$/m)
  assert.match(md, /SMOKE: 16 passed, 1 failed, 1 flaky, 0 skipped/)
  assert.match(md, /1 test over the 30 s budget: s1t3\.smoke\.ts > t s1t3 \(31\.0 s\)/)
  assert.match(md, /Total test time: .* over 18 tests\./)
})

test('CLI: all shards green exits 0', () => {
  const { files } = writeShards([{ name: 'a', text: line('x', 'expected') + '\n' }])
  const out = execFileSync(process.execPath, ['scripts/smoke-merge.mjs', ...files, '--expect', '1'], { encoding: 'utf8' })
  assert.match(out, /^SMOKE: 1 passed, 0 failed, 0 flaky, 0 skipped$/m)
})

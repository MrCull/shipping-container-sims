// Run: node --test scripts/test-smoke-shards.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { assignShards, parseList, shardCountFor, timingsOf, totalMsOf } from './smoke-shards.mjs'

const listLine = (file, title, project = 'dev', describe) =>
  `  [${project}] › ${file}:10:1 › ${describe ? `${describe} › ` : ''}${title}`
const jsonl = (rows) => rows.map(([file, title, ms, project = 'dev']) => JSON.stringify({ id: `${file}${title}`, file, title, project, status: 'passed', outcome: 'expected', retry: 0, ms })).join('\n') + '\n'

/** 30 tests in file order: three slow ones first (as the asset specs sort), then many short ones. */
function sample() {
  const lines = ['Listing tests:']
  const rows = []
  const ms = [240_000, 120_000, 90_000, ...Array.from({ length: 27 }, (_, i) => 5_000 + (i % 5) * 4_000)]
  ms.forEach((t, i) => {
    const file = `sims/a/f${Math.floor(i / 3)}.smoke.ts`
    lines.push(listLine(file, `test ${i}`, 'dev', i % 2 ? 'group' : undefined))
    rows.push([file, `test ${i}`, t])
  })
  lines.push('Total: 30 tests in 10 files')
  return { list: lines.join('\n'), rows }
}

test('parseList keeps the test lines verbatim and keys them by project, file and own title', () => {
  const tests = parseList(['Listing tests:', listLine('a.smoke.ts', 'x', 'dev', 'outer'), listLine('b.prod.smoke.ts', 'y', 'prod'), 'Total: 2 tests in 2 files'].join('\n'))
  assert.equal(tests.length, 2)
  assert.equal(tests[0].line, '[dev] › a.smoke.ts:10:1 › outer › x')
  assert.deepEqual(timingsOf([jsonl([['a.smoke.ts', 'x', 7]])]).get(tests[0].key), 7)
})

test('balances a sample timing set far better than equal-count slices in file order', () => {
  const { list, rows } = sample()
  const tests = parseList(list)
  const { shards } = assignShards(tests, timingsOf([jsonl(rows)]), 6)
  const times = shards.map((s) => s.ms)
  // Longest first: the 240 s test sits alone, the rest fill up to it; no shard is over the longest single test.
  assert.equal(Math.max(...times), 240_000)
  const rest = times.filter((t) => t !== 240_000)
  assert.ok(Math.max(...rest) <= Math.min(...rest) * 1.3, `shards within 30 %: ${rest}`)
})

test('every test lands in exactly one shard, in list order inside a shard', () => {
  const { list, rows } = sample()
  const tests = parseList(list)
  const { shards } = assignShards(tests, timingsOf([jsonl(rows)]), 4)
  const all = shards.flatMap((s) => s.lines)
  assert.equal(all.length, tests.length)
  assert.equal(new Set(all).size, tests.length)
  assert.deepEqual([...all].sort(), tests.map((t) => t.line).sort())
  for (const s of shards) assert.deepEqual(s.lines, tests.map((t) => t.line).filter((l) => s.lines.includes(l)))
})

test('a test with no recorded time counts as the average of the known ones', () => {
  const tests = parseList([listLine('a.smoke.ts', 'a'), listLine('a.smoke.ts', 'b'), listLine('new.smoke.ts', 'new')].join('\n'))
  const r = assignShards(tests, timingsOf([jsonl([['a.smoke.ts', 'a', 10_000], ['a.smoke.ts', 'b', 30_000]])]), 2)
  assert.equal(r.unknown, 1)
  assert.equal(r.averageMs, 20_000)
  assert.deepEqual(r.shards.map((s) => s.ms).sort(), [30_000, 30_000])
})

test('history wins over the fallback, the fallback fills what history lacks', () => {
  const history = jsonl([['a.smoke.ts', 'a', 1_000]])
  const fallback = jsonl([['a.smoke.ts', 'a', 99_000], ['a.smoke.ts', 'b', 5_000]])
  const t = timingsOf([history, fallback])
  const [a, b] = parseList([listLine('a.smoke.ts', 'a'), listLine('a.smoke.ts', 'b')].join('\n'))
  assert.equal(t.get(a.key), 1_000)
  assert.equal(t.get(b.key), 5_000)
})

test('with no timings at all every test counts the same, so shards split by count', () => {
  const { list } = sample()
  const { shards, unknown } = assignShards(parseList(list), new Map(), 6)
  assert.equal(unknown, 30)
  assert.deepEqual(shards.map((s) => s.lines.length), [5, 5, 5, 5, 5, 5])
})

test('CLI: missing history file is skipped, one list file per shard, every test once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-shards-'))
  const { list, rows } = sample()
  writeFileSync(join(dir, 'list.txt'), list)
  writeFileSync(join(dir, 'fallback.jsonl'), jsonl(rows))
  const out = execFileSync(process.execPath, ['scripts/smoke-shards.mjs', '--list', join(dir, 'list.txt'), '--shards', '3', '--out', join(dir, 'shards'), '--fallback', join(dir, 'fallback.jsonl'), join(dir, 'no-such-history.jsonl')], { encoding: 'utf8' })
  assert.match(out, /30 tests, timings from .*fallback\.jsonl, 0 without a time/)
  assert.deepEqual(readdirSync(join(dir, 'shards')).sort(), ['shard-1.txt', 'shard-2.txt', 'shard-3.txt'])
  const lines = [1, 2, 3].flatMap((i) => readFileSync(join(dir, 'shards', `shard-${i}.txt`), 'utf8').split('\n').filter(Boolean))
  assert.equal(lines.length, 30)
  assert.equal(new Set(lines).size, 30)
})

test('the committed fallback covers the current suite', () => {
  const fallback = timingsOf([readFileSync('scripts/smoke-timings.jsonl', 'utf8')])
  assert.ok(fallback.size >= 150, `fallback has ${fallback.size} tests`)
})

test('shardCountFor: one shard per target of predicted time, at least 1, at most max', () => {
  assert.equal(shardCountFor(0), 1)
  assert.equal(shardCountFor(30_000), 1)
  assert.equal(shardCountFor(150_001), 2)
  assert.equal(shardCountFor(14 * 60_000), 6)
  assert.equal(shardCountFor(60 * 60_000), 6)
  assert.equal(shardCountFor(60 * 60_000, { max: 4 }), 4)
  assert.equal(shardCountFor(10 * 60_000, { targetMs: 5 * 60_000 }), 2)
})

test('the full committed suite scales to 6 shards; a handful of short tests to 1', () => {
  const text = readFileSync('scripts/smoke-timings.jsonl', 'utf8')
  const rows = text.trim().split('\n').map((l) => JSON.parse(l))
  const all = parseList(rows.map((r) => listLine(r.file, r.title, r.project)).join('\n'))
  assert.equal(shardCountFor(totalMsOf(all, timingsOf([text]))), 6)
  const few = all.slice(0, 5)
  assert.equal(shardCountFor(totalMsOf(few, new Map(few.map((t) => [t.key, 20_000])))), 1)
})

test('CLI: --shards auto writes as many shard files as the predicted time needs, and the count to --count-out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-shards-'))
  const { list, rows } = sample()
  writeFileSync(join(dir, 'list.txt'), list)
  writeFileSync(join(dir, 'fallback.jsonl'), jsonl(rows))
  // 789 s predicted: 5 min per shard gives 3.
  execFileSync(process.execPath, ['scripts/smoke-shards.mjs', '--list', join(dir, 'list.txt'), '--shards', 'auto', '--target-minutes', '5', '--out', join(dir, 'shards'), '--count-out', join(dir, 'count.txt'), '--fallback', join(dir, 'fallback.jsonl')], { encoding: 'utf8' })
  assert.equal(readFileSync(join(dir, 'count.txt'), 'utf8').trim(), '3')
  assert.deepEqual(readdirSync(join(dir, 'shards')).sort(), ['shard-1.txt', 'shard-2.txt', 'shard-3.txt'])
})

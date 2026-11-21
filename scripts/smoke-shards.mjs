#!/usr/bin/env node
/**
 * Split the smoke suite into CI shards of about equal test time, one Playwright test-list file per shard.
 *
 *   pnpm exec playwright test --list --grep-invert @load > list.txt
 *   node scripts/smoke-shards.mjs --list list.txt --shards 6 --out .smoke-shards [--fallback scripts/smoke-timings.jsonl] [history.jsonl...]
 *   pnpm run test:smoke --test-list .smoke-shards/shard-1.txt
 *
 * Tests come from the `--list` output (`[project] › file:line:col › describe › title` lines; other lines are skipped),
 * and each shard file holds the lines of its tests verbatim, the format `--test-list` reads. Times come from the
 * per-test JSONL files given as plain arguments (scripts/smoke-jsonl-reporter.mjs; CI passes the merged report of the
 * last green run), then from `--fallback` (the committed scripts/smoke-timings.jsonl, same format), and a test found in
 * neither counts as the average of the known ones (10 s when none is known). A test is matched by project, spec file
 * and its own title (the last title segment), as scripts/smoke-merge.mjs keys it. Missing or unreadable timing files
 * are skipped, so a run without history still balances on the fallback.
 *
 * Assignment: longest test first, each to the shard with the least time so far (ties: the lower shard number).
 * Every listed test lands in exactly one shard. Prints one line per shard with its test count and predicted time.
 *
 * Test: node --test scripts/test-smoke-shards.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rowsOfJsonl } from './smoke-timing.mjs'

const SEP = ' › '

/** Key shared by the list lines and the JSONL rows: project, spec file, the test's own title. */
export const keyOf = (project, file, title) => `${project}\u0000${file}\u0000${title}`

/** Parse `playwright test --list` output into tests `{ line, key }` (the line is what `--test-list` reads). */
export function parseList(text) {
  const tests = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const m = /^\[([^\]]+)\]$/.exec(line.split(SEP)[0] ?? '')
    if (!m) continue
    const parts = line.split(SEP)
    if (parts.length < 3) continue
    const file = parts[1].replace(/:\d+:\d+$/, '')
    tests.push({ line, key: keyOf(m[1], file, parts.at(-1)) })
  }
  return tests
}

/**
 * Timings map from JSONL texts, first source wins per test (history before fallback). Within one source a test's
 * attempts are summed (rowsOfJsonl), so a retried test counts its retry.
 * @param {string[]} texts JSONL texts in priority order
 * @returns {Map<string, number>} key to ms
 */
export function timingsOf(texts) {
  const map = new Map()
  for (const text of texts) {
    for (const r of rowsOfJsonl(text)) {
      const key = keyOf(r.project, r.file, r.title)
      if (!map.has(key) && r.ms > 0) map.set(key, r.ms)
    }
  }
  return map
}

/**
 * Longest-processing-time-first assignment.
 * @param {{ line: string, key: string }[]} tests
 * @param {Map<string, number>} timings key to ms
 * @param {number} count number of shards
 * @returns {{ shards: { lines: string[], ms: number }[], unknown: number, averageMs: number }}
 */
export function assignShards(tests, timings, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive integer, got ${count}`)
  const known = tests.map((t) => timings.get(t.key)).filter((ms) => ms !== undefined)
  const averageMs = known.length ? known.reduce((s, ms) => s + ms, 0) / known.length : 10_000
  const seen = new Set()
  const timed = []
  for (const [i, t] of tests.entries()) {
    if (seen.has(t.line)) continue
    seen.add(t.line)
    timed.push({ ...t, i, ms: timings.get(t.key) ?? averageMs })
  }
  timed.sort((a, b) => b.ms - a.ms || a.i - b.i)
  const shards = Array.from({ length: count }, () => ({ lines: [], ms: 0, order: [] }))
  for (const t of timed) {
    let best = shards[0]
    for (const s of shards) if (s.ms < best.ms) best = s
    best.order.push(t)
    best.ms += t.ms
  }
  // Each shard runs its tests in list order (file order), so a spec file's tests stay together.
  return {
    shards: shards.map((s) => ({ lines: s.order.sort((a, b) => a.i - b.i).map((t) => t.line), ms: s.ms })),
    unknown: tests.length - known.length,
    averageMs,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
  const history = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  const listPath = opt('--list')
  if (!listPath || !existsSync(listPath)) {
    console.error(`smoke-shards: test list not found: ${listPath ?? '(no --list given)'}`)
    process.exit(1)
  }
  const count = Number(opt('--shards', '6'))
  const out = opt('--out', '.smoke-shards')
  const fallback = opt('--fallback', 'scripts/smoke-timings.jsonl')
  const sources = [...history, fallback].filter((p) => existsSync(p))
  const tests = parseList(readFileSync(listPath, 'utf8'))
  if (!tests.length) {
    console.error(`smoke-shards: no tests in ${listPath}`)
    process.exit(1)
  }
  const { shards, unknown, averageMs } = assignShards(tests, timingsOf(sources.map((p) => readFileSync(p, 'utf8'))), count)
  mkdirSync(out, { recursive: true })
  const min = (ms) => `${(ms / 60_000).toFixed(1)} min`
  console.log(`smoke-shards: ${tests.length} tests, timings from ${sources.join(', ') || '(none)'}, ${unknown} without a time (counted as ${(averageMs / 1000).toFixed(1)} s)`)
  shards.forEach((s, i) => {
    writeFileSync(join(out, `shard-${i + 1}.txt`), s.lines.join('\n') + '\n')
    console.log(`smoke-shards: shard ${i + 1}: ${s.lines.length} tests, ${min(s.ms)} predicted`)
  })
}

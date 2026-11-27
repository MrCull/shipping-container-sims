#!/usr/bin/env node
/**
 * Merge the per-test JSONL files of a sharded smoke run (scripts/smoke-jsonl-reporter.mjs, one file per CI shard) into
 * one result: one `SMOKE: ...` line (scripts/smoke-summary-reporter.mjs), one timing table (scripts/smoke-timing.mjs,
 * with its 30 s budget flags) and one exit code.
 *
 *   node scripts/smoke-merge.mjs <shard.jsonl>... [--expect N] [--summary FILE] [--src src] [--budget S]
 *
 * Prints the failed and flaky tests by name, then one `OVER BUDGET:` line per test over its time budget
 * (scripts/smoke-budget.mjs, by the group tag in its spec source under --src; a warning only), then the SMOKE line as its last line. Exit 1 when any test failed, when no results were found, when fewer than `--expect` tests were reported (a shard
 * was cancelled, timed out or never ran), or when a test was reported by more than one shard. `--summary` appends the
 * SMOKE line and the timing table as Markdown (CI passes $GITHUB_STEP_SUMMARY), so the table is there even on a red run.
 *
 * Test: node --test scripts/test-smoke-merge.mjs
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { summaryLine } from './smoke-summary-reporter.mjs'
import { renderTable, rowsOfJsonl } from './smoke-timing.mjs'
import { overBudget, overBudgetLine } from './smoke-budget.mjs'
import { groupOfSource } from './check-smoke-groups.mjs'

/**
 * @param {{ name: string, text: string }[]} shards one entry per shard's JSONL file
 * @param {{ expect?: number, groupOf?: (file: string) => string | null }} [opts] `expect`: how many tests the full run
 *   holds (`playwright test --list`); `groupOf`: a spec file's smoke group, for its time budget (scripts/smoke-budget.mjs)
 * @returns {{ rows: object[], summary: string, problems: string[], overBudget: string[], ok: boolean }}
 */
export function mergeShards(shards, { expect, groupOf = () => null } = {}) {
  const byKey = new Map()
  for (const { name, text } of shards) {
    for (const row of rowsOfJsonl(text)) {
      const key = `${row.project}\u0000${row.file}\u0000${row.title}`
      const seen = byKey.get(key)
      if (seen) seen.shards.push(name)
      else byKey.set(key, { row, shards: [name] })
    }
  }
  const rows = [...byKey.values()].map((e) => e.row)
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
  for (const r of rows) {
    if (r.status === 'expected') counts.passed++
    else if (r.status === 'unexpected') counts.failed++
    else if (r.status === 'flaky') counts.flaky++
    else counts.skipped++
  }
  const problems = []
  if (!rows.length) problems.push('no test results')
  if (counts.failed) problems.push(`${counts.failed} test${counts.failed === 1 ? '' : 's'} failed`)
  if (expect && rows.length && rows.length < expect) problems.push(`${rows.length} of ${expect} tests reported (${expect - rows.length} missing)`)
  const twice = [...byKey.values()].filter((e) => e.shards.length > 1)
  if (twice.length) {
    const list = twice.map((e) => `${e.row.file} > ${e.row.title} (${e.shards.join(', ')})`).join('; ')
    problems.push(`${twice.length} test${twice.length === 1 ? '' : 's'} reported by more than one shard: ${list}`)
  }
  const over = overBudget(rows.map((r) => ({ ...r, group: groupOf(r.file) }))).map(overBudgetLine)
  return { rows, summary: summaryLine(counts), problems, overBudget: over, ok: problems.length === 0 }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
  const paths = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  const shards = paths.filter((p) => existsSync(p)).map((p) => ({ name: p, text: readFileSync(p, 'utf8') }))
  const expect = Number(opt('--expect', '0')) || undefined
  const src = opt('--src', 'src')
  const budget = Number(opt('--budget', '30'))
  const read = (file) => {
    const p = join(src, file)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }
  const m = mergeShards(shards, { expect, groupOf: (file) => groupOfSource(read(file)) })
  console.log(`smoke-merge: ${shards.length} shard file${shards.length === 1 ? '' : 's'}, ${m.rows.length} tests`)
  for (const p of m.problems) console.log(`smoke-merge: ${p}`)
  // Failed and flaky tests by name, then the SMOKE line last: a 25-line tail of the CI job log holds the whole result.
  for (const r of m.rows) if (r.status === 'unexpected' || r.status === 'flaky') console.log(`smoke-merge: ${r.status === 'flaky' ? 'flaky' : 'failed'}: ${r.file} > ${r.title}`)
  // Over budget (a warning, never the exit code) just above the SMOKE line.
  for (const l of m.overBudget) console.log(l)
  console.log(m.summary)
  const summaryFile = opt('--summary')
  if (summaryFile) {
    const problems = m.problems.map((p) => `- ${p}`).join('\n')
    const over = m.overBudget.map((l) => `- \`${l}\``).join('\n')
    const md = ['## Smoke timing', '', `\`${m.summary}\``, '', ...(problems ? [problems, ''] : []), ...(over ? [over, ''] : []), m.rows.length ? renderTable(m.rows, read, Infinity, budget) : '', '']
    appendFileSync(summaryFile, md.join('\n'))
  }
  process.exit(m.ok ? 0 : 1)
}

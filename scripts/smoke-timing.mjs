#!/usr/bin/env node
/**
 * Smoke timing report: reads a Playwright JSON report or the per-test JSONL file of scripts/smoke-jsonl-reporter.mjs
 * and prints a Markdown table of every smoke test sorted by duration (slowest first): spec file, title, project,
 * duration, status, scene.
 *
 *   SMOKE_JSONL_REPORT=.smoke-results/results.jsonl pnpm run test:smoke ...   (written as each test ends; CI sets it)
 *   SMOKE_JSON_REPORT=.smoke-results/report.json pnpm run test:smoke ...      (written only when the run ends)
 *   node scripts/smoke-timing.mjs <report.json | results.jsonl>... [--src src] [--top N] [--budget S]
 *
 * Several files (one per shard) are read together. A `.jsonl` file from a cancelled or timed-out run still works: it
 * holds every test that finished, and a half-written last line is skipped.
 *
 * Duration is the sum over a test's attempts (retries included). Status is the test's final outcome (expected,
 * unexpected, flaky, skipped).
 *
 * Budget (default 30 s): a test whose duration is over it gets `(over 30 s)` in its row, and a GitHub `[!WARNING]`
 * block above the table lists them. It is a warning only: the script still exits 0.
 *
 * "scene" heuristic, from the spec source (the spec file is resolved against --src, default `src`, as Playwright
 * reports it relative to testDir). The column lists every marker found, or `ui` when none:
 *   canvas   : the spec reads canvas pixels or the canvas element (`canvas`, `getImageData`, `toDataURL`, `readPixels`)
 *   frames   : it samples the frame rate (`frameSampling`, `sampleFrames`, `requestAnimationFrame`)
 *   shots    : it takes screenshots (`.screenshot(`, `toHaveScreenshot`)
 *   dev-api  : it calls scene-reading dev APIs (`window.__tt`, `__tt.`)
 * The scene is a whole-spec property, so every test in a file gets the same value. A scene spec is slow because of
 * software WebGL; a `ui` spec that is slow points at something else (waits, long sim runs).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MARKERS = [
  ['canvas', /\bcanvas\b|getImageData|toDataURL|readPixels/i],
  ['frames', /frameSampling|sampleFrames|requestAnimationFrame/],
  ['shots', /\.screenshot\(|toHaveScreenshot/],
  ['dev-api', /window\.__tt|__tt\./],
]

/** Scene label for one spec source text. */
export function sceneOf(source) {
  const found = MARKERS.filter(([, re]) => re.test(source)).map(([name]) => name)
  return found.length ? found.join('+') : 'ui'
}

/** Flatten a Playwright JSON report to rows {file, title, project, ms, status}. */
export function rowsOf(report) {
  const rows = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        rows.push({
          file: spec.file ?? suite.file ?? '',
          title: spec.title,
          project: t.projectName ?? '',
          ms: (t.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0),
          status: t.status ?? t.results?.at(-1)?.status ?? '',
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const s of report.suites ?? []) walk(s)
  return rows
}

/**
 * Rows from the JSONL text of scripts/smoke-jsonl-reporter.mjs: one row per test (id + project), durations summed
 * over attempts, status the outcome on the test's last line. Lines that do not parse (a write cut off) are skipped.
 */
export function rowsOfJsonl(text) {
  const byTest = new Map()
  for (const line of text.split('\n')) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (!r || typeof r !== 'object') continue
    const key = `${r.project}\u0000${r.id}`
    const row = byTest.get(key) ?? { file: r.file ?? '', title: r.title ?? '', project: r.project ?? '', ms: 0, status: '' }
    row.ms += r.ms ?? 0
    row.status = r.outcome ?? r.status ?? ''
    byTest.set(key, row)
  }
  return [...byTest.values()]
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/**
 * Markdown table, slowest first. `input` is a Playwright JSON report or rows ({file, title, project, ms, status}).
 * `readSource(file)` returns the spec source or ''. Tests over `budgetS` seconds are flagged (warning only).
 */
export function renderTable(input, readSource, top = Infinity, budgetS = 30) {
  const cache = new Map()
  const scene = (file) => {
    if (!cache.has(file)) cache.set(file, sceneOf(readSource(file)))
    return cache.get(file)
  }
  const all = Array.isArray(input) ? input : rowsOf(input)
  const sorted = [...all].sort((a, b) => b.ms - a.ms)
  const rows = sorted.slice(0, top)
  const cell = (s) => String(s).replaceAll('|', '\\|')
  const over = (r) => r.ms > budgetS * 1000
  const lines = []
  const slow = sorted.filter(over)
  if (slow.length) {
    const list = slow.map((r) => `${r.file} > ${r.title} (${seconds(r.ms)})`).join('; ')
    lines.push('> [!WARNING]', `> ${slow.length} test${slow.length === 1 ? '' : 's'} over the ${budgetS} s budget: ${cell(list)}`, '')
  }
  lines.push('| Spec file | Title | Project | Duration | Status | Scene |', '| --- | --- | --- | ---: | --- | --- |')
  for (const r of rows) {
    lines.push(`| ${cell(r.file)} | ${cell(r.title)} | ${r.project} | ${seconds(r.ms)}${over(r) ? ` (over ${budgetS} s)` : ''} | ${r.status} | ${scene(r.file)} |`)
  }
  const total = all.reduce((s, r) => s + r.ms, 0)
  lines.push('', `Total test time: ${(total / 1000).toFixed(1)} s over ${all.length} tests.`)
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
  const paths = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  const missing = paths.length ? paths.filter((p) => !existsSync(p)) : ['(no path given)']
  if (missing.length) {
    console.error(`smoke-timing: report not found: ${missing.join(', ')}`)
    process.exit(1)
  }
  const src = opt('--src', 'src')
  const top = opt('--top') ? Number(opt('--top')) : Infinity
  const budget = opt('--budget') ? Number(opt('--budget')) : 30
  const read = (file) => {
    const p = join(src, file)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }
  const rows = paths.flatMap((p) => {
    const text = readFileSync(p, 'utf8')
    return p.endsWith('.jsonl') ? rowsOfJsonl(text) : rowsOf(JSON.parse(text))
  })
  console.log(renderTable(rows, read, top, budget))
}

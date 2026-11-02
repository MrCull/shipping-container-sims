#!/usr/bin/env node
/**
 * Smoke timing report: reads a Playwright JSON report and prints a Markdown table of every smoke test sorted by
 * duration (slowest first): spec file, title, project, duration, status, scene.
 *
 *   SMOKE_JSON_REPORT=.smoke-results/report.json pnpm run test:smoke ...   (playwright.config.ts writes the JSON)
 *   node scripts/smoke-timing.mjs .smoke-results/report.json [--src src] [--top N]
 *
 * Duration is the sum over a test's attempts (retries included). Status is the test's final outcome (expected,
 * unexpected, flaky, skipped).
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

/** Markdown table, slowest first. `readSource(file)` returns the spec source or ''. */
export function renderTable(report, readSource, top = Infinity) {
  const cache = new Map()
  const scene = (file) => {
    if (!cache.has(file)) cache.set(file, sceneOf(readSource(file)))
    return cache.get(file)
  }
  const all = rowsOf(report)
  const rows = [...all].sort((a, b) => b.ms - a.ms).slice(0, top)
  const cell = (s) => String(s).replaceAll('|', '\\|')
  const lines = ['| Spec file | Title | Project | Duration | Status | Scene |', '| --- | --- | --- | ---: | --- | --- |']
  for (const r of rows) {
    lines.push(`| ${cell(r.file)} | ${cell(r.title)} | ${r.project} | ${(r.ms / 1000).toFixed(1)} s | ${r.status} | ${scene(r.file)} |`)
  }
  const total = all.reduce((s, r) => s + r.ms, 0)
  lines.push('', `Total test time: ${(total / 1000).toFixed(1)} s over ${all.length} tests.`)
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
  const path = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  if (!path || !existsSync(path)) {
    console.error(`smoke-timing: report not found: ${path ?? '(no path given)'}`)
    process.exit(1)
  }
  const src = opt('--src', 'src')
  const top = opt('--top') ? Number(opt('--top')) : Infinity
  const read = (file) => {
    const p = join(src, file)
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }
  console.log(renderTable(JSON.parse(readFileSync(path, 'utf8')), read, top))
}

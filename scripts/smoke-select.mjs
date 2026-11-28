#!/usr/bin/env node
/**
 * Print the smoke groups a change needs, and why each was picked.
 *
 *   node scripts/smoke-select.mjs [--labels a,b] [--base <ref>] [--head <ref>] [--files-from FILE] [--grep]
 *
 * Changed files come from `--files-from` (one path per line) or `git diff --name-only <base> <head>` (default
 * HEAD^1 HEAD, the last merge). Rules: nothing when no file under src/ changed (Markdown and docs/ folders do not
 * count) and no `smoke` or `smoke:<group>` label is set; otherwise `core` (or, for a sim-only change without the plain `smoke` label, where every changed src/ path is
 * under src/sims/<id>/, the home wall spec `@home-wall` in its place), plus every
 * `smoke:<group>` label, plus every group scripts/smoke-map.txt assigns to a changed path, plus the group of each
 * changed smoke spec (its tag); every group when the plain `smoke` label is present. Markdown and docs/ folders select
 * nothing; Node-only CLI code (src/sims/*\/cli/) and unit tests (*.test.ts) select core (or the home wall spec in a
 * sim folder) and nothing beyond it, since they can still break the build.
 *
 * Output: one line per group, `<group>  <reason>; <reason>`, or with `--grep` one Playwright grep pattern
 * (`@core|@camera`, empty when nothing runs): `pnpm run test:smoke --grep "$(node scripts/smoke-select.mjs --grep)"`.
 *
 * Test: node --test scripts/test-smoke-select.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GROUPS } from './smoke-groups.mjs'
import { groupOfSource } from './check-smoke-groups.mjs'

/**
 * The repo's smoke map (scripts/smoke-map.txt) and a `specGroup(file)` that reads a changed spec's group tag (null
 * when the file is gone), the inputs `selectGroups` takes besides labels and files. Shared with scripts/smoke-ci.mjs.
 * @param {string} root the repo root
 */
export function loadSelectionInputs(root) {
  const map = parseMap(readFileSync(join(root, 'scripts/smoke-map.txt'), 'utf8'))
  const specGroup = (f) => (existsSync(join(root, f)) ? groupOfSource(readFileSync(join(root, f), 'utf8')) : null)
  return { map, specGroup }
}

/**
 * Map lines `pattern => group group` (comments and blank lines skipped) as `{ re, groups, scope }`. A `[folder/]`
 * line scopes the lines after it to paths under that folder (until the next `[...]`; `[]` ends the scope), so a
 * Terminal Twin pattern never matches another sim's file of the same name.
 */
export function parseMap(text) {
  let scope = ''
  const out = []
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l || l.startsWith('#')) continue
    const s = /^\[(.*)\]$/.exec(l)
    if (s) { scope = s[1]; continue }
    const at = l.lastIndexOf(' => ')
    out.push({ re: new RegExp(l.slice(0, at)), groups: l.slice(at + 4).trim().split(/\s+/), scope })
  }
  return out
}

/** The pseudo-group a sim-only change runs in place of `core`: the home wall spec, tagged `@home-wall`. */
export const HOME_WALL = 'home-wall'
const SIM_FOLDER = /^src\/sims\/[^/]+\//

/** Markdown and docs/ folders: never part of the build, so they select no smoke at all (spec #375 story 6). */
const DOCS = /\.md$|(^|\/)docs\//
/** Docs, plus Node-only CLI code and unit tests: those can break the build, so they keep `core` or the home wall spec. */
const IGNORED = /\.md$|(^|\/)docs\/|^src\/sims\/[^/]+\/cli\/|\.test\.ts$/
const SPEC = /\.smoke\.ts$/

/**
 * @param {{ labels: string[], files: string[], map: {re: RegExp, groups: string[]}[], specGroup: (file: string) => string | null }} input
 * @returns {{ groups: { group: string, reasons: string[] }[], warnings: string[], why: string }}
 */
export function selectGroups({ labels, files, map, specGroup }) {
  const warnings = []
  const labelled = labels.some((l) => l === 'smoke' || l.startsWith('smoke:'))
  const srcFiles = files.filter((f) => f.startsWith('src/') && !DOCS.test(f))
  if (!labelled && !srcFiles.length) return { groups: [], warnings, why: 'no file under src/ changed (Markdown and docs/ ignored): no smoke run' }
  const reasons = new Map(GROUPS.map((g) => [g, []]))
  const add = (g, why) => reasons.get(g).push(why)
  const simOnly = !labels.includes('smoke') && srcFiles.length > 0 && srcFiles.every((f) => SIM_FOLDER.test(f))
  if (!simOnly) add('core', 'always')
  if (labels.includes('smoke')) for (const g of GROUPS) add(g, 'label smoke')
  for (const l of labels) {
    const m = /^smoke:(.+)$/.exec(l)
    if (!m) continue
    if (reasons.has(m[1])) add(m[1], `label ${l}`)
    else warnings.push(`unknown label ${l} (groups: ${GROUPS.join(', ')})`)
  }
  for (const f of files.filter((f) => f.startsWith('src/') && !IGNORED.test(f))) {
    if (SPEC.test(f)) {
      const g = specGroup(f)
      if (g) add(g, `spec ${f}`)
      continue
    }
    for (const { re, groups, scope } of map) {
      if (!f.startsWith(scope ?? '') || !re.test(f)) continue
      for (const g of groups.includes('all') ? GROUPS : groups) add(g, `path ${f}`)
    }
  }
  const groups = GROUPS.filter((g) => reasons.get(g).length).map((group) => ({ group, reasons: [...new Set(reasons.get(group))] }))
  const why = `${groups.length} of ${GROUPS.length} groups`
  if (!simOnly || reasons.get('core').length) return { groups, warnings, why }
  const home = { group: HOME_WALL, reasons: ['sim-only: every changed src/ path is inside a sim folder (src/sims/<id>/)'] }
  return { groups: [home, ...groups], warnings, why: `sim-only change: home wall spec instead of core; ${why}` }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const labels = (opt('--labels') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const from = opt('--files-from')
  const text = from
    ? readFileSync(from, 'utf8')
    : execFileSync('git', ['diff', '--name-only', opt('--base') ?? 'HEAD^1', opt('--head') ?? 'HEAD'], { cwd: root, encoding: 'utf8' })
  const files = text.split('\n').map((s) => s.trim()).filter(Boolean)
  const { map, specGroup } = loadSelectionInputs(root)
  const r = selectGroups({ labels, files, map, specGroup })
  for (const w of r.warnings) console.error(`smoke-select: ${w}`)
  if (args.includes('--grep')) console.log(r.groups.map((g) => `@${g.group}`).join('|'))
  else if (!r.groups.length) console.log(`(none)  ${r.why}`)
  else for (const g of r.groups) console.log(`${g.group.padEnd(10)}${g.reasons.join('; ')}`)
}

#!/usr/bin/env node
/**
 * Print the smoke groups a change needs, and why each was picked.
 *
 *   node scripts/smoke-select.mjs [--labels a,b] [--base <ref>] [--head <ref>] [--files-from FILE] [--grep]
 *
 * Changed files come from `--files-from` (one path per line) or `git diff --name-only <base> <head>` (default
 * HEAD^1 HEAD, the last merge). Rules: nothing when no file under src/ changed; otherwise `core`, plus every
 * `smoke:<group>` label, plus every group scripts/smoke-map.txt assigns to a changed path, plus the group of each
 * changed smoke spec (its tag); every group when the plain `smoke` label is present. Markdown, docs/ folders,
 * Node-only CLI code (src/sims/*\/cli/) and unit tests (*.test.ts) never select a group beyond core.
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

/** Map lines `pattern => group group` (comments and blank lines skipped) as `{ re, groups }`. */
export function parseMap(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const at = l.lastIndexOf(' => ')
      return { re: new RegExp(l.slice(0, at)), groups: l.slice(at + 4).trim().split(/\s+/) }
    })
}

const IGNORED = /\.md$|(^|\/)docs\/|^src\/sims\/[^/]+\/cli\/|\.test\.ts$/
const SPEC = /\.smoke\.ts$/

/**
 * @param {{ labels: string[], files: string[], map: {re: RegExp, groups: string[]}[], specGroup: (file: string) => string | null }} input
 * @returns {{ groups: { group: string, reasons: string[] }[], warnings: string[], why: string }}
 */
export function selectGroups({ labels, files, map, specGroup }) {
  const warnings = []
  if (!files.some((f) => f.startsWith('src/'))) return { groups: [], warnings, why: 'no file under src/ changed: no smoke run' }
  const reasons = new Map(GROUPS.map((g) => [g, []]))
  const add = (g, why) => reasons.get(g).push(why)
  add('core', 'always')
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
    for (const { re, groups } of map) {
      if (!re.test(f)) continue
      for (const g of groups.includes('all') ? GROUPS : groups) add(g, `path ${f}`)
    }
  }
  const groups = GROUPS.filter((g) => reasons.get(g).length).map((group) => ({ group, reasons: [...new Set(reasons.get(group))] }))
  return { groups, warnings, why: `${groups.length} of ${GROUPS.length} groups` }
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
  const map = parseMap(readFileSync(join(root, 'scripts/smoke-map.txt'), 'utf8'))
  const specGroup = (f) => (existsSync(join(root, f)) ? groupOfSource(readFileSync(join(root, f), 'utf8')) : null)
  const r = selectGroups({ labels, files, map, specGroup })
  for (const w of r.warnings) console.error(`smoke-select: ${w}`)
  if (args.includes('--grep')) console.log(r.groups.map((g) => `@${g.group}`).join('|'))
  else if (!r.groups.length) console.log(`(none)  ${r.why}`)
  else for (const g of r.groups) console.log(`${g.group.padEnd(10)}${g.reasons.join('; ')}`)
}

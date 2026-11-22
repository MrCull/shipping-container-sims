// Fail when this branch changes a Terminal Twin doc whose `Checked against ENGINE_VERSION x` line is not the current
// ENGINE_VERSION (rule: src/sims/terminal-twin/docs/README.md, "updates the matching doc in the same PR and bumps its
// Checked against line"). Reports under docs/reports/ are records of past runs and are skipped; a doc without the line
// is skipped. Test: node --test scripts/test-check-doc-engine-version.mjs
// DOC_VERSION_BASE=<ref> sets the base (CI uses HEAD^1 on the PR merge commit). Otherwise the base is the merge-base
// with origin/main, and the check skips quietly when origin/main is not fetched (a shallow clone or a fresh worktree).
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const DOCS = 'src/sims/terminal-twin/docs/'
const ENGINE = 'src/sims/terminal-twin/engine/simulation.ts'
const CHECKED = /Checked against ENGINE_VERSION (\d+\.\d+\.\d+)/

/** The ENGINE_VERSION a simulation.ts source declares, or null. */
export function engineVersionOf(source) {
  return /export const ENGINE_VERSION = '([^']+)'/.exec(source)?.[1] ?? null
}

/** "path: checked against x, engine is y" for each changed doc (path and text) whose line is stale. */
export function staleDocs(docs, version) {
  const out = []
  for (const { path, text } of docs) {
    if (!path.startsWith(DOCS) || !path.endsWith('.md') || path.startsWith(`${DOCS}reports/`)) continue
    const m = CHECKED.exec(text)
    if (m && m[1] !== version) out.push(`${path}: checked against ${m[1]}, engine is ${version}`)
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 })
  let base = process.env.DOC_VERSION_BASE
  if (!base) {
    if (git('rev-parse', '--verify', '-q', 'origin/main').status !== 0) {
      console.log('check-doc-engine-version: origin/main not found, skipped')
      process.exit(0)
    }
    base = git('merge-base', 'origin/main', 'HEAD').stdout.trim()
  }
  const diff = git('diff', '--name-only', '--diff-filter=AMR', base, '--', DOCS)
  if (diff.status !== 0) {
    console.error(diff.stderr || 'git diff failed')
    process.exit(diff.status ?? 1)
  }
  const version = engineVersionOf(readFileSync(ENGINE, 'utf8'))
  const docs = diff.stdout
    .split('\n')
    .filter((p) => p && existsSync(p))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  const stale = staleDocs(docs, version)
  if (stale.length) {
    console.error(`Docs changed on this branch but not re-checked against the engine (bump their "Checked against ENGINE_VERSION" line):\n${stale.join('\n')}`)
    process.exit(1)
  }
}

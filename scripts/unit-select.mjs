#!/usr/bin/env node
/**
 * Decide which unit tests (vitest projects) a change needs, and optionally run them. `pnpm run verify` uses it.
 *
 *   node scripts/unit-select.mjs [--run] [--json] [--files-from FILE] [base] [-- extra vitest args]
 *
 * Rule, first match per path, the scope is the union over paths (spec #375):
 *   - Markdown and any `docs/` folder: ignored.
 *   - `src/sims/<id>/**`: sim `<id>` (Node-only CLI code under a sim included; a new sim folder needs no edit).
 *   - anything else under `src/`, `package.json`, the lockfile, vite/vitest/tsconfig/eslint/playwright config,
 *     `scripts/`, `.github/`: all.
 *   - any other path (`knowledge-base/`, `available-media/`, `.ai/`): no unit tests.
 * Scope `all` runs every vitest project; a list runs the named sims' projects (scripts/vitest-projects.mjs); a sim with
 * no unit tests (no vitest project) is skipped with a reason line; `none` runs nothing and succeeds.
 *
 * Changed paths: `--files-from FILE` (one per line), else the same as scripts/test-related.sh: committed since the
 * base (`base...HEAD`), staged, unstaged and untracked. Base default: on a merge commit its first parent, otherwise
 * the merge-base with origin/main. The first line names the base; an unresolvable base exits 2.
 *
 * Output: human lines (`unit-select: base ...`, `unit-select: scope ...`, one reason per path, the projects), or with
 * `--json` one object `{ base, how, scope, projects, skipped, reasons }` (`projects` is `"all"` or a list; for CI).
 * `--run` then runs `vitest run` with those projects.
 *
 * CI (#380, .github/workflows/pr-checks.yml): `--event NAME` is the GitHub event; `pull_request` selects from
 * `--files-from`, any other event (push to main, workflow_dispatch) is scope `all` without reading paths.
 * `--summary FILE` appends the scope, projects and reasons as Markdown (the step summary).
 *
 * Test: node --test scripts/test-unit-select.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { simIdsWithTests } from './vitest-projects.mjs'

const IGNORED = /\.md$|(^|\/)docs\//
const SIM = /^src\/sims\/([^/]+)\//
const CONFIG =
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$|(^|\/)(vite|vitest|playwright)\.config\.[cm]?[jt]s$|(^|\/)tsconfig[^/]*\.json$|(^|\/)eslint\.config\.[cm]?[jt]s$/

/** Why one path selects what it does: `{ sim }`, `{ all }` or nothing. */
function classify(path) {
  if (IGNORED.test(path)) return { why: path.endsWith('.md') ? 'ignored (Markdown)' : 'ignored (docs/ folder)' }
  const m = SIM.exec(path)
  if (m) return { sim: m[1], why: `sim ${m[1]}` }
  if (path.startsWith('src/')) return { all: true, why: 'all (shared src/ code)' }
  if (path === 'pnpm-lock.yaml') return { all: true, why: 'all (lockfile)' }
  if (CONFIG.test(path)) return { all: true, why: 'all (build or test config)' }
  if (path.startsWith('scripts/')) return { all: true, why: 'all (scripts/)' }
  if (path.startsWith('.github/')) return { all: true, why: 'all (.github/)' }
  return { why: 'no unit tests (outside src/ and config)' }
}

/**
 * The unit-test scope for a list of changed paths (repo-relative, `/`-separated). Pure.
 * @param {string[]} files
 * @returns {{ scope: 'all' | 'none' | string[], reasons: { path: string, why: string }[] }}
 */
export function selectUnitScope(files) {
  const sims = new Set()
  let all = false
  const reasons = []
  for (const path of files) {
    const c = classify(path)
    if (c.sim) sims.add(c.sim)
    if (c.all) all = true
    reasons.push({ path, why: c.why })
  }
  const scope = all ? 'all' : sims.size ? [...sims].sort() : 'none'
  return { scope, reasons }
}

/**
 * The vitest projects a scope runs, given the sims that have a project. Pure.
 * @param {'all' | 'none' | string[]} scope
 * @param {string[]} simsWithTests
 * @returns {{ projects: 'all' | string[], skipped: { sim: string, reason: string }[] }}
 */
export function projectsFor(scope, simsWithTests) {
  if (scope === 'all') return { projects: 'all', skipped: [] }
  if (scope === 'none') return { projects: [], skipped: [] }
  const projects = scope.filter((s) => simsWithTests.includes(s))
  const skipped = scope.filter((s) => !simsWithTests.includes(s)).map((sim) => ({ sim, reason: 'no unit tests (not a vitest project)' }))
  return { projects, skipped }
}

/**
 * The scope for a CI event (#380): a pull request uses its changed paths; a push to main, a manual run and any other
 * event run every project. Pure.
 * @param {string} event the GitHub event name
 * @param {string[]} files
 */
export function selectForEvent(event, files) {
  if (event === 'pull_request') return selectUnitScope(files)
  return { scope: 'all', reasons: [{ path: `(event ${event})`, why: `all (a ${event} run tests every project)` }] }
}

/** Markdown for the CI step summary: scope, projects, skipped sims and one line per changed path. Pure. */
export function summaryMarkdown({ scope, projects, skipped, reasons }) {
  const list = (x) => (Array.isArray(x) ? (x.length ? x.join(' ') : '(none)') : x)
  const lines = [`### Unit-test scope: ${list(scope)}`, '', `Projects: ${list(projects)}`]
  if (Array.isArray(projects) && projects.length === 0) lines.push('', 'Nothing selected: no unit tests to run for this change, a passing no-op.')
  for (const s of skipped) lines.push('', `Skipped sim ${s.sim}: ${s.reason}`)
  if (reasons.length) lines.push('', ...reasons.map((r) => `- \`${r.path}\`: ${r.why}`))
  return lines.join('\n') + '\n'
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** The base to compare against, as test-related.sh picks it: `{ sha, how }`, or throws when it does not resolve. */
function resolveBase(root, given) {
  let ref = given
  let how = 'given'
  if (!ref) {
    try {
      git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^2'])
      ref = 'HEAD^1'
      how = `first parent of merge commit ${git(root, ['rev-parse', '--short', 'HEAD']).trim()}`
    } catch {
      how = 'merge-base with origin/main'
      try {
        ref = git(root, ['merge-base', 'HEAD', 'origin/main']).trim()
      } catch {
        ref = git(root, ['merge-base', 'HEAD', 'main']).trim()
      }
    }
  }
  let sha
  try {
    sha = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim()
  } catch {
    sha = ''
  }
  if (!sha) throw new Error(`base '${ref}' is not a commit`)
  return { sha, how }
}

function changedFiles(root, base) {
  const text = [
    git(root, ['diff', '--name-only', `${base}...HEAD`]),
    git(root, ['diff', '--name-only', 'HEAD']),
    git(root, ['ls-files', '--others', '--exclude-standard']),
  ].join('\n')
  return [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))].sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const argv = process.argv.slice(2)
  const dd = argv.indexOf('--')
  const args = dd >= 0 ? argv.slice(0, dd) : argv
  const vitestArgs = dd >= 0 ? argv.slice(dd + 1) : []
  const json = args.includes('--json')
  const runIt = args.includes('--run')
  const valued = ['--files-from', '--event', '--summary']
  const valueOf = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : undefined)
  const filesFrom = valueOf('--files-from')
  const event = valueOf('--event')
  const summary = valueOf('--summary')
  const valueAt = new Set(valued.map((f) => args.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1))
  const positional = args.filter((a, i) => !a.startsWith('--') && !valueAt.has(i))
  const unknown = args.filter((a) => a.startsWith('--') && !['--json', '--run', ...valued].includes(a))
  if (unknown.length || positional.length > 1) {
    console.error('usage: node scripts/unit-select.mjs [--run] [--json] [--event NAME] [--files-from FILE] [--summary FILE] [base] [-- vitest args]')
    process.exit(2)
  }

  let base = { sha: null, how: event && event !== 'pull_request' ? `event ${event}` : `files from ${filesFrom}` }
  let files = []
  try {
    if (event && event !== 'pull_request') files = []
    else if (filesFrom) files = readFileSync(filesFrom, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    else {
      base = resolveBase(root, positional[0])
      files = changedFiles(root, base.sha)
    }
  } catch (e) {
    console.error(`unit-select: ${e.message}`)
    process.exit(2)
  }

  const { scope, reasons } = event ? selectForEvent(event, files) : selectUnitScope(files)
  const { projects, skipped } = projectsFor(scope, simIdsWithTests(root))
  if (summary) appendFileSync(summary, summaryMarkdown({ scope, projects, skipped, reasons }))
  const out = json ? console.error : console.log
  if (json) console.log(JSON.stringify({ base: base.sha, how: base.how, scope, projects, skipped, reasons }))
  out(`unit-select: base ${base.sha ? base.sha.slice(0, 7) : '-'} (${base.how})`)
  out(`unit-select: scope ${Array.isArray(scope) ? scope.join(' ') : scope} (${files.length} changed path${files.length === 1 ? '' : 's'})`)
  for (const r of reasons) out(`  ${r.path}: ${r.why}`)
  for (const s of skipped) out(`unit-select: skip sim ${s.sim}: ${s.reason}`)
  const nothing = Array.isArray(projects) && projects.length === 0
  out(`unit-select: projects ${projects === 'all' ? 'all' : nothing ? '(none)' : projects.join(' ')}`)

  if (!runIt) process.exit(0)
  if (nothing) {
    out('unit-select: no unit tests to run for this change: OK')
    process.exit(0)
  }
  const projArgs = projects === 'all' ? [] : projects.flatMap((p) => ['--project', p])
  const start = performance.now()
  const r = spawnSync('pnpm', ['exec', 'vitest', 'run', ...projArgs, ...vitestArgs], { cwd: root, stdio: 'inherit' })
  const seconds = ((performance.now() - start) / 1000).toFixed(1)
  out(`unit-select: ran projects ${projects === 'all' ? 'all' : projects.join(' ')} in ${seconds} s (exit ${r.status ?? 1})`)
  process.exit(r.status ?? 1)
}

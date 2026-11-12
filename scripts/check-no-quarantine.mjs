// Fail when this branch (origin/main...HEAD, plus uncommitted changes) adds a quarantined or focused test:
// `.fixme(`, `.only(`, or an unconditional `.skip('title', ...)` in a *.test.ts or *.smoke.ts file.
// A conditional skip with a runtime condition first (`test.skip(!OUT, 'reason')`) is allowed.
// Never skip a spec to get green (AGENTS.md); fix it or report it. Test: node --test scripts/test-check-no-quarantine.mjs
// QUARANTINE_BASE=<ref> sets the base (CI uses HEAD^1 on the PR merge commit). Otherwise the base is the merge-base
// with origin/main, and the check skips quietly when origin/main is not fetched (a shallow clone or a fresh worktree).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TEST_FILE = /\.(test|smoke)\.ts$/
const QUARANTINE = [
  /\b(?:test|it|describe)(?:\.describe)?\.(?:only|fixme)\s*\(/,
  /\b(?:test|it|describe)(?:\.describe)?\.skip\s*\(\s*['"`]/,
]

/** Added lines of a unified diff that quarantine or focus a test, as "file:line: text". */
export function findQuarantines(diff) {
  const found = []
  let file = null
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).replace(/^b\//, '')
      file = TEST_FILE.test(path) ? path : null
    } else if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw)
      line = m ? Number(m[1]) : 0
    } else if (raw.startsWith('+')) {
      if (file && QUARANTINE.some((re) => re.test(raw))) found.push(`${file}:${line}: ${raw.slice(1).trim()}`)
      line++
    } else if (!raw.startsWith('-')) {
      line++
    }
  }
  return found
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
  let base = process.env.QUARANTINE_BASE
  if (!base) {
    if (git('rev-parse', '--verify', '-q', 'origin/main').status !== 0) {
      console.log('check-no-quarantine: origin/main not found, skipped')
      process.exit(0)
    }
    base = git('merge-base', 'origin/main', 'HEAD').stdout.trim()
  }
  const diff = git('diff', '-U0', base, '--', '*.test.ts', '*.smoke.ts')
  if (diff.status !== 0) {
    console.error(diff.stderr || 'git diff failed')
    process.exit(diff.status ?? 1)
  }
  const found = findQuarantines(diff.stdout)
  if (found.length) {
    console.error(`Quarantined or focused tests added (fix the test or report it; never skip it to get green):\n${found.join('\n')}`)
    process.exit(1)
  }
}

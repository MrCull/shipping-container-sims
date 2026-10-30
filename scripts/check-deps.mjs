// verify prerequisites: a missing node_modules surfaces as an obscure module-resolution error, and
// unresolved merge conflict markers in files no linter reads (Markdown, YAML) would otherwise be committed. Also checks
// CI workflow jobs install pnpm before using it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

if (!existsSync(new URL('../node_modules/.bin/eslint', import.meta.url))) {
  console.error('node_modules is missing or incomplete. Run `pnpm install` first, then re-run `pnpm run verify`.')
  process.exit(1)
}

if (existsSync(new URL('../package-lock.json', import.meta.url)) || existsSync(new URL('../yarn.lock', import.meta.url))) {
  console.error('This repo uses pnpm: delete package-lock.json / yarn.lock and use `pnpm install` (lockfile: pnpm-lock.yaml).')
  process.exit(1)
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
const marker = /^(<{7}|>{7})( |$)/m
const dirty = []
for (const f of files) {
  if (!/\.(md|ts|vue|js|mjs|json|ya?ml|css|html)$/.test(f) || !existsSync(f)) continue
  let text
  try {
    text = execFileSync('cat', [f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    continue
  }
  if (marker.test(text)) dirty.push(f)
}
if (dirty.length > 0) {
  console.error(`Unresolved merge conflict markers in:\n  ${dirty.join('\n  ')}\nResolve them, then re-run \`pnpm run verify\`.`)
  process.exit(1)
}

// A workflow job that uses pnpm must install it before actions/setup-node: setup-node's `cache: 'pnpm'` looks for the pnpm
// binary and fails with "Unable to locate executable file: pnpm" (what broke CI after the npm → pnpm switch).
const workflowDir = new URL('../.github/workflows/', import.meta.url)
const unorderedJobs = []
for (const name of existsSync(workflowDir) ? readdirSync(workflowDir) : []) {
  if (!/\.ya?ml$/.test(name)) continue
  const lines = readFileSync(new URL(name, workflowDir), 'utf8').split(/\r?\n/)
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsAt < 0) continue
  let job = null
  const check = () => {
    if (job && job.firstPnpmUse >= 0 && !(job.setupAt >= 0 && job.setupAt < job.firstPnpmUse))
      unorderedJobs.push(`${name}: job \`${job.id}\``)
  }
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const header = /^ {2}([\w-]+):\s*$/.exec(lines[i])
    if (header) {
      check()
      job = { id: header[1], setupAt: -1, firstPnpmUse: -1 }
      continue
    }
    if (!job) continue
    if (/uses:\s*pnpm\/action-setup@/.test(lines[i]) && job.setupAt < 0) job.setupAt = i
    const usesPnpm = /cache:\s*['"]?pnpm\b/.test(lines[i]) || /^\s*-?\s*run:.*\bpnpm\b/.test(lines[i])
    if (usesPnpm && job.firstPnpmUse < 0) job.firstPnpmUse = i
  }
  check()
}
if (unorderedJobs.length > 0) {
  console.error(
    `These workflow jobs use pnpm before installing it:\n  ${unorderedJobs.join('\n  ')}\n` +
      'Add a `uses: pnpm/action-setup@v4` step before `actions/setup-node` (no version: it reads `packageManager`).',
  )
  process.exit(1)
}

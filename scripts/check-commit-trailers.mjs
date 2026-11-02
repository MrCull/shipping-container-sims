// Fail when a commit on this branch (origin/main..HEAD) carries a Co-Authored-By trailer.
// The only trailer allowed is `Claude-Session: <link>` (AGENTS.md, "Commit trailers").
// Skips quietly when origin/main is not fetched (a shallow clone or a fresh worktree).
import { spawnSync } from 'node:child_process'

const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })

if (git('rev-parse', '--verify', '-q', 'origin/main').status !== 0) {
  console.log('check-commit-trailers: origin/main not found, skipped')
  process.exit(0)
}
const log = git('log', 'origin/main..HEAD', '--format=%h%x00%B%x01')
if (log.status !== 0) {
  console.error(log.stderr || 'git log failed')
  process.exit(log.status ?? 1)
}
const bad = []
for (const entry of log.stdout.split('\x01')) {
  const [sha, body = ''] = entry.trim().split('\0')
  if (sha && /^co-authored-by:/im.test(body)) bad.push(sha)
}
if (bad.length) {
  console.error(`Commits with a Co-Authored-By trailer (only "Claude-Session: <link>" is allowed): ${bad.join(', ')}\nReword the message (git commit --amend for the tip) before pushing.`)
  process.exit(1)
}

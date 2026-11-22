// Nightly peak-day check (.github/workflows/peak-day.yml): reads the `tt:run --out` summary of
// "TTI Algeciras, peak day" run to `--until vessels:<n>` and fails unless all <n> vessels finished with 0 violations
// and no first error. A preset that stops idle short of its vessels (#365) passes every other check, so this is the
// only guardrail for a run that goes quiet.
// On a failure with --repo, it opens one `needs-triage` issue, or comments on the open one with the same title, so a
// stall that lasts a week is one issue, not seven.
// Usage: node scripts/peak-day-check.mjs <summary.json> --vessels 5 [--repo o/r --sha <sha> --run-url <url>] [--dry-run]
// Test: node --test scripts/test-peak-day-check.mjs
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { githubRequest } from './smoke-ci.mjs'

export const ISSUE_TITLE = 'Nightly peak day: TTI Algeciras, peak day does not finish its vessels'

/** Problems with a run summary (empty when the run passed). `summary` is null when tt:run wrote none (a crash). */
export function judgePeakDay(summary, vessels) {
  if (!summary) return ['tt:run wrote no summary (it crashed or timed out; see the run log)']
  const problems = []
  const done = summary.kpis?.vesselsCompleted ?? 0
  if (done < vessels) problems.push(`${done} of ${vessels} vessels finished`)
  const violations = summary.invariants?.violations ?? 0
  if (violations > 0) problems.push(`${violations} invariant violations`)
  const e = summary.firstError
  if (e) problems.push(`first error: event #${e.eventId} at ${e.t} s: ${e.message}`)
  return problems
}

/** Issue body (also the comment body when the issue is already open). */
export function peakDayReport({ problems, summary, sha, runUrl }) {
  const k = summary?.kpis
  const lines = [
    `The nightly peak-day run failed${sha ? ` on \`${sha.slice(0, 7)}\`` : ''}.`,
    '',
    ...problems.map((p) => `- ${p}`),
  ]
  if (k) lines.push('', `Moves ${k.movesCompleted}, sim time ${k.simTimeS} s, event-log hash \`${summary.eventLogHash}\`.`)
  if (runUrl) lines.push('', `Run: ${runUrl}`)
  lines.push(
    '',
    'Reproduce: `pnpm run tt:run --preset "TTI Algeciras, peak day" --until vessels:5` (under `scripts/bg.sh run --heavy`).',
  )
  return lines.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  const vessels = Number(opt('--vessels', '5'))
  const summary = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const problems = judgePeakDay(summary, vessels)
  if (!problems.length) {
    console.log(`peak-day-check: ${vessels} of ${vessels} vessels, 0 violations`)
    process.exit(0)
  }
  console.error(`peak-day-check: FAILED\n${problems.join('\n')}`)
  const repo = opt('--repo')
  if (repo) {
    const request = githubRequest({ token: process.env.GITHUB_TOKEN, dryRun: args.includes('--dry-run') })
    const body = peakDayReport({ problems, summary, sha: opt('--sha', ''), runUrl: opt('--run-url', '') })
    const open = await request('GET', `/repos/${repo}/issues?state=open&labels=needs-triage&per_page=100`)
    const existing = Array.isArray(open) ? open.find((i) => i.title === ISSUE_TITLE && !i.pull_request) : undefined
    if (existing) {
      await request('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body })
      console.error(`peak-day-check: commented on #${existing.number}`)
    } else {
      const made = await request('POST', `/repos/${repo}/issues`, { title: ISSUE_TITLE, body, labels: ['needs-triage'] })
      console.error(`peak-day-check: opened ${made.html_url ?? 'an issue'}`)
    }
  }
  process.exit(1)
}

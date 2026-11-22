#!/usr/bin/env node
/**
 * The CI side of the browser smoke tests (.github/workflows/pr-checks.yml): which groups a run takes, the PR comment
 * that says why, and the issue a red full run on `main` opens. The workflow stays thin; the decisions live here.
 *
 *   node scripts/smoke-ci.mjs plan --event <name> [--labels a,b] [--files-from F] [--github-output F] [--comment-out F]
 *   node scripts/smoke-ci.mjs comment --repo owner/name --pr N --body-file F [--dry-run]
 *   node scripts/smoke-ci.mjs red-main --repo owner/name --sha S --run-url U [--dry-run] <results.jsonl>...
 *
 * plan: a pull_request event runs scripts/smoke-select.mjs's groups for its labels and changed files (none when no
 * file under src/ changed and no `smoke` or `smoke:<group>` label is set); push (a merge to main) and workflow_dispatch run every group. Writes `run=true|false` and
 * `grep=<pattern>` (empty: every group) to `--github-output`, and the PR comment body to `--comment-out`.
 * comment: creates the PR's one smoke comment (found by its hidden marker) or updates it in place. Needs GITHUB_TOKEN.
 * red-main: opens an issue (label needs-triage) naming the failing specs, the commit, its PR (from the merge commit
 * message in COMMIT_MESSAGE) and the run. Needs GITHUB_TOKEN. `--dry-run` prints the request instead of sending it.
 *
 * Test: node --test scripts/test-smoke-ci.mjs
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GROUPS } from './smoke-groups.mjs'
import { loadSelectionInputs, selectGroups } from './smoke-select.mjs'
import { mergeShards } from './smoke-merge.mjs'

export const COMMENT_MARKER = '<!-- smoke-selection -->'

/**
 * @param {{ event: string, labels: string[], files: string[], map: object[], specGroup: (f: string) => string | null }} input
 * @returns {{ run: boolean, all: boolean, grep: string, groups: { group: string, reasons: string[] }[], why: string, warnings: string[] }}
 */
export function planSmoke({ event, labels, files, map, specGroup }) {
  if (event !== 'pull_request') {
    const why = event === 'push' ? 'push to main: every group' : `${event}: every group`
    return { run: true, all: true, grep: '', groups: GROUPS.map((group) => ({ group, reasons: [why] })), why, warnings: [] }
  }
  const r = selectGroups({ labels, files, map, specGroup })
  const all = r.groups.length === GROUPS.length
  return { run: r.groups.length > 0, all, grep: all ? '' : r.groups.map((g) => `@${g.group}`).join('|'), groups: r.groups, why: r.why, warnings: r.warnings }
}

/** Where a group's selection came from: label, path (a mapped path or a changed spec) and core, in that order. */
export function sourcesOf(reasons) {
  const s = []
  if (reasons.some((r) => r.startsWith('label '))) s.push('label')
  if (reasons.some((r) => r.startsWith('path ') || r.startsWith('spec '))) s.push('path')
  if (reasons.includes('always')) s.push('core')
  if (!s.length) s.push(reasons[0] ?? 'unknown')
  return s
}

/** The PR comment: one row per group that ran, with its source and the first reasons. */
export function commentBody(plan, { maxReasons = 3 } = {}) {
  const lines = [COMMENT_MARKER, '### Browser smoke selection', '']
  if (!plan.run) {
    lines.push(`No smoke tests ran: ${plan.why}.`)
  } else {
    lines.push(`${plan.groups.length} of ${GROUPS.length} groups ran${plan.all ? ' (every group)' : ''}.`, '', '| Group | From | Why |', '| --- | --- | --- |')
    for (const g of plan.groups) {
      const shown = g.reasons.slice(0, maxReasons).map((r) => r.replace(/^(path|spec) (.+)$/, '$1 `$2`'))
      const more = g.reasons.length > maxReasons ? `; and ${g.reasons.length - maxReasons} more` : ''
      lines.push(`| \`${g.group}\` | ${sourcesOf(g.reasons).join(', ')} | ${shown.join('; ')}${more} |`)
    }
  }
  for (const w of plan.warnings) lines.push('', `> [!WARNING]`, `> ${w}`)
  lines.push('', 'Add a `smoke:<group>` label to run one more group, or `smoke` to run every group.')
  return lines.join('\n') + '\n'
}

/** The PR number of a merge commit message (`Merge pull request #12 from ...`, or a squash title ending `(#12)`). */
export function prNumberOf(message) {
  const m = /^Merge pull request #(\d+)/m.exec(message ?? '') ?? /\(#(\d+)\)\s*$/m.exec((message ?? '').split('\n')[0])
  return m ? Number(m[1]) : null
}

/**
 * The issue a red full run on main opens.
 * @param {{ shards: { name: string, text: string }[], expect?: number, repo: string, sha: string, message: string, runUrl: string }} input
 * @returns {{ title: string, body: string, labels: string[] }}
 */
export function redMainIssue({ shards, expect, repo, sha, message, runUrl }) {
  const m = mergeShards(shards, { expect })
  const failed = m.rows.filter((r) => r.status === 'unexpected')
  const specs = [...new Set(failed.map((r) => r.file))].sort()
  const pr = prNumberOf(message)
  const short = sha.slice(0, 7)
  const title = specs.length
    ? `Smoke red on main at ${short}: ${specs.length} failing spec${specs.length === 1 ? '' : 's'}`
    : `Smoke red on main at ${short}`
  const body = [
    `The full browser smoke run on \`main\` failed.`,
    '',
    `- Run: ${runUrl}`,
    `- Commit: https://github.com/${repo}/commit/${sha} (${(message ?? '').split('\n')[0]})`,
    `- PR: ${pr ? `#${pr}` : 'not found in the commit message'}`,
    `- Result: \`${m.summary}\``,
    '',
    '## Failing specs',
    '',
    ...(specs.length
      ? specs.flatMap((f) => [`- \`${f}\``, ...failed.filter((r) => r.file === f).map((r) => `  - [${r.project}] ${r.title}`)])
      : ['No test failed: the run was red for another reason (below).']),
    ...(m.problems.length ? ['', '## Problems', '', ...m.problems.map((p) => `- ${p}`)] : []),
    '',
  ].join('\n')
  return { title, body, labels: ['needs-triage'] }
}

/** Create or update the PR's smoke comment. `request(method, path, body)` returns parsed JSON. */
export async function upsertComment({ request, repo, pr, body }) {
  const comments = await request('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100`)
  const mine = comments.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER))
  if (mine) return request('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body })
  return request('POST', `/repos/${repo}/issues/${pr}/comments`, { body })
}

/** A GitHub REST request function, or with dryRun one that prints writes and returns [] for reads. */
export function githubRequest({ token, dryRun, log = console.log, fetchFn = globalThis.fetch }) {
  return async (method, path, body) => {
    if (dryRun) {
      if (method === 'GET') return []
      log(`dry-run: ${method} ${path}\n${JSON.stringify(body, null, 2)}`)
      return {}
    }
    const res = await fetchFn(`https://api.github.com${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
    return res.json()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const [cmd, ...args] = process.argv.slice(2)
  const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def)
  const dryRun = args.includes('--dry-run')
  const request = githubRequest({ token: process.env.GITHUB_TOKEN, dryRun })
  if (cmd === 'plan') {
    const labels = (opt('--labels', '') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const from = opt('--files-from')
    const files = from && existsSync(from) ? readFileSync(from, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []
    const { map, specGroup } = loadSelectionInputs(root)
    const plan = planSmoke({ event: opt('--event', 'pull_request'), labels, files, map, specGroup })
    for (const w of plan.warnings) console.error(`smoke-ci: ${w}`)
    console.log(`smoke-ci: ${plan.run ? `run ${plan.all ? 'every group' : plan.grep}` : 'no smoke run'} (${plan.why})`)
    for (const g of plan.groups) console.log(`smoke-ci: ${g.group.padEnd(10)}${g.reasons.join('; ')}`)
    const out = opt('--github-output')
    if (out) appendFileSync(out, `run=${plan.run}\ngrep=${plan.grep}\n`)
    const commentOut = opt('--comment-out')
    if (commentOut) writeFileSync(commentOut, commentBody(plan))
  } else if (cmd === 'comment') {
    const body = readFileSync(opt('--body-file'), 'utf8')
    await upsertComment({ request, repo: opt('--repo'), pr: opt('--pr'), body })
    console.log(`smoke-ci: smoke comment ${dryRun ? 'printed' : 'posted'} on #${opt('--pr')}`)
  } else if (cmd === 'red-main') {
    const paths = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
    const shards = paths.filter((p) => existsSync(p)).map((p) => ({ name: p, text: readFileSync(p, 'utf8') }))
    const repo = opt('--repo')
    const issue = redMainIssue({
      shards,
      expect: Number(opt('--expect', '0')) || undefined,
      repo,
      sha: opt('--sha', ''),
      message: process.env.COMMIT_MESSAGE ?? '',
      runUrl: opt('--run-url', ''),
    })
    const made = await request('POST', `/repos/${repo}/issues`, issue)
    console.log(`smoke-ci: ${dryRun ? 'would open:' : `opened ${made.html_url ?? 'an issue'}:`} ${issue.title}`)
  } else {
    console.error('usage: smoke-ci.mjs plan|comment|red-main ... (see the header)')
    process.exit(2)
  }
}

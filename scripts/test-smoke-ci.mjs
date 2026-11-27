// Run: node --test scripts/test-smoke-ci.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { GROUPS } from './smoke-groups.mjs'
import { parseMap } from './smoke-select.mjs'
import { COMMENT_MARKER, commentBody, githubRequest, planSmoke, prNumberOf, redMainIssue, sourcesOf, upsertComment } from './smoke-ci.mjs'

const map = parseMap(readFileSync(new URL('./smoke-map.txt', import.meta.url), 'utf8'))
const plan = (event, labels, files, specGroup = () => null) => planSmoke({ event, labels, files, map, specGroup })
const BAY = 'src/sims/terminal-twin/components/BayViewer.vue'

test('a PR touching only the bay viewer runs the home wall spec and vessel, and the comment says why', () => {
  const p = plan('pull_request', [], [BAY])
  assert.equal(p.run, true)
  assert.equal(p.all, false)
  assert.equal(p.grep, '@home-wall|@vessel')
  const body = commentBody(p)
  assert.ok(body.startsWith(COMMENT_MARKER))
  assert.match(body, /1 of 10 groups ran, plus the home wall spec in place of `core` \(sim-only change\)/)
  assert.match(body, /\| `home-wall` \| sim-only \| sim-only: every changed src\/ path is inside a sim folder/)
  assert.match(body, /\| `vessel` \| path \| path `src\/sims\/terminal-twin\/components\/BayViewer\.vue` \|/)
})

test('a shared src/ change keeps core; every non-core group plus the home wall spec is still not every group', () => {
  const p = plan('pull_request', [], [BAY, 'src/utils/format.ts'])
  assert.equal(p.grep, '@core|@vessel')
  assert.match(commentBody(p), /\| `core` \| core \| always \|/)
  const wide = plan('pull_request', [], ['src/sims/terminal-twin/tests/browser/openTwin.ts'])
  assert.equal(wide.all, true)
})

test('a docs-only PR runs nothing, and the comment says so', () => {
  const p = plan('pull_request', ['bug'], ['README.md', 'docs/agents/tooling.md'])
  assert.equal(p.run, false)
  assert.match(commentBody(p), /No smoke tests ran: no file under src\/ changed/)
})

test('the smoke label on a docs-only PR runs every group', () => {
  const p = plan('pull_request', ['smoke'], ['README.md'])
  assert.equal(p.run, true)
  assert.equal(p.all, true)
  assert.equal(p.grep, '')
})

test('the smoke label runs every group with no grep; a smoke:<group> label shows as a label source', () => {
  const all = plan('pull_request', ['smoke'], ['src/a.ts'])
  assert.equal(all.all, true)
  assert.equal(all.grep, '')
  assert.equal(all.groups.length, GROUPS.length)
  const one = plan('pull_request', ['smoke:yard'], [BAY])
  assert.equal(one.grep, '@home-wall|@vessel|@yard')
  assert.match(commentBody(one), /\| `yard` \| label \| label smoke:yard \|/)
})

test('push to main and workflow_dispatch run every group, whatever changed', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const p = plan(event, [], ['README.md'])
    assert.equal(p.run, true)
    assert.equal(p.all, true)
    assert.equal(p.grep, '')
    assert.deepEqual(p.groups.map((g) => g.group), GROUPS)
  }
})

test('sourcesOf: label, path (spec counts as path), core', () => {
  assert.deepEqual(sourcesOf(['always', 'label smoke']), ['label', 'core'])
  assert.deepEqual(sourcesOf(['spec src/x.smoke.ts', 'path src/y.ts']), ['path'])
  assert.deepEqual(sourcesOf(['push to main: every group']), ['push to main: every group'])
})

test('long reason lists are cut with a count', () => {
  const files = ['bayA.ts', 'bayB.ts', 'bayC.ts', 'bayD.ts', 'bayE.ts'].map((f) => `src/sims/terminal-twin/modules/${f}`)
  assert.match(commentBody(plan('pull_request', [], files)), /; and 2 more \|/)
})

test('prNumberOf reads merge commits and squash titles', () => {
  assert.equal(prNumberOf('Merge pull request #343 from MrCull/claude/x\n\nbody'), 343)
  assert.equal(prNumberOf('Fast CI selection (#335)\n\n* commit'), 335)
  assert.equal(prNumberOf('a direct push'), null)
})

const line = (file, title, outcome, retry = 0) => JSON.stringify({ id: file + title, file, title, project: 'dev', outcome, status: outcome === 'expected' ? 'passed' : 'failed', retry, ms: 1000 })

test('red-main issue: failing specs, commit, PR and run link, labelled needs-triage', () => {
  const shards = [
    { name: 's1', text: [line('a.smoke.ts', 'ok', 'expected'), line('b.smoke.ts', 'breaks', 'unexpected'), line('b.smoke.ts', 'breaks', 'unexpected', 1)].join('\n') },
    { name: 's2', text: [line('c.smoke.ts', 'also breaks', 'unexpected'), line('c.smoke.ts', 'flakes', 'flaky')].join('\n') },
  ]
  const issue = redMainIssue({ shards, repo: 'o/r', sha: 'abcdef1234567', message: 'Merge pull request #12 from o/branch', runUrl: 'https://github.com/o/r/actions/runs/9' })
  assert.deepEqual(issue.labels, ['needs-triage'])
  assert.equal(issue.title, 'Smoke red on main at abcdef1: 2 failing specs')
  assert.match(issue.body, /- Run: https:\/\/github\.com\/o\/r\/actions\/runs\/9/)
  assert.match(issue.body, /- Commit: https:\/\/github\.com\/o\/r\/commit\/abcdef1234567 \(Merge pull request #12 from o\/branch\)/)
  assert.match(issue.body, /- PR: #12/)
  assert.match(issue.body, /- `b\.smoke\.ts`\n {2}- \[dev\] breaks/)
  assert.match(issue.body, /- `c\.smoke\.ts`\n {2}- \[dev\] also breaks/)
  assert.doesNotMatch(issue.body, /flakes|a\.smoke\.ts/)
})

test('red-main issue with no failing test names the problem instead', () => {
  const issue = redMainIssue({ shards: [{ name: 's1', text: line('a.smoke.ts', 'ok', 'expected') }], expect: 3, repo: 'o/r', sha: 'abc', message: 'x', runUrl: 'u' })
  assert.equal(issue.title, 'Smoke red on main at abc')
  assert.match(issue.body, /No test failed/)
  assert.match(issue.body, /1 of 3 tests reported/)
  assert.match(issue.body, /- PR: not found/)
})

test('upsertComment posts a new comment, or patches the one with the marker', async () => {
  const calls = []
  const fake = (existing) => async (method, path, body) => {
    calls.push([method, path, body])
    return method === 'GET' ? existing : {}
  }
  await upsertComment({ request: fake([{ id: 1, body: 'other' }]), repo: 'o/r', pr: 5, body: 'B' })
  assert.deepEqual(calls.at(-1), ['POST', '/repos/o/r/issues/5/comments', { body: 'B' }])
  await upsertComment({ request: fake([{ id: 1, body: 'other' }, { id: 7, body: `${COMMENT_MARKER}\nold` }]), repo: 'o/r', pr: 5, body: 'B' })
  assert.deepEqual(calls.at(-1), ['PATCH', '/repos/o/r/issues/comments/7', { body: 'B' }])
})

test('githubRequest sends a bearer token; dry-run prints writes and never fetches', async () => {
  const seen = []
  const fetchFn = async (url, init) => {
    seen.push([url, init])
    return { ok: true, json: async () => ({ ok: 1 }) }
  }
  assert.deepEqual(await githubRequest({ token: 't', fetchFn })('POST', '/x', { a: 1 }), { ok: 1 })
  assert.equal(seen[0][0], 'https://api.github.com/x')
  assert.equal(seen[0][1].headers.authorization, 'Bearer t')
  const logs = []
  const dry = githubRequest({ dryRun: true, fetchFn, log: (s) => logs.push(s) })
  assert.deepEqual(await dry('GET', '/y'), [])
  await dry('POST', '/z', { b: 2 })
  assert.equal(seen.length, 1)
  assert.match(logs[0], /dry-run: POST \/z/)
})

test('CLI: plan writes run and grep outputs and the comment; red-main --dry-run prints the issue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-ci-'))
  writeFileSync(join(dir, 'files.txt'), `${BAY}\n`)
  const out = join(dir, 'out.txt')
  execFileSync(process.execPath, ['scripts/smoke-ci.mjs', 'plan', '--event', 'pull_request', '--labels', 'bug', '--files-from', join(dir, 'files.txt'), '--github-output', out, '--comment-out', join(dir, 'c.md')], { encoding: 'utf8' })
  assert.equal(readFileSync(out, 'utf8'), 'run=true\ngrep=@home-wall|@vessel\n')
  assert.match(readFileSync(join(dir, 'c.md'), 'utf8'), /`vessel` \| path/)
  writeFileSync(join(dir, 'docs.txt'), 'README.md\n')
  execFileSync(process.execPath, ['scripts/smoke-ci.mjs', 'plan', '--event', 'pull_request', '--files-from', join(dir, 'docs.txt'), '--github-output', out], { encoding: 'utf8' })
  assert.match(readFileSync(out, 'utf8'), /run=false\ngrep=\n$/)
  writeFileSync(join(dir, 'r.jsonl'), line('b.smoke.ts', 'breaks', 'unexpected') + '\n')
  const printed = execFileSync(process.execPath, ['scripts/smoke-ci.mjs', 'red-main', '--dry-run', '--repo', 'o/r', '--sha', 'abcdef1', '--run-url', 'u', join(dir, 'r.jsonl')], { encoding: 'utf8', env: { ...process.env, COMMIT_MESSAGE: 'Merge pull request #4 from o/b', GITHUB_TOKEN: '' } })
  assert.match(printed, /dry-run: POST \/repos\/o\/r\/issues/)
  assert.match(printed, /needs-triage/)
  assert.match(printed, /PR: #4/)
  assert.match(printed, /would open: Smoke red on main at abcdef1: 1 failing spec/)
})

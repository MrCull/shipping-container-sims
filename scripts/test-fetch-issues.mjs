// Run: node --test scripts/test-fetch-issues.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parentOf, pickIssue, repoOfRemote, subIssuesOf, writeIssues } from './fetch-issues.mjs'

// A saved `gh api -X GET search/issues` response, trimmed to the fields that matter plus some noise.
const item = (number, title, body, state = 'open') => ({ number, title, body, state, user: { login: 'x' }, labels: [], html_url: `u/${number}` })
const response = {
  total_count: 5,
  incomplete_results: false,
  items: [
    item(374, 'Spec', '## Problem\n\nSee #12.\n\n## Tickets\n\n#381, #383'),
    item(383, 'Three', '## Parent\n\n#374\n\n## Blocked by\n\n- Blocked by #381'),
    item(381, 'One', '## Parent\n\n#374\n\n## Blocked by\n\nNone (can start immediately)', 'closed'),
    item(398, 'Retro', '## What to build\n\nIn the #374 run the spec went slow.\n\n## Blocked by\n\nNone'),
    item(500, 'Other spec child', '## Parent\n\n#499\n\nmentions #374'),
  ],
}

test('the parent is the first issue in the Parent section', () => {
  assert.equal(parentOf(response.items[1].body), 374)
  assert.equal(parentOf(response.items[3].body), null)
  assert.equal(parentOf(response.items[4].body), 499, 'the first number in the section is the parent')
  assert.equal(parentOf(null), null)
})

test('picks one issue by number from a search response, or null', () => {
  assert.equal(pickIssue(response, 381).title, 'One')
  assert.equal(pickIssue(response, 999), null)
})

test('sub-issues are the items whose Parent section names the spec, by number', () => {
  assert.deepEqual(subIssuesOf(response, 374).map((i) => i.number), [381, 383])
})

test('writes spec-<n>.md and ticket-<n>.md and returns the summary lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-issues-'))
  const lines = writeIssues(dir, pickIssue(response, 374), subIssuesOf(response, 374))
  assert.deepEqual(lines, ['#381 closed One | blocked by: none', '#383 open Three | blocked by: #381'])
  assert.deepEqual(readdirSync(dir).sort(), ['spec-374.md', 'ticket-381.md', 'ticket-383.md'])
  assert.match(readFileSync(join(dir, 'spec-374.md'), 'utf8'), /^# #374 Spec\n\n## Problem/)
  assert.match(readFileSync(join(dir, 'ticket-383.md'), 'utf8'), /^# #383 Three\n\n## Parent/)
})

test('the repo comes from an https, ssh or proxied origin URL', () => {
  assert.equal(repoOfRemote('https://github.com/MrCull/shipping-container-sims.git'), 'MrCull/shipping-container-sims')
  assert.equal(repoOfRemote('git@github.com:MrCull/shipping-container-sims.git'), 'MrCull/shipping-container-sims')
  assert.equal(repoOfRemote('http://local_proxy@127.0.0.1:1234/git/MrCull/shipping-container-sims'), 'MrCull/shipping-container-sims')
  assert.equal(repoOfRemote(''), null)
})

// Run: node --test scripts/test-tickets-from-sub-issues.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSubIssues, blockersOf, splitTickets } from './tickets-from-sub-issues.mjs'

const issues = [
  { number: 359, state: 'open', title: 'One', body: '## What\n\nx #1\n\n## Blocked by\n\nNone (can start immediately)\n\n## Notes\n\nsee #356' },
  { number: 363, state: 'open', title: 'Five', body: '## Blocked by\n\n- Blocked by #359, #360 and #359' },
]

test('reads the MCP text wrapper and a raw array', () => {
  assert.equal(parseSubIssues(JSON.stringify([{ type: 'text', text: JSON.stringify(issues) }])).length, 2)
  assert.equal(parseSubIssues(JSON.stringify(issues)).length, 2)
})

test('blockers come only from the Blocked by section, deduplicated', () => {
  assert.deepEqual(blockersOf(issues[0].body), [])
  assert.deepEqual(blockersOf(issues[1].body), [359, 360])
  assert.deepEqual(blockersOf('no section #5'), [])
})

test('writes one file per ticket and a summary line each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tickets-'))
  const lines = splitTickets(issues, dir)
  assert.deepEqual(lines, ['#359 open One | blocked by: none', '#363 open Five | blocked by: #359, #360'])
  assert.match(readFileSync(join(dir, 'ticket-363.md'), 'utf8'), /^# #363 Five\n\n## Blocked by/)
})

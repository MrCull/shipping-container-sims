// Run: node --test scripts/test-check-no-quarantine.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findQuarantines } from './check-no-quarantine.mjs'

const diffOf = (file, lines) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`

test('flags fixme, only and unconditional skip in test files', () => {
  const found = findQuarantines(
    diffOf('src/a.smoke.ts', [
      "test.fixme('slow on CI', async () => {})",
      "test.only('focus', async () => {})",
      "test.skip('later', async () => {})",
      "test.describe.skip('group', () => {})",
      "it.only('x', () => {})",
    ]),
  )
  assert.equal(found.length, 5)
  assert.match(found[0], /^src\/a\.smoke\.ts:1: test\.fixme/)
  assert.match(found[4], /^src\/a\.smoke\.ts:5: /)
})

test('allows a conditional skip and ordinary tests', () => {
  const found = findQuarantines(
    diffOf('src/b.test.ts', ["test.skip(!OUT, 'run through pnpm run tt:baseline')", "test('ok', () => {})", 'const only = 1'],),
  )
  assert.deepEqual(found, [])
})

test('ignores files that are not tests and removed lines', () => {
  const diff = diffOf('src/c.ts', ["test.fixme('x', () => {})"]) + "--- a/src/d.test.ts\n+++ b/src/d.test.ts\n@@ -3 +3,0 @@\n-test.only('gone', () => {})\n"
  assert.deepEqual(findQuarantines(diff), [])
})

test('counts lines from the hunk header', () => {
  const diff = "--- a/src/e.test.ts\n+++ b/src/e.test.ts\n@@ -10,0 +12,2 @@\n+const a = 1\n+it.fixme('x', () => {})\n"
  assert.deepEqual(findQuarantines(diff), ["src/e.test.ts:13: it.fixme('x', () => {})"])
})

// Run: node --test scripts/test-check-smoke-groups.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupProblems, groupOfSource } from './check-smoke-groups.mjs'

test('one group tag on every test passes and names the group', () => {
  const src = "test('a', { tag: '@camera' }, async () => {})\ntest(`b ${x}`, { tag: ['@camera', '@slow'] }, async () => {})\n"
  assert.deepEqual(groupProblems('a.smoke.ts', src), [])
  assert.equal(groupOfSource(src), 'camera')
})

test('a group tag in the title counts, alongside @load', () => {
  const src = "test('budget @core', async () => {})\ntest('rate @load', { tag: '@core' }, async () => {})\n"
  assert.deepEqual(groupProblems('a.smoke.ts', src), [])
})

test('a test with no group tag fails, naming its line', () => {
  const src = "test('a', { tag: '@yard' }, async () => {})\n\ntest('b @load', async () => {})\n"
  const p = groupProblems('a.smoke.ts', src)
  assert.equal(p.length, 1)
  assert.match(p[0], /^a\.smoke\.ts:3: no group tag/)
})

test('two groups in one file, or on one test, fail', () => {
  assert.match(groupProblems('a.smoke.ts', "test('a', { tag: '@yard' }, f)\ntest('b', { tag: '@camera' }, f)\n").join(), /more than one group/)
  assert.match(groupProblems('a.smoke.ts', "test('a @core', { tag: '@yard' }, f)\n").join(), /more than one group/)
})

test('a spec file with no tests fails', () => {
  assert.match(groupProblems('a.smoke.ts', 'export {}\n').join(), /no group tag/)
})

// Run: node --test scripts/test-vitest-projects.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { projectsOf, simIdsWithTests } from './vitest-projects.mjs'

test('one project per sim folder that has tests, plus shared for tests outside src/sims/', () => {
  const p = projectsOf([
    'src/sims/terminal-twin/modules/a.test.ts',
    'src/sims/terminal-twin/tests/b.test.ts',
    'src/sims/stowage-master/x.test.ts',
    'src/utils/c.test.ts',
  ])
  assert.deepEqual(p, { sims: ['stowage-master', 'terminal-twin'], shared: true })
})

test('a new sim folder is picked up from its path alone', () => {
  assert.deepEqual(projectsOf(['src/sims/yardshift/modules/a.test.ts']), { sims: ['yardshift'], shared: false })
})

test('the repo: terminal-twin is a project, shared exists, sims without tests are not projects', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const ids = simIdsWithTests(root)
  assert.ok(ids.includes('terminal-twin'))
  assert.ok(!ids.includes('box-empire'))
})

test('test-sim: an unknown id exits non-zero and lists the known ids', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./test-sim.mjs', import.meta.url)), 'no-such-sim'], {
    encoding: 'utf8',
  })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /unknown sim "no-such-sim"/)
  assert.match(r.stderr, /terminal-twin/)
})

test('test-sim: no id exits non-zero with usage', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./test-sim.mjs', import.meta.url))], {
    encoding: 'utf8',
  })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /usage/)
})

// Run: node --test scripts/test-unit-select.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { selectUnitScope, projectsFor } from './unit-select.mjs'

const why = (r, path) => r.reasons.find((x) => x.path === path)?.why

test('one sim: that sim, with the path as the reason', () => {
  const r = selectUnitScope(['src/sims/stowage-master/modules/physics.ts'])
  assert.deepEqual(r.scope, ['stowage-master'])
  assert.match(why(r, 'src/sims/stowage-master/modules/physics.ts'), /sim stowage-master/)
})

test('two sims: both, sorted', () => {
  const r = selectUnitScope(['src/sims/terminal-twin/a.ts', 'src/sims/box-empire/b.vue'])
  assert.deepEqual(r.scope, ['box-empire', 'terminal-twin'])
})

test('sim plus shared src/: all', () => {
  const r = selectUnitScope(['src/sims/terminal-twin/a.ts', 'src/utils/lastPlayed.ts'])
  assert.equal(r.scope, 'all')
  assert.match(why(r, 'src/utils/lastPlayed.ts'), /shared/)
})

test('shared only: all', () => {
  assert.equal(selectUnitScope(['src/stores/audio.ts']).scope, 'all')
})

test('config files: all', () => {
  for (const f of ['vitest.config.ts', 'vite.config.ts', 'tsconfig.tools.json', 'eslint.config.js', 'playwright.config.ts', 'package.json', 'scripts/foo.mjs', '.github/workflows/pr-checks.yml']) {
    assert.equal(selectUnitScope([f]).scope, 'all', f)
  }
})

test('lockfile: all', () => {
  const r = selectUnitScope(['pnpm-lock.yaml'])
  assert.equal(r.scope, 'all')
  assert.match(why(r, 'pnpm-lock.yaml'), /lockfile|config/)
})

test('docs only: none, each path ignored', () => {
  const r = selectUnitScope(['README.md', 'docs/agents/tooling.md', 'src/sims/terminal-twin/docs/engine.png'])
  assert.equal(r.scope, 'none')
  assert.match(why(r, 'docs/agents/tooling.md'), /ignored/)
})

test('Markdown inside a sim folder is ignored', () => {
  const r = selectUnitScope(['src/sims/terminal-twin/terminal-twin-AGENTS.md'])
  assert.equal(r.scope, 'none')
})

test('sim CLI code selects that sim', () => {
  assert.deepEqual(selectUnitScope(['src/sims/terminal-twin/cli/run.ts']).scope, ['terminal-twin'])
})

test('a brand-new sim folder selects it by folder name', () => {
  assert.deepEqual(selectUnitScope(['src/sims/yardshift/definition.ts']).scope, ['yardshift'])
})

test('other paths run no unit tests', () => {
  const r = selectUnitScope(['knowledge-base/x.txt', 'available-media/a.glb', '.ai/plans/p.txt'])
  assert.equal(r.scope, 'none')
  assert.match(why(r, 'knowledge-base/x.txt'), /no unit tests/)
})

test('no changed paths: none', () => {
  assert.equal(selectUnitScope([]).scope, 'none')
})

test('projectsFor: all runs every project; a sim without tests is skipped with a reason', () => {
  assert.deepEqual(projectsFor('all', ['terminal-twin']), { projects: 'all', skipped: [] })
  assert.deepEqual(projectsFor('none', ['terminal-twin']), { projects: [], skipped: [] })
  const r = projectsFor(['box-empire', 'terminal-twin'], ['stowage-master', 'terminal-twin'])
  assert.deepEqual(r.projects, ['terminal-twin'])
  assert.equal(r.skipped[0].sim, 'box-empire')
  assert.match(r.skipped[0].reason, /no unit tests/)
})

const cli = fileURLToPath(new URL('./unit-select.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

test('CLI: the first line names the base used', () => {
  const r = run('HEAD')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout.split('\n')[0], /^unit-select: base [0-9a-f]{7,} \(given\)$/)
  assert.match(r.stdout, /unit-select: scope /)
})

test('CLI: an unresolvable base exits non-zero', () => {
  const r = run('no-such-ref-379')
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /no-such-ref-379/)
})

test('CLI --json: one JSON object with base, scope and projects', () => {
  const r = run('--json', 'HEAD')
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.match(j.base, /^[0-9a-f]{40}$/)
  assert.ok('scope' in j && 'projects' in j && Array.isArray(j.reasons))
})

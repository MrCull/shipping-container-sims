// Run: node --test scripts/test-smoke-select.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GROUPS } from './smoke-groups.mjs'
import { selectGroups, parseMap } from './smoke-select.mjs'

const map = parseMap(readFileSync(new URL('./smoke-map.txt', import.meta.url), 'utf8'))
const pick = (labels, files, specGroup = () => null) => selectGroups({ labels, files, map, specGroup })
const names = (r) => r.groups.map((g) => g.group)

test('labels only: core plus each smoke:<group> label, with the label as the reason', () => {
  const r = pick(['smoke:camera', 'smoke:yard', 'bug'], ['src/sims/terminal-twin/modules/unmappedThing.ts'])
  assert.deepEqual(names(r), ['core', 'camera', 'yard'])
  assert.match(r.groups.find((g) => g.group === 'camera').reasons.join(), /label smoke:camera/)
})

test('an unknown smoke:<group> label is reported, not run', () => {
  const r = pick(['smoke:nope'], ['src/a.ts'])
  assert.deepEqual(names(r), ['core'])
  assert.match(r.warnings.join(), /smoke:nope/)
})

test('paths only: the map assigns groups, with the path as the reason', () => {
  const r = pick([], ['src/sims/terminal-twin/components/debug/DebugPanel.vue'])
  assert.deepEqual(names(r), ['core', 'analysis'])
  assert.match(r.groups[1].reasons.join(), /components\/debug\/DebugPanel\.vue/)
})

test('union of labels and paths', () => {
  const r = pick(['smoke:setup'], ['src/sims/terminal-twin/modules/bayViewerLayout.ts'])
  assert.deepEqual(names(r), ['core', 'setup', 'vessel'])
})

test('the plain smoke label runs every group', () => {
  const r = pick(['smoke'], ['src/a.ts'])
  assert.deepEqual(names(r), GROUPS)
})

test('no change under src/ and no smoke label runs nothing', () => {
  const r = pick(['bug'], ['README.md', 'scripts/foo.sh', '.github/workflows/pr-checks.yml'])
  assert.deepEqual(names(r), [])
  assert.match(r.why, /no file under src\//)
})

test('labels win over the no-src rule: smoke runs every group, smoke:<group> runs core and that group', () => {
  const docs = ['README.md', 'docs/agents/tooling.md']
  assert.deepEqual(names(pick(['smoke'], docs)), GROUPS)
  assert.deepEqual(names(pick(['smoke:camera'], docs)), ['core', 'camera'])
  assert.deepEqual(names(pick(['smoke:camera'], [])), ['core', 'camera'])
})

test('CLI-only, Markdown and unit-test changes run core only', () => {
  const r = pick([], [
    'src/sims/terminal-twin/cli/run.ts',
    'src/sims/terminal-twin/cli/assets/truckModel.ts',
    'src/sims/terminal-twin/docs/engine.md',
    'src/sims/terminal-twin/tests/camera-rig.test.ts',
  ])
  assert.deepEqual(names(r), ['core'])
})

test('the pinch-gesture module maps to camera, which holds the phone pinch spec', () => {
  assert.deepEqual(names(pick([], ['src/sims/terminal-twin/modules/pinchGesture.ts'])), ['core', 'camera'])
})

test('a changed smoke spec selects its own group; a shared spec helper selects all', () => {
  const spec = 'src/sims/terminal-twin/tests/browser/terminal-twin-kpi.smoke.ts'
  const r = pick([], [spec], (f) => (f === spec ? 'analysis' : null))
  assert.deepEqual(names(r), ['core', 'analysis'])
  assert.deepEqual(names(pick([], ['src/sims/terminal-twin/tests/browser/openTwin.ts'])), GROUPS)
})

test('every group named in the map is a known group', () => {
  for (const { groups } of map) for (const g of groups) assert.ok(g === 'all' || GROUPS.includes(g), g)
})

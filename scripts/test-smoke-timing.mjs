// Run: node --test scripts/test-smoke-timing.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTable, sceneOf } from './smoke-timing.mjs'

const report = {
  suites: [
    {
      file: 'a/ui.smoke.ts',
      specs: [],
      suites: [
        {
          file: 'a/ui.smoke.ts',
          specs: [{ title: 'opens menu', file: 'a/ui.smoke.ts', tests: [{ projectName: 'dev', status: 'expected', results: [{ duration: 1500 }] }] }],
        },
      ],
    },
    {
      file: 'b/scene.smoke.ts',
      specs: [
        { title: 'draws', file: 'b/scene.smoke.ts', tests: [{ projectName: 'dev', status: 'flaky', results: [{ duration: 20000 }, { duration: 10000 }] }] },
      ],
    },
  ],
}
const sources = {
  'a/ui.smoke.ts': "await page.getByRole('button').click()",
  'b/scene.smoke.ts':
    "const px = await page.evaluate(() => canvas.getContext('2d').getImageData(0,0,1,1)); await page.screenshot(); window.__tt.snapshot()",
}

test('scene heuristic', () => {
  assert.equal(sceneOf(sources['a/ui.smoke.ts']), 'ui')
  assert.equal(sceneOf(sources['b/scene.smoke.ts']), 'canvas+shots+dev-api')
})

test('table is sorted slowest first with a scene column', () => {
  const lines = renderTable(report, (f) => sources[f] ?? '').split('\n')
  assert.match(lines[0], /Scene \|$/)
  assert.match(lines[2], /^\| b\/scene\.smoke\.ts \| draws \| dev \| 30\.0 s \| flaky \| canvas\+shots\+dev-api \|$/)
  assert.match(lines[3], /^\| a\/ui\.smoke\.ts \| opens menu \| dev \| 1\.5 s \| expected \| ui \|$/)
})

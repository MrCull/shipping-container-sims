// Run: node --test scripts/test-check-doc-engine-version.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOCS, engineVersionOf, staleDocs } from './check-doc-engine-version.mjs'

const doc = (name, version) => ({ path: `${DOCS}${name}`, text: `# T\n\nChecked against ENGINE_VERSION ${version}.\n` })

test('reads ENGINE_VERSION from the simulation source', () => {
  assert.equal(engineVersionOf("export const ENGINE_VERSION = '0.59.0'\n"), '0.59.0')
})

test('flags a changed doc checked against an older engine', () => {
  assert.deepEqual(staleDocs([doc('subsystems/yard.md', '0.53.0')], '0.59.0'), [
    `${DOCS}subsystems/yard.md: checked against 0.53.0, engine is 0.59.0`,
  ])
})

test('passes a doc at the current version, a doc without the line, and reports', () => {
  const docs = [
    doc('decision-points.md', '0.59.0'),
    { path: `${DOCS}glossary-notes.md`, text: '# no version line\n' },
    doc('reports/throughput-and-speed-report.md', '0.40.0'),
  ]
  assert.deepEqual(staleDocs(docs, '0.59.0'), [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_MD_LINE, longLines } from './check-md-line-length.mjs'

test('longLines reports each line over the limit with its 1-based number and length', () => {
  const text = ['short', 'x'.repeat(MAX_MD_LINE), 'y'.repeat(MAX_MD_LINE + 1)].join('\n')
  assert.deepEqual(longLines(text), [{ line: 3, length: MAX_MD_LINE + 1 }])
})

test('longLines counts characters, not UTF-16 units', () => {
  assert.deepEqual(longLines('\u{1F6A2}'.repeat(10), 10), [])
})

test('CLI: exits 1 and names file and line for a long line, exits 0 otherwise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-line-'))
  const ok = join(dir, 'ok.md')
  const bad = join(dir, 'bad.md')
  writeFileSync(ok, '# fine\n')
  writeFileSync(bad, `# title\n${'z'.repeat(MAX_MD_LINE + 5)}\n`)
  execFileSync(process.execPath, ['scripts/check-md-line-length.mjs', ok])
  let err = null
  try {
    execFileSync(process.execPath, ['scripts/check-md-line-length.mjs', ok, bad], { stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    err = e
  }
  assert.ok(err)
  assert.equal(err.status, 1)
  assert.match(err.stderr, new RegExp(`bad\\.md:2 \\(${MAX_MD_LINE + 5} characters\\)`))
})

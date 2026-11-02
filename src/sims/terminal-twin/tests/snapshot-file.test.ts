import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJsonFile, writeJsonFile } from '../cli/snapshotFile'
import { createSimulation, restoreSimulation, type SimSnapshot } from '../engine'
import { fixtures } from '../scenario/fixtures'

const dir = mkdtempSync(join(tmpdir(), 'tt-snapfile-'))

describe('snapshot files in pieces (#216)', () => {
  it('writes JSON that JSON.parse reads, and reads it back across tiny buffer refills', () => {
    const value = {
      a: [1, 'x"y\\z', null, { deep: { deeper: { deepest: [1, { k: 'v' }] } } }, [], {}],
      b: { s: 'unicode é中 "q" }]{[', n: -1.5e3, t: true, u: undefined, f: null },
      c: 'plain',
    }
    const file = join(dir, 'v.json')
    writeJsonFile(file, value)
    const expected = JSON.parse(JSON.stringify(value)) as unknown
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected)
    for (const bytes of [1, 2, 7, 64]) expect(readJsonFile(file, bytes)).toEqual(expected)
  })

  it('a snapshot written and read in pieces resumes to the uninterrupted event-log hash', () => {
    const config = fixtures['tracer-1sts-10-boxes']
    const full = createSimulation(config)
    full.runUntil()
    const first = createSimulation(config)
    first.runUntil({ maxEvents: 40 })
    const file = join(dir, 's.json')
    writeJsonFile(file, first.snapshot())
    const resumed = restoreSimulation(readJsonFile<SimSnapshot>(file, 4096))
    resumed.runUntil()
    expect(resumed.eventLogHash()).toBe(full.eventLogHash())
  })
})

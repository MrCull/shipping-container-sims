/**
 * Golden summaries: each fixture's KPIs + event-log hash are committed next
 * to it as `<name>.golden.json`. Drift fails here. Regenerate ONLY on an
 * intentional behaviour change:
 *   UPDATE_GOLDEN=1 npm test
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSimulation, summarizeRun } from '../engine'
import { fixtures } from '../scenario/fixtures'

const update = process.env.UPDATE_GOLDEN === '1'
const fixturesDir = fileURLToPath(new URL('../scenario/fixtures/', import.meta.url))

describe('golden summaries', () => {
  for (const [name, config] of Object.entries(fixtures)) {
    it(`${name} matches its golden summary`, () => {
      const sim = createSimulation(config)
      sim.runUntil()
      const summary = summarizeRun(sim)
      const file = `${fixturesDir}${name}.golden.json`
      if (update) {
        writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`)
        return
      }
      expect(existsSync(file), `missing ${file}: run UPDATE_GOLDEN=1 npm test`).toBe(true)
      const golden = JSON.parse(readFileSync(file, 'utf8'))
      expect(summary, `${name} drifted from its golden summary (UPDATE_GOLDEN=1 npm test if intended)`).toEqual(golden)
    })
  }
})

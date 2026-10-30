/**
 * Golden summaries: each fixture's KPIs + event-log hash are committed next
 * to it as `<name>.golden.json`. Drift fails here with a field-by-field diff.
 * Regenerate ONLY on an intentional behaviour change, with an explicit flag:
 *   pnpm run tt:golden --update      (or UPDATE_GOLDEN=1 pnpm test)
 */
import { describe, it } from 'vitest'
import { checkFixtureGolden } from '../cli/golden'
import { fixtures } from '../scenario/fixtures'

const update = process.env.UPDATE_GOLDEN === '1'

describe('golden summaries', () => {
  for (const name of Object.keys(fixtures)) {
    it(`${name} matches its golden summary`, () => {
      const result = checkFixtureGolden(name, { update })
      if (result.status === 'drift' || result.status === 'missing') throw new Error(`${name} ${result.report}`)
    })
  }
})

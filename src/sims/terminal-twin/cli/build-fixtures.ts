/**
 * Regenerate scenario fixture JSON from `scenario/fixtures/definitions.ts`.
 *   npm run tt:fixtures
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fixtureDefinitions } from '../scenario/fixtures/definitions'

const dir = fileURLToPath(new URL('../scenario/fixtures/', import.meta.url))
for (const [name, build] of Object.entries(fixtureDefinitions)) {
  const file = `${dir}${name}.json`
  writeFileSync(file, `${JSON.stringify(build(), null, 2)}\n`)
  console.log(`wrote ${file}`)
}

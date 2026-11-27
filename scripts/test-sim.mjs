#!/usr/bin/env node
/**
 * Run one sim's unit tests (its vitest project) and print the total wall time.
 *
 *   pnpm test:sim <id> [extra vitest args]
 *
 * An unknown id (no `src/sims/<id>/` folder with a `*.test.ts`) exits 2 with the list of known ids.
 *
 * Test: node --test scripts/test-vitest-projects.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { simIdsWithTests } from './vitest-projects.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const [id, ...rest] = process.argv.slice(2)
const known = simIdsWithTests(root)

if (!id) {
  console.error(`usage: pnpm test:sim <id> [vitest args]; known ids: ${known.join(', ')}`)
  process.exit(2)
}
if (!known.includes(id)) {
  console.error(`test:sim: unknown sim "${id}" (or it has no unit tests); known ids: ${known.join(', ')}`)
  process.exit(2)
}

const start = performance.now()
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--project', id, ...rest], { cwd: root, stdio: 'inherit' })
const seconds = ((performance.now() - start) / 1000).toFixed(1)
console.log(`test:sim ${id}: total wall time ${seconds} s (exit ${r.status ?? 1})`)
process.exit(r.status ?? 1)

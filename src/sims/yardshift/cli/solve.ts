/**
 * `pnpm run ys:solve [level...]`: proves each level's minimum rehandles with the solver and writes
 * `fixtures/level-NN.json` (minimum plus one optimal action list). With no arguments it solves all 13 levels.
 * `--check` writes nothing and exits 1 when a fixture is missing or differs. Exits 2 when a level has no solution.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVELS, levelByNumber } from '../modules/levels'
import { solve } from '../modules/solver'
import type { LevelFixture } from '../modules/fixtures'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const args = process.argv.slice(2)
const check = args.includes('--check')
const wanted = args.filter((a) => a !== '--check').map(Number)
const levels = wanted.length ? wanted.map((n) => levelByNumber(n)!) : LEVELS
let exit = 0

for (const level of levels) {
  if (!level) throw new Error(`ys:solve: unknown level in ${args.join(' ')}`)
  const t0 = performance.now()
  const solution = solve(level)
  const ms = (performance.now() - t0).toFixed(0)
  if (!solution) {
    console.log(`level ${level.number} ${level.name}: NO SOLUTION within ${level.maxRehandles} rehandles (${ms} ms)`)
    exit = 2
    continue
  }
  const fixture: LevelFixture = { level: level.number, minRehandles: solution.minRehandles, actions: solution.actions }
  const file = join(dir, `level-${String(level.number).padStart(2, '0')}.json`)
  const actions = fixture.actions.map((a) => `    ${JSON.stringify(a)}`).join(',\n')
  const text = `{\n  "level": ${fixture.level},\n  "minRehandles": ${fixture.minRehandles},\n  "actions": [\n${actions}\n  ]\n}\n`
  console.log(`level ${level.number} ${level.name}: min ${solution.minRehandles}, ${solution.actions.length} actions (${ms} ms)`)
  if (check) {
    let old = ''
    try {
      old = readFileSync(file, 'utf8')
    } catch {
      /* missing */
    }
    if (old !== text) {
      console.log(`  fixture ${file} is missing or stale`)
      exit = exit || 1
    }
  } else writeFileSync(file, text)
}
process.exit(exit)

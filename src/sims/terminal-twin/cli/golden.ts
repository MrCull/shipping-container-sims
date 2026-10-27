/**
 * Golden summaries: check (default) or regenerate (`--update` only) each
 * fixture's `<name>.golden.json`. Used by `tests/golden.test.ts` and the
 * `npm run tt:golden` command (entry: `golden-cli.ts`).
 *
 *   npm run tt:golden                         check every fixture; exit 1 on drift or a missing golden
 *   npm run tt:golden -- --update             rewrite goldens to the current outcome (intentional changes only)
 *   npm run tt:golden -- --fixture <name>     one fixture
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createSimulation, jsonDifferences, summarizeRun, type RunSummary } from '../engine'
import { fixtures } from '../scenario/fixtures'

export const GOLDEN_DIR = fileURLToPath(new URL('../scenario/fixtures/', import.meta.url))

export type GoldenStatus = 'match' | 'drift' | 'missing' | 'created' | 'updated'

export interface GoldenResult {
  status: GoldenStatus
  /** Human-readable report: one line per differing field, plus how to accept the change. */
  report: string
}

const show = (v: unknown): string => (v === undefined ? '(absent)' : JSON.stringify(v))

function valueAt(obj: unknown, path: string): unknown {
  let cur = obj
  for (const key of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** One line per differing field: `kpis.movesCompleted: golden 9 → actual 10`. */
export function goldenDiffLines(golden: unknown, actual: unknown): string[] {
  return jsonDifferences(golden, actual).map((path) =>
    path === '(root)'
      ? `(whole summary): golden ${show(golden)} → actual ${show(actual)}`
      : `${path}: golden ${show(valueAt(golden, path))} → actual ${show(valueAt(actual, path))}`,
  )
}

/** Compare a run summary with its golden file; rewrite the file only when `update` is true. */
export function checkGolden(file: string, summary: RunSummary, { update }: { update: boolean }): GoldenResult {
  const write = () => writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`)
  if (!existsSync(file)) {
    if (update) {
      write()
      return { status: 'created', report: `created ${file}` }
    }
    return { status: 'missing', report: `missing ${file}\n  create it with: npm run tt:golden -- --update` }
  }
  const golden = JSON.parse(readFileSync(file, 'utf8')) as unknown
  const lines = goldenDiffLines(golden, summary)
  if (lines.length === 0) return { status: 'match', report: 'matches' }
  if (update) {
    write()
    return { status: 'updated', report: ['updated:', ...lines.map((l) => `  ${l}`)].join('\n') }
  }
  return {
    status: 'drift',
    report: [
      `drifted from ${file}:`,
      ...lines.map((l) => `  ${l}`),
      'Find the first diverging event: write the event log before and after your change',
      '  (npm run tt:run -- --fixture <name> --events before.jsonl) and run npm run tt:diff -- before.jsonl after.jsonl.',
      'If the change is intended: npm run tt:golden -- --update (or UPDATE_GOLDEN=1 npm test), review the diff, explain it in the commit.',
    ].join('\n'),
  }
}

/** Run a fixture to the end and check its golden summary. */
export function checkFixtureGolden(name: string, options: { update: boolean; dir?: string }): GoldenResult {
  const config = fixtures[name]
  if (!config) throw new Error(`Unknown fixture "${name}"`)
  const sim = createSimulation(config)
  sim.runUntil()
  return checkGolden(join(options.dir ?? GOLDEN_DIR, `${name}.golden.json`), summarizeRun(sim), options)
}

export const GOLDEN_USAGE = `Usage: npm run tt:golden -- [--update] [--fixture <name>] [--dir <folder>]

  (no flags)        Check every fixture's golden summary; exit 1 on drift or a missing golden
  --update          Rewrite the goldens to the current outcome (intentional behaviour changes only)
  --fixture <name>  Only this fixture (${Object.keys(fixtures).join(', ')})
  --dir <folder>    Golden folder (default: scenario/fixtures/)`

export function runGoldenCli(argv: string[], print: (line: string) => void = console.log): number {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        update: { type: 'boolean', default: false },
        fixture: { type: 'string' },
        dir: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    }))
  } catch (err) {
    print(`Error: ${(err as Error).message}`)
    print(GOLDEN_USAGE)
    return 2
  }
  if (values.help) {
    print(GOLDEN_USAGE)
    return 0
  }
  if (values.fixture && !fixtures[values.fixture]) {
    print(`Error: unknown fixture "${values.fixture}"`)
    print(GOLDEN_USAGE)
    return 2
  }
  const names = values.fixture ? [values.fixture] : Object.keys(fixtures)
  let failed = 0
  for (const name of names) {
    const result = checkFixtureGolden(name, { update: values.update, dir: values.dir })
    if (result.status === 'drift' || result.status === 'missing') failed++
    const label = result.status === 'drift' ? 'DRIFT' : result.status
    print(`${name}: ${label}${result.status === 'match' ? '' : `\n${result.report}`}`)
  }
  return failed > 0 ? 1 : 0
}

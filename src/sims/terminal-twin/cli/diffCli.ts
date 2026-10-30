/**
 * Run diff CLI (logic; `diff.ts` is the process entry point). Reports the
 * first event at which two runs differ.
 *
 *   pnpm run tt:diff a.jsonl b.jsonl                    two saved event logs (or snapshot .json files)
 *   pnpm run tt:diff --fixture <name> --b-seed 7        two seeds of one scenario
 *   pnpm run tt:diff --fixture <name> --b-handlers highest-free-lane   two strategies
 *
 * Exit codes: 0 no divergence, 1 diverged, 2 usage error.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createSimulation, diffEventLogs, type EngineEvent, type SimSnapshot } from '../engine'
import { handlerSets } from './handlerSets'
import { formatSimTime, loadScenario, parseUntil, UsageError } from './runCli'

export const DIFF_USAGE = `Usage: pnpm run tt:diff <a.jsonl|a.snapshot.json> <b.jsonl|b.snapshot.json> [--context n]
       pnpm run tt:diff (--fixture <name|file.json> | --preset <name>) [options]

  Two files: event logs written by tt:run --events (JSON lines), or snapshots
  written by tt:run --snapshot (their embedded log is compared).

  Two runs of one scenario (side B defaults to side A's settings):
  --seed <n>             Seed for both runs        --a-seed / --b-seed <n>
  --handlers <name>      Handler set for both      --a-handlers / --b-handlers <name> (${Object.keys(handlerSets).join(', ')})
  --until <cond>         Stop condition for both runs (see tt:run --help)
  --context <n>          Events of context around the divergence (default 3)

Exit codes: 0 no divergence, 1 diverged, 2 usage error.`

function readLog(file: string): EngineEvent[] {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.jsonl'))
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as EngineEvent)
  const json = JSON.parse(text) as SimSnapshot | EngineEvent[]
  if (Array.isArray(json)) return json
  if (json.kind === 'terminal-twin-snapshot') return json.log
  throw new UsageError(`${file}: not an event log (.jsonl) or snapshot`)
}

const brief = (e: EngineEvent): string =>
  `#${e.seq} t=${formatSimTime(e.t)} ${e.type} (id ${e.id}, causedBy ${e.causedBy ?? '-'}) ${JSON.stringify(e.payload)}`

export function runDiffCli(argv: string[], print: (line: string) => void = console.log): number {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        fixture: { type: 'string' },
        preset: { type: 'string' },
        seed: { type: 'string' },
        'a-seed': { type: 'string' },
        'b-seed': { type: 'string' },
        handlers: { type: 'string', default: 'default' },
        'a-handlers': { type: 'string' },
        'b-handlers': { type: 'string' },
        until: { type: 'string' },
        context: { type: 'string', default: '3' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    })
    if (values.help) {
      print(DIFF_USAGE)
      return 0
    }
    const context = Number(values.context)
    if (!Number.isInteger(context) || context < 0) throw new UsageError(`Bad --context "${values.context}"`)

    let a: EngineEvent[]
    let b: EngineEvent[]
    let labelA: string
    let labelB: string
    if (positionals.length > 0) {
      if (positionals.length !== 2) throw new UsageError('Give exactly two files to compare')
      if (values.fixture || values.preset) throw new UsageError('Give either two files or --fixture/--preset')
      ;[labelA, labelB] = positionals
      a = readLog(labelA)
      b = readLog(labelB)
    } else {
      const config = loadScenario(values.fixture, values.preset)
      const condition = parseUntil(values.until)
      const side = (seedText: string | undefined, handlersName: string) => {
        const seed = seedText === undefined ? undefined : Number(seedText)
        if (seed !== undefined && !Number.isInteger(seed)) throw new UsageError(`Bad seed "${seedText}"`)
        const handlers = handlerSets[handlersName]
        if (!handlers) throw new UsageError(`Unknown handler set "${handlersName}"`)
        const sim = createSimulation(config, handlers, { seed, invariants: { failFast: false } })
        sim.runUntil(condition)
        return { log: [...sim.eventLog()], label: `seed ${sim.seed}, handlers ${handlersName}` }
      }
      const runA = side(values['a-seed'] ?? values.seed, values['a-handlers'] ?? values.handlers)
      const runB = side(values['b-seed'] ?? values.seed, values['b-handlers'] ?? values.handlers)
      ;({ log: a, label: labelA } = runA)
      ;({ log: b, label: labelB } = runB)
    }

    print(`A: ${labelA} (${a.length} events)`)
    print(`B: ${labelB} (${b.length} events)`)
    const diff = diffEventLogs(a, b, { context })
    if (!diff.diverged) {
      print(`No divergence: ${diff.commonEvents} events identical`)
      return 0
    }
    print(`First divergence at seq ${diff.seq} (after ${diff.commonEvents} identical events)`)
    print(`Differing fields: ${diff.differences.join(', ')}`)
    if (diff.before.length) {
      print('Common context before:')
      for (const e of diff.before) print(`    ${brief(e)}`)
    }
    print(`A > ${diff.a ? brief(diff.a) : '(run A has no more events)'}`)
    for (const e of diff.afterA) print(`    ${brief(e)}`)
    print(`B > ${diff.b ? brief(diff.b) : '(run B has no more events)'}`)
    for (const e of diff.afterB) print(`    ${brief(e)}`)
    return 1
  } catch (err) {
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      print(`Error: ${(err as Error).message}`)
      print(DIFF_USAGE)
      return 2
    }
    throw err
  }
}

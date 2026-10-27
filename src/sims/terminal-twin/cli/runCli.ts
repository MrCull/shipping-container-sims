/**
 * Headless CLI runner (logic; `run.ts` is the process entry point).
 *
 *   npm run tt:run -- --fixture tracer-1sts-10-boxes [--seed 7] [--until moves:5]
 *                     [--out summary.json] [--events events.jsonl] [--handlers default]
 *
 * Exit codes: 0 ok, 1 invariant violation or engine error, 2 usage error.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createSimulation, summarizeRun, type EventType, type RunCondition, type RunSummary } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'
import { handlerSets } from './handlerSets'

export const USAGE = `Usage: npm run tt:run -- (--fixture <name|file.json> | --preset <name>) [options]

  --fixture <name|path>  Scenario fixture name (${Object.keys(fixtures).join(', ')}) or a ScenarioConfig JSON file
  --preset <name>        Scenario preset (${Object.keys(presets).join(', ') || 'none yet'})
  --seed <n>             Override the scenario seed
  --until <cond>         Stop condition: end (default) | time:<s> | moves:<n> | vessels:<n> | event:<Type>
  --handlers <name>      Handler set: ${Object.keys(handlerSets).join(', ')}
  --no-fail-fast         Keep running after an invariant violation
  --out <file>           Write the run summary JSON
  --events <file>        Write the event log as JSON lines`

class UsageError extends Error {}

function loadScenario(fixture: string | undefined, preset: string | undefined): ScenarioConfig {
  if (fixture && preset) throw new UsageError('Use either --fixture or --preset, not both')
  if (preset) {
    const build = presets[preset]
    if (!build) throw new UsageError(`Unknown preset "${preset}" (available: ${Object.keys(presets).join(', ') || 'none yet'})`)
    return build()
  }
  if (!fixture) throw new UsageError('Missing --fixture or --preset')
  if (fixtures[fixture]) return fixtures[fixture]
  if (fixture.endsWith('.json')) return JSON.parse(readFileSync(fixture, 'utf8')) as ScenarioConfig
  throw new UsageError(`Unknown fixture "${fixture}" (available: ${Object.keys(fixtures).join(', ')})`)
}

function parseUntil(text: string | undefined): RunCondition {
  if (!text || text === 'end') return {}
  const [kind, value] = text.split(':')
  const n = Number(value)
  if (kind === 'event' && value) return { eventType: value as EventType }
  if (value === undefined || !Number.isFinite(n)) throw new UsageError(`Bad --until "${text}"`)
  if (kind === 'time') return { time: n }
  if (kind === 'moves') return { moves: n }
  if (kind === 'vessels') return { vesselsCompleted: n }
  throw new UsageError(`Bad --until "${text}"`)
}

export function formatSimTime(seconds: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0')
  const days = Math.floor(seconds / 86400)
  const rest = seconds - days * 86400
  const hms = `${p(rest / 3600)}:${p((rest % 3600) / 60)}:${(rest % 60).toFixed(3).padStart(6, '0')}`
  return days > 0 ? `day ${days} ${hms}` : hms
}

function formatSummary(s: RunSummary, stopped: string): string[] {
  const lines = [
    `Terminal Twin — ${s.scenario} (seed ${s.seed})`,
    `Stopped:          ${stopped}${s.endReason ? ` (${s.endReason})` : ''}`,
    `Sim time:         ${formatSimTime(s.kpis.simTimeS)}  [${s.kpis.eventsProcessed} events]`,
    `Event-log hash:   ${s.eventLogHash}`,
    `Moves completed:  ${s.kpis.movesCompleted}`,
    `Vessels done:     ${s.kpis.vesselsCompleted}`,
  ]
  for (const [id, k] of Object.entries(s.kpis.sts))
    lines.push(`  ${id.padEnd(15)} ${k.moves} moves, ${k.grossMovesPerHour ?? '–'} gross moves/h`)
  for (const [id, v] of Object.entries(s.kpis.vessels))
    lines.push(`  ${id.padEnd(15)} turnaround ${v.turnaroundS === null ? '–' : `${v.turnaroundS} s`}`)
  lines.push(`Invariants:       ${s.invariants.enabled ? `${s.invariants.checks} checks, ${s.invariants.violations} violations` : 'off'}`)
  const e = s.firstError
  lines.push(`First error:      ${e ? `event #${e.eventId} at ${formatSimTime(e.t)}: ${e.message}` : 'none'}`)
  return lines
}

/** Run the CLI; returns the process exit code. `print` receives output lines. */
export function runCli(argv: string[], print: (line: string) => void = console.log): number {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        fixture: { type: 'string' },
        preset: { type: 'string' },
        seed: { type: 'string' },
        until: { type: 'string' },
        handlers: { type: 'string', default: 'default' },
        'no-fail-fast': { type: 'boolean', default: false },
        out: { type: 'string' },
        events: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    })
    if (values.help) {
      print(USAGE)
      return 0
    }
    const config = loadScenario(values.fixture, values.preset)
    const seed = values.seed === undefined ? undefined : Number(values.seed)
    if (seed !== undefined && !Number.isInteger(seed)) throw new UsageError(`Bad --seed "${values.seed}"`)
    const handlers = handlerSets[values.handlers]
    if (!handlers) throw new UsageError(`Unknown handler set "${values.handlers}"`)
    const condition = parseUntil(values.until)

    const sim = createSimulation(config, handlers, { seed, invariants: { failFast: !values['no-fail-fast'] } })
    const result = sim.runUntil(condition)
    const summary = summarizeRun(sim)
    for (const line of formatSummary(summary, result.reason)) print(line)
    if (values.out) writeFileSync(values.out, `${JSON.stringify(summary, null, 2)}\n`)
    if (values.events) writeFileSync(values.events, sim.eventLog().map((e) => JSON.stringify(e)).join('\n') + '\n')
    return summary.invariants.violations > 0 || summary.firstError ? 1 : 0
  } catch (err) {
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      print(`Error: ${(err as Error).message}`)
      print(USAGE)
      return 2
    }
    throw err
  }
}

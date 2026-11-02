/**
 * Where a run's time goes (spec #166, logic; `profile.ts` is the process entry point):
 *
 *   pnpm run tt:profile <preset|fixture> --until <seconds> [--json profile.json]
 *
 * Runs the scenario to `--until` (or to its own end, if that comes first) and prints, from the KPI collector and the event
 * log: moves per clock hour per STS, ASC and SHC idle share per clock hour, the STS time breakdown (`engine/stsProductivity`),
 * the per-box waits of discharge and load boxes (`engine/boxWaits`) and the longest waits. `--json` writes the same data.
 *
 * Exit codes: 0 ok, 1 the run hit an engine error, 2 usage error.
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  BOX_WAIT_PATHS,
  BOX_WAIT_STAGES,
  boxWaits,
  createSimulation,
  formatStsProductivity,
  stsProductivity,
  type BoxWait,
  type BoxWaitReport,
  type HourBucket,
  type KpiSeriesEntity,
  type KpiSeriesReport,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { ScenarioConfig } from '../scenario/types'
import { handlerSets } from './handlerSets'
import { formatSimTime } from './runCli'

export const PROFILE_USAGE = `Usage: pnpm run tt:profile <preset|fixture> --until <seconds> [--json <file>]

  <preset|fixture>   A scenario preset (${Object.keys(presets).join(', ')}) or fixture (${Object.keys(fixtures).join(', ')})
  --until <seconds>  Run to this sim time (required). The profile covers 0 to that time, or to the scenario's end if it comes first
  --json <file>      Also write the same data as JSON`

class UsageError extends Error {}

/** The scenario named on the command line: a preset first, then a fixture. */
function scenarioNamed(name: string): ScenarioConfig {
  const has = (table: object) => Object.prototype.hasOwnProperty.call(table, name)
  if (has(presets)) return presets[name]()
  if (has(fixtures)) return fixtures[name]
  throw new UsageError(
    `Unknown fixture or preset "${name}" (fixtures: ${Object.keys(fixtures).join(', ')}; presets: ${Object.keys(presets).join(', ')})`,
  )
}

interface PercentEntity {
  hourly: (number | null)[]
  total: number | null
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const hourLabel = (h: HourBucket) => `${h.clockDay > 0 ? `d${h.clockDay} ` : ''}${String(h.hourOfDay).padStart(2, '0')}:00`

/** One section: a heading, a header row of columns, one indented row per name, then a blank line. */
function grid(heading: string, columns: string[], rows: [string, string[]][]): string[] {
  const nameW = Math.max(7, ...rows.map(([n]) => n.length)) + 2
  const cellW = Math.max(8, ...columns.map((c) => c.length)) + 2
  const line = (first: string, cells: string[]) => `  ${first.padEnd(nameW)}${cells.map((c) => c.padStart(cellW)).join('')}`
  return [heading, line('', columns), ...rows.map(([name, cells]) => line(name, cells)), '']
}

/** The profile as data: the same numbers the text prints. */
export interface ProfileReport {
  format: 'terminal-twin-profile'
  scenario: string
  seed: number
  until: number
  endS: number
  stopped: string
  hours: HourBucket[]
  sts: { moves: Record<string, { hourly: (number | null)[]; total: number | null }> }
  asc: { idlePct: Record<string, PercentEntity> }
  shc: { idlePct: Record<string, PercentEntity> }
  stsProductivity: ReturnType<typeof stsProductivity>
  boxWaits: BoxWaitReport
}

function idleOf(e: KpiSeriesEntity): PercentEntity {
  return { hourly: e.hourly.map((v) => (v === null ? null : r3(100 - v))), total: e.total === null ? null : r3(100 - e.total) }
}

function profileOf(report: KpiSeriesReport, data: Omit<ProfileReport, 'format' | 'hours' | 'sts' | 'asc' | 'shc'>): ProfileReport {
  const moves = report.series['sts.moves'].entities
  const ascUtil = report.series['asc.utilisation-pct'].entities
  const shcIdle = report.series['shc.idle-pct'].entities
  return {
    format: 'terminal-twin-profile',
    ...data,
    hours: report.hours,
    sts: { moves: Object.fromEntries(Object.entries(moves).map(([id, e]) => [id, { hourly: e.hourly, total: e.total }])) },
    asc: { idlePct: Object.fromEntries(Object.entries(ascUtil).map(([id, e]) => [id, idleOf(e)])) },
    shc: { idlePct: Object.fromEntries(Object.entries(shcIdle).map(([id, e]) => [id, { hourly: e.hourly, total: e.total }])) },
  }
}

function textOf(p: ProfileReport, report: KpiSeriesReport): string[] {
  const hours = report.hours.map(hourLabel)
  const cols = [...hours, 'run']
  const lines: string[] = [
    `Terminal Twin profile, ${p.scenario} (seed ${p.seed}), 0 to ${formatSimTime(p.endS)}`,
    `Stopped:          ${p.stopped}`,
    '',
  ]

  const stsIds = Object.keys(p.sts.moves)
  const stsRows: [string, string[]][] = stsIds.map((id) => {
    const e = p.sts.moves[id]
    return [id, [...hours.map((_, i) => String(e.hourly[i] ?? 0)), String(e.total ?? 0)]]
  })
  stsRows.push([
    'ALL',
    [...hours.map((_, i) => String(stsIds.reduce((n, id) => n + (p.sts.moves[id].hourly[i] ?? 0), 0))), String(stsIds.reduce((n, id) => n + (p.sts.moves[id].total ?? 0), 0))],
  ])
  lines.push(...grid('Moves per clock hour (boxes moved, per STS):', cols, stsRows))

  const pct = (v: number | null) => (v === null ? '–' : v.toFixed(1))
  const pctRows = (entities: Record<string, PercentEntity>): [string, string[]][] =>
    Object.entries(entities).map(([id, e]) => [id, [...hours.map((_, i) => pct(e.hourly[i] ?? null)), pct(e.total)]])
  lines.push(...grid('ASC idle share (%, 100 minus utilisation, per clock hour):', cols, pctRows(p.asc.idlePct)))
  lines.push(...grid('SHC idle share (%, per clock hour):', cols, pctRows(p.shc.idlePct)))

  lines.push('STS time breakdown (share of each crane window, from its first package to the end):')
  lines.push(...formatStsProductivity(p.stsProductivity).split('\n'), '')

  const w = p.boxWaits
  lines.push(
    ...grid(
      'Box waits (mean seconds per box; a box counts on the path it enters):',
      ['boxes', ...BOX_WAIT_STAGES],
      BOX_WAIT_PATHS.map((path) => [path, [String(w.paths[path].boxes), ...BOX_WAIT_STAGES.map((s) => w.paths[path].meanS[s].toFixed(1))]]),
    ),
  )
  lines.push('Top waits (longest first):')
  lines.push(`  ${'box'.padEnd(14)}${'path'.padEnd(11)}${'stage'.padEnd(13)}${'from s'.padStart(10)}${'seconds'.padStart(10)}`)
  for (const x of w.top) lines.push(waitLine(x))
  if (w.top.length === 0) lines.push('  none')
  return lines
}

function waitLine(x: BoxWait): string {
  return `  ${x.containerId.padEnd(14)}${x.path.padEnd(11)}${x.stage.padEnd(13)}${x.startS.toFixed(0).padStart(10)}${x.seconds.toFixed(1).padStart(10)}${x.open ? '  open' : ''}`
}

/** Run the profiler; returns the process exit code. `print` receives output lines. */
export function runProfileCli(argv: string[], print: (line: string) => void = console.log): number {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        until: { type: 'string' },
        json: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    })
    if (values.help) {
      print(PROFILE_USAGE)
      return 0
    }
    if (positionals.length !== 1) throw new UsageError('Give one preset or fixture name')
    const until = Number(values.until)
    if (values.until === undefined || !Number.isFinite(until) || until <= 0) throw new UsageError('--until <seconds> is required (a positive number)')

    const config = scenarioNamed(positionals[0])
    const sim = createSimulation(config, handlerSets.default)
    const result = sim.runUntil({ time: until })
    const endS = Math.min(until, sim.now)
    const events = sim.eventLog()
    const report = sim.kpiSeries()
    const profile = profileOf(report, {
      scenario: config.name,
      seed: sim.seed,
      until,
      endS,
      stopped: result.reason,
      stsProductivity: stsProductivity(events, endS),
      boxWaits: boxWaits(events, endS),
    })
    for (const line of textOf(profile, report)) print(line)
    if (values.json) writeFileSync(values.json, `${JSON.stringify(profile, null, 2)}\n`)
    if (sim.firstError) {
      print(`First error:      ${sim.firstError.message}`)
      return 1
    }
    return 0
  } catch (err) {
    if (err instanceof UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      print(`Error: ${(err as Error).message}`)
      print(PROFILE_USAGE)
      return 2
    }
    throw err
  }
}

/**
 * Headless CLI runner (logic; `run.ts` is the process entry point).
 *
 *   pnpm run tt:run --fixture tracer-1sts-10-boxes [--seed 7] [--until moves:5]
 *                     [--out summary.json] [--events events.jsonl] [--handlers default]
 *                     [--async-mode keep-running|pause] [--strategy dp=name] [--latency dp=spec]
 *                     [--log run.log.jsonl --log-level sts=debug,*=warn] [--snapshot s.json]
 *   pnpm run tt:run --from-snapshot s.json --until time:900   (run only a window)
 *
 * Exit codes: 0 ok, 1 invariant violation or engine error, 2 usage error.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  createSimulation,
  DECISION_POINT_IDS,
  exportRun,
  headlineKpis,
  getStrategy,
  parseLogVerbosity,
  restoreSimulation,
  summarizeRun,
  type AsyncMode,
  type DecisionPointId,
  type DecisionsConfig,
  type EventType,
  type HeadlineKpis,
  type LatencySpec,
  type LogRecord,
  type LogVerbosity,
  type RunCondition,
  type RunSummary,
  type SimSnapshot,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import type { EndConditions, ScenarioConfig, SubsystemMode, SubsystemModes } from '../scenario/types'
import { validateSubsystemModes } from '../scenario/validate'
import { t } from '../i18n/messages'
import { handlerSets } from './handlerSets'

export const USAGE = `Usage: pnpm run tt:run (--fixture <name|file.json> | --preset <name> | --from-snapshot <file>) [options]

  --fixture <name|path>  Scenario fixture name (${Object.keys(fixtures).join(', ')}) or a ScenarioConfig JSON file
  --preset <name>        Scenario preset (${Object.keys(presets).join(', ') || 'none yet'})
  --from-snapshot <file> Resume from a snapshot (written by --snapshot) and run only from its time on;
                         --events/--log then hold only the window's events
  --seed <n>             Override the scenario seed (not with --from-snapshot)
  --until <cond>         Stop condition: end (default) | time:<s> | moves:<n> | vessels:<n> | event:<Type>
  --handlers <name>      Handler set: ${Object.keys(handlerSets).join(', ')}
  --async-mode <mode>    keep-running (default) | pause
  --strategy <dp>=<name> Built-in strategy for a decision point (repeatable)
  --latency <dp>=<spec>  Latency injector (repeatable). spec = none | fixed:<ms> | uniform:<min>-<max> | exp:<mean>
                         then optional ,timeout:<pct> ,error:<pct> ,timeoutMs:<ms>
                         e.g. stsGroundPosition=fixed:1500,timeout:5
                         Decision points: ${DECISION_POINT_IDS.join(', ')}
  --subsystem <name>=<mode>  Subsystem mode (repeatable): real | instant | off for quay, berth, yard, shc, asc, landside.
                         instant keeps the events with zero durations; off removes the subsystem. Impossible
                         combinations (e.g. yard=off with asc=real) exit with code 2
  --no-fail-fast         Keep running after an invariant violation
  --end <cond>           End condition (repeatable; the first one met ends the run): moves:<n> | vessels:<n> | time:<s>
  --out <file>           Write the run summary JSON
  --kpi-json <file>      Write the KPI report (summary, hourly/shift series, headline, highlights) as JSON
  --kpi-csv <file>       Write every KPI series as CSV (one row per KPI, entity and bucket)
  --events-json <file>   Write the full event log as one JSON array
  --events-csv <file>    Write the full event log as CSV
  --snapshot <file>      Write a snapshot of the run where it stopped (resume with --from-snapshot)
  --events <file>        Write the event log as JSON lines
  --log <file>           Write structured JSON-lines logs (t, eventId, seq, subsystem, level, type, subjects;
                         + causedBy and payload at debug)
  --log-level <spec>     Per-subsystem verbosity, e.g. "sts=debug,vessel=warn,*=info" (default *=info).
                         Levels: off|error|warn|info|debug. Subsystems: scenario, vessel, sts, invariants, …`

export class UsageError extends Error {}

export function loadScenario(fixture: string | undefined, preset: string | undefined): ScenarioConfig {
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

export function parseUntil(text: string | undefined): RunCondition {
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

/** `--end moves:50 --end time:3600`: replaces the scenario's end conditions. */
function endConditionsFromArgs(args: string[]): EndConditions | undefined {
  if (args.length === 0) return undefined
  const out: EndConditions = {}
  for (const arg of args) {
    const [kind, value] = arg.split(':')
    const n = Number(value)
    if (value === undefined || !Number.isFinite(n) || n <= 0) throw new UsageError(`Bad --end "${arg}"`)
    if (kind === 'moves') out.moves = n
    else if (kind === 'vessels') out.vesselsCompleted = n
    else if (kind === 'time') out.simDurationS = n
    else throw new UsageError(`Bad --end "${arg}" (moves:<n> | vessels:<n> | time:<s>)`)
  }
  return out
}

const SUBSYSTEM_NAMES = ['quay', 'berth', 'yard', 'shc', 'asc', 'landside'] as const

/** `--subsystem quay=instant`: merged over the scenario's own `subsystems`; impossible combinations are usage errors. */
function subsystemsFromArgs(base: SubsystemModes | undefined, args: string[]): SubsystemModes | undefined {
  if (args.length === 0) return base
  const out: SubsystemModes = { ...base }
  for (const arg of args) {
    const [name, mode] = arg.split('=')
    if (!(SUBSYSTEM_NAMES as readonly string[]).includes(name))
      throw new UsageError(`Bad --subsystem "${arg}" (subsystems: ${SUBSYSTEM_NAMES.join(', ')})`)
    if (mode !== 'real' && mode !== 'instant' && mode !== 'off') throw new UsageError(`Bad --subsystem "${arg}" (modes: real, instant, off)`)
    out[name as (typeof SUBSYSTEM_NAMES)[number]] = mode as SubsystemMode
  }
  return out
}

function splitPoint(text: string, flag: string): [DecisionPointId, string] {
  const eq = text.indexOf('=')
  const dp = text.slice(0, eq) as DecisionPointId
  if (eq < 1 || !DECISION_POINT_IDS.includes(dp))
    throw new UsageError(`Bad ${flag} "${text}" (decision points: ${DECISION_POINT_IDS.join(', ')})`)
  return [dp, text.slice(eq + 1)]
}

function parseLatency(text: string): { latency: LatencySpec; timeoutMs?: number } {
  const bad = () => new UsageError(`Bad --latency spec "${text}"`)
  const num = (s: string | undefined) => {
    const n = Number(s)
    if (s === undefined || s === '' || !Number.isFinite(n) || n < 0) throw bad()
    return n
  }
  const [delay, ...extras] = text.split(',')
  const [kind, arg] = delay.split(':')
  const latency: LatencySpec = {}
  if (kind === 'none') latency.delay = { kind: 'none' }
  else if (kind === 'fixed') latency.delay = { kind: 'fixed', ms: num(arg) }
  else if (kind === 'exp') latency.delay = { kind: 'exponential', meanMs: num(arg) }
  else if (kind === 'uniform') {
    const [min, max] = (arg ?? '').split('-')
    latency.delay = { kind: 'uniform', minMs: num(min), maxMs: num(max) }
  } else throw bad()
  let timeoutMs: number | undefined
  for (const extra of extras) {
    const [key, value] = extra.split(':')
    if (key === 'timeout') latency.timeoutPct = num(value)
    else if (key === 'error') latency.errorPct = num(value)
    else if (key === 'timeoutMs') timeoutMs = num(value)
    else throw bad()
  }
  return { latency, timeoutMs }
}

/** Merge --async-mode / --strategy / --latency over the scenario's own decisions config. */
function decisionsFromArgs(
  base: DecisionsConfig | undefined,
  asyncMode: string | undefined,
  strategyArgs: string[],
  latencyArgs: string[],
): DecisionsConfig | undefined {
  if (asyncMode === undefined && strategyArgs.length === 0 && latencyArgs.length === 0) return base
  const out: DecisionsConfig = { ...base, points: { ...base?.points } }
  const points = out.points as Record<DecisionPointId, NonNullable<DecisionsConfig['points']>[DecisionPointId]>
  if (asyncMode !== undefined) {
    if (asyncMode !== 'keep-running' && asyncMode !== 'pause') throw new UsageError(`Bad --async-mode "${asyncMode}"`)
    out.asyncMode = asyncMode as AsyncMode
  }
  for (const arg of strategyArgs) {
    const [dp, name] = splitPoint(arg, '--strategy')
    try {
      getStrategy(dp, name)
    } catch (err) {
      throw new UsageError((err as Error).message)
    }
    points[dp] = { ...points[dp], strategy: name }
  }
  for (const arg of latencyArgs) {
    const [dp, spec] = splitPoint(arg, '--latency')
    const { latency, timeoutMs } = parseLatency(spec)
    points[dp] = { ...points[dp], latency, ...(timeoutMs === undefined ? {} : { timeoutMs }) }
  }
  return out
}

function loadSnapshot(file: string): SimSnapshot {
  const snap = JSON.parse(readFileSync(file, 'utf8')) as SimSnapshot
  if (snap.kind !== 'terminal-twin-snapshot') throw new UsageError(`${file} is not a Terminal Twin snapshot`)
  return snap
}

function parseVerbosity(spec: string | undefined): LogVerbosity {
  try {
    return parseLogVerbosity(spec ?? '*=info')
  } catch (err) {
    throw new UsageError((err as Error).message)
  }
}

export function formatSimTime(seconds: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0')
  const days = Math.floor(seconds / 86400)
  const rest = seconds - days * 86400
  const hms = `${p(rest / 3600)}:${p((rest % 3600) / 60)}:${(rest % 60).toFixed(3).padStart(6, '0')}`
  return days > 0 ? `day ${days} ${hms}` : hms
}

function formatSummary(s: RunSummary, headline: HeadlineKpis, stopped: string, started: string, processed: number, asyncMode: AsyncMode): string[] {
  const lines = [
    `Terminal Twin — ${s.scenario} (seed ${s.seed})`,
    `Started:          ${started}  [${processed} events processed in this run]`,
    `Stopped:          ${stopped}${s.endReason ? ` (${s.endReason})` : ''}`,
    `Async mode:       ${asyncMode}`,
    `Sim time:         ${formatSimTime(s.kpis.simTimeS)}  [${s.kpis.eventsProcessed} events]`,
    `Event-log hash:   ${s.eventLogHash}`,
    `Moves completed:  ${s.kpis.movesCompleted}`,
    `Vessels done:     ${s.kpis.vesselsCompleted}`,
  ]
  for (const [id, k] of Object.entries(s.kpis.sts))
    lines.push(
      `  ${id.padEnd(15)} ${k.moves} moves in ${k.cycles} cycles (${k.twinLifts} twin-20), ${k.grossMovesPerHour ?? '–'} gross moves/h, rail wait ${k.railWaitS} s`,
    )
  const s3 = (x: number | null) => (x === null ? '–' : `${x} s`)
  for (const [id, v] of Object.entries(s.kpis.vessels))
    lines.push(
      `  ${id.padEnd(15)} ${v.sizeClass}, berth ${v.berthX === null ? '–' : `${v.berthX} m`}, anchorage ${s3(v.anchorageWaitS)}, turnaround ${s3(v.turnaroundS)}, STS ${v.sts.join(' ') || '–'}`,
    )
  lines.push(
    `Quay:             ${s.kpis.quay.vesselsWaited} vessel(s) waited at anchorage, max ${s.kpis.quay.anchorageWaitS.max} s, mean ${s.kpis.quay.anchorageWaitS.mean} s`,
  )
  const hz = s.kpis.horizontal
  if (hz) {
    lines.push(`Horizontal:       ${hz.boxesToWtp} boxes to WTP pads`)
    for (const [id, k] of Object.entries(hz.shcs))
      lines.push(
        `  ${id.padEnd(15)} ${k.jobs} jobs, ${k.loadedDistanceM} m loaded / ${k.emptyDistanceM} m empty, reservation wait ${k.reservationWaitS} s`,
      )
    for (const [id, w] of Object.entries(hz.stsGroundPositionWaitS))
      lines.push(`  ${id.padEnd(15)} waited ${w} s for a free ground position`)
  }
  const h = headline
  const num = (x: number | null, unit = '') => (x === null ? '–' : `${x}${unit}`)
  lines.push(
    'Headline KPIs:',
    `  Gross moves/h:    ${num(h.grossMovesPerHour)}`,
    `  Net moves/h:      ${num(h.netMovesPerHour)}`,
  )
  if (h.shcBusyPct !== null) lines.push(`  SHC busy:         ${num(h.shcBusyPct, ' %')}  (empty travel ratio ${num(h.shcEmptyTravelRatio)})`)
  if (h.wtpDwellS !== null) lines.push(`  WTP pad dwell:    ${num(h.wtpDwellS, ' s')}`)
  if (h.ascUtilisationPct !== null) lines.push(`  ASC utilisation:  ${num(h.ascUtilisationPct, ' %')}`)
  if (h.yardFillPct !== null) lines.push(`  Yard fill:        ${num(h.yardFillPct, ' %')}`)
  lines.push('TOS handlers:')
  for (const [dp, h] of Object.entries(s.kpis.handlers)) {
    lines.push(
      `  ${dp.padEnd(18)} ${h.handler}  ${h.calls} calls, ${h.ok} ok, ${h.fallbacks} fallbacks (${h.timeouts} timeouts, ${h.errors} errors${h.lateReplies ? `, ${h.lateReplies} late` : ''})`,
      `  ${''.padEnd(18)} sim latency mean ${h.simLatencyS.mean} s / max ${h.simLatencyS.max} s, wall mean ${h.wallLatencyMs.mean} ms / max ${h.wallLatencyMs.max} ms, backlog ${h.pending} (max ${h.maxPending}), idle caused ${h.equipmentIdleS} s`,
    )
  }
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
        'from-snapshot': { type: 'string' },
        seed: { type: 'string' },
        until: { type: 'string' },
        handlers: { type: 'string', default: 'default' },
        'no-fail-fast': { type: 'boolean', default: false },
        subsystem: { type: 'string', multiple: true, default: [] },
        out: { type: 'string' },
        events: { type: 'string' },
        'async-mode': { type: 'string' },
        strategy: { type: 'string', multiple: true, default: [] },
        latency: { type: 'string', multiple: true, default: [] },
        snapshot: { type: 'string' },
        log: { type: 'string' },
        'log-level': { type: 'string' },
        end: { type: 'string', multiple: true, default: [] },
        'kpi-json': { type: 'string' },
        'kpi-csv': { type: 'string' },
        'events-json': { type: 'string' },
        'events-csv': { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    })
    if (values.help) {
      print(USAGE)
      return 0
    }
    const fromFile = values['from-snapshot']
    if (fromFile && (values.fixture || values.preset || values.seed !== undefined))
      throw new UsageError('--from-snapshot takes scenario and seed from the snapshot: drop --fixture/--preset/--seed')
    const start = fromFile ? loadSnapshot(fromFile) : null
    let config = start ? start.config : loadScenario(values.fixture, values.preset)
    const decisionFlags = values['async-mode'] !== undefined || values.strategy.length > 0 || values.latency.length > 0
    if (start && decisionFlags)
      throw new UsageError('--from-snapshot takes decision settings from the snapshot: drop --async-mode/--strategy/--latency')
    const endConditions = endConditionsFromArgs(values.end)
    if (start && endConditions) throw new UsageError('--from-snapshot takes end conditions from the snapshot: drop --end')
    if (endConditions) config = { ...config, endConditions }
    const decisions = decisionsFromArgs(config.decisions, values['async-mode'], values.strategy, values.latency)
    if (decisions !== config.decisions) config = { ...config, decisions }
    if (values.subsystem.length > 0) {
      if (start) throw new UsageError('--from-snapshot takes subsystem modes from the snapshot: drop --subsystem')
      config = { ...config, subsystems: subsystemsFromArgs(config.subsystems, values.subsystem) }
      const problems = validateSubsystemModes(config)
      if (problems.length > 0) throw new UsageError(problems.map((p) => t(p.key, p.params)).join('; '))
    }
    const seed = values.seed === undefined ? undefined : Number(values.seed)
    if (seed !== undefined && !Number.isInteger(seed)) throw new UsageError(`Bad --seed "${values.seed}"`)
    const handlers = handlerSets[values.handlers]
    if (!handlers) throw new UsageError(`Unknown handler set "${values.handlers}"`)
    const condition = parseUntil(values.until)
    const verbosity = parseVerbosity(values['log-level'])
    const logLines: string[] = []
    const log = values.log
      ? { verbosity, write: (r: LogRecord) => void logLines.push(JSON.stringify(r)) }
      : undefined

    const options = { invariants: { failFast: !values['no-fail-fast'] }, log }
    const sim = start
      ? restoreSimulation(start, handlers, options)
      : createSimulation(config, handlers, { ...options, seed })
    const firstNewEvent = sim.eventLog().length
    const result = sim.runUntil(condition)
    const summary = summarizeRun(sim)
    const startedAt = start ? `snapshot at ${formatSimTime(start.state.now)} (after ${firstNewEvent} events)` : 'scenario start'
    const headline = headlineKpis(sim.kpiSeries(), sim.kpiReport())
    for (const line of formatSummary(summary, headline, result.reason, startedAt, result.eventsProcessed, sim.asyncMode)) print(line)
    if (values.out) writeFileSync(values.out, `${JSON.stringify(summary, null, 2)}\n`)
    if (values.snapshot) writeFileSync(values.snapshot, JSON.stringify(sim.snapshot()))
    if (values.log) writeFileSync(values.log, logLines.length ? `${logLines.join('\n')}\n` : '')
    for (const [flag, kind] of [
      ['kpi-json', 'kpi-json'],
      ['kpi-csv', 'kpi-csv'],
      ['events-json', 'events-json'],
      ['events-csv', 'events-csv'],
    ] as const) {
      const file = values[flag]
      if (file) writeFileSync(file, exportRun(sim, kind))
    }
    if (values.events) {
      const events = sim.eventLog().slice(firstNewEvent)
      writeFileSync(values.events, events.length ? `${events.map((e) => JSON.stringify(e)).join('\n')}\n` : '')
    }
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

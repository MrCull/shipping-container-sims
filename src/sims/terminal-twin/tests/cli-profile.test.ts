/** Spec #166 (profiler): `pnpm run tt:profile <preset|fixture> --until <seconds>` prints what the KPI collector and the STS breakdown say. */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boxWaits, createSimulation, formatStsProductivity, stsProductivity } from '../engine'
import { runProfileCli } from '../cli/profileCli'
import { handlerSets } from '../cli/handlerSets'
import { fixtures } from '../scenario/fixtures'

const FIXTURE = 'mixed-discharge-then-load'
const UNTIL = 2000

function cli(...args: string[]) {
  const out: string[] = []
  const exitCode = runProfileCli(args, (line) => out.push(line))
  return { exitCode, text: out.join('\n') }
}

/** The lines under an unindented heading (the sections are indented rows, closed by a blank line). */
function section(text: string, heading: string): string[] {
  const lines = text.split('\n')
  const rest = lines.slice(lines.findIndex((l) => l.startsWith(heading)) + 1)
  const end = rest.findIndex((l) => l.trim() === '' || !l.startsWith(' '))
  return rest.slice(0, end === -1 ? rest.length : end)
}

/** Columns of the row that starts with `id`. */
function row(lines: string[], id: string): string[] {
  const hit = lines.find((l) => l.trim().split(/\s+/)[0] === id)
  if (!hit) throw new Error(`no row ${id}`)
  return hit.trim().split(/\s+/)
}

/** The same run, outside the CLI: the reference numbers. */
function reference(until: number) {
  const sim = createSimulation(fixtures[FIXTURE], handlerSets.default)
  sim.runUntil({ time: until })
  return { sim, endS: Math.min(until, sim.now) }
}

describe('CLI profiler', () => {
  it('prints hourly STS moves, ASC and SHC idle share, the STS breakdown and box waits from the same collector', () => {
    const { exitCode, text } = cli(FIXTURE, '--until', String(UNTIL))
    expect(exitCode).toBe(0)
    const { sim, endS } = reference(UNTIL)
    const series = sim.kpiSeries()

    const moves = section(text, 'Moves per clock hour')
    for (const [id, e] of Object.entries(series.series['sts.moves'].entities))
      expect(row(moves, id).at(-1)).toBe(String(e.total))

    const asc = section(text, 'ASC idle share')
    for (const [id, e] of Object.entries(series.series['asc.utilisation-pct'].entities))
      expect(row(asc, id).at(-1)).toBe(e.total === null ? '–' : (100 - e.total).toFixed(1))

    const shc = section(text, 'SHC idle share')
    for (const [id, e] of Object.entries(series.series['shc.idle-pct'].entities))
      expect(row(shc, id).at(-1)).toBe(e.total === null ? '–' : e.total.toFixed(1))

    expect(text).toContain(formatStsProductivity(stsProductivity(sim.eventLog(), endS)))

    const waits = boxWaits(sim.eventLog(), endS)
    expect(text).toMatch(new RegExp(`discharge\\s+${waits.paths.discharge.boxes}\\s`))
    expect(text).toMatch(new RegExp(`load\\s+${waits.paths.load.boxes}\\s`))
    expect(text).toContain('Top waits')
  })

  it('--json writes the same data as JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-profile-'))
    const file = join(dir, 'profile.json')
    expect(cli(FIXTURE, '--until', String(UNTIL), '--json', file).exitCode).toBe(0)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const { sim, endS } = reference(UNTIL)
    const series = sim.kpiSeries()
    const events = sim.eventLog()

    expect(json.endS).toBe(endS)
    for (const [id, e] of Object.entries(series.series['sts.moves'].entities)) expect(json.sts.moves[id]).toEqual({ hourly: e.hourly, total: e.total })
    expect(json.stsProductivity).toEqual(JSON.parse(JSON.stringify(stsProductivity(events, endS))))
    expect(json.boxWaits).toEqual(JSON.parse(JSON.stringify(boxWaits(events, endS))))
  })

  it('stops at the end of the scenario when it ends before --until', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-profile-'))
    const file = join(dir, 'profile.json')
    expect(cli(FIXTURE, '--until', '99999', '--json', file).exitCode).toBe(0)
    const full = createSimulation(fixtures[FIXTURE], handlerSets.default)
    full.runUntil()
    expect(JSON.parse(readFileSync(file, 'utf8')).endS).toBe(Math.min(99999, full.now))
  })

  it('needs a preset or fixture name and --until, and fails clearly on an unknown name', () => {
    const unknown = cli('no-such-run', '--until', '100')
    expect(unknown.exitCode).toBe(2)
    expect(unknown.text).toContain('Unknown fixture or preset "no-such-run"')
    expect(cli(FIXTURE).exitCode).toBe(2)
    expect(cli(FIXTURE, '--until', 'soon').exitCode).toBe(2)
    expect(cli().exitCode).toBe(2)
    expect(cli('--help').exitCode).toBe(0)
  })

  it('works on a TTI preset to a short end time', () => {
    const { exitCode, text } = cli('TTI Algeciras baseline', '--until', '600')
    expect(exitCode).toBe(0)
    expect(text).toContain('Moves per clock hour')
  }, 60_000)
})

/** KPI headline, highlights and JSON/CSV export (TT-07). */
import { describe, expect, it } from 'vitest'
import { createSimulation, type Simulation } from '../engine'
import { eventLogCsv, eventLogJson, kpiReportCsv, kpiReportJson } from '../engine/export'
import { headlineKpis, highlightsOf } from '../engine/kpi/headline'
import { fixtures } from '../scenario/fixtures'

function finished(name: string): Simulation {
  const sim = createSimulation(fixtures[name])
  sim.runUntil()
  return sim
}

/** Minimal RFC 4180 parser (independent of the exporter's escaping code). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

describe('export', () => {
  const sim = finished('asc-1sts-10-boxes-1block')

  it('event log JSON parses and holds every event', () => {
    const events = JSON.parse(eventLogJson(sim)) as { id: number; type: string; payload: unknown }[]
    expect(events).toHaveLength(sim.eventLog().length)
    expect(events.map((e) => e.id)).toEqual(sim.eventLog().map((e) => e.id))
    expect(events[events.length - 1].type).toBe('ScenarioEnded')
  })

  it('event log CSV parses back to every event with its payload intact', () => {
    const rows = parseCsv(eventLogCsv(sim))
    expect(rows[0]).toEqual(['id', 'seq', 't', 'type', 'causedBy', 'subjects', 'payload'])
    const log = sim.eventLog()
    expect(rows.length - 1).toBe(log.length)
    for (let i = 0; i < log.length; i += 7) {
      const [id, seq, t, type, causedBy, subjects, payload] = rows[i + 1]
      expect(Number(id)).toBe(log[i].id)
      expect(Number(seq)).toBe(log[i].seq)
      expect(Number(t)).toBe(log[i].t)
      expect(type).toBe(log[i].type)
      expect(causedBy).toBe(log[i].causedBy === null ? '' : String(log[i].causedBy))
      expect(JSON.parse(subjects)).toEqual(log[i].subjects)
      expect(JSON.parse(payload)).toEqual(log[i].payload)
    }
  })

  it('KPI report JSON carries the summary, every series, the headline and the highlights', () => {
    const report = JSON.parse(kpiReportJson(sim)) as {
      format: string
      scenario: string
      seed: number
      eventLogHash: string
      kpis: { movesCompleted: number }
      series: ReturnType<Simulation['kpiSeries']>
      headline: { movesDone: number }
      highlights: unknown[]
    }
    expect(report.format).toBe('terminal-twin-kpi-report')
    expect(report.scenario).toBe(sim.config.name)
    expect(report.eventLogHash).toBe(sim.eventLogHash())
    expect(report.kpis.movesCompleted).toBe(10)
    expect(report.headline.movesDone).toBe(10)
    expect(Object.keys(report.series.series)).toEqual(Object.keys(sim.kpiSeries().series))
    expect(report.highlights.length).toBeGreaterThan(0)
  })

  it('KPI CSV has one row per series entity bucket (hours, shifts and total)', () => {
    const series = sim.kpiSeries()
    const rows = parseCsv(kpiReportCsv(sim))
    expect(rows[0]).toEqual(['kpi', 'unit', 'entityKind', 'entity', 'bucket', 'index', 'startS', 'endS', 'value'])
    let expected = 0
    for (const s of Object.values(series.series))
      expected += Object.keys(s.entities).length * (series.hours.length + series.shifts.length + 1)
    expect(rows.length - 1).toBe(expected)
    const moves = rows.find((r) => r[0] === 'sts.moves' && r[4] === 'total')!
    expect(moves[3]).toBe('STS01')
    expect(Number(moves[8])).toBe(10)
    // a null value (no data) is an empty cell
    expect(rows.every((r) => r.length === 9)).toBe(true)
  })
})

describe('headline and highlights', () => {
  it('headline numbers come from the same series as the report', () => {
    const sim = finished('asc-1sts-10-boxes-1block')
    const h = headlineKpis(sim.kpiSeries(), sim.kpiReport())
    const series = sim.kpiSeries()
    expect(h.movesDone).toBe(10)
    expect(h.vesselsDone).toBe(1)
    expect(h.grossMovesPerHour).toBe(series.series['sts.gross-moves-per-hour'].entities['STS01'].total)
    expect(h.netMovesPerHour).toBe(series.series['sts.net-moves-per-hour'].entities['STS01'].total)
    expect(h.ascUtilisationPct).toBe(series.series['asc.utilisation-pct'].entities['B01-ASC1'].total)
    expect(h.yardFillPct).toBe(series.series['yard.fill-pct'].entities['B01'].total)
  })

  it('headline leaves out what the scenario does not have', () => {
    const sim = finished('tracer-1sts-10-boxes')
    const h = headlineKpis(sim.kpiSeries(), sim.kpiReport())
    expect(h.shcEmptyTravelRatio).toBeNull()
    expect(h.ascUtilisationPct).toBeNull()
    expect(h.yardFillPct).toBeNull()
  })

  it('highlights name the hardest-working crane, the busiest block and the longest wait', () => {
    const sim = finished('asc-1sts-10-boxes-1block')
    const hl = highlightsOf(sim.kpiSeries(), sim.kpiReport())
    const crane = hl.find((h) => h.kind === 'hardestCrane')
    expect(crane).toMatchObject({ entity: 'STS01', moves: 10 })
    expect(hl.find((h) => h.kind === 'busiestBlock')).toMatchObject({ entity: 'B01' })
    expect(hl.find((h) => h.kind === 'busiestShc')?.entity).toMatch(/^SHC/)
  })

  it('picks the biggest wait across anchorage, SHC and rail waits', () => {
    const sim = finished('two-vessels-compete-for-berth')
    const hl = highlightsOf(sim.kpiSeries(), sim.kpiReport())
    const wait = hl.find((h) => h.kind === 'longestWait')
    expect(wait).toMatchObject({ source: 'anchorage' })
    expect((wait as { seconds: number }).seconds).toBe(sim.kpiReport().quay.anchorageWaitS.max)
  })
})

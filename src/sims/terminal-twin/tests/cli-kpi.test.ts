/** CLI side of TT-07: headline KPIs in the summary, end-condition flags and exports. */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSimulation, headlineKpis } from '../engine'
import { runCli } from '../cli/runCli'
import { fixtures } from '../scenario/fixtures'

function cli(...args: string[]) {
  const out: string[] = []
  const exitCode = runCli(args, (line) => out.push(line))
  return { exitCode, text: out.join('\n') }
}

describe('CLI KPIs', () => {
  it('prints the headline KPIs from the same collector the UI uses', () => {
    const { exitCode, text } = cli('--fixture', 'asc-1sts-10-boxes-1block')
    expect(exitCode).toBe(0)
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil()
    const h = headlineKpis(sim.kpiSeries(), sim.kpiReport())
    expect(text).toMatch(/Headline KPIs:/)
    expect(text).toContain(`Gross moves/h:    ${h.grossMovesPerHour}`)
    expect(text).toContain(`Net moves/h:      ${h.netMovesPerHour}`)
    expect(text).toContain(`ASC utilisation:  ${h.ascUtilisationPct} %`)
    expect(text).toContain(`Yard fill:        ${h.yardFillPct} %`)
  })

  it('--end sets the end conditions; the earliest wins', () => {
    const { text } = cli('--fixture', 'tracer-1sts-10-boxes', '--end', 'moves:3', '--end', 'time:99999')
    expect(text).toMatch(/Stopped:\s+ended \(moves >= 3\)/)
    expect(cli('--fixture', 'tracer-1sts-10-boxes', '--end', 'time:300').text).toMatch(/simDurationS >= 300/)
    expect(cli('--fixture', 'tracer-1sts-10-boxes', '--end', 'bogus:1').exitCode).toBe(2)
  })

  it('writes the KPI report and the event log as JSON and CSV', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-cli-kpi-'))
    const files = {
      kpiJson: join(dir, 'kpi.json'),
      kpiCsv: join(dir, 'kpi.csv'),
      eventsJson: join(dir, 'events.json'),
      eventsCsv: join(dir, 'events.csv'),
    }
    const { exitCode } = cli(
      '--fixture',
      'asc-1sts-10-boxes-1block',
      '--kpi-json',
      files.kpiJson,
      '--kpi-csv',
      files.kpiCsv,
      '--events-json',
      files.eventsJson,
      '--events-csv',
      files.eventsCsv,
    )
    expect(exitCode).toBe(0)
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil()
    const report = JSON.parse(readFileSync(files.kpiJson, 'utf8'))
    expect(report.series).toEqual(JSON.parse(JSON.stringify(sim.kpiSeries())))
    expect(JSON.parse(readFileSync(files.eventsJson, 'utf8'))).toHaveLength(sim.eventLog().length)
    expect(readFileSync(files.kpiCsv, 'utf8').split('\n')[0]).toBe('kpi,unit,entityKind,entity,bucket,index,startS,endS,value')
    expect(readFileSync(files.eventsCsv, 'utf8').trim().split('\n').length).toBeGreaterThan(sim.eventLog().length)
  })
})

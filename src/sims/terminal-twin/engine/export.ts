/**
 * Export of a run: the KPI report and the full event log as JSON and CSV.
 * Pure string builders over the public Simulation API; the UI downloads the
 * strings, the CLI writes them to files.
 */
import { headlineKpis, highlightsOf } from './kpi/headline'
import type { Simulation } from './simulation'

export const KPI_REPORT_FORMAT = 'terminal-twin-kpi-report'

/** RFC 4180: quote cells with commas, quotes or line breaks. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (cells: (string | number | null | undefined)[]) => `${cells.map(cell).join(',')}\n`

/** The KPI report: summary counters, every KPI series, the headline KPIs and highlights. */
export function kpiReportJson(sim: Simulation): string {
  const kpis = sim.kpiReport()
  const series = sim.kpiSeries()
  return JSON.stringify(
    {
      format: KPI_REPORT_FORMAT,
      scenario: sim.config.name,
      seed: sim.seed,
      status: sim.status,
      eventLogHash: sim.eventLogHash(),
      kpis,
      series,
      headline: headlineKpis(series, kpis),
      highlights: highlightsOf(series, kpis),
    },
    null,
    2,
  )
}

/** Every KPI series in long form: one row per KPI, entity and bucket (hour, shift, total). */
export function kpiReportCsv(sim: Simulation): string {
  const report = sim.kpiSeries()
  let out = row(['kpi', 'unit', 'entityKind', 'entity', 'bucket', 'index', 'startS', 'endS', 'value'])
  for (const s of Object.values(report.series)) {
    for (const [entity, e] of Object.entries(s.entities)) {
      const head = [s.id, s.unit, s.entityKind, entity]
      e.hourly.forEach((v, i) => (out += row([...head, 'hour', i, report.hours[i].startS, report.hours[i].endS, v])))
      e.shifts.forEach((v, i) => (out += row([...head, 'shift', i, report.shifts[i].startS, report.shifts[i].endS, v])))
      out += row([...head, 'total', '', 0, report.elapsedS, e.total])
    }
  }
  // appointment counts come from the booking plan, not from events, so they have a whole-run row only
  const appointments = sim.kpiReport().landside?.appointments
  if (appointments)
    out += row(['landside.appointments-rejected', 'count', 'terminal', 'terminal', 'total', '', 0, report.elapsedS, appointments.rejected])
  return out
}

export function eventLogJson(sim: Simulation): string {
  return JSON.stringify(sim.eventLog())
}

export function eventLogCsv(sim: Simulation): string {
  let out = row(['id', 'seq', 't', 'type', 'causedBy', 'subjects', 'payload'])
  for (const e of sim.eventLog()) out += row([e.id, e.seq, e.t, e.type, e.causedBy, JSON.stringify(e.subjects), JSON.stringify(e.payload)])
  return out
}

export type ExportKind = 'kpi-json' | 'kpi-csv' | 'events-json' | 'events-csv'

export const EXPORT_FILES: Record<ExportKind, { suffix: string; mime: string }> = {
  'kpi-json': { suffix: 'kpi-report.json', mime: 'application/json' },
  'kpi-csv': { suffix: 'kpi-series.csv', mime: 'text/csv' },
  'events-json': { suffix: 'events.json', mime: 'application/json' },
  'events-csv': { suffix: 'events.csv', mime: 'text/csv' },
}

export function exportRun(sim: Simulation, kind: ExportKind): string {
  switch (kind) {
    case 'kpi-json':
      return kpiReportJson(sim)
    case 'kpi-csv':
      return kpiReportCsv(sim)
    case 'events-json':
      return eventLogJson(sim)
    case 'events-csv':
      return eventLogCsv(sim)
  }
}

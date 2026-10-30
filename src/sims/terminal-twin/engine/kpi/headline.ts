/**
 * Headline KPIs (the always-visible strip, the CLI summary) and the final
 * report's highlights. Pure functions of the collector's series and the
 * KpiReport, so the CLI and the UI show the same numbers for the same run.
 */
import type { KpiReport } from '../kpis'
import type { KpiSeriesReport } from './collector'

export interface HeadlineKpis {
  movesDone: number
  vesselsDone: number
  /** Sum over the STS cranes (null without data). */
  grossMovesPerHour: number | null
  netMovesPerHour: number | null
  /** Mean over the SHCs, null without SHCs or travel. */
  shcEmptyTravelRatio: number | null
  /** Mean over the SHCs of the time spent moving (loaded + empty). */
  shcBusyPct: number | null
  /** Mean over the ASCs. */
  ascUtilisationPct: number | null
  /** Mean over the blocks. */
  yardFillPct: number | null
  /** Mean WTP pad dwell over the blocks (s). */
  wtpDwellS: number | null
  /** Mean truck turnaround, arrival at the gate to gate-out (s); null without a landside or before a truck has left. */
  truckTurnaroundS: number | null
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

function totals(series: KpiSeriesReport, kpi: string): number[] {
  const s = series.series[kpi]
  if (!s) return []
  return Object.values(s.entities)
    .map((e) => e.total)
    .filter((v): v is number => v !== null)
}
const sum = (xs: number[]) => (xs.length ? r3(xs.reduce((a, b) => a + b, 0)) : null)
const mean = (xs: number[]) => (xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export function headlineKpis(series: KpiSeriesReport, report: KpiReport): HeadlineKpis {
  const loaded = totals(series, 'shc.loaded-pct')
  const empty = totals(series, 'shc.empty-pct')
  return {
    movesDone: report.movesCompleted,
    vesselsDone: report.vesselsCompleted,
    grossMovesPerHour: sum(totals(series, 'sts.gross-moves-per-hour')),
    netMovesPerHour: sum(totals(series, 'sts.net-moves-per-hour')),
    shcEmptyTravelRatio: mean(totals(series, 'shc.empty-travel-ratio')),
    shcBusyPct: loaded.length && loaded.length === empty.length ? r3((mean(loaded) ?? 0) + (mean(empty) ?? 0)) : null,
    ascUtilisationPct: mean(totals(series, 'asc.utilisation-pct')),
    yardFillPct: mean(totals(series, 'yard.fill-pct')),
    wtpDwellS: mean(totals(series, 'wtp.dwell-s')),
    truckTurnaroundS: report.landside && report.landside.trucksOut > 0 ? report.landside.totalTurnaroundS.mean : null,
  }
}

export type Highlight =
  | { kind: 'hardestCrane'; entity: string; moves: number; netMovesPerHour: number | null }
  | { kind: 'busiestBlock'; entity: string; ascId: string; utilisationPct: number }
  | { kind: 'busiestShc'; entity: string; jobs: number }
  | { kind: 'longestWait'; source: 'anchorage' | 'shc' | 'rail'; entity: string; seconds: number }

/** Friendly "who did what" facts for the final report. Empty entries are left out. */
export function highlightsOf(series: KpiSeriesReport, report: KpiReport): Highlight[] {
  const out: Highlight[] = []
  const best = (kpi: string): [string, number] | null => {
    let top: [string, number] | null = null
    for (const [entity, e] of Object.entries(series.series[kpi]?.entities ?? {}))
      if (e.total !== null && e.total > 0 && (!top || e.total > top[1])) top = [entity, e.total]
    return top
  }
  const crane = best('sts.moves')
  if (crane)
    out.push({
      kind: 'hardestCrane',
      entity: crane[0],
      moves: crane[1],
      netMovesPerHour: series.series['sts.net-moves-per-hour'].entities[crane[0]].total,
    })
  const asc = best('asc.utilisation-pct')
  if (asc) {
    const block = asc[0].replace(/-ASC\d+$/, '')
    out.push({ kind: 'busiestBlock', entity: block, ascId: asc[0], utilisationPct: asc[1] })
  }
  const shc = best('shc.jobs')
  if (shc) out.push({ kind: 'busiestShc', entity: shc[0], jobs: shc[1] })

  const waits: Extract<Highlight, { kind: 'longestWait' }>[] = []
  for (const [id, v] of Object.entries(report.vessels))
    if (v.anchorageWaitS) waits.push({ kind: 'longestWait', source: 'anchorage', entity: id, seconds: v.anchorageWaitS })
  for (const [id, s] of Object.entries(report.horizontal?.stsGroundPositionWaitS ?? {}))
    if (s > 0) waits.push({ kind: 'longestWait', source: 'shc', entity: id, seconds: s })
  for (const [id, k] of Object.entries(report.sts))
    if (k.railWaitS > 0) waits.push({ kind: 'longestWait', source: 'rail', entity: id, seconds: k.railWaitS })
  if (waits.length) out.push(waits.reduce((a, b) => (b.seconds > a.seconds ? b : a)))
  return out
}

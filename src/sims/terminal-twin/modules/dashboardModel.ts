/**
 * Dashboard view models (pure TS): KPI groups, per-KPI chart data with hour or
 * shift bucketing, downsampling and the yard fill heatmap. ECharts-specific
 * option building lives in `dashboardOptions.ts`, which is the only code that
 * touches the (lazy) chart library.
 */
import {
  SHC_OPERATIONAL_STATES,
  type KpiSeries,
  type KpiSeriesReport,
  type KpiUnit,
  type LandsideKpiReport,
} from '../engine'
import type { MessageKey } from '../i18n/messages'
import { MAX_SERIES } from './dashboardPalette'

export type KpiGroupId = 'quay' | 'horizontal' | 'yard' | 'landside' | 'handlers'
export type Bucketing = 'hour' | 'shift'

export interface KpiGroup {
  id: KpiGroupId
  kpis: readonly string[]
}

/** KPI groups of the dashboard, in tab order. */
export const KPI_GROUPS: readonly KpiGroup[] = [
  {
    id: 'quay',
    kpis: [
      'sts.gross-moves-per-hour',
      'sts.net-moves-per-hour',
      'sts.moves',
      'sts.wait-shc-s',
      'wp.released',
      'wp.completed',
      'wp.lead-time-s',
      'sts.wait-work-s',
      'sts.wait-rail-s',
      'berth.moves-per-hour',
      'vessel.remaining-moves',
      'vessel.turnaround-s',
      'vessel.anchorage-wait-s',
    ],
  },
  {
    id: 'horizontal',
    kpis: [
      'shc.loaded-pct',
      'shc.empty-pct',
      'shc.idle-pct',
      'shc.empty-travel-ratio',
      'shc.cycle-time-s',
      'shc.jobs',
      'shc.empty-distance-m',
      'shc.loaded-distance-m',
      'shc.handovers',
      ...SHC_OPERATIONAL_STATES.map((op) => `shc.state.${op}-s`),
      'wtp.dwell-s',
    ],
  },
  { id: 'yard', kpis: ['asc.utilisation-pct', 'asc.cycle-time-s', 'asc.jobs', 'yard.fill-pct', 'yard.rehandles-per-move'] },
  {
    id: 'landside',
    kpis: [
      'landside.truck-turn-s',
      'landside.gate-queue',
      'landside.gate-wait-s',
      'landside.stall-wait-s',
      'landside.trucks-in',
      'landside.trucks-out',
      'landside.gate-processing-s',
      'landside.internal-drive-s',
      'landside.total-turnaround-s',
      'landside.road-trucks',
      'landside.holding-utilisation-pct',
      'landside.appointments-delayed',
    ],
  },
  {
    id: 'handlers',
    kpis: ['handler.calls', 'handler.mean-latency-s', 'handler.wall-latency-s', 'handler.fallbacks', 'handler.failures', 'handler.backlog', 'handler.equipment-idle-s'],
  },
]

/** Groups with at least one KPI series that has data in `report`. */
export function groupsWithData(report: KpiSeriesReport): KpiGroupId[] {
  return KPI_GROUPS.filter((g) => g.kpis.some((id) => hasEntities(report.series[id]))).map((g) => g.id)
}

function hasEntities(s: KpiSeries | undefined): s is KpiSeries {
  return !!s && Object.keys(s.entities).length > 0
}

export interface ChartLine {
  entity: string
  /** One value per x position (null = no data). */
  values: (number | null)[]
}

export interface KpiChartData {
  kpiId: string
  unit: KpiUnit
  /** Bucket start times in sim seconds. */
  x: number[]
  lines: ChartLine[]
  /** Entities beyond the palette size that were left out. */
  hiddenEntities: number
}

/** Catalogue key of a KPI's chart title. */
export function kpiLabelKey(kpiId: string): MessageKey {
  return `dashboard.kpi.${kpiId}` as MessageKey
}

export function buildGroupCharts(report: KpiSeriesReport, group: KpiGroupId, bucketing: Bucketing): KpiChartData[] {
  const def = KPI_GROUPS.find((g) => g.id === group)
  if (!def) return []
  const x = (bucketing === 'hour' ? report.hours : report.shifts).map((b) => b.startS)
  const charts: KpiChartData[] = []
  for (const kpiId of def.kpis) {
    const series = report.series[kpiId]
    if (!hasEntities(series)) continue
    const ids = Object.keys(series.entities)
    charts.push({
      kpiId,
      unit: series.unit,
      x,
      lines: ids.slice(0, MAX_SERIES).map((entity) => ({
        entity,
        values: [...(bucketing === 'hour' ? series.entities[entity].hourly : series.entities[entity].shifts)],
      })),
      hiddenEntities: Math.max(0, ids.length - MAX_SERIES),
    })
  }
  return charts
}

/**
 * Indices to plot so that at most `budget` points remain (evenly spaced, always
 * keeping the first and last). ECharts' own `sampling` handles line density on
 * screen; this caps what is sent to the chart for very long runs.
 */
export function downsampleEvery(count: number, budget: number): number[] {
  if (count <= budget) return Array.from({ length: count }, (_, i) => i)
  const out: number[] = []
  const step = (count - 1) / (budget - 1)
  for (let i = 0; i < budget; i++) out.push(Math.round(i * step))
  return out
}

/** Points per line above which the model downsamples. */
export const POINT_BUDGET = 1500

// ------------------------------------------------------------------ yard heatmap

export interface YardHeatmap {
  blocks: string[]
  /** Hour bucket start times (sim s). */
  hours: number[]
  /** Fill % per block per hour (null = no data). */
  values: Record<string, (number | null)[]>
}

export function buildYardHeatmap(report: KpiSeriesReport): YardHeatmap {
  const fill = report.series['yard.fill-pct']
  const blocks = fill ? Object.keys(fill.entities) : []
  return {
    blocks,
    hours: report.hours.map((h) => h.startS),
    values: Object.fromEntries(blocks.map((b) => [b, [...fill.entities[b].hourly]])),
  }
}

/** Fill % of a block from its stacked boxes (a 40 ft box fills two cells). */
export function blockFillPct(
  block: { bays: number; rows: number; tiers: number },
  slots: readonly { span: number }[],
): number {
  const capacity = block.bays * block.rows * block.tiers
  if (capacity <= 0) return 0
  const cells = slots.reduce((n, s) => n + s.span, 0)
  return Math.round((100 * cells / capacity) * 1000) / 1000
}

// ------------------------------------------------------------ landside summary

export interface LandsideSummaryRow {
  /** Catalogue key suffix: `dashboard.landside.<id>`. */
  id: string
  value: number
  unit: KpiUnit
}

/**
 * The whole-run landside numbers as table rows (TT-R18): the series charts show them over time, this table adds the
 * ones that have no per-hour series (rejected appointments) and the maxima. Rows for holding and appointments exist
 * only when the scenario has them.
 */
export function buildLandsideSummary(k: LandsideKpiReport | null | undefined): LandsideSummaryRow[] {
  if (!k) return []
  const rows: LandsideSummaryRow[] = [
    { id: 'trucksOut', value: k.trucksOut, unit: 'count' },
    { id: 'gateQueueMax', value: k.gateQueueMax, unit: 'count' },
    { id: 'gateWaitMean', value: k.gateWaitS.mean, unit: 's' },
    { id: 'gateWaitMax', value: k.gateWaitS.max, unit: 's' },
    { id: 'gateProcessing', value: k.gateProcessingS.mean, unit: 's' },
    { id: 'internalDrive', value: k.internalDriveS.mean, unit: 's' },
    { id: 'stallWaitMean', value: k.stallWaitS.mean, unit: 's' },
    { id: 'stallWaitMax', value: k.stallWaitS.max, unit: 's' },
    { id: 'turnaroundMean', value: k.totalTurnaroundS.mean, unit: 's' },
    { id: 'turnaroundMax', value: k.totalTurnaroundS.max, unit: 's' },
    { id: 'roadMean', value: k.road.meanTrucks, unit: 'ratio' },
    { id: 'roadMax', value: k.road.maxTrucks, unit: 'count' },
  ]
  if (k.holding)
    rows.push(
      { id: 'holdingUtilisation', value: k.holding.utilisationPct, unit: 'pct' },
      { id: 'holdingMax', value: k.holding.maxInUse, unit: 'count' },
      { id: 'heldOutside', value: k.holding.heldOutside, unit: 'count' },
    )
  if (k.appointments)
    rows.push(
      { id: 'appointmentsBooked', value: k.appointments.booked, unit: 'count' },
      { id: 'appointmentsRejected', value: k.appointments.rejected, unit: 'count' },
      { id: 'appointmentsDelayed', value: k.appointments.delayed, unit: 'count' },
    )
  return rows
}

/** Catalogue key of a landside summary row. */
export function landsideLabelKey(id: string): MessageKey {
  return `dashboard.landside.${id}` as MessageKey
}

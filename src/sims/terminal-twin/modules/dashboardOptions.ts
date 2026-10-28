/**
 * Builds ECharts options for the dashboard from the pure view models. This file
 * only has `import type` from echarts, so it never pulls the library into a
 * bundle; the chart library itself is loaded lazily by `chartLib.ts`.
 */
import type { EChartsCoreOption } from 'echarts/core'
import type { KpiUnit, TimelineReport } from '../engine'
import { t, type MessageKey } from '../i18n/messages'
import { downsampleEvery, kpiLabelKey, POINT_BUDGET, type KpiChartData, type YardHeatmap } from './dashboardModel'
import {
  PHASE_COLOURS,
  PHASE_PATTERNS,
  SEQUENTIAL_BLUE,
  seriesStyle,
  SURFACE,
  type TimelinePhase,
} from './dashboardPalette'

/** Locale-aware formatting supplied by the component (from the store's formatter). */
export interface ChartFormat {
  /** A sim time (s) as an axis label. */
  time(s: number): string
  value(unit: KpiUnit, v: number): string
}

const TEXT = '#e5e7eb'
const MUTED = '#9ca3af'
const GRID = 'rgba(156, 163, 175, 0.18)'

const textStyle = { color: MUTED, fontFamily: 'inherit' }

const axisCommon = {
  axisLine: { lineStyle: { color: GRID } },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: GRID } },
}

const tooltipCommon = {
  backgroundColor: '#111827',
  borderColor: '#374151',
  textStyle: { color: TEXT },
  confine: true,
}

/** Marker size for line points (>= 8 px per the dataviz spec, smaller on dense lines). */
const MARKER_PX = 8

export function lineChartOption(chart: KpiChartData, fmt: ChartFormat): EChartsCoreOption {
  const keep = downsampleEvery(chart.x.length, POINT_BUDGET)
  const x = keep.map((i) => chart.x[i])
  const dense = chart.x.length > 48
  return {
    backgroundColor: SURFACE,
    animation: false,
    aria: { enabled: true },
    textStyle,
    color: chart.lines.map((_, i) => seriesStyle(i).colour),
    legend: { type: 'scroll', top: 0, textStyle: { color: TEXT }, icon: 'roundRect' },
    grid: { left: 52, right: 20, top: 34, bottom: 62, containLabel: false },
    tooltip: {
      ...tooltipCommon,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: MUTED } },
      formatter: (raw: unknown) => {
        const params = raw as { axisValue: number; marker: string; seriesName: string; value: [number, number | null] }[]
        if (!params.length) return ''
        const rows = params.filter((p) => Array.isArray(p.value)).map((p) => {
          const v = p.value[1]
          return `${p.marker}${p.seriesName}: ${v === null ? t('unit.none') : fmt.value(chart.unit, v)}`
        })
        return [fmt.time(params[0].axisValue), ...rows].join('<br/>')
      },
    },
    xAxis: {
      type: 'value',
      min: 'dataMin',
      max: 'dataMax',
      ...axisCommon,
      axisLabel: { color: MUTED, formatter: (v: number) => fmt.time(v), hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      ...axisCommon,
      axisLabel: { color: MUTED, formatter: (v: number) => fmt.value(chart.unit, v) },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      {
        type: 'slider',
        xAxisIndex: 0,
        height: 18,
        bottom: 8,
        filterMode: 'none',
        borderColor: GRID,
        textStyle: { color: MUTED },
        labelFormatter: (v: number) => fmt.time(v),
      },
    ],
    series: chart.lines.map((line, i) => {
      const style = seriesStyle(i)
      return {
        name: line.entity,
        type: 'line',
        sampling: 'lttb',
        connectNulls: false,
        symbol: style.symbol,
        symbolSize: dense ? 5 : MARKER_PX,
        showSymbol: !dense,
        lineStyle: { width: 2, type: style.dash, color: style.colour },
        itemStyle: { color: style.colour, borderColor: SURFACE, borderWidth: 2 },
        emphasis: { focus: 'series' },
        data: keep.map((idx, k) => [x[k], line.values[idx]]),
      }
    }),
  }
}

// ------------------------------------------------------------------ heatmap

export function heatmapOption(heat: YardHeatmap, fmt: ChartFormat): EChartsCoreOption {
  const data: { value: [number, number, number | null]; label: { color: string } }[] = []
  heat.blocks.forEach((b, row) => {
    heat.values[b].forEach((v, col) => {
      const value = v === null ? null : Math.round(v * 10) / 10
      // dark text on the light steps, light text on the dark ones
      data.push({ value: [col, row, value], label: { color: value !== null && value >= 50 ? '#f0efec' : '#0b0b0b' } })
    })
  })
  return {
    backgroundColor: SURFACE,
    animation: false,
    aria: { enabled: true },
    textStyle,
    tooltip: {
      ...tooltipCommon,
      formatter: (raw: unknown) => {
        const p = raw as { value: [number, number, number | null] }
        const [col, row, v] = p.value
        return `${heat.blocks[row]} · ${fmt.time(heat.hours[col])}<br/>${t('dashboard.yard.fill')}: ${
          v === null ? t('unit.none') : fmt.value('pct', v)
        }`
      },
    },
    grid: { left: 64, right: 24, top: 12, bottom: 64 },
    xAxis: {
      type: 'category',
      data: heat.hours.map((h) => fmt.time(h)),
      ...axisCommon,
      splitArea: { show: false },
      axisLabel: { color: MUTED, hideOverlap: true },
    },
    yAxis: { type: 'category', data: heat.blocks, ...axisCommon, axisLabel: { color: MUTED } },
    visualMap: {
      type: 'continuous',
      min: 0,
      max: 100,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: [...SEQUENTIAL_BLUE] },
      text: [fmt.value('pct', 100), fmt.value('pct', 0)],
      textStyle: { color: MUTED },
    },
    series: [
      {
        type: 'heatmap',
        data,
        // 2 px surface gap between cells; the value is also in the tooltip and the table view
        itemStyle: { borderColor: SURFACE, borderWidth: 2 },
        label: { show: heat.hours.length <= 12, formatter: (p: { value: [number, number, number | null] }) =>
          p.value[2] === null ? '' : fmt.value('pct', p.value[2]) },
        emphasis: { itemStyle: { borderColor: TEXT } },
      },
    ],
  }
}

// -------------------------------------------------------------------- gantt

export interface GanttRow {
  id: string
  label: string
  kind: 'vessel' | 'crane'
}

export interface GanttBar {
  row: number
  phase: TimelinePhase
  startS: number
  endS: number
  /** Text shown inside / in the tooltip. */
  detail: string
}

export interface GanttModel {
  rows: GanttRow[]
  bars: GanttBar[]
  endS: number
}

const PHASE_LABELS: Record<TimelinePhase, MessageKey> = {
  anchorage: 'dashboard.gantt.anchorage',
  mooring: 'dashboard.gantt.mooring',
  work: 'dashboard.gantt.work',
  unmooring: 'dashboard.gantt.unmooring',
  package: 'dashboard.gantt.package',
}

export const phaseLabelKey = (p: TimelinePhase): MessageKey => PHASE_LABELS[p]

/** Rows: each vessel, followed by one row per crane that worked it. */
export function buildGanttModel(timeline: TimelineReport): GanttModel {
  const rows: GanttRow[] = []
  const bars: GanttBar[] = []
  const push = (row: number, phase: TimelinePhase, startS: number, endS: number, detail: string) => {
    if (endS > startS) bars.push({ row, phase, startS, endS, detail })
  }
  for (const v of timeline.vessels) {
    const vr = rows.push({ id: v.vesselId, label: v.vesselId, kind: 'vessel' }) - 1
    push(vr, 'anchorage', v.anchorage.startS, v.anchorage.endS, v.vesselId)
    push(vr, 'mooring', v.mooring.startS, v.mooring.endS, v.vesselId)
    push(vr, 'work', v.work.startS, v.work.endS, v.vesselId)
    push(vr, 'unmooring', v.unmooring.startS, v.unmooring.endS, v.vesselId)
    for (const p of v.packages) {
      const cr = rows.push({ id: `${v.vesselId}:${p.stsId}`, label: `${v.vesselId} · ${p.stsId}`, kind: 'crane' }) - 1
      push(cr, 'package', p.startS, p.endS, t('dashboard.gantt.bays', { bays: bayRange(p.bays) }))
    }
  }
  return { rows, bars, endS: timeline.nowS }
}

export function bayRange(bays: readonly number[]): string {
  if (bays.length === 0) return ''
  const sorted = [...bays].sort((a, b) => a - b)
  return sorted.length === 1 ? String(sorted[0]) : `${sorted[0]}–${sorted[sorted.length - 1]}`
}

export function ganttOption(model: GanttModel, fmt: ChartFormat): EChartsCoreOption {
  const phaseName = (p: TimelinePhase) => t(PHASE_LABELS[p])
  return {
    backgroundColor: SURFACE,
    animation: false,
    aria: { enabled: true },
    textStyle,
    tooltip: {
      ...tooltipCommon,
      formatter: (raw: unknown) => {
        const p = raw as { value: [number, number, number, TimelinePhase, string] }
        const [row, start, end, phase, detail] = p.value
        return [
          model.rows[row].label,
          `${phaseName(phase)}: ${fmt.time(start)} – ${fmt.time(end)}`,
          detail,
        ].join('<br/>')
      },
    },
    // the legend is the HTML one beside the chart (its swatches carry the same textures)
    legend: { show: false },
    grid: { left: 120, right: 20, top: 34, bottom: 62 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter' },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 8, filterMode: 'weakFilter', borderColor: GRID, textStyle: { color: MUTED }, labelFormatter: (v: number) => fmt.time(v) },
    ],
    xAxis: {
      type: 'value',
      min: 0,
      max: Math.max(model.endS, 1),
      ...axisCommon,
      axisLabel: { color: MUTED, formatter: (v: number) => fmt.time(v), hideOverlap: true },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: model.rows.map((r) => r.label),
      ...axisCommon,
      axisLabel: { color: TEXT },
    },
    series: (Object.keys(PHASE_COLOURS) as TimelinePhase[]).map((phase) => ({
      name: phaseName(phase),
      type: 'custom',
      encode: { x: [1, 2], y: 0 },
      itemStyle: { color: PHASE_COLOURS[phase], borderColor: SURFACE, borderWidth: 1 },
      renderItem: (_params: unknown, api: GanttApi) => {
        const row = api.value(0) as number
        const start = api.coord([api.value(1), row])
        const end = api.coord([api.value(2), row])
        const height = api.size([0, 1])[1] * 0.6
        const shape = { x: start[0], y: start[1] - height / 2, width: Math.max(end[0] - start[0], 1), height }
        const pattern = patternFill(phase)
        return {
          type: 'group',
          children: [
            { type: 'rect', shape, style: { fill: PHASE_COLOURS[phase], stroke: SURFACE, lineWidth: 1 } },
            // texture on top of the colour: the phase is never conveyed by colour alone
            ...(pattern ? [{ type: 'rect', shape, style: { fill: pattern }, silent: true }] : []),
          ],
        }
      },
      data: model.bars
        .filter((b) => b.phase === phase)
        .map((b) => [b.row, b.startS, b.endS, b.phase, b.detail]),
    })),
  }
}

/** The slice of ECharts' custom-series API the Gantt uses. */
interface GanttApi {
  value(dim: number): number | string
  coord(v: [number | string, number]): [number, number]
  size(v: [number, number]): [number, number]
}

const patterns = new Map<TimelinePhase, { image: HTMLCanvasElement; repeat: 'repeat' } | null>()

/** A repeating zrender pattern fill for a phase (browser only; built on first use). */
function patternFill(phase: TimelinePhase): { image: HTMLCanvasElement; repeat: 'repeat' } | null {
  if (patterns.has(phase)) return patterns.get(phase) ?? null
  let result: { image: HTMLCanvasElement; repeat: 'repeat' } | null = null
  const spec = PHASE_PATTERNS[phase]
  if (spec.symbol !== 'none' && typeof document !== 'undefined') {
    const size = 8
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.lineWidth = 2
      ctx.beginPath()
      if (spec.symbol === 'circle') {
        ctx.arc(size / 2, size / 2, 1.6, 0, Math.PI * 2)
        ctx.fill()
      } else if (spec.symbol === 'triangle') {
        ctx.moveTo(size / 2, 0)
        ctx.lineTo(size / 2, size)
        ctx.stroke()
      } else if (spec.rotation > 0) {
        ctx.moveTo(0, size)
        ctx.lineTo(size, 0)
        ctx.moveTo(-1, 1)
        ctx.lineTo(1, -1)
        ctx.moveTo(size - 1, size + 1)
        ctx.lineTo(size + 1, size - 1)
        ctx.stroke()
      } else {
        ctx.moveTo(0, 0)
        ctx.lineTo(size, size)
        ctx.moveTo(-1, size - 1)
        ctx.lineTo(1, size + 1)
        ctx.moveTo(size - 1, -1)
        ctx.lineTo(size + 1, 1)
        ctx.stroke()
      }
      result = { image: canvas, repeat: 'repeat' }
    }
  }
  patterns.set(phase, result)
  return result
}

export { kpiLabelKey }

/**
 * ECharts options for the dashboard (seam: pure option builders): zoom, legend,
 * downsampling and the non-colour encodings are present in what is handed to the chart.
 */
import { describe, expect, it } from 'vitest'
import { buildGanttModel, ganttOption, heatmapOption, lineChartOption, type ChartFormat } from '../modules/dashboardOptions'
import { POINT_BUDGET, type KpiChartData } from '../modules/dashboardModel'
import { SERIES_COLOURS, SERIES_SYMBOLS } from '../modules/dashboardPalette'
import { buildTimeline, createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

const fmt: ChartFormat = { time: (s) => `t${s}`, value: (u, v) => `${v}${u}` }

function chart(points: number, lines = 3): KpiChartData {
  return {
    kpiId: 'sts.moves',
    unit: 'count',
    x: Array.from({ length: points }, (_, i) => i * 3600),
    lines: Array.from({ length: lines }, (_, l) => ({
      entity: `S${l}`,
      values: Array.from({ length: points }, (_, i) => (i % 7 === 0 ? null : i + l)),
    })),
    hiddenEntities: 0,
  }
}

describe('line chart option', () => {
  const opt = lineChartOption(chart(24), fmt) as Record<string, unknown> & { series: Record<string, unknown>[] }

  it('has zoom (inside + slider) and a legend', () => {
    expect((opt.dataZoom as { type: string }[]).map((z) => z.type)).toEqual(['inside', 'slider'])
    expect(opt.legend).toBeTruthy()
  })

  it('encodes each series by colour, marker symbol and dash (never colour alone)', () => {
    opt.series.forEach((s, i) => {
      expect((s.itemStyle as { color: string }).color).toBe(SERIES_COLOURS[i])
      expect(s.symbol).toBe(SERIES_SYMBOLS[i])
      expect((s.lineStyle as { type: string }).type).toBeTruthy()
    })
    expect(new Set(opt.series.map((s) => s.symbol)).size).toBe(3)
  })

  it('downsamples very long series to the point budget and uses lttb sampling', () => {
    const long = lineChartOption(chart(POINT_BUDGET * 4, 1), fmt) as { series: { data: unknown[]; sampling: string }[] }
    expect(long.series[0].data.length).toBeLessThanOrEqual(POINT_BUDGET)
    expect(long.series[0].sampling).toBe('lttb')
  })

  it('tooltip formatter tolerates params without a data point', () => {
    const f = (opt.tooltip as { formatter: (p: unknown) => string }).formatter
    expect(f([{ axisValue: 3600, marker: '', seriesName: 'x', value: undefined }])).toBe('t3600')
  })
})

describe('heatmap and gantt options', () => {
  it('heatmap uses a one-hue sequential visual map from 0 to 100 %', () => {
    const o = heatmapOption({ blocks: ['B01'], hours: [0, 3600], values: { B01: [10, null] } }, fmt) as {
      visualMap: { min: number; max: number }
    }
    expect([o.visualMap.min, o.visualMap.max]).toEqual([0, 100])
  })

  it('gantt has one series per phase and a row per vessel and crane package', () => {
    const sim = createSimulation(fixtures['two-vessels-compete-for-berth'])
    sim.runUntil()
    const model = buildGanttModel(buildTimeline(sim.eventLog(), sim.now))
    const o = ganttOption(model, fmt) as { series: { name: string }[]; yAxis: { data: string[] } }
    expect(o.series).toHaveLength(5)
    expect(o.yAxis.data).toEqual(model.rows.map((r) => r.label))
    expect(model.rows.filter((r) => r.kind === 'vessel')).toHaveLength(2)
  })
})

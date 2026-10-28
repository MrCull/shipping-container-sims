/**
 * Dashboard view models (seam: pure builders over the engine's KPI series and queries).
 * Expected values come from the engine's own reports, not from re-deriving them.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import {
  KPI_GROUPS,
  blockFillPct,
  buildGroupCharts,
  buildYardHeatmap,
  downsampleEvery,
  groupsWithData,
} from '../modules/dashboardModel'

function run(name: string, until?: number) {
  const sim = createSimulation(fixtures[name])
  if (until === undefined) sim.runUntil()
  else sim.runUntil({ time: until })
  return sim
}

describe('KPI groups', () => {
  const sim = run('asc-1sts-10-boxes-1block')
  const series = sim.kpiSeries()

  it('offers only groups that have data, and every KPI in a group exists in the report', () => {
    const groups = groupsWithData(series)
    expect(groups).toContain('quay')
    expect(groups).toContain('yard')
    expect(groups).not.toContain('landside') // no landside KPIs yet
    for (const g of KPI_GROUPS) for (const id of g.kpis) expect(typeof id).toBe('string')
  })

  it('builds one chart per KPI with one line per entity and one point per hour', () => {
    const charts = buildGroupCharts(series, 'quay', 'hour')
    const moves = charts.find((c) => c.kpiId === 'sts.moves')!
    expect(moves.unit).toBe('count')
    expect(moves.x).toEqual(series.hours.map((h) => h.startS))
    const sts = moves.lines.find((l) => l.entity === 'STS01')!
    expect(sts.values).toEqual(series.series['sts.moves'].entities.STS01.hourly)
    expect(sts.values.reduce<number>((a, v) => a + (v ?? 0), 0)).toBe(series.series['sts.moves'].entities.STS01.total)
  })

  it('switches to shift buckets', () => {
    const charts = buildGroupCharts(series, 'quay', 'shift')
    const moves = charts.find((c) => c.kpiId === 'sts.moves')!
    expect(moves.x).toEqual(series.shifts.map((s) => s.startS))
    expect(moves.lines[0].values).toEqual(series.series['sts.moves'].entities.STS01.shifts)
  })

  it('caps lines at 8 (the palette) and reports how many were folded away', () => {
    const fake = {
      ...series,
      series: {
        'sts.moves': {
          ...series.series['sts.moves'],
          entities: Object.fromEntries(
            Array.from({ length: 11 }, (_, i) => [`S${i}`, series.series['sts.moves'].entities.STS01]),
          ),
        },
      },
    }
    const [chart] = buildGroupCharts(fake, 'quay', 'hour')
    expect(chart.lines).toHaveLength(8)
    expect(chart.hiddenEntities).toBe(3)
  })
})

describe('downsampling long runs', () => {
  it('keeps at most the budget of points, always including the last', () => {
    const idx = downsampleEvery(24 * 7, 100)
    expect(idx.length).toBeLessThanOrEqual(100)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(24 * 7 - 1)
    expect(downsampleEvery(24, 100)).toHaveLength(24)
  })
})

describe('yard heatmap', () => {
  const sim = run('asc-1sts-10-boxes-1block')
  const series = sim.kpiSeries()

  it("per-block fill matches the engine's yard state and the KPI total", () => {
    const heat = buildYardHeatmap(series)
    expect(heat.blocks).toEqual(sim.query.yardBlocks().map((b) => b.id))
    const last = heat.hours.length - 1
    for (const b of sim.query.yardBlocks()) {
      expect(blockFillPct(b, sim.query.yardSlots(b.id))).toBeCloseTo(series.series['yard.fill-pct'].entities[b.id].total ?? 0, 1)
      expect(heat.values[b.id][last]).toBe(series.series['yard.fill-pct'].entities[b.id].hourly[last])
    }
  })
})

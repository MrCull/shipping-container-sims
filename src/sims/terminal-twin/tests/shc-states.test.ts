/**
 * TT-R11: SHC operational states (seam: `shcOperationalState`, `Simulation.kpiSeries()` / `kpiReport()`).
 * The expected mapping is a literal table, not recomputed from the code.
 */
import { describe, expect, it } from 'vitest'
import {
  createSimulation,
  headlineKpis,
  kpiReportCsv,
  kpiReportJson,
  SHC_OPERATIONAL_STATES,
  SHC_STATUSES,
  shcOperationalState,
  type ShcState,
  type ShcStatus,
} from '../engine'
import { fixtures } from '../scenario/fixtures'

const shc = (status: ShcStatus, motion: ShcState['motion'] = []): ShcState => ({
  id: 'SHC01',
  status,
  nodeId: 'n',
  carrying: null,
  jobId: null,
  motion,
  plan: [],
})

const EXPECTED: Record<ShcStatus, string> = {
  parked: 'parked',
  'waiting-for-dispatch': 'parked',
  available: 'parked',
  'waiting-for-pad': 'queuing-to-collect',
  'job-assigned': 'moving-to-collect',
  'routing-to-parking': 'moving-to-collect',
  'routing-empty': 'collecting',
  'positioning-at-pickup': 'collecting',
  locking: 'collecting',
  lifting: 'moving-to-deliver',
  'routing-loaded': 'delivering',
  'positioning-at-dropoff': 'delivering',
  lowering: 'delivering',
  unlocking: 'delivering',
  clearing: 'delivering',
  'queuing-for-pad': 'queuing-to-deliver',
  'queuing-for-work': 'queuing-to-collect',
}

describe('SHC operational states', () => {
  it('has seven states', () => {
    expect([...SHC_OPERATIONAL_STATES]).toEqual([
      'parked',
      'moving-to-collect',
      'queuing-to-collect',
      'collecting',
      'moving-to-deliver',
      'queuing-to-deliver',
      'delivering',
    ])
  })

  it('maps every existing status to exactly one operational state', () => {
    expect([...SHC_STATUSES].sort()).toEqual(Object.keys(EXPECTED).sort())
    for (const status of SHC_STATUSES) {
      const op = shcOperationalState(shc(status), 0)
      expect(op, status).toBe(EXPECTED[status])
      expect(SHC_OPERATIONAL_STATES).toContain(op)
    }
  })

  it('an assigned SHC queues for its reservations until its departure time', () => {
    const motion = [{ id: 's', axis: 'x', from: 0, to: 10, t0: 50, t1: 60 }] as unknown as ShcState['motion']
    expect(shcOperationalState(shc('job-assigned', motion), 49)).toBe('queuing-to-collect')
    expect(shcOperationalState(shc('job-assigned', motion), 50)).toBe('moving-to-collect')
  })
})

describe('SHC dispatch metrics on a real run', () => {
  const sim = createSimulation(fixtures['shc-1sts-2shc-1wtp'])
  sim.runUntil()
  const series = sim.kpiSeries()
  const report = sim.kpiReport()
  const hz = report.horizontal!

  it('time per state adds up to the elapsed time, per SHC, in the series and the report', () => {
    for (const id of Object.keys(hz.shcs)) {
      let seriesSum = 0
      for (const op of SHC_OPERATIONAL_STATES) seriesSum += series.series[`shc.state.${op}-s`].entities[id].total ?? 0
      expect(seriesSum).toBeCloseTo(series.elapsedS, 1)
      const reportSum = Object.values(hz.shcs[id].stateS).reduce((a, b) => a + b, 0)
      expect(reportSum).toBeCloseTo(series.elapsedS, 1)
    }
  })

  it('an SHC that worked spent time collecting, moving and delivering; none queues to deliver yet', () => {
    const worker = Object.entries(hz.shcs).find(([, k]) => k.jobs > 0)!
    const s = worker[1].stateS
    expect(s['moving-to-collect']).toBeGreaterThan(0)
    expect(s.collecting).toBeGreaterThan(0)
    expect(s['moving-to-deliver']).toBeGreaterThan(0)
    expect(s.delivering).toBeGreaterThan(0)
    expect(s['queuing-to-deliver']).toBe(0)
  })

  it('handovers: one custody change at a buffer per box picked up and one per box put down', () => {
    const log = sim.eventLog()
    for (const id of Object.keys(hz.shcs)) {
      const mine = log.filter((e) => (e.payload as { shcId?: string }).shcId === id)
      const n = mine.filter((e) => ['ShcPicked', 'ShcPickedAtWtp', 'ShcDroppedAtWtp', 'ShcDroppedAtGround'].includes(e.type)).length
      expect(hz.shcs[id].handovers).toBe(n)
      expect(series.series['shc.handovers'].entities[id].total).toBe(n)
    }
    expect(Object.values(hz.shcs).reduce((a, k) => a + k.handovers, 0)).toBe(hz.boxesToWtp * 2)
  })

  it('headline, JSON and CSV carry empty travel, time per state and handovers', () => {
    const h = headlineKpis(series, report)
    expect(h.shcEmptyDistanceM).toBeCloseTo(Object.values(hz.shcs).reduce((a, k) => a + k.emptyDistanceM, 0), 1)
    expect(h.shcHandovers).toBe(Object.values(hz.shcs).reduce((a, k) => a + k.handovers, 0))
    expect(Object.keys(h.shcStateS!)).toEqual([...SHC_OPERATIONAL_STATES])
    const json = JSON.parse(kpiReportJson(sim))
    expect(json.headline.shcHandovers).toBe(h.shcHandovers)
    expect(json.kpis.horizontal.shcs['SHC01'].stateS).toBeDefined()
    const csv = kpiReportCsv(sim)
    expect(csv).toContain('shc.state.collecting-s')
    expect(csv).toContain('shc.handovers')
    expect(csv).toContain('shc.empty-distance-m')
  })
})

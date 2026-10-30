/**
 * TT-R18: truck turnaround metrics. The expected values are derived here from the event log with plain arithmetic, so
 * they do not share code with the engine counters or the collector; `truck-holding-overflow` is the hand-computed case.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, headlineKpis, kpiReportCsv, kpiReportJson, restoreSimulation, type EngineEvent, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

const run = (name: string): Simulation => {
  const sim = createSimulation(fixtures[name])
  sim.runUntil()
  return sim
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const mean = (xs: number[]) => (xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
const max = (xs: number[]) => r3(Math.max(0, ...xs))

/** Time of the first event of a type for a truck. */
function timeOf(sim: Simulation, type: EngineEvent['type'], truckId: string): number | undefined {
  return sim.eventLog().find((e) => e.type === type && (e.payload as { truckId?: string }).truckId === truckId)?.t
}

/** Every metric worked out per truck from the event log. */
function byHand(sim: Simulation) {
  const trucks = ofType(sim, 'TruckGateOut').map((e) => e.payload.truckId)
  const arrived = (id: string) => timeOf(sim, 'TruckArrived', id) as number
  const out = (id: string) => timeOf(sim, 'TruckGateOut', id) as number
  const span = (a: EngineEvent['type'], b: EngineEvent['type'], id: string) => {
    const t0 = timeOf(sim, a, id)
    const t1 = timeOf(sim, b, id)
    return t0 !== undefined && t1 !== undefined ? t1 - t0 : 0
  }
  const processing = ofType(sim, 'TruckGateIn').map((e) => e.payload.processingS)
  const drive = trucks.map((id) => span('TruckRoutingToHolding', 'TruckAtHolding', id) + span('TruckRoutingToStall', 'TruckAtStall', id))
  const total = trucks.map((id) => out(id) - arrived(id))
  // trucks driving inside (inbound legs and the way out) as +1 / -1 steps in time order
  const steps: { t: number; d: number }[] = []
  for (const e of sim.eventLog()) {
    if (e.type === 'TruckRoutingToHolding' || e.type === 'TruckRoutingToStall' || e.type === 'TruckRoutingToExit') steps.push({ t: e.t, d: 1 })
    if (e.type === 'TruckAtHolding' || e.type === 'TruckAtStall' || e.type === 'TruckGateOut') steps.push({ t: e.t, d: -1 })
  }
  let n = 0
  let peak = 0
  let area = 0
  let last = 0
  for (const s of steps) {
    area += n * (s.t - last)
    last = s.t
    n += s.d
    peak = Math.max(peak, n)
  }
  // holding positions occupied from reservation to the truck driving out of the position
  let holdArea = 0
  for (const e of ofType(sim, 'TruckHoldingAssigned')) holdArea += (timeOf(sim, 'TruckRoutingToStall', e.payload.truckId) as number) - e.t
  return { processing, drive, total, area, peak, holdArea }
}

describe('truck turnaround metrics on truck-holding-overflow (hand-computed)', () => {
  const sim = run('truck-holding-overflow')
  const k = sim.kpiReport().landside
  const hand = byHand(sim)

  it('reports gate processing, internal drive and total turnaround as per-truck mean and max', () => {
    expect(k?.trucksOut).toBe(10)
    expect(k?.gateProcessingS).toEqual({ mean: mean(hand.processing), max: max(hand.processing) })
    expect(k?.internalDriveS).toEqual({ mean: mean(hand.drive), max: max(hand.drive) })
    expect(k?.totalTurnaroundS).toEqual({ mean: mean(hand.total), max: max(hand.total) })
    expect(k?.internalDriveS.mean).toBeGreaterThan(0)
  })

  it('total turnaround runs from arrival at the gate, so it includes the wait outside and exceeds gate-in to gate-out', () => {
    expect(k?.totalTurnaroundS.mean).toBeGreaterThan(k?.turnTimeS.mean ?? Infinity)
    expect(k?.totalTurnaroundS.max).toBeGreaterThan(k?.turnTimeS.max ?? Infinity)
    for (const t of hand.total) expect(t).toBeGreaterThan(0)
  })

  it('pins the headline numbers of the fixture (10 trucks, 30 s kiosk, 2 stalls, 2 holding positions)', () => {
    expect(k?.gateProcessingS).toEqual({ mean: 30, max: 30 })
    expect(k?.gateQueueMax).toBe(8)
    expect(k?.road.maxTrucks).toBe(4)
    expect(k?.holding?.admittedToHolding).toBe(8)
  })

  it('reports the trucks driving on the roads as a time-weighted mean and a peak', () => {
    expect(k?.road.maxTrucks).toBe(hand.peak)
    expect(k?.road.meanTrucks).toBeCloseTo(hand.area / sim.kpiReport().simTimeS, 2)
  })

  it('reports holding utilisation as occupied position-seconds over positions x run time, plus the existing gate numbers', () => {
    const h = k?.holding
    expect(h?.positions).toBe(2)
    expect(h?.maxInUse).toBe(2)
    expect(h?.heldOutside).toBe(6)
    expect(h?.utilisationPct).toBeCloseTo((100 * hand.holdArea) / (2 * sim.kpiReport().simTimeS), 2)
    expect(k?.gateQueueMax).toBeGreaterThanOrEqual(6)
    expect(k?.gateWaitS.mean).toBeGreaterThan(0)
    expect(k?.stallWaitS).toBeDefined()
  })

  it('agrees with the KPI series totals (the dashboard and CSV source)', () => {
    const s = sim.kpiSeries().series
    const total = (id: string) => s[id].entities.terminal.total
    expect(total('landside.gate-processing-s')).toBeCloseTo(k?.gateProcessingS.mean ?? NaN, 2)
    expect(total('landside.internal-drive-s')).toBeCloseTo(k?.internalDriveS.mean ?? NaN, 2)
    expect(total('landside.total-turnaround-s')).toBeCloseTo(k?.totalTurnaroundS.mean ?? NaN, 2)
    expect(total('landside.road-trucks')).toBeCloseTo(k?.road.meanTrucks ?? NaN, 2)
    expect(total('landside.holding-utilisation-pct')).toBeCloseTo(k?.holding?.utilisationPct ?? NaN, 1)
    expect(s['landside.appointments-delayed']).toBeUndefined() // no appointment system in this fixture
  })

  it('survives a snapshot restore with the same numbers', () => {
    const half = createSimulation(fixtures['truck-holding-overflow'])
    half.runUntil({ eventType: 'TruckAtHolding' })
    const restored = restoreSimulation(half.snapshot())
    restored.runUntil()
    expect(restored.kpiReport().landside).toEqual(k)
  })
})

describe('appointments: rejected and delayed', () => {
  const sim = run('truck-appointment-windows')
  const k = sim.kpiReport().landside

  it('counts a booked truck as delayed when it passes the gate after the end of its window', () => {
    const windowS = k?.appointments?.windowS as number
    let delayed = 0
    for (const e of ofType(sim, 'TruckGateStarted')) {
      const arrived = timeOf(sim, 'TruckArrived', e.payload.truckId) as number
      const booked = ofType(sim, 'TruckArrived').find((a) => a.payload.truckId === e.payload.truckId)?.payload.appointmentId
      if (booked && e.t >= (Math.floor(arrived / windowS) + 1) * windowS) delayed++
    }
    expect(k?.appointments?.delayed).toBe(delayed)
    expect(k?.appointments?.rejected).toBe(12)
    expect(k?.appointments?.delayed).toBe(2)
    const series = sim.kpiSeries().series['landside.appointments-delayed'].entities.terminal.total
    expect(series).toBe(delayed)
  })
})

describe('scenarios without the optional landside parts', () => {
  it('has the turnaround numbers but no holding utilisation or delayed count', () => {
    const k = run('truck-gate-queue').kpiReport().landside
    expect(k?.totalTurnaroundS.mean).toBeGreaterThan(0)
    expect(k?.gateProcessingS.mean).toBeGreaterThan(0)
    expect(k?.holding).toBeUndefined()
    expect(k?.appointments).toBeUndefined()
  })
})

describe('export and headline', () => {
  const sim = run('truck-holding-overflow')

  it('puts every metric in the JSON report and the CSV', () => {
    const json = JSON.parse(kpiReportJson(sim))
    for (const key of ['gateQueueMax', 'gateWaitS', 'gateProcessingS', 'internalDriveS', 'stallWaitS', 'totalTurnaroundS', 'road']) expect(json.kpis.landside, key).toHaveProperty(key)
    expect(json.kpis.landside.holding).toHaveProperty('utilisationPct')
    const csv = kpiReportCsv(sim)
    for (const id of [
      'landside.gate-queue',
      'landside.gate-wait-s',
      'landside.gate-processing-s',
      'landside.internal-drive-s',
      'landside.stall-wait-s',
      'landside.total-turnaround-s',
      'landside.road-trucks',
      'landside.holding-utilisation-pct',
    ])
      expect(csv, id).toContain(`${id},`)
  })

  it('writes the appointment counts into the CSV as total rows', () => {
    const csv = kpiReportCsv(run('truck-appointment-windows'))
    expect(csv).toMatch(/^landside\.appointments-rejected,count,terminal,terminal,total,,0,[\d.]+,12$/m)
    expect(csv).toMatch(/^landside\.appointments-delayed,count,terminal,terminal,total,/m)
  })

  it('shows the mean truck turnaround in the headline (null without a landside)', () => {
    const h = headlineKpis(sim.kpiSeries(), sim.kpiReport())
    expect(h.truckTurnaroundS).toBe(sim.kpiReport().landside?.totalTurnaroundS.mean)
    const plain = run('tracer-1sts-10-boxes')
    expect(headlineKpis(plain.kpiSeries(), plain.kpiReport()).truckTurnaroundS).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import { VESSEL_CLASSES } from '../scenario/vesselClasses'

const twoVessels = fixtures['two-vessels-compete-for-berth']

function eventsOf(log: readonly EngineEvent[], vesselId: string): EngineEvent[] {
  return log.filter((e) => e.subjects.vessels?.includes(vesselId) && !e.type.startsWith('Decision') && !e.type.startsWith('Sts') && !e.type.startsWith('WorkPackage'))
}

describe('berthing on a continuous quay', () => {
  it('two vessels compete for a berth: the second waits at anchorage, then berths after the first departs', () => {
    const sim = createSimulation(twoVessels)
    expect(sim.runUntil().reason).toBe('ended')
    const log = sim.eventLog()

    expect(eventsOf(log, 'V001').map((e) => e.type)).toEqual([
      'VesselArrived',
      'BerthAllocated',
      'VesselBerthed',
      'VesselWorkComplete',
      'VesselDeparted',
    ])
    expect(eventsOf(log, 'V002').map((e) => e.type)).toEqual([
      'VesselArrived',
      'VesselAtAnchorage',
      'BerthAllocated',
      'VesselBerthed',
      'VesselWorkComplete',
      'VesselDeparted',
    ])

    const at = (vesselId: string, type: string) => eventsOf(log, vesselId).find((e) => e.type === type)!.t
    const v1Departed = at('V001', 'VesselDeparted')
    expect(at('V002', 'VesselArrived')).toBe(300)
    expect(at('V002', 'VesselAtAnchorage')).toBe(300)
    expect(at('V002', 'BerthAllocated')).toBe(v1Departed)
    // mooring and unmooring times apply
    expect(at('V002', 'VesselBerthed')).toBe(v1Departed + twoVessels.quay.mooringS)
    expect(at('V001', 'VesselBerthed')).toBe(twoVessels.quay.mooringS)
    expect(at('V001', 'VesselDeparted')).toBe(at('V001', 'VesselWorkComplete') + twoVessels.quay.unmooringS)

    // the anchorage wait is recorded
    const kpis = sim.kpiReport()
    expect(kpis.vessels.V001.anchorageWaitS).toBe(0)
    expect(kpis.vessels.V002.anchorageWaitS).toBeCloseTo(v1Departed - 300, 3)
    expect(kpis.quay.vesselsWaited).toBe(1)
    expect(kpis.quay.anchorageWaitS.max).toBeCloseTo(v1Departed - 300, 3)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('a vessel departs automatically once all its moves are done', () => {
    const sim = createSimulation(twoVessels)
    sim.runUntil()
    const log = sim.eventLog()
    const lastGrounded = log.filter((e) => e.type === 'StsGrounded' && sim.query.container(e.subjects.containers![0]).custodyHistory[0].owner.id.startsWith('V001:')).at(-1)!
    const workComplete = log.find((e) => e.type === 'VesselWorkComplete' && e.subjects.vessels?.[0] === 'V001')!
    expect(sim.why(workComplete.id).map((e) => e.id)).toContain(lastGrounded.id)
    expect(sim.query.vessel('V001').status).toBe('departed')
    expect(sim.query.vessel('V001').remainingDischarge).toBe(0)
  })

  it('vessels that fit berth side by side at different positions (first-fit)', () => {
    const config = new ScenarioBuilder('side-by-side', 'two feeders on a long quay').hatch({ enabled: false })
      .quay(600, { mooringS: 100, unmooringS: 100, berthGapM: 20 })
      .sts('STS01', { gantryX: 50, groundPositions: 10 })
      .sts('STS02', { gantryX: 300, groundPositions: 10 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 4, maxSts: 1 })
      .vesselCall('V002', { sizeClass: 'feeder', arrivalS: 10, discharge: 4, maxSts: 1 })
      .build()
    const sim = createSimulation(config)
    sim.runUntil()
    const k = sim.kpiReport().vessels
    expect(k.V001.berthX).toBe(0)
    expect(k.V002.berthX).toBe(VESSEL_CLASSES.feeder.loaM + 20)
    expect(k.V002.anchorageWaitS).toBe(0)
    expect(k.V001.sts).toEqual(['STS01'])
    expect(k.V002.sts).toEqual(['STS02'])
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('berth allocation is a decision point: first-fit and best-fit choose different gaps', () => {
    // V001 [0,140] and V003 [454,594] stay long; V002 [150,444] leaves early.
    // V004 then sees a 314 m gap mid-quay and a 166 m gap at the end of the 760 m quay.
    const config = (strategy: string) =>
      new ScenarioBuilder('fit', 'first-fit vs best-fit').hatch({ enabled: false })
        .quay(760, { mooringS: 100, unmooringS: 100, berthGapM: 10 })
        .sts('STS01', { gantryX: 50, groundPositions: 40 })
        .sts('STS02', { gantryX: 300, groundPositions: 40 })
        .sts('STS03', { gantryX: 550, groundPositions: 40 })
        .vesselCall('V001', { sizeClass: 'feeder', arrivalS: 0, discharge: 30, maxSts: 1 })
        .vesselCall('V002', { sizeClass: 'panamax', arrivalS: 10, discharge: 2, maxSts: 1 })
        .vesselCall('V003', { sizeClass: 'feeder', arrivalS: 20, discharge: 30, maxSts: 1 })
        .vesselCall('V004', { sizeClass: 'feeder', arrivalS: 1500, discharge: 2, maxSts: 1 })
        .decisions({ points: { berthAllocation: { strategy } } })
        .build()
    const berthOf = (strategy: string) => {
      const sim = createSimulation(config(strategy))
      sim.runUntil({ predicate: (e) => e.type === 'BerthAllocated' && e.payload.vesselId === 'V004' })
      expect(sim.query.vessel('V002').status).toBe('departed')
      expect(sim.invariantReport().violations).toEqual([])
      return sim.query.vessel('V004').berthX
    }
    expect(berthOf('first-fit')).toBe(150)
    expect(berthOf('best-fit')).toBe(604)
  })

  it('a scripted berth handler is obeyed; an overlapping berth is rejected', () => {
    const config = new ScenarioBuilder('scripted', 'scripted berths').hatch({ enabled: false })
      .quay(600, { mooringS: 100, unmooringS: 100, berthGapM: 10 })
      .sts('STS01', { gantryX: 100, groundPositions: 10 })
      .sts('STS02', { gantryX: 400, groundPositions: 10 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 2, maxSts: 1 })
      .vesselCall('V002', { sizeClass: 'feeder', arrivalS: 10, discharge: 2, maxSts: 1 })
      .build()
    const ok = createSimulation(config, { berthAllocation: (msg) => ({ berthX: msg.payload.vesselId === 'V001' ? 300 : 50 }) })
    ok.runUntil()
    expect(ok.kpiReport().vessels.V001.berthX).toBe(300)
    expect(ok.kpiReport().vessels.V002.berthX).toBe(50)
    const bad = createSimulation(config, { berthAllocation: () => ({ berthX: 100 }) })
    expect(bad.runUntil().reason).toBe('failed')
    expect(bad.firstError?.message).toMatch(/V002 at 100 m overlaps V001/)
  })
})

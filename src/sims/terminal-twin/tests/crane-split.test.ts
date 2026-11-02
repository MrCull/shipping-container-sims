import { describe, expect, it } from 'vitest'
import { createSimulation, positionAt, type EngineEvent, type Simulation } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'

const craneSplit = fixtures['crane-split-4sts']

function withSplit(strategy: string) {
  return { ...craneSplit, decisions: { points: { craneSplit: { strategy } } } }
}

/** Gantry X of every crane at the current sim time, in rail order (from the cranes' planned motion). */
function gantryPositions(sim: Simulation): { id: string; x: number }[] {
  return sim.query.stsList().map((s) => {
    const seg = s.motion.find((m) => m.axis === 'gantry')
    return { id: s.id, x: seg ? positionAt(seg, sim.now) : s.gantryX }
  })
}

function splitReply(sim: Simulation): Record<string, number[]> {
  const ev = sim.eventLog().find((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'craneSplit')
  if (ev?.type !== 'DecisionResolved' || ev.payload.decisionPoint !== 'craneSplit') throw new Error('no crane split')
  return Object.fromEntries(ev.payload.reply.assignments.map((a) => [a.stsId, a.bays]))
}

describe('STS cranes on one rail', () => {
  it('never pass or come closer than the minimum spacing, checked after every event of the 4-STS fixture', () => {
    for (const strategy of ['balanced-moves', 'equal-bays']) {
      const sim = createSimulation(withSplit(strategy))
      let checked = 0
      sim.subscribe(() => {
        const xs = gantryPositions(sim)
        for (let i = 1; i < xs.length; i++) {
          expect(xs[i].x - xs[i - 1].x, `${xs[i - 1].id} → ${xs[i].id} at t=${sim.now}`).toBeGreaterThanOrEqual(
            craneSplit.quay.stsMinSpacingM - 1e-6,
          )
        }
        checked++
      })
      expect(sim.runUntil().reason).toBe('ended')
      expect(checked).toBe(sim.eventLog().length)
      expect(sim.invariantReport().violations).toEqual([])
      expect(sim.kpiReport().movesCompleted).toBe(60)
    }
  })

  it('the sts.rail-order invariant catches a crane driven past its neighbour', () => {
    const sim = createSimulation(craneSplit)
    sim.runUntil({ time: 10 })
    // STS02 stands at 140 m; send STS01 (at 40 m) to 200 m regardless of the rail
    sim.inject('StsRepositionStarted', 10, { equipment: ['STS01'] }, { stsId: 'STS01', toX: 200 })
    expect(sim.runUntil().reason).toBe('failed')
    const last = sim.eventLog().at(-1) as EngineEvent
    if (last.type !== 'InvariantViolated') throw new Error(`expected InvariantViolated, got ${last.type}`)
    expect(last.payload.invariant).toBe('sts.rail-order')
    expect(last.payload.message).toMatch(/STS01.*STS02/)
  })

  it('a free crane in the way steps aside, and the working crane waits for the rail meanwhile', () => {
    const config = new ScenarioBuilder('yield', 'STS02 is parked inside the vessel span of STS01').hatch({ enabled: false })
      .quay(500, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 50, groundPositions: 30 })
      .sts('STS02', { gantryX: 100, groundPositions: 30 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 24, maxSts: 1, sizeMix: { '40': 1 } })
      .build()
    const sim = createSimulation(config)
    expect(sim.runUntil().reason).toBe('ended')
    const types = sim.eventLog().map((e) => e.type)
    expect(types).toContain('StsRepositionStarted')
    expect(types).toContain('StsRepositionCompleted')
    const moved = sim.eventLog().find((e) => e.type === 'StsRepositionStarted')
    expect(moved?.subjects.equipment).toEqual(['STS02'])
    expect(sim.kpiReport().sts.STS01.moves).toBe(24)
    expect(sim.kpiReport().sts.STS02.moves).toBe(0)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('gantry between bays and work deck before hold, top tier first, within each bay', () => {
    const sim = createSimulation(craneSplit)
    sim.runUntil()
    for (const sts of ['STS01', 'STS02', 'STS03', 'STS04']) {
      const picked = sim
        .eventLog()
        .filter((e) => e.type === 'StsPicked' && e.subjects.equipment?.[0] === sts)
        .flatMap((e) => e.subjects.containers ?? [])
        .map((id) => sim.query.vesselSlots('V001').find((s) => s.id === sim.query.container(id).custodyHistory[0].owner.id)!)
      expect(picked.length).toBeGreaterThan(0)
      // the crane gantries: it works more than one bay and its gantry moved
      expect(new Set(picked.map((s) => s.bay)).size).toBeGreaterThan(1)
      for (let i = 1; i < picked.length; i++) {
        const [a, b] = [picked[i - 1], picked[i]]
        expect(b.bay, `${sts} bay order`).toBeGreaterThanOrEqual(a.bay)
        if (a.bay === b.bay) {
          expect(Number(b.deck) <= Number(a.deck), `${sts} deck before hold in bay ${a.bay}`).toBe(true)
          if (a.deck === b.deck) expect(b.tier, `${sts} top tier first`).toBeLessThanOrEqual(a.tier)
        }
      }
    }
    const gantryMoves = sim
      .eventLog()
      .filter((e) => e.type === 'StsPicked')
      .flatMap((e) => (e.type === 'StsPicked' ? e.payload.segments : []))
      .filter((s) => s.axis === 'gantry')
    expect(gantryMoves.length).toBeGreaterThan(8)
  })
})

describe('crane split decision point', () => {
  it('two built-in strategies give different STS assignments for the same vessel', () => {
    const balanced = createSimulation(withSplit('balanced-moves'))
    const equal = createSimulation(withSplit('equal-bays'))
    balanced.runUntil()
    equal.runUntil()
    const a = splitReply(balanced)
    const b = splitReply(equal)
    expect(Object.keys(a)).toEqual(['STS01', 'STS02', 'STS03', 'STS04'])
    expect(Object.keys(b)).toEqual(['STS01', 'STS02', 'STS03', 'STS04'])
    expect(a).not.toEqual(b)
    // equal-bays: bay counts differ by at most one
    const counts = Object.values(b).map((bays) => bays.length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    // balanced-moves: crane workloads are closer than with equal bays
    const spread = (sim: Simulation) => {
      const moves = Object.values(sim.kpiReport().sts).map((s) => s.moves)
      return Math.max(...moves) - Math.min(...moves)
    }
    expect(spread(balanced)).toBeLessThan(spread(equal))
    expect(balanced.eventLogHash()).not.toBe(equal.eventLogHash())
  })

  it('splits cranes between adjacent vessels by position: each vessel gets the cranes on its side', () => {
    const config = new ScenarioBuilder('adjacent', 'two feeders side by side, four cranes').hatch({ enabled: false })
      .quay(400, { mooringS: 60, unmooringS: 60, berthGapM: 20 })
      .sts('STS01', { gantryX: 30, groundPositions: 20 })
      .sts('STS02', { gantryX: 120, groundPositions: 20 })
      .sts('STS03', { gantryX: 210, groundPositions: 20 })
      .sts('STS04', { gantryX: 300, groundPositions: 20 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 20, maxSts: 2 })
      .vesselCall('V002', { sizeClass: 'feeder', arrivalS: 5, discharge: 20, maxSts: 2 })
      .build()
    const sim = createSimulation(config)
    expect(sim.runUntil().reason).toBe('ended')
    const k = sim.kpiReport().vessels
    expect(k.V001.berthX).toBeLessThan(k.V002.berthX as number)
    expect(k.V001.sts).toEqual(['STS01', 'STS02'])
    expect(k.V002.sts).toEqual(['STS03', 'STS04'])
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('runs the adjacent feeders to the end with every move done: no rail stall between two busy cranes (#174)', () => {
    // a stall passes every invariant (nothing moves, nothing is wrong), so the move count is the check
    const config = new ScenarioBuilder('adjacent', 'two feeders side by side, four cranes').hatch({ enabled: false })
      .quay(400, { mooringS: 60, unmooringS: 60, berthGapM: 20 })
      .sts('STS01', { gantryX: 30, groundPositions: 20 })
      .sts('STS02', { gantryX: 120, groundPositions: 20 })
      .sts('STS03', { gantryX: 210, groundPositions: 20 })
      .sts('STS04', { gantryX: 300, groundPositions: 20 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 20, maxSts: 2 })
      .vesselCall('V002', { sizeClass: 'feeder', arrivalS: 5, discharge: 20, maxSts: 2 })
      .build()
    const sim = createSimulation(config)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.kpiReport().movesCompleted).toBe(40)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('rejects a split whose bay order contradicts the cranes’ rail order', () => {
    const sim = createSimulation(craneSplit, {
      craneSplit: (msg) => {
        const bays = msg.payload.bays.map((b) => b.bay)
        const half = Math.ceil(bays.length / 2)
        return {
          assignments: [
            { stsId: 'STS01', bays: bays.slice(half) },
            { stsId: 'STS02', bays: bays.slice(0, half) },
          ],
        }
      },
    })
    expect(sim.runUntil().reason).toBe('failed')
    expect(sim.firstError?.message).toMatch(/craneSplit for V001: bay ranges must follow crane rail order/)
  })

  it('a vessel without cranes waits berthed and is split again when a crane becomes free', () => {
    const config = new ScenarioBuilder('no-cranes', 'one crane, two vessels at once').hatch({ enabled: false })
      .quay(600, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 50, groundPositions: 30 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 6, maxSts: 1 })
      .vesselCall('V002', { sizeClass: 'feeder', arrivalS: 1, discharge: 6, maxSts: 1 })
      .build()
    const sim = createSimulation(config)
    expect(sim.runUntil().reason).toBe('ended')
    const splits = sim
      .eventLog()
      .filter((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'craneSplit')
      .map((e) => (e.type === 'DecisionResolved' && e.payload.decisionPoint === 'craneSplit' ? e.payload : null)!)
    expect(splits.map((s) => [s.request.vesselId, s.reply.assignments.map((a) => a.stsId)])).toEqual([
      ['V001', ['STS01']],
      ['V002', ['STS01']],
    ])
    expect(sim.kpiReport().vessels.V002.sts).toEqual(['STS01'])
    expect(sim.invariantReport().violations).toEqual([])
  })
})

/**
 * TT-12: physical rehandles for buried export boxes, through the headless engine
 * API (seam 1) and the yardAllocation / rehandleTarget decision points (seam 2).
 */
import { describe, expect, it } from 'vitest'
import {
  createSimulation,
  strategies,
  yardSlotId,
  type DecisionHandler,
  type EngineEvent,
  type RehandleTargetRequest,
  type Simulation,
  type YardAllocationRequest,
} from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

/** Index of the stack (bay, row) in the request's per-stack arrays. */
const stackAt = (req: Pick<YardAllocationRequest, 'rows'>, bay: number, row: number) => (bay - 1) * req.rows + (row - 1)

/** A yardAllocation handler that piles every import box onto the export boxes' stacks (20 ft boxes: one cell each). */
function buryExports(pick: (stacks: { bay: number; row: number }[], random: number) => { bay: number; row: number }): DecisionHandler<'yardAllocation'> {
  return (msg, query) => {
    const req = msg.payload
    const exportStacks = query
      .yardSlots(req.blockId)
      .filter((s) => query.container(s.containerId as string).vesselId !== req.vesselId || s.tier === 1)
      .filter((s) => s.tier === 1 && s.span === 1)
      .map((s) => ({ bay: s.bay, row: s.row }))
      .filter((c) => req.heights[stackAt(req, c.bay, c.row)] < req.tiers)
    if (exportStacks.length === 0) return { slotId: null }
    const c = pick(exportStacks, req.random)
    return { slotId: yardSlotId(req.blockId, c.bay, c.row, req.heights[stackAt(req, c.bay, c.row)] + 1) }
  }
}

/** Mixed call: `discharge` imports first (all stacked on export boxes by the handler), then `load` exports. */
function buried(opts: { discharge: number; load: number; tiers: number; strategy?: string; seed?: number; sizeMix?: Record<string, number> }): ScenarioConfig {
  const b = new ScenarioBuilder('buried', 'export boxes buried under imports').hatch({ enabled: false })
    .seed(opts.seed ?? 4)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', {
      name: 'Buried Star',
      sizeClass: 'feeder',
      discharge: opts.discharge,
      load: opts.load,
      maxSts: 1,
      sizeMix: opts.sizeMix ?? { '20': 1 },
    })
    .shcs(3)
    .block('B01', { x: 20, bays: 8, tiers: opts.tiers })
    .endWhen({ vesselsCompleted: 1 })
  if (opts.strategy) b.decisions({ points: { rehandleTarget: { strategy: opts.strategy } } })
  return b.build()
}

describe('buried-box fixture: an export box under 3 others', () => {
  // 3 imports pile onto the stack of one export box; 4 exports are loaded.
  const config = buried({ discharge: 3, load: 4, tiers: 4 })
  const target = { bay: 0, row: 0 }
  const handler = buryExports((stacks) => {
    if (target.bay === 0) Object.assign(target, stacks[0])
    return target
  })
  const sim = createSimulation(config, { yardAllocation: handler })
  const stackedStates: string[] = []
  // walk the run in small steps: stack invariants (heights match boxes) hold at every step
  for (let i = 0; i < 20000 && sim.status !== 'ended'; i++) {
    sim.runUntil({ maxEvents: 5 })
    stackedStates.push(String(sim.invariantReport().violations.length))
  }

  it('runs to the end: all four export boxes are loaded', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(ofType(sim, 'StsLoaded')).toHaveLength(4)
  })

  it('performs exactly 3 rehandles before the productive move, top box first', () => {
    const required = ofType(sim, 'RehandleRequired')
    const buriedBox = required[0].payload.containerId
    expect(required[0].payload.yardSlotId).toBe(yardSlotId('B01', target.bay, target.row, 1))
    expect(required).toHaveLength(1)
    expect(required[0].payload.containerId).toBe(buriedBox)
    expect(required[0].payload.blockerIds).toHaveLength(3)
    const moves = ofType(sim, 'AscStacked').filter((e) => e.payload.rehandle)
    expect(moves).toHaveLength(3)
    expect(moves.map((e) => e.payload.containerId)).toEqual(required[0].payload.blockerIds)
    // every rehandle finishes before the buried box leaves its stack
    const lift = ofType(sim, 'AscRetrieved').find((e) => e.payload.containerId === buriedBox)
    expect(lift).toBeDefined()
    for (const m of moves) expect(m.seq).toBeLessThan((lift as { seq: number }).seq)
    // and the buried box had exactly the 3 imports on it
    const kpi = sim.kpiReport().yard
    expect(kpi?.rehandles.total).toBe(3)
    expect(kpi?.rehandles.productiveMoves).toBe(3 + 4) // 3 stacked, 4 retrieved
    expect(kpi?.rehandles.perProductiveMove).toBeCloseTo(3 / 7, 3)
    expect(kpi?.blocks.B01.rehandles).toBe(3)
    expect(kpi?.blocks.B01.rehandlesPerProductiveMove).toBeCloseTo(3 / 7, 3)
  })

  it('every rehandle moves a box within the block, blockers never land on the stack being dug out', () => {
    for (const e of ofType(sim, 'AscStacked').filter((x) => x.payload.rehandle)) {
      expect(e.payload.yardSlotId.startsWith('B01:')).toBe(true)
      const cell = e.payload.yardSlotId.slice(4).split('-').map(Number)
      expect(cell[0] === target.bay && cell[1] === target.row, e.payload.yardSlotId).toBe(false)
    }
  })

  it('stack invariants hold throughout (checked every few events)', () => {
    expect(stackedStates.length).toBeGreaterThan(50)
    expect(new Set(stackedStates)).toEqual(new Set(['0']))
    expect(sim.invariantReport().checks).toBeGreaterThan(0)
  })

  it('a rehandle is an ASC cycle that costs time: the retrieval waits for 3 extra moves', () => {
    const clean = createSimulation(buried({ discharge: 3, load: 4, tiers: 4 }))
    clean.runUntil({ maxEvents: 200_000 })
    expect(clean.kpiReport().yard?.rehandles.total).toBe(0)
    expect(sim.query.vessel('V001').departedAt as number).toBeGreaterThan(clean.query.vessel('V001').departedAt as number)
  })

  it('the rehandle events chain: RehandleRequired → rehandleTarget decision → ASC job', () => {
    const required = ofType(sim, 'RehandleRequired')[0]
    const requests = ofType(sim, 'DecisionRequested').filter((e) => e.payload.decisionPoint === 'rehandleTarget')
    expect(requests).toHaveLength(3)
    expect(requests[0].seq).toBeGreaterThan(required.seq - 1)
    const chain = sim.why(ofType(sim, 'AscStacked').find((e) => e.payload.rehandle)?.id as number)
    expect(chain.some((e) => e.type === 'DecisionResolved' && e.payload.decisionPoint === 'rehandleTarget')).toBe(true)
  })
})

describe('rehandleTarget decision point', () => {
  it('is registered with two built-in strategies', () => {
    expect(Object.keys(strategies.rehandleTarget.strategies).sort()).toEqual(['min-future-rehandles', 'nearest-valid'])
    expect(strategies.rehandleTarget.default).toBe('nearest-valid')
  })

  it('the request lists only legal slots (not the dug stack, the blocker stack, nor full stacks)', () => {
    const requests: RehandleTargetRequest[] = []
    const sim = createSimulation(buried({ discharge: 3, load: 4, tiers: 4 }), {
      yardAllocation: buryExports((s) => s[0]),
      rehandleTarget: (msg) => {
        requests.push(msg.payload)
        return strategies.rehandleTarget.strategies['nearest-valid'].handler(msg, sim.query) as { slotId: string | null }
      },
    })
    sim.runUntil({ maxEvents: 200_000 })
    expect(sim.firstError).toBeNull()
    expect(requests).toHaveLength(3)
    expect(requests.map((r) => r.from.tier)).toEqual([4, 3, 2])
    expect(requests.map((r) => r.blockersLeft)).toEqual([3, 2, 1])
    for (const r of requests) {
      const dug = r.retrieval.slotId.slice(4).split('-').map(Number)
      expect(r.candidates.length).toBeGreaterThan(0)
      for (const c of r.candidates) {
        expect(c.bay === dug[0] && c.row === dug[1], c.slotId).toBe(false)
        expect(c.bay === r.from.bay && c.row === r.from.row, c.slotId).toBe(false)
        expect(c.tier).toBeLessThanOrEqual(4)
      }
    }
  })

  it('a handler that names a slot outside the candidates is an error', () => {
    const sim = createSimulation(buried({ discharge: 3, load: 4, tiers: 4 }), {
      yardAllocation: buryExports((s) => s[0]),
      rehandleTarget: () => ({ slotId: 'B01:01-1-1' }),
    })
    sim.runUntil({ maxEvents: 200_000 })
    expect(sim.firstError?.message).toMatch(/rehandleTarget handler returned slot B01:01-1-1/)
    expect(sim.invariantReport().violations).toEqual([])
  })
})

describe('rehandle strategies on a longer fixture', () => {
  const run = (strategy: string) => {
    const sim = createSimulation(buried({ discharge: 28, load: 30, tiers: 5, strategy, seed: 11 }), {
      yardAllocation: buryExports((stacks, random) => stacks[Math.min(stacks.length - 1, Math.floor(random * stacks.length))]),
    })
    sim.runUntil({ maxEvents: 600_000 })
    return sim
  }
  const nearest = run('nearest-valid')
  const minimising = run('min-future-rehandles')

  it('both complete without an invariant violation', () => {
    for (const sim of [nearest, minimising]) {
      expect(sim.firstError).toBeNull()
      expect(sim.status).toBe('ended')
      expect(sim.invariantReport().violations).toEqual([])
      expect(ofType(sim, 'StsLoaded')).toHaveLength(30)
    }
  })

  it('produce different rehandle KPIs: minimising future rehandles needs fewer', () => {
    const a = nearest.kpiReport().yard?.rehandles
    const b = minimising.kpiReport().yard?.rehandles
    expect(a?.total).toBeGreaterThan(10)
    expect(a?.total).not.toBe(b?.total)
    expect(b?.total).toBeLessThan(a?.total as number)
    expect(b?.perProductiveMove).toBeLessThan(a?.perProductiveMove as number)
    expect(nearest.kpiReport().handlers.rehandleTarget.handler).toBe('strategy:nearest-valid')
    expect(minimising.kpiReport().handlers.rehandleTarget.handler).toBe('strategy:min-future-rehandles')
  })
})

describe('allocation comparison on an export-heavy fixture', () => {
  /** V001 discharges first; V002 (arriving later) loads export boxes seeded in the same block. */
  function exportHeavy(allocation: string, seed: number): ScenarioConfig {
    return new ScenarioBuilder('export-heavy', 'imports of one vessel pile up where exports of the next stand').hatch({ enabled: false })
      .seed(seed)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 36, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V002', { name: 'Export Star', sizeClass: 'feeder', discharge: 0, load: 24, arrivalS: 5400, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(3)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .decisions({ points: { yardAllocation: { strategy: allocation } } })
      .endWhen({ vesselsCompleted: 2 })
      .build()
  }
  const ratio = (strategy: string, seed: number) => {
    const sim = createSimulation(exportHeavy(strategy, seed))
    sim.runUntil({ maxEvents: 800_000 })
    expect(sim.firstError, `${strategy} seed ${seed}`).toBeNull()
    expect(sim.status, `${strategy} seed ${seed}`).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    return sim.kpiReport().yard?.rehandles
  }

  it('random allocation has a higher rehandle ratio than grouped', () => {
    for (const seed of [1, 2, 3]) {
      const random = ratio('random', seed)
      const grouped = ratio('grouped', seed)
      expect(random?.total, `seed ${seed}`).toBeGreaterThan(0)
      expect(random?.perProductiveMove, `seed ${seed}`).toBeGreaterThan(grouped?.perProductiveMove as number)
    }
  })
})

/**
 * TT-06: slots, ASC motion, ASC/SHC handover, allocation strategies, stack
 * invariants, KPIs and modes — through the public engine API and the
 * yardAllocation decision point.
 */
import { describe, expect, it } from 'vitest'
import {
  ascPoseAt,
  blockSpecs,
  candidateSlots,
  createSimulation,
  laneGraphOf,
  restoreSimulation,
  rowX,
  slotZ,
  strategies,
  tierBaseY,
  yardSlotId,
  type Simulation,
  type YardAllocationRequest,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const fixture = fixtures['asc-1sts-10-boxes-1block']

const clone = (c: ScenarioConfig): ScenarioConfig => JSON.parse(JSON.stringify(c)) as ScenarioConfig

function withStrategy(strategy: string): ScenarioConfig {
  const c = clone(fixture)
  c.decisions = { points: { yardAllocation: { strategy } } }
  return c
}

/** box id → slot id, from the stacked state. */
function allocation(sim: Simulation): Record<string, string> {
  return Object.fromEntries(sim.query.yardSlots().map((s) => [s.containerId as string, s.id]))
}

/** A copy of the fixture with every box of one size. */
function allOfSize(size: '20' | '40'): ScenarioConfig {
  const c = clone(fixture)
  c.vessels[0].sizeMix = { [size]: 1 }
  return c
}

describe('yard slots and stack geometry', () => {
  it('a 40 ft box occupies two 20 ft bays, named by its lower bay; a 20 ft box one', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const slots = sim.query.yardSlots()
    expect(slots).toHaveLength(10)
    for (const s of slots) {
      const size = sim.query.container(s.containerId as string).size
      expect(s.span, s.id).toBe(size === '20' ? 1 : 2)
      expect(s.id).toBe(yardSlotId('B01', s.bay, s.row, s.tier))
      expect(s.bay + s.span - 1).toBeLessThanOrEqual(8)
    }
    expect(slots.some((s) => s.span === 2)).toBe(true)
    expect(slots.some((s) => s.span === 1)).toBe(true)
  })

  it('stacks respect the tier limit for 20 ft and for 40 ft boxes', () => {
    for (const size of ['20', '40'] as const) {
      const cfg = allOfSize(size)
      cfg.yard!.blocks[0].tiers = 2
      cfg.yard!.blocks[0].bays = 2
      const sim = createSimulation(cfg)
      sim.runUntil()
      expect(sim.invariantReport().violations, size).toEqual([])
      for (const s of sim.query.yardSlots()) expect(s.tier).toBeLessThanOrEqual(2)
    }
  })
})

describe('ASC motion', () => {
  it('plans gantry, trolley and hoist segments; the ASC ends exactly over the slot at the slot height', () => {
    const sim = createSimulation(fixture)
    const block = blockSpecs(fixture)[0]
    for (let i = 0; i < 10; i++) {
      sim.runUntil({ eventType: 'AscStacked' })
      const e = sim.eventLog().at(-1)
      if (e?.type !== 'AscStacked') throw new Error('expected AscStacked')
      const slot = sim.query.yardSlot(e.payload.yardSlotId)
      const pose = ascPoseAt(sim.query.asc(e.payload.ascId), e.t)
      expect(pose.x).toBeCloseTo(rowX(block, slot.row), 6)
      expect(pose.z).toBeCloseTo(slotZ(block, slot.bay, slot.span), 6)
      expect(pose.hoistY).toBeCloseTo(tierBaseY(slot.tier), 6)
      for (const s of e.payload.segments) {
        expect(s.entityId).toBe('B01-ASC1')
        expect(['gantry', 'trolley', 'hoist']).toContain(s.axis)
        expect(s.t1).toBeLessThanOrEqual(e.t + 1e-9)
      }
    }
    sim.runUntil()
    const toSlot = sim.eventLog().filter((e) => e.type === 'AscPositioningAtSlot')
    const parallel = toSlot.some((e) => {
      const g = e.payload.segments.find((s) => s.axis === 'gantry')
      const t = e.payload.segments.find((s) => s.axis === 'trolley')
      return !!g && !!t && g.t0 === t.t0
    })
    expect(parallel, 'gantry and trolley start together').toBe(true)
  })

  it('picks from the pad at the pad position with the hoist down', () => {
    const sim = createSimulation(fixture)
    const graph = laneGraphOf(fixture)
    for (let i = 0; i < 10; i++) {
      sim.runUntil({ eventType: 'AscPicked' })
      const e = sim.eventLog().at(-1)
      if (e?.type !== 'AscPicked') throw new Error('expected AscPicked')
      const pad = graph.pads.find((p) => p.id === e.payload.wtpPadId)!
      const pose = ascPoseAt(sim.query.asc(e.payload.ascId), e.t)
      expect(pose.x).toBeCloseTo(pad.x, 6)
      expect(pose.z).toBeCloseTo(pad.z, 6)
      expect(pose.hoistY).toBeCloseTo(0, 6)
    }
  })

  it('custody ends in the slot the ASC set the box down in, at the AscStacked time', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    for (const e of sim.eventLog().filter((x) => x.type === 'AscStacked')) {
      const last = sim.query.container(e.payload.containerId).custodyHistory.at(-1)!
      expect(last.owner).toEqual({ kind: 'yardSlot', id: e.payload.yardSlotId })
      expect(last.t).toBe(e.t)
    }
  })
})

describe('ASC/SHC handover', () => {
  it('the ASC takes a box only after its SHC has released it and cleared the pad', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const log = sim.eventLog()
    for (const picked of log.filter((e) => e.type === 'AscPicked')) {
      const cleared = log.find((e) => e.type === 'ShcCleared' && e.payload.containerId === picked.payload.containerId)!
      const dropped = log.find((e) => e.type === 'ShcDroppedAtWtp' && e.payload.containerId === picked.payload.containerId)!
      expect(dropped.seq).toBeLessThan(cleared.seq)
      expect(cleared.seq).toBeLessThan(picked.seq)
      expect(picked.t).toBeGreaterThanOrEqual(cleared.t)
    }
  })

  it('the ASC reserves the pad zone while it works over it', () => {
    const sim = createSimulation(fixture)
    let sawAscWindow = false
    sim.subscribe(
      (e) => {
        if (e.type !== 'AscJobAssigned') return
        sawAscWindow ||= e.payload.reservations.some((r) => r.zone === e.payload.wtpPadId && r.holder === e.payload.ascId)
      },
      { types: ['AscJobAssigned'] },
    )
    sim.runUntil()
    expect(sawAscWindow).toBe(true)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('an ASC lowered into a pad envelope while an SHC is on the pad is reported (tampered snapshot)', () => {
    const sim = createSimulation(fixture)
    sim.runUntil({ eventType: 'ShcPositioningAtDropoff' })
    const snap = sim.snapshot()
    const shc = Object.values(snap.state.shcs).find((s) => s.status === 'positioning-at-dropoff')!
    const job = snap.state.shcJobs[shc.jobId as string]
    const pad = laneGraphOf(snap.config).pads.find((p) => p.id === job.wtpPadId)!
    const asc = snap.state.ascs['B01-ASC1']
    asc.motion = []
    asc.gantryZ = pad.z
    asc.trolleyX = pad.x
    asc.hoistY = 0
    shc.motion = []
    shc.nodeId = `P:${pad.id}`
    const tampered = restoreSimulation(snap)
    tampered.step()
    expect(tampered.status).toBe('failed')
    expect(tampered.firstError?.message).toMatch(/asc\.wtp-handover/)
  })
})

describe('yardAllocation strategies', () => {
  const names = ['random', 'nearest-wtp', 'group-by-vessel']

  it('each built-in strategy produces a valid yard', () => {
    for (const name of names) {
      const sim = createSimulation(withStrategy(name))
      expect(sim.runUntil().reason, name).toBe('ended')
      expect(sim.query.yardSlots(), name).toHaveLength(10)
      expect(sim.invariantReport().violations, name).toEqual([])
      expect(sim.kpiReport().handlers.yardAllocation.handler).toBe(`strategy:${name}`)
    }
  })

  it('on the same seed they produce different allocation patterns', () => {
    const patterns = names.map((name) => {
      const sim = createSimulation(withStrategy(name))
      sim.runUntil()
      return JSON.stringify(Object.values(allocation(sim)).sort())
    })
    expect(new Set(patterns).size).toBe(3)
  })

  it('the registry lists exactly random, nearest-wtp and group-by-vessel', () => {
    expect(Object.keys(strategies.yardAllocation.strategies).sort()).toEqual([...names].sort())
  })

  it('random is reproducible: same seed → same allocation; another seed differs', () => {
    const run = (seed: number) => {
      const sim = createSimulation(withStrategy('random'), {}, { seed })
      sim.runUntil()
      return allocation(sim)
    }
    expect(run(42)).toEqual(run(42))
    expect(run(43)).not.toEqual(run(42))
  })

  it('group-by-vessel packs a vessel into no more bays than random', () => {
    const bays = (name: string) => {
      const sim = createSimulation(withStrategy(name))
      sim.runUntil()
      return new Set(sim.query.yardSlots().flatMap((s) => (s.span === 2 ? [s.bay, s.bay + 1] : [s.bay]))).size
    }
    expect(bays('group-by-vessel')).toBeLessThanOrEqual(bays('random'))
  })

  it('candidateSlots gives legal slots only: 40 ft needs two stacks of equal height, nothing above the tier limit', () => {
    const heights = new Array<number>(4 * 8).fill(0)
    heights[0] = 1 // bay 1 row 1
    heights[8] = 2 // bay 2 row 1
    heights[1] = 3 // bay 1 row 2 (full)
    const base = {
      blockId: 'B01',
      bays: 4,
      rows: 8,
      tiers: 3,
      blockX: 0,
      firstBayZ: 100,
      wtpX: 0,
      wtpZ: 64,
      heights,
      topVessels: heights.map((h) => (h > 0 ? 'V001' : null)),
    }
    const c20 = candidateSlots({ ...base, size: '20' })
    expect(c20.find((c) => c.bay === 1 && c.row === 2)).toBeUndefined()
    expect(c20.find((c) => c.bay === 1 && c.row === 1)?.tier).toBe(2)
    const c40 = candidateSlots({ ...base, size: '40' })
    expect(c40.find((c) => c.bay === 1 && c.row === 1)).toBeUndefined()
    expect(c40.find((c) => c.bay === 1 && c.row === 3)?.tier).toBe(1)
    expect(c40.every((c) => c.bay <= 3)).toBe(true)
  })
})

describe('stack invariants (a broken TOS is caught)', () => {
  const run = (handler: (req: YardAllocationRequest) => string | null, cfg: ScenarioConfig = fixture) => {
    const sim = createSimulation(cfg, { yardAllocation: (msg) => ({ slotId: handler(msg.payload) }) })
    sim.runUntil()
    return sim
  }

  it('floating box: a slot on tier 2 above an empty stack', () => {
    const sim = run((req) => `${req.blockId}:01-1-2`)
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/yard\.no-floating/)
  })

  it('stack height: a slot above the tier limit', () => {
    const cfg = allOfSize('20')
    cfg.yard!.blocks[0].tiers = 2
    let n = 0
    const sim = run(() => `B01:01-1-${++n}`, cfg) // tier 1, tier 2, then tier 3 (limit 2)
    expect(sim.firstError?.message).toMatch(/yard\.stack-height/)
  })

  it('double occupancy: two boxes of the same length in one cell', () => {
    const sim = run(() => 'B01:01-1-1', allOfSize('20'))
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/custody\.single-owner|yard\.no-double-occupied/)
  })

  it('double occupancy by 40 ft boxes whose anchors overlap (bay 1, then bay 2)', () => {
    let n = 0
    const sim = run(() => `B01:0${++n % 2 === 1 ? 1 : 2}-1-1`, allOfSize('40'))
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/yard\.no-double-occupied/)
  })

  it('mixed length overlap: a 40 ft box over a cell holding a 20 ft box', () => {
    const cfg = clone(fixture)
    cfg.vessels[0].sizeMix = { '20': 1, '40': 1 }
    const used = { '20': 0, '40': 0 }
    // the first 40 ft box takes bays 1–2 and the first 20 ft box bay 2; the rest go to their own stacks
    const sim = run((req) => {
      const n = used[req.size === '20' ? '20' : '40']++
      if (req.size === '20') return n === 0 ? 'B01:02-1-1' : `B01:08-${n}-1`
      return n === 0 ? 'B01:01-1-1' : `B01:05-${n}-1`
    }, cfg)
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/yard\.no-mixed-length-overlap/)
  })

  it('a slot outside the block stops the run with an error', () => {
    const sim = run(() => 'B01:99-1-1')
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/outside block B01/)
  })
})

describe('stack invariants hold', () => {
  for (const [name, cfg] of Object.entries(fixtures)) {
    it(`on fixture ${name}`, () => {
      const sim = createSimulation(cfg)
      sim.runUntil()
      expect(sim.firstError).toBeNull()
      expect(sim.invariantReport().violations).toEqual([])
    })
  }

  it('with every strategy on a bigger run of 40 boxes', () => {
    for (const name of ['random', 'nearest-wtp', 'group-by-vessel']) {
      const cfg = withStrategy(name)
      cfg.vessels[0].discharge = 40
      cfg.endConditions = { simDurationS: 6000 }
      const sim = createSimulation(cfg)
      sim.runUntil()
      expect(sim.firstError, name).toBeNull()
      expect(sim.query.yardSlots(), name).toHaveLength(40)
    }
  })
})

describe('stress: scarce pads, many SHCs, slow TOS', () => {
  it('2 pads, 4 SHCs and 30 boxes: the ASC and SHCs share the pads without a violation', () => {
    const cfg = withStrategy('random')
    cfg.vessels[0].discharge = 30
    cfg.yard!.blocks[0].wtpPads = 2
    cfg.kinematics.shc = { ...cfg.kinematics.shc!, driveEmpty: { vMax: 8, accel: 2, decel: 2 }, driveLoaded: { vMax: 7, accel: 2, decel: 2 } }
    cfg.shcs = ['SHC01', 'SHC02', 'SHC03', 'SHC04'].map((id) => ({ id }))
    cfg.endConditions = { simDurationS: 5000 }
    const sim = createSimulation(cfg)
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.query.yardSlots()).toHaveLength(30)
  })

  it('a slow yardAllocation reply (keep-running) never stacks a box before an older claim below it', () => {
    const cfg = withStrategy('group-by-vessel')
    cfg.decisions = {
      asyncMode: 'keep-running',
      simSecondsPerWallSecond: 1,
      points: { yardAllocation: { strategy: 'group-by-vessel', latency: { delay: { kind: 'uniform', minMs: 0, maxMs: 40000 } }, timeoutMs: 60000 } },
    }
    cfg.vessels[0].discharge = 25
    cfg.endConditions = { simDurationS: 6000 }
    const sim = createSimulation(cfg)
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    expect(sim.query.yardSlots()).toHaveLength(25)
  })
})

describe('yard KPIs, modes, determinism', () => {
  it('reports boxes stacked, block fill and ASC travel', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const yard = sim.kpiReport().yard!
    expect(yard.boxesStacked).toBe(10)
    expect(yard.boxesInTransit).toBe(0)
    expect(yard.blocks.B01.boxes).toBe(10)
    expect(yard.blocks.B01.capacityCells).toBe(8 * 8 * 3)
    expect(yard.ascs['B01-ASC1'].jobs).toBe(10)
    expect(yard.ascs['B01-ASC1'].gantryM).toBeGreaterThan(0)
    expect(sim.kpiReport().handlers.yardAllocation.calls).toBe(10)
  })

  it('ASC real is the default with blocks; off leaves the boxes on the pads; instant takes zero time', () => {
    const real = createSimulation(fixture)
    real.runUntil()
    const off = createSimulation(fixture, {}, { subsystems: { asc: 'off' } })
    off.runUntil()
    expect(off.query.yardSlots()).toHaveLength(0)
    expect(off.query.containers().filter((c) => c.custody.kind === 'wtpPad').length).toBeGreaterThan(0)
    expect(off.invariantReport().violations).toEqual([])
    const instant = createSimulation(fixture, {}, { subsystems: { asc: 'instant' } })
    expect(instant.runUntil().reason).toBe('ended')
    expect(instant.query.yardSlots()).toHaveLength(10)
    const picked = instant.eventLog().find((e) => e.type === 'AscPicked')!
    const stacked = instant.eventLog().find((e) => e.type === 'AscStacked')!
    expect(stacked.t).toBe(picked.t)
    const types = (sim: Simulation) => new Set(sim.eventLog().map((e) => e.type))
    for (const t of types(real)) if (t.startsWith('Asc')) expect(types(instant).has(t), t).toBe(true)
  })

  it('a full block leaves the box on its pad and counts an allocation failure', () => {
    const cfg = clone(fixture)
    cfg.yard!.blocks[0].bays = 1
    cfg.yard!.blocks[0].tiers = 1
    cfg.vessels[0].sizeMix = { '20': 1 }
    const sim = createSimulation(cfg)
    expect(sim.runUntil().reason).toBe('ended')
    expect(sim.query.yardSlots()).toHaveLength(8)
    expect(sim.kpiReport().yard!.allocationFailures).toBeGreaterThan(0)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('same seed → same hash; a snapshot mid-cycle resumes to the same end', () => {
    const a = createSimulation(fixture)
    a.runUntil()
    const b = createSimulation(fixture)
    b.runUntil({ eventType: 'AscRoutingToSlot' })
    const resumed = restoreSimulation(b.snapshot())
    resumed.runUntil()
    expect(resumed.eventLogHash()).toBe(a.eventLogHash())
    const again = createSimulation(fixture)
    again.runUntil()
    expect(again.eventLogHash()).toBe(a.eventLogHash())
  })

  it('why() walks a stacking back through the ASC cycle', () => {
    const sim = createSimulation(fixture)
    sim.runUntil()
    const stacked = sim.eventLog().find((e) => e.type === 'AscStacked')!
    const chain = sim.why(stacked.id).map((e) => e.type)
    expect(chain.slice(0, 9).reverse()).toEqual([
      'AscJobAssigned',
      'AscRoutingToPad',
      'AscPositioningAtPad',
      'AscLocking',
      'AscPicked',
      'AscRoutingToSlot',
      'AscPositioningAtSlot',
      'AscUnlocking',
      'AscStacked',
    ])
  })
})

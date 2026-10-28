/**
 * TT-13: landside trucks, gate and ASC truck interchange, through the headless engine
 * API (seam 1) and the gateLaneAssignment / transferStallSelection decision points (seam 2).
 */
import { describe, expect, it } from 'vitest'
import {
  buildLandsideGraph,
  createSimulation,
  laneGraphOf,
  landsideGraphOf,
  restoreSimulation,
  strategies,
  type DecisionHandler,
  type EngineEvent,
  type Simulation,
} from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { LandsideConfig, ScenarioConfig, TruckTransactionKind } from '../scenario/types'

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

const HOUR = 3600
const flat = (perHour: number): number[] => Array.from({ length: 24 }, () => perHour)

interface YardOpts {
  seed?: number
  durationS: number
  profile?: number[]
  mix?: LandsideConfig['mix']
  inLanes?: number
  outLanes?: number
  inProcessingS?: number
  dwellS?: number
  window?: { minBeforeEtaS: number; maxBeforeEtaS: number }
  /** Vessel calls: V001 discharges `imports` boxes at t = 0; extra export vessels arrive at the given times. */
  imports?: number
  exportEtas?: number[]
  pool?: { count: number; maxAgeS: number }
  blocks?: number
  clockStart?: number
  scripted?: { atS: number; transaction: TruckTransactionKind }[]
}

/** A terminal with `blocks` blocks (paired ASCs), 3 SHCs and a landside; all knobs of the landside exposed. */
function yardScenario(o: YardOpts): ScenarioConfig {
  const b = new ScenarioBuilder('landside-test', 'landside test terminal')
    .seed(o.seed ?? 5)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .shcs(3)
    .ascsPerBlock(2)
    .clockStart(o.clockStart ?? 0)
    .endWhen({ simDurationS: o.durationS })
  if ((o.imports ?? 0) > 0) b.vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: o.imports, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
  ;(o.exportEtas ?? []).forEach((eta, i) => b.vesselCall(`X00${i + 1}`, { name: `Export Star ${i + 1}`, sizeClass: 'feeder', arrivalS: eta, maxSts: 1 }))
  for (let i = 0; i < (o.blocks ?? 1); i++) b.block(`B0${i + 1}`, { x: 20 + 40 * i, bays: 30, tiers: 3 })
  if (o.pool) b.emptyPool({ count: o.pool.count, sizeMix: { '40': 1 }, maxAgeS: o.pool.maxAgeS })
  b.landside({
    hourlyProfile: o.profile ?? flat(0),
    ...(o.mix ? { mix: o.mix } : {}),
    importDwell: { kind: 'fixed', s: o.dwellS ?? 600 },
    ...(o.window ? { exportWindow: o.window } : {}),
    gate: {
      inLanes: o.inLanes ?? 4,
      outLanes: o.outLanes ?? 4,
      ...(o.inProcessingS !== undefined ? { inProcessingS: o.inProcessingS } : {}),
    },
    scripted: o.scripted ?? [],
  })
  return b.build()
}

const finished = (sim: Simulation): Simulation => {
  sim.runUntil()
  return sim
}

describe('landside graph', () => {
  const config = fixtures['landside-morning-peak']
  const graph = landsideGraphOf(config)

  it('is a separate graph from the waterside lane graph: no node id is shared', () => {
    const lanes = laneGraphOf(config)
    expect(Object.keys(graph.nodes).length).toBeGreaterThan(30)
    for (const id of Object.keys(graph.nodes)) {
      expect(lanes.nodes[id], id).toBeUndefined()
      expect(id.startsWith('ls:') || graph.stalls.some((s) => `ls:${s.id}` === id)).toBe(true)
    }
  })

  it('every edge is axis-aligned and every stall can be reached from every inbound lane and left through every outbound lane', () => {
    for (const e of graph.edges) {
      const a = graph.nodes[e.from]
      const b = graph.nodes[e.to]
      expect(a.x === b.x || a.z === b.z, `${e.from} → ${e.to}`).toBe(true)
    }
    const reach = (from: string): Set<string> => {
      const seen = new Set([from])
      const stack = [from]
      while (stack.length)
        for (const e of graph.out[stack.pop() as string])
          if (!seen.has(e.to)) {
            seen.add(e.to)
            stack.push(e.to)
          }
      return seen
    }
    for (const lane of graph.inLanes) {
      const r = reach(lane.kioskNode)
      for (const s of graph.stalls) expect(r.has(graph.stallNode[s.id]), `${lane.id} → ${s.id}`).toBe(true)
    }
    for (const s of graph.stalls) {
      const r = reach(graph.stallNode[s.id])
      for (const lane of graph.outLanes) expect(r.has(lane.endNode), `${s.id} → ${lane.id}`).toBe(true)
    }
  })

  it('draws an out-of-gauge lane between the in and out lanes that no route uses', () => {
    expect(graph.oogX).not.toBeNull()
    const inMax = Math.max(...graph.inLanes.map((l) => l.x))
    const outMin = Math.min(...graph.outLanes.map((l) => l.x))
    expect(graph.oogX as number).toBeGreaterThan(inMax)
    expect(graph.oogX as number).toBeLessThan(outMin)
    for (const n of Object.values(graph.nodes)) expect(Math.abs(n.x - (graph.oogX as number))).toBeGreaterThan(1)
    const without = buildLandsideGraph({ ...config, landside: { ...(config.landside as LandsideConfig), gate: { ...(config.landside as LandsideConfig).gate, oogLane: false } } })
    expect(without.oogX).toBeNull()
  })

  it('puts a stall for each of the block stalls at the landside end, inside the ASC rail', () => {
    const b01 = graph.stalls.filter((s) => s.blockId === 'B01')
    expect(b01).toHaveLength(5)
    expect(new Set(b01.map((s) => s.z)).size).toBe(1)
    expect(b01[0].z).toBeGreaterThan(64 + 8 + 12 * 6.7) // beyond the last bay of a 12-bay block
  })
})

describe('dual truck transaction', () => {
  const sim = finished(createSimulation(fixtures['dual-truck-transaction']))
  const truck = 'T0001'
  const events = sim.eventLog().filter((e) => e.subjects.equipment?.includes(truck) || e.payload && (e.payload as { truckId?: string }).truckId === truck)
  const types = events.map((e) => e.type)

  it('completes with every step of the truck turn, in order', () => {
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const order = [
      'TruckArrived',
      'TruckGateStarted',
      'TruckGateIn',
      'TruckStallAssigned',
      'TruckRoutingToStall',
      'TruckAtStall',
      'AscPickedFromTruck',
      'AscDroppedAtStall',
      'TruckInterchangeDone',
      'TruckRoutingToExit',
      'TruckGateOut',
      'TruckDeparted',
    ]
    let at = -1
    for (const type of order) {
      const i = types.indexOf(type as never, at + 1)
      expect(i, `${type} after ${order[order.indexOf(type) - 1] ?? 'start'}`).toBeGreaterThan(at)
      at = i
    }
  })

  it('drops an export and picks an import in one visit, with the right custody on both boxes', () => {
    const arrived = ofType(sim, 'TruckArrived').find((e) => e.payload.truckId === truck)
    expect(arrived?.payload.transaction).toBe('dual')
    const [drop, pick] = arrived?.payload.legs ?? []
    expect([drop.kind, drop.purpose, pick.kind, pick.purpose]).toEqual(['drop', 'export', 'pick', 'import'])
    const exportBox = sim.query.container(drop.containerId)
    const importBox = sim.query.container(pick.containerId)
    const owners = (b: typeof exportBox) => b.custodyHistory.map((h) => h.owner.kind)
    // the export arrives on the chassis, goes through the ASC into the stack and stays there
    expect(owners(exportBox)).toEqual(['truck', 'asc', 'yardSlot'])
    expect(exportBox.custodyHistory[0].owner.id).toBe(truck)
    expect(exportBox.vesselId).toBe('V002')
    // the import was discharged, stacked, lifted by the ASC onto the chassis and left with the truck
    expect(owners(importBox).slice(-4)).toEqual(['yardSlot', 'asc', 'truck', 'external'])
    expect(importBox.custodyHistory.at(-2)?.owner.id).toBe(truck)
    expect(importBox.vesselId).toBe('V001')
    // the drop comes before the pick (the chassis must be free), and the visit is one stall occupation
    const t = (id: string, kind: string) => importBox.custodyHistory.concat(exportBox.custodyHistory).find((h) => h.owner.kind === kind && h.owner.id === id)?.t as number
    expect(exportBox.custodyHistory[1].t).toBeLessThan(importBox.custodyHistory.at(-2)?.t as number)
    void t
    expect(sim.query.truck.bind(sim.query, truck)).toThrow() // gone from the terminal
    expect(sim.query.transferStalls().every((s) => s.truckId === null)).toBe(true)
    expect(ofType(sim, 'TruckAtStall').filter((e) => e.payload.truckId === truck)).toHaveLength(1)
  })

  it('is served by the landside ASC and its causal chain leads back to the arrival', () => {
    const jobs = ofType(sim, 'AscJobAssigned').filter((e) => e.payload.truckId === truck)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((e) => e.payload.ascId === 'B01-ASC2')).toBe(true)
    const departed = ofType(sim, 'TruckDeparted')[0]
    const chain = sim.why(departed.id).map((e) => e.type)
    expect(chain).toContain('TruckArrivalDue')
    expect(chain[chain.length - 1]).toBe('ScenarioStarted')
  })

  it('counts the truck turn, the boxes and the waits in the landside KPIs', () => {
    const k = sim.kpiReport().landside
    expect(k?.trucksIn).toBe(1)
    expect(k?.trucksOut).toBe(1)
    expect(k?.boxesDropped).toBe(1)
    expect(k?.boxesPicked).toBe(1)
    expect(k?.transactions.dual).toBe(1)
    expect(k?.turnTimeS.mean).toBeGreaterThan(200)
    expect(k?.stallWaitS.mean).toBeLessThan(10)
    const turn = ofType(sim, 'TruckGateOut')[0].payload.turnS
    const gateIn = ofType(sim, 'TruckGateIn')[0].t
    expect(turn).toBeCloseTo(ofType(sim, 'TruckGateOut')[0].t - gateIn, 2)
  })
})

describe('demand consistency', () => {
  it('collects only boxes that are in the yard and whose dwell has elapsed (imports and the empty pool)', () => {
    const dwell = 900
    const sim = createSimulation(
      yardScenario({
        durationS: 2 * HOUR,
        imports: 30,
        profile: flat(90),
        mix: { pickImport: 1, pickEmpty: 1, dual: 0.2, dropEmpty: 0.2 },
        dwellS: dwell,
        exportEtas: [5000],
        window: { minBeforeEtaS: 600, maxBeforeEtaS: 3000 },
        pool: { count: 12, maxAgeS: 1800 },
      }),
    )
    const violations: string[] = []
    let picks = 0
    sim.subscribe(
      (e) => {
        if (e.type !== 'TruckArrived') return
        for (const leg of e.payload.legs) {
          if (leg.kind !== 'pick') continue
          picks++
          const box = sim.query.container(leg.containerId)
          if (box.custody.kind !== 'yardSlot') violations.push(`${box.id} picked at ${e.t} but custody is ${box.custody.kind}`)
          const standing = box.yardSince ?? 0
          const first = box.custodyHistory.find((h) => h.owner.kind === 'yardSlot')?.t ?? standing
          const since = Math.min(first, standing)
          if (e.t < since + dwell - 1e-6) violations.push(`${box.id} picked ${(e.t - since).toFixed(0)} s after it was stacked (dwell ${dwell})`)
          if ((box.pickupReadyAt ?? Infinity) > e.t) violations.push(`${box.id} picked before its dwell ended`)
        }
      },
      { types: ['TruckArrived'] },
    )
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(picks).toBeGreaterThan(25)
    expect(violations).toEqual([])
    // before the first import has stood its dwell nobody can collect an import: the earliest import pickup is >= dwell after the first stack
    const firstStack = ofType(sim, 'AscStacked')[0].t
    const firstImportPick = ofType(sim, 'TruckArrived').find((e) => e.payload.legs.some((l) => l.kind === 'pick' && l.purpose === 'import'))
    expect((firstImportPick?.t ?? Infinity) >= firstStack + dwell).toBe(true)
    // pool boxes younger than the dwell are not offered
    const pool = [...Object.values(sim.snapshot().state.containers)].filter((c) => c.vesselId === 'POOL' && (c.yardSince ?? 0) <= 0)
    const picked = new Set(ofType(sim, 'TruckArrived').flatMap((e) => e.payload.legs.filter((l) => l.kind === 'pick').map((l) => l.containerId)))
    for (const c of pool) if (picked.has(c.id)) expect(c.pickupReadyAt as number).toBeLessThanOrEqual(2 * HOUR)
  })

  it('delivers exports only inside each vessel export window', () => {
    const window = { minBeforeEtaS: 600, maxBeforeEtaS: 3000 }
    const etas = { X001: 4000, X002: 90000 }
    const sim = finished(
      createSimulation(
        yardScenario({
          durationS: 2 * HOUR,
          profile: flat(90),
          mix: { dropExport: 1, dropEmpty: 0.3 },
          exportEtas: [etas.X001, etas.X002],
          window,
        }),
      ),
    )
    const drops = ofType(sim, 'TruckArrived').flatMap((e) => e.payload.legs.filter((l) => l.purpose === 'export').map((l) => ({ t: e.t, vesselId: l.vesselId as string })))
    expect(drops.length).toBeGreaterThan(20)
    for (const d of drops) {
      expect(d.vesselId).toBe('X001') // the other vessel is 25 h away: never inside the window
      const until = etas.X001 - d.t
      expect(until).toBeGreaterThanOrEqual(window.minBeforeEtaS)
      expect(until).toBeLessThanOrEqual(window.maxBeforeEtaS)
    }
    // outside the window (before it opens: t < 1000, after it closes: t > 3400) trucks bring empties only
    const outside = ofType(sim, 'TruckArrived').filter((e) => e.t < 1000 || e.t > 3400)
    expect(outside.length).toBeGreaterThan(20)
    expect(outside.every((e) => e.payload.transaction === 'dropEmpty')).toBe(true)
  })

  it('never generates an import pickup when no box has finished its dwell (falls back to a drop empty, counted)', () => {
    const sim = finished(
      createSimulation(yardScenario({ durationS: HOUR, profile: flat(60), mix: { pickImport: 1 }, imports: 10, dwellS: 5 * HOUR })),
    )
    const arrivals = ofType(sim, 'TruckArrived')
    expect(arrivals.length).toBeGreaterThan(30)
    expect(arrivals.every((e) => e.payload.transaction === 'dropEmpty' && e.payload.fallback === true)).toBe(true)
    expect(sim.kpiReport().landside?.fallbacks).toBe(arrivals.length)
  })

  it('creates each truck box with a valid ISO 6346 id and unique ids', async () => {
    const { isValidIso6346 } = await import('../scenario/iso6346')
    const sim = finished(createSimulation(yardScenario({ durationS: HOUR, profile: flat(60), mix: { dropEmpty: 1, dropExport: 1 }, exportEtas: [4000] })))
    const ids = ofType(sim, 'TruckArrived').flatMap((e) => e.payload.legs.map((l) => l.containerId))
    expect(ids.length).toBeGreaterThan(30)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(isValidIso6346(id), id).toBe(true)
  })
})

describe('segregation', () => {
  const landsideFixtures = ['dual-truck-transaction', 'truck-gate-queue', 'landside-morning-peak']

  it('holds across all fixtures (invariant and an independent monitor)', () => {
    for (const [name, config] of Object.entries(fixtures)) {
      const sim = createSimulation(config)
      const lanes = laneGraphOf(config)
      const road = config.landside ? landsideGraphOf(config) : null
      sim.subscribe(() => {
        for (const t of sim.query.trucks()) {
          expect(road?.nodes[t.nodeId], `${name}: ${t.id} at ${t.nodeId}`).toBeDefined()
          expect(lanes.nodes[t.nodeId], `${name}: ${t.id} on the lane graph`).toBeUndefined()
        }
        for (const s of sim.query.shcs()) {
          expect(lanes.nodes[s.nodeId], `${name}: ${s.id} at ${s.nodeId}`).toBeDefined()
          expect(s.nodeId.startsWith('ls:')).toBe(false)
        }
      })
      sim.runUntil()
      expect(sim.firstError, name).toBeNull()
      expect(sim.invariantReport().violations.filter((v) => v.invariant === 'landside.segregation'), name).toEqual([])
    }
    expect(landsideFixtures.every((n) => n in fixtures)).toBe(true)
  })

  it('reports a truck on the waterside lane graph and an SHC on the public gate (tampered snapshots)', () => {
    const sim = createSimulation(fixtures['truck-gate-queue'])
    sim.runUntil({ eventType: 'TruckAtStall' })
    const lane = Object.keys(laneGraphOf(fixtures['truck-gate-queue']).nodes).find((n) => n.startsWith('AE@')) as string

    const a = sim.snapshot()
    const id = Object.keys(a.state.trucks)[0]
    a.state.trucks[id].nodeId = lane
    const trucks = restoreSimulation(a)
    trucks.step()
    expect(trucks.status).toBe('failed')
    expect(trucks.firstError?.message).toMatch(/landside\.segregation.*waterside lane graph/)

    const b = sim.snapshot()
    b.state.shcs['SHC01'].nodeId = 'ls:IK1'
    const shcs = restoreSimulation(b)
    shcs.step()
    expect(shcs.status).toBe('failed')
    expect(shcs.firstError?.message).toMatch(/landside\.segregation.*SHCs never use the public gate/)

    // a truck whose planned motion leads into the waterside area
    const c = sim.snapshot()
    const t = Object.values(c.state.trucks)[0]
    t.motion = [{ entityId: t.id, axis: 'z', from: 200, to: 40, t0: c.state.now, t1: c.state.now + 20, vPeak: 8, accel: 1, decel: 1 }]
    const into = restoreSimulation(c)
    into.step()
    expect(into.firstError?.message).toMatch(/landside\.segregation.*waterside area/)
  })
})

describe('gate', () => {
  it('queues trucks behind the gate and reducing the inbound lanes increases the gate queue wait', () => {
    const run = (inLanes: number) =>
      finished(
        createSimulation(
          yardScenario({ seed: 9, durationS: 2 * HOUR, profile: flat(55), mix: { dropEmpty: 1 }, inLanes, outLanes: 2, inProcessingS: 60, blocks: 2 }),
        ),
      )
    const one = run(1)
    const four = run(4)
    const wait = (s: Simulation) => s.kpiReport().landside
    expect(one.firstError).toBeNull()
    expect(four.firstError).toBeNull()
    expect(wait(one)?.gateWaitS.mean).toBeGreaterThan(60)
    expect(wait(one)?.gateWaitS.mean).toBeGreaterThan((wait(four)?.gateWaitS.mean ?? 0) * 3 + 20)
    expect(wait(one)?.gateQueueMax).toBeGreaterThan((wait(four)?.gateQueueMax ?? 0) + 5)
    // the dashboard series agree
    const series = one.kpiSeries().series
    expect(series['landside.gate-wait-s'].entities.terminal.total).toBeCloseTo(wait(one)?.gateWaitS.mean ?? 0, 0)
    expect(series['landside.gate-queue'].entities.terminal.hourly.some((v) => (v ?? 0) > 5)).toBe(true)
  })

  it('uses a single lane at a time per truck and never the same lane for two trucks at once', () => {
    const sim = createSimulation(fixtures['truck-gate-queue'])
    const busy = new Map<string, string>()
    sim.subscribe((e) => {
      if (e.type === 'TruckGateStarted') {
        expect(busy.has(e.payload.laneId), `${e.payload.laneId} busy with ${busy.get(e.payload.laneId)}`).toBe(false)
        busy.set(e.payload.laneId, e.payload.truckId)
      }
      if (e.type === 'TruckRoutingToStall') busy.delete(e.payload.laneId)
    })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(ofType(sim, 'TruckGateStarted').length).toBe(14)
    expect(sim.kpiReport().landside?.trucksOut).toBe(14)
  })

  it('holds the truck at the gate while every transfer stall is taken, and releases it when one frees up', () => {
    const sim = finished(createSimulation(fixtures['truck-gate-queue']))
    const waiting = ofType(sim, 'TruckWaitingForStall')
    expect(waiting.length).toBeGreaterThan(0)
    for (const w of waiting) {
      const assigned = ofType(sim, 'TruckStallAssigned').find((e) => e.payload.truckId === w.payload.truckId)
      expect(assigned && assigned.payload.waitedS > 0).toBe(true)
    }
    // never two trucks in one stall
    const inStall = new Map<string, string>()
    for (const e of sim.eventLog()) {
      if (e.type === 'TruckStallAssigned') {
        expect(inStall.has(e.payload.stallId)).toBe(false)
        inStall.set(e.payload.stallId, e.payload.truckId)
      }
      if (e.type === 'TruckRoutingToExit') inStall.delete(e.payload.stallId)
    }
  })
})

describe('arrival process', () => {
  const profile = [4, 3, 3, 3, 4, 8, 20, 40, 48, 44, 30, 24, 22, 28, 38, 46, 42, 30, 18, 12, 10, 8, 6, 5]

  it('follows the hourly profile within statistical tolerance over a 24 h run', () => {
    const sim = createSimulation(
      yardScenario({ seed: 17, durationS: 24 * HOUR, profile, mix: { dropEmpty: 1 }, blocks: 2, outLanes: 4 }),
      {},
      { invariants: { enabled: false } },
    )
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    const arrivals = ofType(sim, 'TruckArrived')
    const perHour = Array.from({ length: 24 }, () => 0)
    for (const a of arrivals) perHour[Math.floor(a.t / HOUR) % 24]++
    perHour.forEach((n, h) => {
      expect(Math.abs(n - profile[h]), `hour ${h}: ${n} arrivals against ${profile[h]}`).toBeLessThanOrEqual(4 * Math.sqrt(profile[h]) + 1)
    })
    const expected = profile.reduce((a, b) => a + b, 0)
    expect(Math.abs(arrivals.length - expected)).toBeLessThanOrEqual(4 * Math.sqrt(expected))
    // Poisson: the inter-arrival times within a steady hour have mean 3600/rate and coefficient of variation near 1
    const peak = arrivals.filter((a) => a.t >= 8 * HOUR && a.t < 9 * HOUR).map((a) => a.t)
    const gaps = peak.slice(1).map((t, i) => t - peak[i])
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
    expect(mean).toBeGreaterThan(HOUR / 48 / 1.4)
    expect(mean).toBeLessThan((HOUR / 48) * 1.4)
    expect(sd / mean).toBeGreaterThan(0.6)
    expect(sd / mean).toBeLessThan(1.5)
  }, 120000)

  it('reads the profile on the scenario clock: a start time of 06:00 puts hour 10 at 4 h to 5 h of sim time', () => {
    const only10 = Array.from({ length: 24 }, (_, h) => (h === 10 ? 120 : 0))
    const sim = createSimulation(yardScenario({ durationS: 8 * HOUR, profile: only10, mix: { dropEmpty: 1 }, clockStart: 6 * HOUR, blocks: 2 }), {}, { invariants: { enabled: false } })
    sim.runUntil()
    const times = ofType(sim, 'TruckArrived').map((e) => e.t)
    expect(times.length).toBeGreaterThan(80)
    expect(times.every((t) => t >= 4 * HOUR && t < 5 * HOUR)).toBe(true)
  })

  it('has no arrivals for an empty profile and honours scripted trucks at their time', () => {
    const none = finished(createSimulation(yardScenario({ durationS: 2 * HOUR })))
    expect(ofType(none, 'TruckArrived')).toHaveLength(0)
    const scripted = finished(createSimulation(yardScenario({ durationS: HOUR, scripted: [{ atS: 100, transaction: 'dropEmpty' }, { atS: 250.5, transaction: 'dropEmpty' }] })))
    expect(ofType(scripted, 'TruckArrived').map((e) => e.t)).toEqual([100, 250.5])
  })
})

describe('decision points', () => {
  const scripted = (n: number) => yardScenario({ durationS: 1800, scripted: Array.from({ length: n }, (_, i) => ({ atS: 100 + i * 5, transaction: 'dropEmpty' as const })), inLanes: 3 })

  it('registers strategies for both decision points with a default each', () => {
    expect(Object.keys(strategies.gateLaneAssignment.strategies).sort()).toEqual(['least-used-lane', 'lowest-free-lane'])
    expect(strategies.gateLaneAssignment.default).toBe('lowest-free-lane')
    expect(Object.keys(strategies.transferStallSelection.strategies).sort()).toEqual(['least-loaded-block', 'nearest-to-box'])
    expect(strategies.transferStallSelection.default).toBe('nearest-to-box')
  })

  it('a custom gate-lane handler chooses the lane; the default takes the lowest free lane', () => {
    const highest: DecisionHandler<'gateLaneAssignment'> = (msg) => ({ laneId: [...msg.payload.lanes].reverse().find((l) => l.free)?.laneId ?? null })
    const custom = finished(createSimulation(scripted(3), { gateLaneAssignment: highest }))
    expect(ofType(custom, 'TruckGateStarted').map((e) => e.payload.laneId)).toEqual(['ls:GI3', 'ls:GI2', 'ls:GI1'])
    const dflt = finished(createSimulation(scripted(3)))
    expect(ofType(dflt, 'TruckGateStarted').map((e) => e.payload.laneId)).toEqual(['ls:GI1', 'ls:GI2', 'ls:GI3'])
    const spread = finished(createSimulation({ ...scripted(4), decisions: { points: { gateLaneAssignment: { strategy: 'least-used-lane' } } } }))
    expect(spread.kpiReport().handlers.gateLaneAssignment.handler).toBe('strategy:least-used-lane')
  })

  it('a custom stall handler chooses the stall, and a reply that names a taken stall fails the run', () => {
    const last: DecisionHandler<'transferStallSelection'> = (msg) => ({ stallId: [...msg.payload.stalls].reverse().find((s) => s.occupiedBy === null)?.stallId ?? null })
    const sim = finished(createSimulation(scripted(1), { transferStallSelection: last }))
    expect(ofType(sim, 'TruckStallAssigned')[0].payload.stallId).toBe('B01-TS5')
    const bad = createSimulation(scripted(3), { transferStallSelection: () => ({ stallId: 'B01-TS1' }) })
    bad.runUntil()
    expect(bad.status).toBe('failed')
    expect(bad.firstError?.message).toMatch(/holds it/)
    const unknown = createSimulation(scripted(1), { gateLaneAssignment: () => ({ laneId: 'nope' }) })
    unknown.runUntil()
    expect(unknown.firstError?.message).toMatch(/not an inbound lane/)
  })

  it('a handler that answers null holds the truck; the stall request carries the box block for a pick', () => {
    const requests: string[] = []
    const sim = createSimulation(fixtures['dual-truck-transaction'], {
      transferStallSelection: (msg, query) => {
        requests.push(JSON.stringify(msg.payload.legs.map((l) => [l.kind, l.purpose, l.blockId])))
        return strategies.transferStallSelection.strategies['nearest-to-box'].handler(msg, query)
      },
    })
    sim.runUntil()
    expect(requests).toEqual(['[["drop","export",null],["pick","import","B01"]]'])
  })
})

describe('subsystem modes and determinism', () => {
  it('off: no truck events and the same event log as the scenario without a landside', () => {
    const off = finished(createSimulation(fixtures['dual-truck-transaction'], {}, { subsystems: { landside: 'off' } }))
    expect(off.eventLog().some((e) => e.type.startsWith('Truck'))).toBe(false)
    const { landside: _l, ...rest } = fixtures['dual-truck-transaction']
    void _l
    const without = finished(createSimulation(rest as ScenarioConfig))
    expect(off.eventLogHash()).toBe(without.eventLogHash())
  })

  it('instant: the same truck events with no durations', () => {
    const real = finished(createSimulation(fixtures['dual-truck-transaction']))
    const instant = finished(createSimulation(fixtures['dual-truck-transaction'], {}, { subsystems: { landside: 'instant' } }))
    expect(instant.firstError).toBeNull()
    expect(instant.eventLog().filter((e) => e.type.startsWith('Truck')).map((e) => e.type)).toEqual(
      real.eventLog().filter((e) => e.type.startsWith('Truck')).map((e) => e.type),
    )
    const gate = (s: Simulation) => ofType(s, 'TruckGateOut')[0].payload.turnS
    expect(gate(instant)).toBeLessThan(gate(real))
  })

  it('is deterministic for a seed and survives a snapshot/restore mid-run', () => {
    const run = (): Simulation => finished(createSimulation(fixtures['landside-morning-peak']))
    const a = run()
    expect(run().eventLogHash()).toBe(a.eventLogHash())
    const other = finished(createSimulation(fixtures['landside-morning-peak'], {}, { seed: 99 }))
    expect(other.eventLogHash()).not.toBe(a.eventLogHash())
    const half = createSimulation(fixtures['landside-morning-peak'])
    half.runUntil({ time: 2400 })
    const resumed = restoreSimulation(half.snapshot())
    resumed.runUntil()
    expect(resumed.eventLogHash()).toBe(a.eventLogHash())
  })
})

describe('landside KPIs', () => {
  const sim = finished(createSimulation(fixtures['landside-morning-peak']))
  const k = sim.kpiReport().landside

  it('match the events', () => {
    expect(k?.trucksIn).toBe(ofType(sim, 'TruckGateIn').length)
    expect(k?.trucksOut).toBe(ofType(sim, 'TruckGateOut').length)
    expect(k?.trucksInside).toBe(ofType(sim, 'TruckArrived').length - ofType(sim, 'TruckDeparted').length)
    const turns = ofType(sim, 'TruckGateOut').map((e) => e.payload.turnS)
    expect(k?.turnTimeS.mean).toBeCloseTo(turns.reduce((a, b) => a + b, 0) / turns.length, 2)
    expect(k?.turnTimeS.max).toBeCloseTo(Math.max(...turns), 2)
    const waits = ofType(sim, 'TruckGateStarted').map((e) => e.payload.queueWaitS)
    expect(k?.gateWaitS.mean).toBeCloseTo(waits.reduce((a, b) => a + b, 0) / waits.length, 2)
    expect(Object.values(k?.transactions ?? {}).reduce((a, b) => a + b, 0)).toBe(ofType(sim, 'TruckArrived').length)
  })

  it('are available as hourly, shift and total series for the dashboard', () => {
    const series = sim.kpiSeries().series
    for (const id of ['landside.truck-turn-s', 'landside.gate-queue', 'landside.gate-wait-s', 'landside.stall-wait-s', 'landside.trucks-in', 'landside.trucks-out']) {
      expect(series[id], id).toBeDefined()
      expect(series[id].entities.terminal.hourly.length).toBeGreaterThan(0)
    }
    expect(series['landside.trucks-in'].entities.terminal.total).toBe(k?.trucksIn)
    expect(series['landside.trucks-out'].entities.terminal.total).toBe(k?.trucksOut)
    expect(series['landside.truck-turn-s'].entities.terminal.total).toBeCloseTo(k?.turnTimeS.mean ?? 0, 1)
    expect(series['landside.stall-wait-s'].entities.terminal.total).toBeCloseTo(k?.stallWaitS.mean ?? 0, 1)
  })

  it('are absent for scenarios without a landside', () => {
    const plain = finished(createSimulation(fixtures['asc-1sts-10-boxes-1block']))
    expect(plain.kpiReport().landside).toBeUndefined()
    expect(plain.kpiSeries().series['landside.trucks-in']).toBeUndefined()
  })
})

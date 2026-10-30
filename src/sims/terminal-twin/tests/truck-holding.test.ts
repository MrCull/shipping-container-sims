/**
 * TT-R16: transfer stall admission and truck holding positions. The gate admits a truck only when a stall can take it
 * (reserved before the truck is sent) or a holding position is free; holding trucks wait off the roads; with holding full
 * trucks wait outside the gate; a truck leaves only after all its transfers are complete.
 */
import { describe, expect, it } from 'vitest'
import {
  buildLandsideGraph,
  createSimulation,
  landsideGraphOf,
  restoreSimulation,
  truckPositionAt,
  type DecisionHandler,
  type EngineEvent,
  type Simulation,
} from '../engine'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const FIXTURE = 'truck-holding-overflow'

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

const run = (config: ScenarioConfig = fixtures[FIXTURE]): Simulation => {
  const sim = createSimulation(config)
  sim.runUntil()
  return sim
}

const withHolding = (positions: number | undefined): ScenarioConfig => {
  const config = structuredClone(fixtures[FIXTURE])
  const landside = config.landside as NonNullable<ScenarioConfig['landside']>
  if (positions === undefined) delete landside.holding
  else landside.holding = { positions }
  return config
}

describe('holding positions on the landside graph', () => {
  it('has the configured number of holding spurs, off every road and west of every stall spur', () => {
    const graph = landsideGraphOf(fixtures[FIXTURE])
    expect(graph.holding.map((h) => h.id)).toEqual(['H1', 'H2'])
    const stallXs = graph.stalls.map((s) => graph.nodes[graph.stallNode[s.id]].x)
    for (const h of graph.holding) {
      const node = graph.nodes[h.nodeId]
      expect(node.kind).toBe('holding')
      expect(node.z).toBeLessThan(graph.gate.roadInZ - 5) // a spur, not on the road
      expect(h.x).toBeLessThan(Math.min(...stallXs)) // every stall is reachable from it over the one-way road
      expect(graph.nodes[h.junction].kind).toBe('road')
    }
    const xs = graph.holding.map((h) => h.x)
    expect(new Set(xs).size).toBe(xs.length)
  })

  it('leaves the graph of a scenario without holding exactly as it was', () => {
    const config = withHolding(undefined)
    const plain = buildLandsideGraph(config)
    expect(plain.holding).toEqual([])
    expect(Object.values(plain.nodes).some((n) => n.kind === 'holding')).toBe(false)
    const widened = buildLandsideGraph(withHolding(8))
    expect(widened.holding).toHaveLength(8)
    // the gate cluster makes room for the holding spurs west of the stalls, clear of the gate lanes
    const gateEast = Math.max(...widened.outLanes.map((l) => l.x))
    expect(Math.min(...widened.holding.map((h) => h.x))).toBeGreaterThan(gateEast + 4)
  })
})

describe(FIXTURE, () => {
  it('runs clean: every truck is served and nothing violates an invariant', () => {
    const sim = run()
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    const k = sim.kpiReport().landside
    expect(k?.trucksOut).toBe(10)
    expect(sim.query.trucks()).toEqual([])
  })

  it('reserves a stall for the first trucks, holds the next two, and keeps the rest outside the gate', () => {
    const sim = run()
    const reserved = ofType(sim, 'TruckStallReserved')
    const holding = ofType(sim, 'TruckHoldingAssigned')
    const outside = ofType(sim, 'TruckHeldOutside')
    expect(reserved).toHaveLength(2)
    expect(holding).toHaveLength(8)
    expect(outside.length).toBeGreaterThan(0)
    // the first two trucks to arrive get the two stalls, the next two the two holding positions
    expect(reserved.slice(0, 2).map((e) => e.payload.truckId)).toEqual(['T0001', 'T0002'])
    expect(holding.slice(0, 2).map((e) => e.payload.truckId)).toEqual(['T0003', 'T0004'])
    // overflow waits outside: the fifth truck waits at the head of the queue while no admission is possible
    expect(outside[0].payload.truckId).toBe('T0005')
    const k = sim.kpiReport().landside?.holding
    expect(k?.positions).toBe(2)
    expect(k?.maxInUse).toBe(2)
    expect(k?.heldOutside).toBe(outside.length)
    expect(k?.admittedToHolding).toBe(holding.length)
    expect(k?.admittedToStall).toBe(reserved.length)
    expect(k?.admittedToStall).toBe(2) // later trucks find both stalls still reserved and go through holding
    expect(k?.waitS.max ?? 0).toBeGreaterThan(0)
  })

  it('reserves the stall before the truck passes the gate and sends a held truck only when its stall is assigned', () => {
    const sim = run()
    const log = sim.eventLog()
    const at = (type: EngineEvent['type'], truckId: string) => log.findIndex((e) => e.type === type && (e.payload as { truckId?: string }).truckId === truckId)
    for (const e of ofType(sim, 'TruckStallReserved')) {
      const id = e.payload.truckId
      expect(at('TruckStallReserved', id)).toBeLessThan(at('TruckGateStarted', id))
      expect(at('TruckGateIn', id)).toBeLessThan(at('TruckStallAssigned', id))
    }
    for (const e of ofType(sim, 'TruckHoldingAssigned')) {
      const id = e.payload.truckId
      expect(at('TruckHoldingAssigned', id)).toBeLessThan(at('TruckGateStarted', id))
      expect(at('TruckRoutingToHolding', id)).toBeLessThan(at('TruckAtHolding', id))
      expect(at('TruckAtHolding', id)).toBeLessThan(at('TruckStallAssigned', id))
      expect(at('TruckStallAssigned', id)).toBeLessThan(at('TruckRoutingToStall', id))
    }
    // nobody queues at a kiosk for a stall any more
    expect(ofType(sim, 'TruckWaitingForStall')).toEqual([])
  })

  it('never has two trucks on one stall or one holding position (independent monitor)', () => {
    const sim = createSimulation(fixtures[FIXTURE])
    const stalls = new Map<string, string>()
    const holds = new Map<string, string>()
    const take = (map: Map<string, string>, id: string, truck: string, what: string) => {
      expect(map.has(id), `${what} ${id} taken by ${map.get(id)} and ${truck}`).toBe(false)
      map.set(id, truck)
    }
    sim.subscribe((e) => {
      if (e.type === 'TruckStallReserved' || e.type === 'TruckStallAssigned') {
        if (stalls.get(e.payload.stallId) !== e.payload.truckId) take(stalls, e.payload.stallId, e.payload.truckId, 'stall')
      }
      if (e.type === 'TruckRoutingToExit') stalls.delete(e.payload.stallId)
      if (e.type === 'TruckHoldingAssigned') take(holds, e.payload.holdingId, e.payload.truckId, 'holding position')
      if (e.type === 'TruckRoutingToStall') for (const [id, truck] of holds) if (truck === e.payload.truckId) holds.delete(id)
    })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(stalls.size).toBe(0)
    expect(holds.size).toBe(0)
  })

  it('never has a waiting truck standing on a road (independent monitor on every event)', () => {
    const config = fixtures[FIXTURE]
    const graph = landsideGraphOf(config)
    const roads = Object.values(graph.zones).filter((z) => z.kind === 'road' || z.kind === 'intersection')
    const sim = createSimulation(config)
    let checked = 0
    sim.subscribe(() => {
      for (const t of sim.query.trucks()) {
        if (!['queued', 'in-lane', 'waiting-for-stall', 'holding'].includes(t.status)) continue
        if (t.motion.some((s) => s.t0 <= sim.now && sim.now < s.t1)) continue
        const p = truckPositionAt(graph, t, sim.now)
        for (const z of roads) expect(p.x > z.x0 && p.x < z.x1 && p.z > z.z0 && p.z < z.z1, `${t.id} ${t.status} in ${z.id}`).toBe(false)
        if (t.status === 'holding') {
          const h = graph.holding.find((x) => x.id === t.holdingId)
          expect(h && { x: h.x, z: h.z }, t.id).toEqual(p)
          checked++
        }
      }
    })
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(checked).toBeGreaterThan(0)
  })

  it('lets a truck leave only after all its transfers are complete', () => {
    const sim = run()
    const legs = new Map(ofType(sim, 'TruckArrived').map((e) => [e.payload.truckId, e.payload.legs.length]))
    const done = new Map<string, number>()
    const log = sim.eventLog()
    for (const e of log) {
      if (e.type === 'AscPickedFromTruck' || e.type === 'AscDroppedAtStall') done.set(e.payload.truckId, (done.get(e.payload.truckId) ?? 0) + 1)
      if (e.type === 'TruckRoutingToExit') expect(done.get(e.payload.truckId), e.payload.truckId).toBe(legs.get(e.payload.truckId))
    }
    expect(ofType(sim, 'TruckRoutingToExit')).toHaveLength(10)
  })

  it('trucks wait outside when holding is full: more holding positions mean a shorter gate wait', () => {
    const wait = (n: number | undefined) => run(withHolding(n)).kpiReport().landside
    const none = wait(1)
    const many = wait(8)
    expect(none?.trucksOut).toBe(10)
    expect(many?.trucksOut).toBe(10)
    expect(many?.holding?.heldOutside ?? 0).toBeLessThan(none?.holding?.heldOutside ?? 0)
    expect(many?.gateWaitS.mean ?? 0).toBeLessThan(none?.gateWaitS.mean ?? 0)
  })

  it('without holding config the gate behaves as before: trucks wait at the kiosk and no holding events appear', () => {
    const sim = run(withHolding(undefined))
    expect(sim.firstError).toBeNull()
    expect(ofType(sim, 'TruckHoldingAssigned')).toEqual([])
    expect(ofType(sim, 'TruckStallReserved')).toEqual([])
    expect(ofType(sim, 'TruckHeldOutside')).toEqual([])
    expect(sim.kpiReport().landside?.holding).toBeUndefined()
    expect(sim.query.holdingPositions()).toEqual([])
  })

  it('is a deterministic run (same seed, same event log)', () => {
    const a = run()
    const b = run()
    expect(a.eventLog().length).toBe(b.eventLog().length)
    expect(JSON.stringify(a.kpiReport())).toBe(JSON.stringify(b.kpiReport()))
  })
})

describe('invariants (negative tests)', () => {
  const midRun = (): Simulation => {
    const sim = createSimulation(fixtures[FIXTURE])
    sim.runUntil({ eventType: 'TruckAtHolding' })
    return sim
  }

  it('landside.stall-exclusive trips when two trucks claim the same stall', () => {
    const sim = midRun()
    const snap = sim.snapshot()
    const trucks = Object.values(snap.state.trucks).filter((t) => t.stallId !== null)
    expect(trucks.length).toBeGreaterThanOrEqual(2)
    trucks[1].stallId = trucks[0].stallId
    const broken = restoreSimulation(snap)
    broken.step()
    expect(broken.status).toBe('failed')
    expect(broken.firstError?.message).toMatch(/landside\.stall-exclusive.*claimed by/)
  })

  it('landside.stall-exclusive trips when a stall records a truck that does not claim it', () => {
    const snap = midRun().snapshot()
    const free = Object.values((snap.state.landside as NonNullable<typeof snap.state.landside>).stalls).find((s) => s.truckId === null)
    const stalls = (snap.state.landside as NonNullable<typeof snap.state.landside>).stalls
    const target = free ?? Object.values(stalls)[0]
    target.truckId = Object.keys(snap.state.trucks).find((id) => snap.state.trucks[id].stallId !== target.id) as string
    const broken = restoreSimulation(snap)
    broken.step()
    expect(broken.firstError?.message).toMatch(/landside\.stall-exclusive/)
  })

  it('landside.stall-exclusive trips when two trucks claim one holding position', () => {
    const snap = midRun().snapshot()
    const holders = Object.values(snap.state.trucks).filter((t) => t.holdingId !== null)
    expect(holders.length).toBeGreaterThanOrEqual(1)
    const other = Object.values(snap.state.trucks).find((t) => t.id !== holders[0].id) as (typeof holders)[number]
    other.holdingId = holders[0].holdingId
    const broken = restoreSimulation(snap)
    broken.step()
    expect(broken.firstError?.message).toMatch(/landside\.stall-exclusive.*holding position/)
  })

  it('a transferStallSelection handler that returns a reserved stall is refused', () => {
    const greedy: DecisionHandler<'transferStallSelection'> = (msg) => ({ stallId: msg.payload.stalls[0].stallId })
    const sim = createSimulation(fixtures[FIXTURE], { transferStallSelection: greedy })
    sim.runUntil()
    expect(sim.status).toBe('failed')
    expect(sim.firstError?.message).toMatch(/transferStallSelection handler returned .* but T\d+ holds it/)
  })

  it('landside.waiting-off-road trips when a holding truck is moved onto a road node', () => {
    const snap = midRun().snapshot()
    const graph = landsideGraphOf(fixtures[FIXTURE])
    const truck = Object.values(snap.state.trucks).find((t) => t.status === 'holding') as NonNullable<(typeof snap.state.trucks)[string]>
    expect(truck).toBeDefined()
    truck.nodeId = graph.holding[0].junction
    truck.motion = []
    const broken = restoreSimulation(snap)
    broken.step()
    expect(broken.firstError?.message).toMatch(/landside\.waiting-off-road.*(waits on the road node|inside intersection zone)/)
  })

  it('landside.waiting-off-road trips when a waiting truck stands inside a road zone', () => {
    const snap = midRun().snapshot()
    const graph = landsideGraphOf(fixtures[FIXTURE])
    const truck = Object.values(snap.state.trucks).find((t) => t.status === 'queued') as NonNullable<(typeof snap.state.trucks)[string]>
    expect(truck).toBeDefined()
    const road = graph.nodes[graph.holding[0].junction]
    truck.nodeId = graph.gate.queueHeadNode
    truck.motion = [{ entityId: truck.id, axis: 'x', from: road.x, to: road.x, t0: 0, t1: 0, vPeak: 1, accel: 1, decel: 1 }, { entityId: truck.id, axis: 'z', from: road.z, to: road.z, t0: 0, t1: 0, vPeak: 1, accel: 1, decel: 1 }]
    const broken = restoreSimulation(snap)
    broken.step()
    expect(broken.firstError?.message).toMatch(/landside\.waiting-off-road.*inside (road|intersection) zone/)
  })

  it('landside.leaves-complete trips when a truck reverses out with an unfinished transfer', () => {
    const sim = createSimulation(fixtures[FIXTURE])
    sim.runUntil({ eventType: 'TruckRoutingToExit' })
    const snap = sim.snapshot()
    const truck = Object.values(snap.state.trucks).find((t) => t.status === 'routing-to-exit') as NonNullable<(typeof snap.state.trucks)[string]>
    expect(truck).toBeDefined()
    truck.legs[0].done = false
    const broken = restoreSimulation(snap)
    broken.step()
    expect(broken.firstError?.message).toMatch(/landside\.leaves-complete.*unfinished transfer/)
  })
})

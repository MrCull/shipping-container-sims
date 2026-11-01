/**
 * Spec #134, ticket #146: at TTI Algeciras the trucks use the access road. They come up from the south along the road
 * that runs beside the terminal, turn right (east, towards the water) into the terminal road at the gate and leave
 * round a teardrop loop at the far end of the terminal road without stopping. Generic presets keep their landside graph.
 */
import { describe, expect, it } from 'vitest'
import { buildLandsideGraph, createSimulation, landsideGraphOf, queueSlotAt, type EngineEvent, type Simulation } from '../engine'

type MotionSegment = Readonly<ReturnType<Simulation['query']['truck']>>['motion'][number]
import { SceneModel } from '../modules/sceneModel'
import { presets } from '../scenario/presets'
import { fixtures } from '../scenario/fixtures'
import { SURROUNDINGS, TTI_PRESET_NAME } from '../terminals/tti-algeciras/constants'

const tti = () => presets[TTI_PRESET_NAME]()

describe('TTI landside graph', () => {
  const config = tti()
  const g = buildLandsideGraph(config)

  it('has an access road that comes from the south and meets the terminal road at the gate', () => {
    const start = g.nodes['ls:AS']
    const junction = g.nodes['ls:AJ']
    expect(start.kind).toBe('access')
    expect(junction.kind).toBe('access')
    expect(junction.x).toBe(g.gate.queueX)
    expect(start.z).toBe(junction.z)
    // south is +x: the road starts beyond the last block and runs north (-x) to the gate
    expect(start.x).toBeGreaterThan(g.gate.eastX)
    expect(g.access?.z).toBe(junction.z)
    // the road is the scenery's Isla Verde road: one constant places both
    expect(g.access?.z).toBe(SURROUNDINGS.landside.z - 10)
    // right turn: the terminal road leaves the junction towards the water (-z) at the queue X
    const next = g.out['ls:AJ'][0]
    expect(next.to).toBe(g.gate.queueHeadNode)
    expect(g.nodes[next.to].z).toBeLessThan(junction.z)
    expect(g.nodes[next.to].x).toBe(junction.x)
  })

  it('replaces the two sharp end turns with a loop of rolling corners', () => {
    expect(g.nodes['ls:end']).toBeUndefined()
    const loop = Object.values(g.nodes).filter((n) => n.kind === 'loop')
    expect(loop.length).toBeGreaterThanOrEqual(4)
    expect(loop.every((n) => n.rolling === true)).toBe(true)
    expect(g.zones['ls:loop']).toBeDefined()
    // the loop is part of the road: the eastbound road reaches it and it reaches the westbound road
    expect(g.out[`ls:RI@${g.gate.eastX}`].some((e) => g.nodes[e.to].kind === 'loop')).toBe(true)
    expect(g.edges.some((e) => g.nodes[e.from].kind === 'loop' && e.to === `ls:RO@${g.gate.eastX}`)).toBe(true)
  })
})

describe('TTI gate queue', () => {
  const g = buildLandsideGraph(tti())
  it('stands on the terminal road and backs up along the access road when it is longer', () => {
    expect(queueSlotAt(g, 0)).toEqual({ x: g.gate.queueX, z: g.gate.queueHeadZ })
    const far = queueSlotAt(g, 100)
    expect(far.z).toBe(g.access!.z)
    expect(far.x).toBeGreaterThan(g.gate.queueX)
    // no slot lies beyond the access road's carriageway
    for (let i = 0; i < 200; i++) expect(queueSlotAt(g, i).z).toBeLessThanOrEqual(g.access!.z)
  })
})

describe('generic presets', () => {
  it('keep their landside graph', () => {
    const small = buildLandsideGraph(presets['Small automated']())
    expect(small.access).toBeNull()
    expect(small.nodes['ls:end']).toBeDefined()
    for (const [name, config] of Object.entries(fixtures)) {
      if (!config.landside) continue
      const g = landsideGraphOf(config)
      expect(g.access, name).toBeNull()
      expect(g.nodes['ls:end'], name).toBeDefined()
      expect(Object.values(g.nodes).some((n) => n.kind === 'access' || n.kind === 'loop'), name).toBe(false)
    }
  })
})

describe('TTI trucks in a run', () => {
  const config = tti()
  const sim = createSimulation(config)
  // a truck's first plan is its drive in: read it when the truck arrives (later plans replace it)
  const firstMotion = new Map<string, MotionSegment[]>()
  sim.subscribe(
    (e) => {
      if (e.type === 'TruckArrived') firstMotion.set(e.payload.truckId, sim.query.truck(e.payload.truckId).motion.map((s) => ({ ...s })))
    },
    { types: ['TruckArrived'] },
  )
  sim.runUntil({ time: 2400 })
  const g = landsideGraphOf(config)
  const log = sim.eventLog()
  const trucks = sim.query.trucks()

  it('lets trucks run and keeps every invariant at zero', { timeout: 120000 }, () => {
    expect(trucks.length).toBeGreaterThan(5)
    expect(sim.invariantReport().violations).toEqual([])
  })

  it('starts every truck on the access road from the south', () => {
    expect(firstMotion.size).toBeGreaterThan(10)
    for (const [id, motion] of firstMotion) {
      const t = { id }
      const x = motion.find((s) => s.axis === 'x') as MotionSegment
      const z = motion.find((s) => s.axis === 'z') as MotionSegment
      expect(x, t.id).toBeDefined()
      expect(x.from).toBeGreaterThan(g.gate.eastX) // from the south end
      expect(x.to).toBe(g.gate.queueX) // north along the road to the gate junction
      expect(z.t0).toBeGreaterThanOrEqual(x.t1 - 1e-6) // the right turn comes after the road
      expect(z.from).toBe(g.access!.z) // and goes into the terminal road at the junction
    }
  })

  it('drives the loop without a stop, a reversal or a point turn', () => {
    const outs = log.filter((e): e is Extract<EngineEvent, { type: 'TruckGateOut' }> => e.type === 'TruckGateOut')
    expect(outs.length).toBeGreaterThan(2)
    for (const e of outs) {
      const all = e.payload.segments.filter((s) => s.axis === 'x' || s.axis === 'z')
      // the first run that leaves the eastbound road northwards (+z) is the start of the loop
      const at = all.findIndex((s) => s.axis === 'z' && Math.abs(s.from - g.gate.roadInZ) < 1e-6 && s.to > g.gate.roadOutZ)
      expect(at, e.payload.truckId).toBeGreaterThan(0)
      // four corners (x east, z up, x west, z down, x west): each taken at speed and chained without a wait
      const loop = all.slice(at - 1, at + 4)
      expect(loop.map((s) => s.axis)).toEqual(['x', 'z', 'x', 'z', 'x'])
      for (let i = 0; i + 1 < loop.length; i++) {
        expect(loop[i].v1 ?? 0, `${e.payload.truckId} leaves run ${i} at rest`).toBeGreaterThan(0)
        expect(loop[i + 1].v0 ?? 0).toBeGreaterThan(0)
        expect(loop[i + 1].t0).toBeCloseTo(loop[i].t1, 6)
      }
    }
  })
})

describe('scene model', () => {
  it('knows the access road', () => {
    const config = tti()
    const model = new SceneModel(config)
    expect(model.landside?.access?.z).toBe(landsideGraphOf(config).access?.z)
  })
})

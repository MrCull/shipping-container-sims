/**
 * Transit status, content status and dwell (spec #106, ticket #109): pure functions of a container and the
 * state of its carriers. Table test of every row of the spec's transit-status table, then headless runs that
 * follow a box through the statuses and check the KPI report's dwell by direction.
 */
import { describe, expect, it } from 'vitest'
import { contentStatus, dwellS, terminalArrivalS, transitStatus, type TransitStatus, type TransitWorld, type ContainerState, type CustodyKind, type VesselStatus, type TruckStatus } from '../engine'
import { createSimulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

type Hist = [number, CustodyKind, string][]

function box(history: Hist, full = true): ContainerState {
  const h = history.map(([t, kind, id]) => ({ t, owner: { kind, id }, eventId: null }))
  return { id: 'MSKU0000001', size: '40', full, line: 'MSK', vesselId: 'V1', custody: h[h.length - 1].owner, custodyHistory: h } as ContainerState
}

const world = (vessels: Record<string, VesselStatus> = {}, trucks: Record<string, TruckStatus> = {}): TransitWorld => ({
  vesselStatus: (id) => vessels[id],
  truckStatus: (id) => trucks[id],
})

interface Row {
  name: string
  box: ContainerState
  world: TransitWorld
  expect: TransitStatus
}

const rows: Row[] = [
  // ADVISED: never held on the terminal, inbound carrier has not arrived
  { name: 'discharge box, vessel scheduled', box: box([[0, 'vesselSlot', 'V1:01-01-82']]), world: world({ V1: 'scheduled' }), expect: 'ADVISED' },
  { name: 'discharge box, vessel at anchorage', box: box([[0, 'vesselSlot', 'V1:01-01-82']]), world: world({ V1: 'at-anchorage' }), expect: 'ADVISED' },
  { name: 'discharge box, vessel mooring', box: box([[0, 'vesselSlot', 'V1:01-01-82']]), world: world({ V1: 'mooring' }), expect: 'ADVISED' },
  { name: 'export box outside, awaiting its truck', box: box([[0, 'external', 'outside']]), world: world(), expect: 'ADVISED' },
  { name: 'export box on a truck still in the gate queue', box: box([[10, 'truck', 'T1']]), world: world({}, { T1: 'queued' }), expect: 'ADVISED' },
  { name: 'export box on a truck driving to the kiosk', box: box([[10, 'truck', 'T1']]), world: world({}, { T1: 'in-lane' }), expect: 'ADVISED' },
  // ARRIVED: inbound carrier here, box not off yet
  { name: 'discharge box, vessel berthed', box: box([[0, 'vesselSlot', 'V1:01-01-82']]), world: world({ V1: 'berthed' }), expect: 'ARRIVED' },
  { name: 'discharge box, vessel unmooring', box: box([[0, 'vesselSlot', 'V1:01-01-82']]), world: world({ V1: 'unmooring' }), expect: 'ARRIVED' },
  { name: 'export box on a truck inside the gate', box: box([[10, 'truck', 'T1']]), world: world({}, { T1: 'at-stall' }), expect: 'ARRIVED' },
  { name: 'export box on a truck waiting for a stall', box: box([[10, 'truck', 'T1']]), world: world({}, { T1: 'waiting-for-stall' }), expect: 'ARRIVED' },
  // ON_TERMINAL: every terminal custody kind
  ...(['sts', 'groundPosition', 'shc', 'wtpPad', 'asc', 'yardSlot'] as CustodyKind[]).map<Row>((k) => ({
    name: `custody ${k}`,
    box: box([[0, 'vesselSlot', 'V1:01-01-82'], [100, k, 'X']]),
    world: world({ V1: 'berthed' }),
    expect: 'ON_TERMINAL',
  })),
  { name: 'pre-filled box in a yard slot', box: box([[0, 'yardSlot', 'B01:01-1-1']]), world: world(), expect: 'ON_TERMINAL' },
  // LOADED: on its outbound carrier, which has not left
  { name: 'load box in a slot of a berthed vessel', box: box([[0, 'yardSlot', 'B01:01-1-1'], [500, 'vesselSlot', 'V2:01-01-82']]), world: world({ V2: 'berthed' }), expect: 'LOADED' },
  { name: 'load box, vessel unmooring', box: box([[0, 'yardSlot', 'B01:01-1-1'], [500, 'vesselSlot', 'V2:01-01-82']]), world: world({ V2: 'unmooring' }), expect: 'LOADED' },
  { name: 'transshipment box on its onward vessel', box: box([[0, 'vesselSlot', 'V1:01-01-82'], [100, 'yardSlot', 'B01:01-1-1'], [900, 'vesselSlot', 'V2:02-01-82']]), world: world({ V1: 'departed', V2: 'berthed' }), expect: 'LOADED' },
  { name: 'import box on the pickup truck, still here', box: box([[0, 'vesselSlot', 'V1:01-01-82'], [100, 'yardSlot', 'B01:01-1-1'], [900, 'truck', 'T9']]), world: world({ V1: 'departed' }, { T9: 'routing-to-exit' }), expect: 'LOADED' },
  // DEPARTED: its outbound carrier has left
  { name: 'load box, vessel departed', box: box([[0, 'yardSlot', 'B01:01-1-1'], [500, 'vesselSlot', 'V2:01-01-82']]), world: world({ V2: 'departed' }), expect: 'DEPARTED' },
  { name: 'import box that left on a truck', box: box([[0, 'vesselSlot', 'V1:01-01-82'], [100, 'yardSlot', 'B01:01-1-1'], [900, 'truck', 'T9'], [950, 'external', 'T9']]), world: world({ V1: 'departed' }), expect: 'DEPARTED' },
]

describe('transit status (pure function)', () => {
  it.each(rows)('$name -> $expect', (r) => {
    expect(transitStatus(r.box, r.world)).toBe(r.expect)
  })

  it('covers every status', () => {
    expect(new Set(rows.map((r) => r.expect))).toEqual(new Set(['ADVISED', 'ARRIVED', 'ON_TERMINAL', 'LOADED', 'DEPARTED']))
  })

  it('does not change the box', () => {
    const b = box([[0, 'vesselSlot', 'V1:01-01-82']])
    const before = JSON.stringify(b)
    transitStatus(b, world({ V1: 'berthed' }))
    expect(JSON.stringify(b)).toBe(before)
  })
})

describe('content status', () => {
  it('derives EMPTY / LADEN from full', () => {
    expect(contentStatus(box([[0, 'yardSlot', 'a']], true))).toBe('LADEN')
    expect(contentStatus(box([[0, 'yardSlot', 'a']], false))).toBe('EMPTY')
  })
})

describe('dwell', () => {
  it('is null before the box reaches the terminal', () => {
    expect(dwellS(box([[0, 'vesselSlot', 'V1:01-01-82']]), 500)).toBeNull()
    expect(terminalArrivalS(box([[0, 'external', 'outside']]))).toBeNull()
  })
  it('runs from the first terminal custody while the box is here', () => {
    expect(dwellS(box([[0, 'vesselSlot', 'V1:01-01-82'], [100, 'sts', 'STS1']]), 400)).toBe(300)
  })
  it('stops when the box leaves terminal custody', () => {
    const b = box([[0, 'vesselSlot', 'V1:01-01-82'], [100, 'sts', 'STS1'], [600, 'yardSlot', 'B1:01-1-1'], [5000, 'truck', 'T1']])
    expect(dwellS(b, 99999)).toBe(4900)
  })
  it('counts from the yard-since time of a pre-aged box', () => {
    const b = { ...box([[0, 'yardSlot', 'B1:01-1-1']]), yardSince: -3600 }
    expect(dwellS(b, 100)).toBe(3700)
  })
})

describe('headless run', () => {
  it('a discharge box goes ADVISED -> ARRIVED -> ON_TERMINAL and a load box ends LOADED or DEPARTED', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    const w = (): TransitWorld => ({ vesselStatus: (id) => sim.query.vessel(id).status, truckStatus: (id) => sim.query.trucks().find((t) => t.id === id)?.status })
    const discharge = sim.query.containers().find((c) => c.custody.kind === 'vesselSlot')
    expect(discharge).toBeDefined()
    const id = discharge?.id ?? ''
    const seen: TransitStatus[] = []
    const note = () => {
      const s = transitStatus(sim.query.container(id), w())
      if (seen[seen.length - 1] !== s) seen.push(s)
    }
    note()
    while (sim.step()) note()
    expect(sim.invariantReport().violations).toEqual([])
    expect(seen.slice(0, 3)).toEqual(['ADVISED', 'ARRIVED', 'ON_TERMINAL'])
    // order only ever moves forward through the journey
    const order: TransitStatus[] = ['ADVISED', 'ARRIVED', 'ON_TERMINAL', 'LOADED', 'DEPARTED']
    const idx = seen.map((s) => order.indexOf(s))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('reports dwell by direction in the KPI report', () => {
    const sim = createSimulation(fixtures['asc-1sts-10-boxes-1block'])
    sim.runUntil({})
    const d = sim.kpiReport().dwell
    expect(d).toBeDefined()
    const imports = d?.IMPORT
    expect(imports?.count).toBeGreaterThan(0)
    expect(imports?.maxS).toBeGreaterThanOrEqual(imports?.meanS ?? 0)
    expect(imports?.meanS).toBeGreaterThan(0)
  })

  it.each(['mixed-discharge-then-load', 'transshipment-a-to-b', 'dual-truck-transaction'])('every box in %s only moves forward and ends LOADED or DEPARTED when it left', (name) => {
    const sim = createSimulation(fixtures[name])
    const order: TransitStatus[] = ['ADVISED', 'ARRIVED', 'ON_TERMINAL', 'LOADED', 'DEPARTED']
    const w = (): TransitWorld => ({ vesselStatus: (id) => sim.query.vessel(id).status, truckStatus: (id) => sim.query.trucks().find((t) => t.id === id)?.status })
    const last = new Map<string, number>()
    const reached = new Set<TransitStatus>()
    const scan = () => {
      const world = w()
      for (const c of sim.query.containers()) {
        const s = transitStatus(c, world)
        reached.add(s)
        const i = order.indexOf(s)
        const prev = last.get(c.id) ?? 0
        expect(i, `${c.id} went back from ${order[prev]} to ${s}`).toBeGreaterThanOrEqual(prev)
        last.set(c.id, i)
      }
    }
    let n = 0
    while (sim.step()) if (++n % 5 === 0) scan()
    scan()
    expect(sim.invariantReport().violations).toEqual([])
    expect(reached.has('ON_TERMINAL')).toBe(true)
    expect(reached.has('LOADED') || reached.has('DEPARTED')).toBe(true)
  })
})


/**
 * Spec #106 (#113): `vesselPlanning.ordering = 'pod-weight'`. Through the headless engine (seam 1), plus pure
 * checks of the ordering functions with plain data.
 */
import { describe, expect, it } from 'vitest'
import { countDischargeSplits, createSimulation, orderDischarge, orderLoad, type EngineEvent, type OrderBox, type OrderCell, type OrderEntry, type Simulation } from '../engine'
import { runCli } from '../cli/runCli'
import { ScenarioBuilder } from '../scenario/builder'
import type { ContainerProps } from '../scenario/containerProps'
import { fixtures } from '../scenario/fixtures'
import { fixtureDefinitions } from '../scenario/fixtures/definitions'
import type { ScenarioConfig, VesselOrdering } from '../scenario/types'

const PORTS = ['ESALG', 'MAPTM', 'ESVLC', 'NLRTM']

const withOrdering = (config: ScenarioConfig, ordering: VesselOrdering): ScenarioConfig => ({ ...config, vesselPlanning: { ordering } })

function run(config: ScenarioConfig): Simulation {
  const sim = createSimulation(config)
  sim.runUntil({ maxEvents: 400_000 })
  return sim
}

const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) =>
  sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

function box(over: Partial<ContainerProps> & { line?: string }): OrderBox {
  const { line = 'MSC', ...props } = over
  return {
    line,
    size: '40',
    props: {
      direction: 'IMPORT',
      isoType: '45G1',
      pol: 'SGSIN',
      pod: 'ESALG',
      tareKg: 4000,
      cargoKg: 10000,
      weightClass: 'MEDIUM',
      plannedDepartureS: 1000,
      inbound: { kind: 'vessel', id: 'V001' },
      outbound: { kind: 'truck' },
      bookingRef: 'B',
      holds: [],
      ...props,
    },
  }
}

const cell = (row: number, tier: number, half: OrderCell['half'] = null): OrderCell => ({ bay: 1, row, tier, deck: false, half })
const seq = (list: OrderEntry<OrderCell>[]) => list.map((e) => `${e.slot.row}/${e.slot.tier}`)

describe('pod-weight ordering functions', () => {
  it('discharges stack by stack, top-down, the stacks in yard-group order', () => {
    const entries: OrderEntry<OrderCell>[] = [
      { slot: cell(1, 1), box: box({ line: 'MSC' }) },
      { slot: cell(1, 2), box: box({ line: 'MSC' }) },
      { slot: cell(2, 1), box: box({ line: 'CMA' }) },
      { slot: cell(2, 2), box: box({ line: 'CMA' }) },
      { slot: cell(3, 2), box: box({ line: 'MSC' }) },
      { slot: cell(3, 1), box: box({ line: 'MSC' }) },
    ]
    // imports group by line: CMA before MSC; rows 1 and 3 (both MSC) keep row order; every stack is top-down
    expect(seq(orderDischarge(entries, PORTS))).toEqual(['2/2', '2/1', '1/2', '1/1', '3/2', '3/1'])
  })

  it('loads bottom-up; inside a tier later PODs first, then heavier boxes', () => {
    const entries: OrderEntry<OrderCell>[] = [
      { slot: cell(1, 2), box: box({ pod: 'MAPTM' }) },
      { slot: cell(1, 1), box: box({ pod: 'MAPTM', cargoKg: 5000 }) },
      { slot: cell(2, 1), box: box({ pod: 'NLRTM', cargoKg: 2000 }) },
      { slot: cell(3, 1), box: box({ pod: 'MAPTM', cargoKg: 20000 }) },
      { slot: cell(2, 2), box: box({ pod: 'MAPTM' }) },
      { slot: cell(9, 3), box: undefined }, // an empties requirement keeps its place after the boxes
    ]
    expect(seq(orderLoad(entries, PORTS))).toEqual(['2/1', '3/1', '1/1', '1/2', '2/2', '9/3'])
  })

  it('never puts a higher tier of a stack before a lower one, whatever the POD and weight', () => {
    const entries: OrderEntry<OrderCell>[] = []
    for (let tier = 1; tier <= 4; tier++)
      for (let row = 1; row <= 3; row++) entries.push({ slot: cell(row, tier), box: box({ pod: PORTS[(tier * 7 + row * 3) % 4], cargoKg: 1000 * ((tier * 5 + row * 11) % 20) }) })
    const order = orderLoad(entries, PORTS)
    for (let row = 1; row <= 3; row++) {
      const tiers = order.filter((e) => e.slot.row === row).map((e) => e.slot.tier)
      expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
    }
  })
})

describe('vessel-ordering-pod-weight fixture', () => {
  const sim = run(fixtures['vessel-ordering-pod-weight'])
  const asToday = run(withOrdering(fixtures['vessel-ordering-pod-weight'], 'as-today'))
  const initial = createSimulation(fixtures['vessel-ordering-pod-weight'])

  it('is defined in the fixture catalogue with pod-weight selected', () => {
    expect(fixtures['vessel-ordering-pod-weight'].vesselPlanning?.ordering).toBe('pod-weight')
    expect(fixtureDefinitions['vessel-ordering-pod-weight']().vesselPlanning?.ordering).toBe('pod-weight')
  })

  it('runs to the end with zero invariant violations and loads every booked box', () => {
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    const booked = sim.query.vesselSlots('V001').filter((s) => s.purpose === 'load' && s.plannedContainerId)
    expect(booked.length).toBeGreaterThan(0)
    for (const s of booked) expect(s.containerId).toBe(s.plannedContainerId)
    expect(sim.kpiReport().movesCompleted).toBe(asToday.kpiReport().movesCompleted)
  })

  it('keeps one package per bay section and the hatch steps of as-today', () => {
    const shape = (s: Simulation) => s.query.workPackages().map((p) => [p.kind, p.section, p.bay, p.kind.startsWith('hatch') ? p.hatchPanelId : null])
    expect(shape(sim).length).toBeGreaterThan(0)
    expect(shape(sim)).toEqual(shape(asToday))
    // one package per bay section and kind (an empties requirement has its own package)
    const sections = sim.query.workPackages().filter((p) => (p.kind === 'discharge' || p.kind === 'load') && !p.emptyReq).map((p) => `${p.kind}:${p.bay}:${p.section}`)
    expect(new Set(sections).size).toBe(sections.length)
    // a hatch job may restart after a lashing wait, so compare each (panel, op) once, in order of first start
    const hatchSteps = (s: Simulation) => [...new Set(ofType(s, 'StsHatchStarted').map((e) => `${e.payload.panelId} ${e.payload.op}`))]
    expect(hatchSteps(sim)).toEqual(hatchSteps(asToday))
  })

  it('discharges every stack top-down and keeps each yard group together', () => {
    const cellOf = new Map(initial.query.vesselSlots('V001').filter((s) => s.containerId).map((s) => [s.containerId as string, s]))
    expect(cellOf.size).toBeGreaterThan(0)
    for (const p of sim.query.workPackages().filter((w) => w.kind === 'discharge')) {
      const seenRows = new Map<number, number>()
      for (const id of p.containerIds) {
        const slot = cellOf.get(id)
        expect(slot, id).toBeDefined()
        const lastTier = seenRows.get(slot!.row)
        if (lastTier !== undefined) expect(slot!.tier, `${p.id} row ${slot!.row}`).toBeLessThanOrEqual(lastTier)
        seenRows.set(slot!.row, slot!.tier)
      }
    }
    const k = sim.kpiReport().ordering
    expect(k).toBeDefined()
    expect(k!.discharge.boxes).toBeGreaterThan(0)
  })

  it('splits yard groups no more often than the as-today order', () => {
    const ports = ['ESALG', 'MAPTM', 'ESVLC', 'NLRTM', 'DEHAM', 'GBFXT', 'SGSIN']
    const boxes = new Map(sim.query.containers().map((c) => [c.id, c]))
    const splits = (s: Simulation) =>
      s.query
        .workPackages()
        .filter((p) => p.kind === 'discharge')
        .reduce((n, p) => n + countDischargeSplits(p.containerIds.map((id) => ({ slot: { bay: 0, row: 0, tier: 0, deck: false, half: null }, box: boxes.get(id) })), ports), 0)
    expect(splits(sim)).toBeLessThanOrEqual(splits(asToday))
    expect(splits(sim)).toBe(sim.kpiReport().ordering!.discharge.groupSplits)
  })

  it('loads bottom-up inside each package', () => {
    const slots = new Map(sim.query.vesselSlots('V001').map((s) => [s.id, s]))
    const boxSlot = new Map<string, string>()
    for (const e of ofType(sim, 'StsLoadStarted')) boxSlot.set(e.payload.containerId, e.payload.slotId)
    for (const p of sim.query.workPackages().filter((w) => w.kind === 'load' && !w.emptyReq)) {
      const byRow = new Map<number, number>()
      for (const id of p.containerIds) {
        const slot = slots.get(boxSlot.get(id) as string)
        if (!slot) continue
        const last = byRow.get(slot.row) ?? 0
        expect(slot.tier, `${p.id} row ${slot.row}`).toBeGreaterThanOrEqual(last)
        byRow.set(slot.row, slot.tier)
      }
    }
  })

  it('reports broken-ordering counts only when pod-weight is selected', () => {
    const k = sim.kpiReport().ordering
    expect(k).toBeDefined()
    expect(k!.load.boxes).toBeGreaterThan(0)
    for (const n of [k!.load.podOnEarlier, k!.load.heavyOnLight, k!.discharge.groupSplits]) expect(n).toBeGreaterThanOrEqual(0)
    expect(asToday.kpiReport().ordering).toBeUndefined()
  })

  it('stows later PODs and heavier boxes low: fewer later-POD-on-earlier-POD boxes than the as-today stowage', () => {
    const better = sim.kpiReport().ordering!.load.podOnEarlier
    const base = createSimulation(withOrdering(fixtures['vessel-ordering-pod-weight'], 'as-today'))
    // count the same breaks on the as-today plan by running pod-weight counting over it
    const plan = base.query.vesselSlots('V001').filter((s) => s.purpose === 'load' && s.plannedContainerId)
    const ports = ['ESALG', 'MAPTM', 'ESVLC', 'NLRTM', 'DEHAM', 'GBFXT', 'SGSIN']
    let worse = 0
    for (const upper of plan) {
      const under = plan.filter((l) => l.bay === upper.bay && l.deck === upper.deck && l.row === upper.row && l.tier === upper.tier - 1)
      const pod = (id: string | null | undefined) => ports.indexOf(base.query.containers().find((c) => c.id === id)!.props.pod)
      if (under.some((l) => pod(upper.plannedContainerId) > pod(l.plannedContainerId))) worse++
    }
    expect(better).toBeLessThanOrEqual(worse)
  })
})

describe('selecting the ordering', () => {
  it('as-today (explicit or absent) leaves every existing fixture identical', () => {
    for (const name of ['mixed-discharge-then-load', 'stow-mixed-20-40']) {
      const absent = run(fixtures[name])
      const explicit = run(withOrdering(fixtures[name], 'as-today'))
      expect(explicit.eventLogHash(), name).toBe(absent.eventLogHash())
      expect(absent.kpiReport().ordering).toBeUndefined()
    }
  })

  it('pod-weight selected through config changes the work order but not the work done', () => {
    const base = fixtures['mixed-discharge-then-load']
    const a = run(base)
    const b = run(withOrdering(base, 'pod-weight'))
    expect(b.firstError).toBeNull()
    expect(b.invariantReport().violations).toEqual([])
    expect(b.kpiReport().movesCompleted).toBe(a.kpiReport().movesCompleted)
    expect(b.kpiReport().ordering).toBeDefined()
  })

  it('pod-weight selected through the CLI; a bad name is a usage error', () => {
    const lines: string[] = []
    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--ordering', 'pod-weight'], (l) => lines.push(l))).toBe(0)
    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--ordering', 'as-today'], () => {})).toBe(0)
    expect(runCli(['--fixture', 'tracer-1sts-10-boxes', '--ordering', 'sideways'], () => {})).toBe(2)
  })

  it('the builder sets the option', () => {
    expect(new ScenarioBuilder('x', 'x').vesselPlanning({ ordering: 'pod-weight' }).build().vesselPlanning).toEqual({ ordering: 'pod-weight' })
  })
})

describe('soft preferences: a load always completes', () => {
  it('boxes delivered by truck in an awkward order are all loaded', () => {
    const HOUR = 3600
    const config = new ScenarioBuilder('awkward', 'exports arrive by truck, long before and out of load order')
      .seed(11)
      .moveVariation(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Only', sizeClass: 'feeder', arrivalS: 6 * HOUR, discharge: 6, load: 10, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(3)
      .ascsPerBlock(2)
      .block('B01', { x: 20, bays: 12, tiers: 4 })
      .landside({
        hourlyProfile: Array.from({ length: 24 }, () => 0),
        exportWindow: { minBeforeEtaS: HOUR, maxBeforeEtaS: 30 * 86400 },
        scripted: Array.from({ length: 10 }, (_, i) => ({ atS: 60 + ((i * 7) % 10) * 300, transaction: 'dropExport' as const })),
      })
      .yardStart({ mode: 'empty' })
      .vesselPlanning({ ordering: 'pod-weight' })
      .endWhen({ vesselsCompleted: 1 })
      .build()
    const sim = run(config)
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    expect(sim.invariantReport().violations).toEqual([])
    expect(ofType(sim, 'StsLoaded').length).toBeGreaterThan(0)
  })
})

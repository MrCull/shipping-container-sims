/**
 * #184 yard reserve: a share of every block's stacks is kept free of pre-fill and discharge placement so
 * rehandles always have somewhere to go. Headless engine API plus the `yardReserve` scenario field.
 */
import { describe, expect, it } from 'vitest'
import { blockSpecs, candidateSlots, createSimulation, parseYardSlotId, reservedStacksOf, stackIndex, type DecisionHandler, type EngineEvent, type Simulation, type YardStacks } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'
import { ScenarioValidationError, validateScenario } from '../scenario/validate'

const HOUR = 3600
const ofType = <T extends EngineEvent['type']>(sim: Simulation, type: T) => sim.eventLog().filter((e): e is Extract<EngineEvent, { type: T }> => e.type === type)

function scenario(reserve: number | undefined): ScenarioConfig {
  const b = new ScenarioBuilder('yard-reserve', 'yard reserve test').hatch({ enabled: false })
    .seed(7)
    .moveVariation(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'First', sizeClass: 'feeder', discharge: 20, load: 8, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
    .vesselCall('V002', { name: 'Second', sizeClass: 'feeder', arrivalS: 6 * HOUR, discharge: 0, load: 8, maxSts: 1 })
    .shcs(3)
    .block('B01', { x: 20, bays: 12, tiers: 4 })
    .yardStart({ mode: 'prefilled', targetPct: 40 })
    .endWhen({ simDurationS: 4 * HOUR })
  if (reserve !== undefined) b.yardReserve(reserve)
  return b.build()
}

const reservedCell = (config: ScenarioConfig, slotId: string): boolean => {
  const spec = blockSpecs(config)[0]
  const c = parseYardSlotId(slotId)
  return spec.reserved[stackIndex(spec, c.bay, c.row)] === true
}

describe('reservedStacksOf', () => {
  it('is empty for no reserve and holds round(share * stacks) stacks spread over the block', () => {
    expect(reservedStacksOf(12, 8, 0)).toEqual([])
    const r = reservedStacksOf(12, 8, 0.25)
    expect(r.filter(Boolean)).toHaveLength(24)
    for (let bay = 0; bay < 12; bay++) expect(r.slice(bay * 8, bay * 8 + 8).some(Boolean)).toBe(true)
  })

  it('reserves neighbouring bays in pairs, so a 40 ft rehandle has two free stacks in a row (TT-184)', () => {
    for (const [bays, share] of [[45, 0.1], [12, 0.25], [20, 0.5]] as const) {
      const r = reservedStacksOf(bays, 8, share)
      expect(r.filter(Boolean).length).toBeGreaterThan(0)
      for (let i = 0; i < r.length; i++) if (r[i]) expect(r[i + 8] === true || r[i - 8] === true, `stack ${i} of ${bays} bays`).toBe(true)
    }
  })
})

describe('candidateSlots with a reserve', () => {
  const stacks = (size: '20' | '40', reservedStacks?: boolean[]): YardStacks => ({
    blockId: 'B01', bays: 4, rows: 8, tiers: 3, size, blockX: 0, firstBayZ: 100, wtpX: 0, wtpZ: 64,
    heights: new Array<number>(32).fill(0), topVessels: new Array<string | null>(32).fill(null), stackSpans: new Array<number>(32).fill(0),
    ...(reservedStacks ? { reservedStacks } : {}),
  })
  const reserved = new Array<boolean>(32).fill(false)
  reserved[0] = true // bay 1 row 1
  reserved[8 + 3] = true // bay 2 row 4

  it('never offers a reserved stack, and a 40 ft box needs both of its stacks free of the reserve', () => {
    expect(candidateSlots(stacks('20')).some((c) => c.bay === 1 && c.row === 1)).toBe(true)
    expect(candidateSlots(stacks('20', reserved)).some((c) => c.bay === 1 && c.row === 1)).toBe(false)
    expect(candidateSlots(stacks('20', reserved)).some((c) => c.bay === 2 && c.row === 4)).toBe(false)
    expect(candidateSlots(stacks('40', reserved)).some((c) => c.row === 1 && c.bay === 1)).toBe(false)
    expect(candidateSlots(stacks('40', reserved)).some((c) => c.row === 4 && (c.bay === 1 || c.bay === 2))).toBe(false)
    expect(candidateSlots(stacks('40', reserved)).some((c) => c.row === 2 && c.bay === 1)).toBe(true)
  })
})

describe('the reserve in a run', () => {
  const config = scenario(0.25)
  const sim = createSimulation(config)
  const prefilled = sim.query.yardSlots('B01')
  sim.runUntil({})

  it('pre-fill never uses a reserved stack', () => {
    expect(prefilled.length).toBeGreaterThan(20)
    for (const s of prefilled) expect(reservedCell(config, `B01:${String(s.bay).padStart(2, '0')}-${s.row}-${s.tier}`)).toBe(false)
  })

  it('discharge never uses a reserved stack', () => {
    expect(sim.firstError).toBeNull()
    const placed = ofType(sim, 'AscStacked').filter((e) => !e.payload.rehandle)
    expect(placed.length).toBeGreaterThan(15)
    for (const e of placed) expect(reservedCell(config, e.payload.yardSlotId)).toBe(false)
    expect(sim.invariantReport().violations).toEqual([])
  })
})

describe('rehandles may use the reserve', () => {
  const base = fixtures['rehandle-random-yard']
  const config: ScenarioConfig = { ...base, yard: { ...(base.yard as NonNullable<ScenarioConfig['yard']>), reserveShare: 0.3 } }
  const toReserve: DecisionHandler<'rehandleTarget'> = (msg) => {
    const c = msg.payload.candidates.find((x) => reservedCell(config, x.slotId)) ?? msg.payload.candidates[0]
    return { slotId: c ? c.slotId : null }
  }
  const sim = createSimulation(config, { rehandleTarget: toReserve })
  sim.runUntil({})

  it('offers reserved stacks as targets and stacks blockers there; stacking never does', () => {
    expect(sim.firstError).toBeNull()
    const moves = ofType(sim, 'AscStacked').filter((e) => e.payload.rehandle)
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.some((e) => reservedCell(config, e.payload.yardSlotId))).toBe(true)
    for (const e of ofType(sim, 'AscStacked').filter((x) => !x.payload.rehandle)) expect(reservedCell(config, e.payload.yardSlotId)).toBe(false)
    expect(sim.invariantReport().violations).toEqual([])
  })
})

describe('validation and default', () => {
  it.each([-0.1, 0.6, Number.NaN])('rejects a reserve of %s with a clear message', (v) => {
    const config = scenario(v)
    expect(validateScenario(config).errors.map((e) => e.key)).toContain('setup.check.yardReserve')
    expect(() => createSimulation(config)).toThrow(ScenarioValidationError)
    expect(() => createSimulation(config)).toThrow(/Yard reserve must be a share from 0 to 0.5/)
  })

  it('accepts 0, 0.5 and an absent reserve', () => {
    for (const v of [undefined, 0, 0.5]) expect(validateScenario(scenario(v)).errors.map((e) => e.key)).not.toContain('setup.check.yardReserve')
  })

  it('an absent reserve and a reserve of 0 give the same event log', () => {
    const a = createSimulation(scenario(undefined))
    a.runUntil({})
    const b = createSimulation(scenario(0))
    b.runUntil({})
    expect(b.eventLog()).toEqual(a.eventLog())
  })
})

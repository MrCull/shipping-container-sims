/**
 * Spec #201 (#203): the discharge and the load of a vessel share the bay's cells. Planner seam (`planCargo`, config plus
 * seed) and engine seam (headless run, invariant report, event log).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import { loadPurposeOf, planCargo, type PlannedSlot } from '../scenario/bayPlan'
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'
import { cellCapacity, stackBaseTier, vesselClass } from '../scenario/vesselClasses'

const CAP = cellCapacity(vesselClass('feeder')) // 336 cells

interface CallOptions {
  discharge: number
  load: number
  sizeMix?: Record<string, number>
  rob?: number
  seed?: number
}

function call(o: CallOptions): ScenarioConfig {
  const b = new ScenarioBuilder('shared', 'shared cells')
    .seed(o.seed ?? 5)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { sizeClass: 'feeder', discharge: o.discharge, load: o.load, maxSts: 1, sizeMix: (o.sizeMix ?? { '40': 1 }) as never })
    .shcs(2)
    .block('B01', { x: 20, bays: 40, tiers: 4 })
  if (o.rob) b.robBays(o.rob)
  return b.build()
}

/** Slots of a vessel in stacks (bay, row, section): discharge slots and load bookings as separate tier lists. */
function stacks(slots: readonly PlannedSlot[], pick: (s: PlannedSlot) => boolean) {
  const out = new Map<string, PlannedSlot[]>()
  for (const s of slots.filter(pick)) out.set(`${s.bay}:${s.row}:${s.deck}`, [...(out.get(`${s.bay}:${s.row}:${s.deck}`) ?? []), s])
  return out
}

/** Every stack's tiers run from its base up with no gap (a cell of two halves counts once). */
function bottomUp(slots: readonly PlannedSlot[], pick: (s: PlannedSlot) => boolean): string[] {
  const spec = vesselClass('feeder')
  const bad: string[] = []
  for (const [key, list] of stacks(slots, pick)) {
    const [, row, deck] = key.split(':')
    const tiers = [...new Set(list.map((s) => s.tier))].sort((a, b) => a - b)
    const base = stackBaseTier(spec, Number(row), deck === 'true')
    tiers.forEach((t, i) => {
      if (t !== base + i) bad.push(`${key} tiers ${tiers.join(',')} from base ${base}`)
    })
  }
  return [...new Set(bad)]
}

describe('shared cells: planner', () => {
  it('fills the discharge bottom up with no empty cell below a discharge box', () => {
    const config = call({ discharge: 150, load: 60 })
    expect(bottomUp(planCargo(config, config.seed).slots, (s) => s.purpose === 'discharge')).toEqual([])
  })

  it('fills the load bottom up, and some load cells are the cells of discharge boxes', () => {
    const config = call({ discharge: 150, load: 120 })
    const { slots } = planCargo(config, config.seed)
    expect(bottomUp(slots, (s) => loadPurposeOf(s) !== null)).toEqual([])
    const shared = slots.filter((s) => s.purpose === 'discharge' && s.loadPurpose)
    expect(shared.length).toBeGreaterThan(0)
    // all 120 load boxes are booked, shared or not
    expect(slots.filter((s) => loadPurposeOf(s) !== null)).toHaveLength(120)
  })

  it('takes a call too big for the old capacity (discharge plus load above the cells)', () => {
    const config = call({ discharge: 220, load: 220 })
    expect(220 + 220).toBeGreaterThan(CAP)
    const { slots } = planCargo(config, config.seed)
    expect(slots.filter((s) => s.purpose === 'discharge')).toHaveLength(220)
    expect(slots.filter((s) => loadPurposeOf(s) !== null)).toHaveLength(220)
  })

  it('fails a discharge-only overflow and a load-only overflow with their own message', () => {
    const tooMuchDischarge = call({ discharge: CAP + 1, load: 10 })
    expect(() => planCargo(tooMuchDischarge, 5)).toThrow(/discharge cells.*do not fit/)
    const tooMuchLoad = call({ discharge: 10, load: CAP + 1 })
    expect(() => planCargo(tooMuchLoad, 5)).toThrow(/load cells do not fit/)
    expect(() => planCargo(tooMuchLoad, 5)).not.toThrow(/discharge cells/)
  })

  it('books a 40 discharge cell as two 20s (and a 20 pair cell as a 40) in separate slots of the same cell', () => {
    const config = call({ discharge: 200, load: 200, sizeMix: { '20': 1, '40': 1 } })
    const plan = planCargo(config, 5)
    const cellOf = (s: PlannedSlot) => `${s.bay}:${s.row}:${s.tier}`
    const byId = new Set(plan.slots.map((s) => s.id))
    expect(byId.size).toBe(plan.slots.length)
    const dischargeAt = new Map<string, PlannedSlot[]>()
    for (const s of plan.slots.filter((x) => x.purpose === 'discharge')) dischargeAt.set(cellOf(s), [...(dischargeAt.get(cellOf(s)) ?? []), s])
    let fortyToTwenties = 0
    let twentiesToForty = 0
    for (const s of plan.slots.filter((x) => x.purpose !== 'discharge')) {
      const here = dischargeAt.get(cellOf(s)) ?? []
      expect(s.loadPurpose).toBeUndefined() // a separate slot is a plain load slot
      if (here.some((d) => d.half === null) && s.half !== null) fortyToTwenties++
      if (here.some((d) => d.half !== null) && s.half === null) twentiesToForty++
    }
    expect(fortyToTwenties).toBeGreaterThan(0)
    expect(twentiesToForty).toBeGreaterThan(0)
    expect(bottomUp(plan.slots, (s) => loadPurposeOf(s) !== null)).toEqual([])
  })

  it('reuses the discharge slot for a load booking of the same shape', () => {
    const config = call({ discharge: 150, load: 120, sizeMix: { '40': 1 } })
    const plan = planCargo(config, 5)
    const shared = plan.slots.filter((s) => s.loadPurpose)
    expect(shared.length).toBeGreaterThan(0)
    const ids = plan.slots.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of shared) {
      const boxes = plan.containers.filter((c) => c.slotId === s.id)
      expect(boxes.map((c) => c.flow).sort(), s.id).toEqual(['discharge', 'load'])
    }
  })

  it('leaves ROB bays without discharge and load', () => {
    const config = call({ discharge: 100, load: 100, rob: 0.4 })
    const plan = planCargo(config, 5)
    const rob = new Set(plan.robBays.V001)
    expect(rob.size).toBeGreaterThan(0)
    for (const s of plan.slots) expect(rob.has(s.bay), s.id).toBe(false)
  })

  it('gives the same plan for the same config and seed', () => {
    const config = call({ discharge: 150, load: 120, sizeMix: { '20': 1, '40': 1 } })
    expect(planCargo(config, 9)).toEqual(planCargo(config, 9))
  })
})

describe('shared cells: engine', () => {
  type Variant = { name: string; hatch: boolean; ahead: number }
  const variants: Variant[] = [
    { name: 'hatch covers off', hatch: false, ahead: 0 },
    { name: 'hatch covers on', hatch: true, ahead: 0 },
    { name: 'loadReleaseAhead 3', hatch: false, ahead: 3 },
  ]
  for (const v of variants)
    it(`runs to the end with zero violations and loads each cell after its discharge box left (${v.name})`, () => {
      const b = new ScenarioBuilder('shared-run', 'shared cells run')
        .seed(7)
        .moveVariation(10)
        .quay(400, { mooringS: 60, unmooringS: 60 })
        .sts('STS01', { gantryX: 60, groundPositions: 3 })
        .vesselCall('V001', { sizeClass: 'feeder', discharge: 60, load: 60, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
        .shcs(3)
        .block('B01', { x: 20, bays: 30, tiers: 4 })
        .ascsPerBlock(2)
        .endWhen({ vesselsCompleted: 1 })
      if (!v.hatch) b.hatch({ enabled: false })
      if (v.ahead) b.loadReleaseAhead(v.ahead)
      const config = b.build()
      const plan = planCargo(config, config.seed)
      expect(plan.slots.some((s) => s.loadPurpose), 'the fixture shares cells').toBe(true)
      const sim = createSimulation(config)
      sim.runUntil({ maxEvents: 400_000 })
      expect(sim.firstError).toBeNull()
      expect(sim.status).toBe('ended')
      const report = sim.invariantReport().violations
      const stowage = report.filter((x) => ['stowage.cell-free', 'stowage.order', 'stowage.no-floating'].includes(x.invariant))
      expect(stowage).toEqual([])
      expect(report).toEqual([])
      const log = sim.eventLog()
      const at = (pick: (e: EngineEvent) => string[]) => {
        const m = new Map<string, number>()
        log.forEach((e, i) => pick(e).forEach((id) => m.set(id, i)))
        return m
      }
      const picked = at((e) => (e.type === 'StsPicked' ? [e.payload.containerId, ...(e.payload.twin ? [e.payload.twin.containerId] : [])] : []))
      const loadedAt = new Map<string, { index: number; slot: string }>()
      log.forEach((e, i) => {
        if (e.type === 'StsLoaded') loadedAt.set(e.payload.containerId, { index: i, slot: e.payload.slotId })
      })
      const slotOf = new Map(plan.slots.map((s) => [s.id, s]))
      const sameCell = (a: PlannedSlot, b: PlannedSlot) => a.bay === b.bay && a.row === b.row && a.tier === b.tier
      const dischargeBoxes = plan.containers.filter((c) => c.flow === 'discharge')
      let checked = 0
      for (const [box, { index, slot }] of loadedAt) {
        const cell = slotOf.get(slot) as PlannedSlot
        for (const d of dischargeBoxes) {
          if (!sameCell(slotOf.get(d.slotId) as PlannedSlot, cell)) continue
          checked++
          expect(picked.get(d.id), `${d.id} picked before ${box} loaded into ${slot}`).toBeLessThan(index)
        }
      }
      expect(loadedAt.size).toBe(60)
      expect(checked).toBeGreaterThan(0)
    })
})

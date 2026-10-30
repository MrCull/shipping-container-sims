/** TT-R07: on board, a 20 never sits on a 40, and a 40 rests only on a 40 or on two filled 20 halves. */
import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation } from '../engine'
import { planCargo, type PlannedSlot } from '../scenario/bayPlan'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { vesselClass } from '../scenario/vesselClasses'
import type { ScenarioConfig } from '../scenario/types'

/** Independent check of a plan: every pair of stacked cells (same section) obeys the rule. */
function violations(config: ScenarioConfig, slots: readonly PlannedSlot[]): string[] {
  const out: string[] = []
  for (const v of config.vessels) {
    const holdTiers = vesselClass(v.sizeClass).holdTiers
    const cells = new Map<string, Map<number, PlannedSlot['half'][]>>()
    for (const s of slots.filter((x) => x.vesselId === v.id)) {
      const key = `${s.bay}:${s.row}:${s.deck}`
      const tiers = cells.get(key) ?? new Map<number, PlannedSlot['half'][]>()
      tiers.set(s.tier, [...(tiers.get(s.tier) ?? []), s.half])
      cells.set(key, tiers)
    }
    for (const [key, tiers] of cells)
      for (const [tier, halves] of tiers) {
        if (tier === 0 || tier === holdTiers) continue
        const below = tiers.get(tier - 1) ?? []
        if (halves.includes(null) && !(below.includes(null) || below.length === 2)) out.push(`${v.id} ${key} tier ${tier}: 40 over ${below.length === 1 ? 'a single 20 half' : 'nothing'}`)
        if (!halves.includes(null) && below.includes(null)) out.push(`${v.id} ${key} tier ${tier}: 20 over a 40`)
      }
  }
  return out
}

describe('bay plans follow the 20-on-40 rule', () => {
  for (const [name, config] of Object.entries(fixtures))
    it(`fixture ${name}`, () => {
      expect(violations(config, planCargo(config, config.seed).slots)).toEqual([])
    })
  for (const [name, build] of Object.entries(presets))
    it(`preset ${name}`, () => {
      const config = build()
      expect(violations(config, planCargo(config, config.seed).slots)).toEqual([])
    })

  it('holds for many seeds and mixes, with odd 20 ft counts, empties and tight stacks', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const config = new ScenarioBuilder('stow', 'stow')
        .seed(seed)
        .quay(400)
        .sts('STS01', { gantryX: 60, groundPositions: 3 })
        .vesselCall('V001', {
          sizeClass: 'feeder',
          discharge: 100 + seed,
          load: 50 + (seed % 7),
          transshipment: 20,
          empties: [{ size: '20', line: 'MSC', count: 5 }],
          sizeMix: { '20': 1 + (seed % 3), '40': 1, '40HC': 1 },
        })
        .shcs(2)
        .block('B01', { x: 20 })
        .build()
      expect(violations(config, planCargo(config, seed).slots), `seed ${seed}`).toEqual([])
    }
  })
})

describe('stowage.order rejects a 20 over a 40 and a 40 over a single 20 half', () => {
  function tampered(lower: 'whole' | 'aft', upper: 'whole' | 'aft'): string[] {
    const config = new ScenarioBuilder('stow-neg', 'stowage negative test')
      .seed(3)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { sizeClass: 'feeder', load: 70, maxSts: 1, sizeMix: { '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20 })
      .build()
    const sim = createSimulation(config)
    sim.runUntil({ eventType: 'BerthAllocated' })
    const snap = sim.snapshot()
    const slots = snap.state.vesselSlots
    const loads = Object.values(slots).filter((s) => s.purpose === 'load')
    const low = loads.find((s) => s.tier === 0 && loads.some((u) => u.bay === s.bay && u.row === s.row && u.tier === 1))
    expect(low).toBeDefined()
    const up = loads.find((u) => u.bay === low!.bay && u.row === low!.row && u.tier === 1)!
    const place = (s: (typeof loads)[number], id: string, whole: boolean) => {
      // a 20 ft box takes the aft half of its cell: re-key the slot as the half
      const slot = whole ? s : { ...s, id: `${s.id}:aft`, half: 'aft' as const }
      if (!whole) delete slots[s.id]
      slots[slot.id] = slot
      slot.containerId = id
    }
    place(low!, 'LOW', lower === 'whole')
    place(up, 'UP', upper === 'whole')
    const restored = restoreSimulation(snap, {}, { invariants: { failFast: false } })
    restored.runUntil({ maxEvents: 5 })
    return restored.invariantReport().violations.map((v) => v.invariant)
  }

  it('a 20 over a 40', () => {
    expect(tampered('whole', 'aft')).toContain('stowage.order')
  })
  it('a 40 over a single 20 half', () => {
    expect(tampered('aft', 'whole')).toContain('stowage.order')
  })
  it('a 40 over a 40 is fine', () => {
    expect(tampered('whole', 'whole')).not.toContain('stowage.order')
  })
})

describe('mixed 20/40 stows on a real run', () => {
  it('the stow-mixed-20-40 fixture runs clean with every invariant', () => {
    const sim = createSimulation(fixtures['stow-mixed-20-40'])
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations).toEqual([])
    const slots = sim.query.vesselSlots('V001')
    expect(slots.some((s) => s.deck && s.half === null)).toBe(true)
    expect(slots.some((s) => !s.deck && s.half === 'aft')).toBe(true)
  })
})

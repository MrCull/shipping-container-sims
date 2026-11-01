/**
 * Arrival stows (spec #134, #148): a vessel that arrives with boxes looks like a really stowed ship. Across every
 * preset and fixture: nothing floats, heavier boxes sit lower, one port of loading is a block of bays, fixtures keep
 * their exact box counts, and a normal scenario arrives 60 to 80 % full (discharge plus ROB boxes).
 */
import { describe, expect, it } from 'vitest'
import { planCargo, type PlannedContainer, type PlannedSlot } from '../scenario/bayPlan'
import { grossKgOf } from '../scenario/containerProps'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { arrivalRobBayCount, NORMAL_ARRIVAL_FILL, validateRob } from '../scenario/robBays'
import { generateVessels } from '../scenario/vesselGenerator'
import type { ScenarioConfig } from '../scenario/types'
import { cellCapacity, isStackBase, stackBaseTier, vesselClass } from '../scenario/vesselClasses'

const fixtureList = Object.entries(fixtures) as [string, ScenarioConfig][]
const presetList = Object.entries(presets).map(([name, make]) => [name, make()] as [string, ScenarioConfig])
const all = [...fixtureList, ...presetList]

const key = (s: { bay: number; row: number; tier: number }) => `${s.bay}:${s.row}:${s.tier}`

interface Cell {
  bay: number
  row: number
  tier: number
  deck: boolean
  kind: 'pair' | 'full' | 'lone'
  kg: number
  pols: Set<string>
}

/** The occupied discharge cells of a vessel with the boxes in them. */
function arrivalCells(plan: ReturnType<typeof planCargo>, vesselId: string): Cell[] {
  const slots = new Map(plan.slots.map((s) => [s.id, s]))
  const cells = new Map<string, Cell>()
  const boxes = plan.containers.filter((c): c is PlannedContainer => c.flow === 'discharge' && c.vesselId === vesselId)
  for (const c of boxes) {
    const s = slots.get(c.slotId) as PlannedSlot
    const cell = cells.get(key(s)) ?? { bay: s.bay, row: s.row, tier: s.tier, deck: s.deck, kind: s.half === null ? 'full' : 'lone', kg: 0, pols: new Set<string>() }
    if (cell.kind === 'lone' && cells.has(key(s))) cell.kind = 'pair'
    cell.kg += grossKgOf(c.props as NonNullable<PlannedContainer['props']>)
    cell.pols.add((c.props as NonNullable<PlannedContainer['props']>).pol)
    cells.set(key(s), cell)
  }
  return [...cells.values()]
}

describe.each(all)('arrival stow of %s', (_name, config) => {
  const plan = planCargo(config, config.seed)

  it('leaves no box above an empty cell (discharge and ROB boxes)', () => {
    for (const v of config.vessels) {
      const spec = vesselClass(v.sizeClass)
      const occupied = new Set([...arrivalCells(plan, v.id).map(key), ...plan.rob.filter((b) => b.vesselId === v.id).map(key)])
      for (const k of occupied) {
        const [bay, row, tier] = k.split(':').map(Number)
        if (isStackBase(spec, row, tier)) continue
        expect(occupied.has(key({ bay, row, tier: tier - 1 })), `${v.id} ${k}`).toBe(true)
      }
    }
  })

  it('stows heavier cells lower within a stack, for cells of one kind', () => {
    for (const v of config.vessels) {
      const stacks = new Map<string, Cell[]>()
      for (const c of arrivalCells(plan, v.id)) stacks.set(`${c.bay}:${c.row}:${c.deck}`, [...(stacks.get(`${c.bay}:${c.row}:${c.deck}`) ?? []), c])
      for (const stack of stacks.values()) {
        stack.sort((a, b) => a.tier - b.tier)
        for (let i = 1; i < stack.length; i++)
          if (stack[i].kind === stack[i - 1].kind) expect(stack[i].kg, `${v.id} bay ${stack[i].bay} row ${stack[i].row} tier ${stack[i].tier}`).toBeLessThanOrEqual(stack[i - 1].kg)
      }
    }
  })

  it('groups the boxes of one port of loading in neighbouring bays', () => {
    for (const v of config.vessels) {
      const byPol = new Map<string, Set<number>>()
      for (const c of arrivalCells(plan, v.id)) for (const pol of c.pols) byPol.set(pol, (byPol.get(pol) ?? new Set()).add(c.bay))
      // bays holding more than one port of loading: only the seams between the blocks (one per kind of cell)
      const bays = new Map<number, number>()
      for (const set of byPol.values()) for (const b of set) bays.set(b, (bays.get(b) ?? 0) + 1)
      const mixed = [...bays.values()].filter((n) => n > 1).length
      expect(mixed, v.id).toBeLessThanOrEqual(Math.max(0, 3 * (byPol.size - 1)))
    }
  })

  it('keeps the box counts of the vessel table', () => {
    for (const v of config.vessels) expect(plan.containers.filter((c) => c.vesselId === v.id && c.flow === 'discharge')).toHaveLength(v.discharge)
  })
})

describe('fixtures keep their exact boxes', () => {
  it('sets no arrival fill, so no ROB bay appears that the fixture did not ask for', () => {
    for (const [name, config] of fixtureList) {
      expect(config.arrivalFill, name).toBeUndefined()
      if (!config.robBayFraction) expect(planCargo(config, config.seed).rob, name).toEqual([])
    }
  })
})

describe('normal scenarios arrive 60 to 80 % full', () => {
  const fill = (config: ScenarioConfig) => {
    const plan = planCargo(config, config.seed)
    return config.vessels.map((v) => {
      const cells = new Set([...arrivalCells(plan, v.id).map(key), ...plan.rob.filter((b) => b.vesselId === v.id).map(key)])
      return { id: v.id, share: cells.size / cellCapacity(vesselClass(v.sizeClass)) }
    })
  }

  it.each(presetList)('%s', (_name, config) => {
    expect(config.arrivalFill).toBe(NORMAL_ARRIVAL_FILL)
    for (const { id, share } of fill(config)) {
      expect(share, id).toBeGreaterThanOrEqual(0.6)
      expect(share, id).toBeLessThanOrEqual(0.8)
    }
  })

  it('at full-size calls (movesScale 1) the fill is as high as the load side leaves room for (never above 80 %)', () => {
    const base = presets['TTI Algeciras baseline']()
    for (const sizeClass of ['feeder', 'feedermax', 'panamax', 'neo-panamax', 'ulcv'] as const) {
      const vessels = generateVessels({ count: 2, startS: 0, intervalS: 3600, jitterS: 0, seed: 3, sizeMix: { [sizeClass]: 1 }, flowMix: { import: 8, export: 7, transshipment: 85 } })
      for (const { id, share } of fill({ ...base, vessels })) {
        expect(share, `${sizeClass} ${id}`).toBeGreaterThanOrEqual(0.3)
        expect(share, `${sizeClass} ${id}`).toBeLessThanOrEqual(0.8)
      }
    }
  })
})

describe('arrival fill sizing', () => {
  const cargo = presets['Small automated']().cargo
  it('adds no ROB bay without a target or when the call already fills the ship', () => {
    expect(arrivalRobBayCount({ cargo }, { sizeClass: 'feeder', discharge: 10 }, 5)).toBe(0)
    expect(arrivalRobBayCount({ cargo, arrivalFill: 0.7 }, { sizeClass: 'feeder', discharge: 1200 }, 0)).toBe(0)
  })
  it('never takes the room the load side needs, nor the last working bay', () => {
    const n = arrivalRobBayCount({ cargo, arrivalFill: 0.9 }, { sizeClass: 'feeder', discharge: 150 }, 150)
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(vesselClass('feeder').bays)
  })
  it('validates the target', () => {
    expect(validateRob({ arrivalFill: 0.7 })).toEqual([])
    expect(validateRob({ arrivalFill: 1 })).toHaveLength(1)
    expect(validateRob({ arrivalFill: 0 })).toHaveLength(1)
  })
})

/**
 * Level stows (#164): within a bay section (hold or deck) the occupied stacks of an arriving vessel reach about the
 * same height. Heights are compared as the top tier of each stack, so an outer hold stack that the hull profile starts
 * higher (a physically shorter row) does not count as low.
 */
describe('level arrival stows', () => {
  type Placed = { bay: number; row: number; tier: number; deck: boolean }
  /** Top tier of each occupied stack, by bay section (`bay:deck`). */
  const topsBySection = (cells: readonly Placed[]) => {
    const tops = new Map<string, Map<number, number>>()
    for (const c of cells) {
      const section = `${c.bay}:${c.deck}`
      const rows = tops.get(section) ?? new Map<number, number>()
      rows.set(c.row, Math.max(rows.get(c.row) ?? 0, c.tier + 1))
      tops.set(section, rows)
    }
    return tops
  }
  /** The largest difference in top tier between occupied stacks of one bay section, over every section. */
  const worstSpread = (cells: readonly Placed[]) => {
    let worst = { spread: 0, section: '' }
    for (const [section, rows] of topsBySection(cells)) {
      const spread = Math.max(...rows.values()) - Math.min(...rows.values())
      if (spread > worst.spread) worst = { spread, section }
    }
    return worst
  }
  const check = (config: ScenarioConfig) => {
    const plan = planCargo(config, config.seed)
    for (const v of config.vessels) {
      const discharge = worstSpread(arrivalCells(plan, v.id))
      expect(discharge.spread, `${v.id} discharge, bay:deck ${discharge.section}`).toBeLessThanOrEqual(2)
      const rob = worstSpread(plan.rob.filter((b) => b.vesselId === v.id))
      expect(rob.spread, `${v.id} ROB, bay:deck ${rob.section}`).toBeLessThanOrEqual(2)
    }
  }

  it.each(all)('%s', (_name, config) => check(config))

  it.each([3, 17, 42])('generated full-size calls of every vessel class (seed %i)', (seed) => {
    const base = presets['TTI Algeciras baseline']()
    for (const sizeClass of ['feeder', 'feedermax', 'panamax', 'neo-panamax', 'ulcv'] as const) {
      const vessels = generateVessels({ count: 2, startS: 0, intervalS: 3600, jitterS: 0, seed, sizeMix: { [sizeClass]: 1 }, flowMix: { import: 8, export: 7, transshipment: 85 } })
      check({ ...base, vessels, seed })
    }
  })

  it('keeps the outer stacks of a bay section clear for the load boxes', () => {
    // a section uses the fewest stacks nearest the centreline that hold its discharge cells (the odd 20 ft box may add one)
    for (const [name, config] of presetList) {
      const plan = planCargo(config, config.seed)
      for (const v of config.vessels) {
        const spec = vesselClass(v.sizeClass)
        const mid = (spec.rows - 1) / 2
        const cells = arrivalCells(plan, v.id)
        for (const [section, rows] of topsBySection(cells)) {
          const deck = section.endsWith('true')
          const count = cells.filter((c) => `${c.bay}:${c.deck}` === section).length
          const top = deck ? spec.holdTiers + spec.deckTiers : spec.holdTiers
          const byCentre = Array.from({ length: spec.rows }, (_, row) => row).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
          let need = 0
          for (let room = 0; room < count && need < byCentre.length; need++) room += top - stackBaseTier(spec, byCentre[need], deck)
          expect(rows.size, `${name} ${v.id} ${section}`).toBeLessThanOrEqual(need + 1)
        }
      }
    }
  })
})

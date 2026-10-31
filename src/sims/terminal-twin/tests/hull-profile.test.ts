/**
 * Hull profile (spec #116, #131): below deck the holds narrow towards the keel. Capacity, planning, ROB fill, the
 * scenario validation and the `hull.profile` invariant all use it.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, restoreSimulation } from '../engine'
import { planCargo } from '../scenario/bayPlan'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { buildBayView, type BayViewData } from '../modules/bayView'
import { holdLinerOutline, hullHatchOpenings } from '../modules/hullHatchOpening'
import type { HullMeta } from '../modules/vesselHull'
import { validateOverrides } from '../scenario/overrides'
import type { ScenarioConfig } from '../scenario/types'
import { cellCapacity, isCellUsable, rowRange, stackBaseTier, VESSEL_CLASSES, VESSEL_SIZE_CLASSES, vesselClass } from '../scenario/vesselClasses'

const configs: [string, ScenarioConfig][] = [
  ...Object.entries(fixtures).map(([k, c]) => [`fixture ${k}`, c] as [string, ScenarioConfig]),
  ...Object.entries(presets).map(([k, f]) => [`preset ${k}`, f()] as [string, ScenarioConfig]),
]

describe('hull profile of each vessel class', () => {
  it('is centred, monotonic, ends at the full beam and loses rows towards the keel', () => {
    for (const cls of VESSEL_SIZE_CLASSES) {
      const spec = VESSEL_CLASSES[cls]
      expect(spec.holdRows, cls).toHaveLength(spec.holdTiers)
      expect(spec.holdRows[spec.holdTiers - 1], cls).toBe(spec.rows)
      expect(spec.holdRows[0], cls).toBeLessThan(spec.rows)
      spec.holdRows.forEach((n, t) => {
        expect((spec.rows - n) % 2, `${cls} tier ${t} stays centred`).toBe(0)
        if (t > 0) expect(n, `${cls} tier ${t}`).toBeGreaterThanOrEqual(spec.holdRows[t - 1])
      })
    }
  })

  it('capacity per class is the profile summed over the hold plus the full deck', () => {
    const expected = { feeder: 336, feedermax: 760, panamax: 2142, 'neo-panamax': 4720, ulcv: 9288 } as const
    for (const cls of VESSEL_SIZE_CLASSES) {
      const spec = vesselClass(cls)
      const hold = spec.holdRows.reduce((n, r) => n + r, 0)
      expect(cellCapacity(spec), cls).toBe(spec.bays * (hold + spec.rows * spec.deckTiers))
      expect(cellCapacity(spec), cls).toBeLessThan(spec.bays * spec.rows * (spec.holdTiers + spec.deckTiers))
      expect(cellCapacity(spec), cls).toBe(expected[cls])
    }
  })

  it('answers which cells exist: inner rows low in the hold, every row on deck, nothing outside the vessel', () => {
    const spec = vesselClass('feeder')
    expect(rowRange(spec, 0)).toEqual({ from: 2, to: 6 })
    expect(isCellUsable(spec, 1, 0)).toBe(false)
    expect(isCellUsable(spec, 2, 0)).toBe(true)
    expect(isCellUsable(spec, 0, 3)).toBe(true)
    expect(isCellUsable(spec, 0, spec.holdTiers)).toBe(true)
    expect(isCellUsable(spec, 0, spec.holdTiers + spec.deckTiers)).toBe(false)
    expect(stackBaseTier(spec, 0, false)).toBe(3)
    expect(stackBaseTier(spec, 3, false)).toBe(0)
    expect(stackBaseTier(spec, 0, true)).toBe(spec.holdTiers)
  })
})

describe('planning respects the hull profile', () => {
  it.each(configs)('%s: no slot and no ROB box outside the profile', (_name, config) => {
    const plan = planCargo(config, config.seed)
    for (const s of plan.slots) {
      const spec = vesselClass(config.vessels.find((v) => v.id === s.vesselId)!.sizeClass)
      expect(isCellUsable(spec, s.row, s.tier), s.id).toBe(true)
    }
    for (const b of plan.rob) {
      const spec = vesselClass(config.vessels.find((v) => v.id === b.vesselId)!.sizeClass)
      expect(isCellUsable(spec, b.row, b.tier), b.slotId).toBe(true)
    }
  })

  it('a ROB fill of 100 % uses every usable cell of a ROB bay and no other', () => {
    const base = fixtures['rob-bays'] as ScenarioConfig
    const config: ScenarioConfig = { ...base, robFill: 1 }
    const plan = planCargo(config, config.seed)
    const v = config.vessels[0]
    const spec = vesselClass(v.sizeClass)
    const bays = plan.robBays[v.id]
    expect(bays.length).toBeGreaterThan(0)
    const cells = new Set(plan.rob.filter((b) => b.vesselId === v.id).map((b) => `${b.bay}:${b.row}:${b.tier}`))
    expect(cells.size).toBe(bays.length * (spec.holdRows.reduce((n, r) => n + r, 0) + spec.rows * spec.deckTiers))
  })

  it('a vessel booked past the profile capacity (but within the box grid) is a capacity error', () => {
    const base = fixtures['hatch-cover-cycle'] as ScenarioConfig
    const spec = vesselClass(base.vessels[0].sizeClass)
    const over = spec.bays * spec.rows * (spec.holdTiers + spec.deckTiers)
    expect(over).toBeGreaterThan(cellCapacity(spec))
    const v = { ...base.vessels[0], discharge: over, load: 0, transshipment: 0, dischargeTransshipment: 0, empties: [] }
    const result = validateOverrides({ ...base, vessels: [v] })
    const error = result.errors.find((m) => m.key === 'setup.check.capacity')
    expect(error?.params?.capacity).toBe(cellCapacity(spec))
  })
})

describe('hull.profile invariant', () => {
  it('stays silent on every fixture run', () => {
    for (const name of ['hatch-cover-cycle', 'rob-bays', 'stow-mixed-20-40']) {
      const sim = createSimulation(fixtures[name])
      sim.runUntil()
      expect(sim.firstError, name).toBeNull()
      expect(sim.invariantReport().violations.filter((v) => v.invariant === 'hull.profile'), name).toEqual([])
    }
  })

  it('fires on a box deliberately put in a hold cell outside the profile', () => {
    const sim = createSimulation(fixtures['hatch-cover-cycle'])
    sim.runUntil({ eventType: 'BerthAllocated' })
    const snap = sim.snapshot()
    const spec = vesselClass(Object.values(snap.state.vessels)[0].sizeClass)
    const slot = Object.values(snap.state.vesselSlots).find((s) => s.containerId && s.tier < spec.holdTiers)
    expect(slot, 'a discharge box in the hold').toBeDefined()
    // cheat: the box sits in the outermost row of the keel tier, which the hull does not have
    slot!.row = 0
    slot!.tier = 0
    const restored = restoreSimulation(snap, {}, { invariants: { failFast: false } })
    restored.runUntil({ maxEvents: 5 })
    expect(restored.invariantReport().violations.map((v) => v.invariant)).toContain('hull.profile')
  })
})

describe('bay viewer draws the V', () => {
  it('marks cells outside the profile absent in both panels, and does not count them', () => {
    const data: BayViewData = { vesselId: 'V1', sizeClass: 'feeder', status: 'berthed', slots: [], boxes: {}, packages: [], robBoxes: [] }
    const view = buildBayView(data, 3, { colourMode: 'status' })
    const spec = vesselClass('feeder')
    const hold = view.sections[1]
    for (const t of hold.tiers) t.positions.forEach((p, row) => expect(p.cells[0].absent, `tier ${t.tier} row ${row}`).toBe(!isCellUsable(spec, row, t.tier)))
    expect(view.sections[0].tiers.every((t) => t.positions.every((p) => !p.cells[0].absent))).toBe(true)
    for (const panel of view.panels) expect(panel.sections[1].tiers.find((t) => t.tier === 0)!.cells.map((c) => c.absent)).toEqual([true, true, false, false, false, false, true, true])
    const usable = spec.holdRows.reduce((n, r) => n + r, 0) + spec.rows * spec.deckTiers
    expect(view.counts.empty).toBe(usable)
  })
})

describe('3D hold liner follows the profile', () => {
  it('is a stepped V: the keel tier is as narrow as its rows, the top tier as wide as the opening', () => {
    const g = { origin: [0, 0, 11.5], holdTopY: 20, bays: 7, rows: 8, holdTiers: 4, deckTiers: 3, bayPitchM: 14, rowPitchM: 2.55, tierPitchM: 2.896, halfOffsetM: 3.067 }
    const meta = { sizeClass: 'feeder', bayGrid: g } as unknown as HullMeta
    const [o] = hullHatchOpenings(meta, [0])
    const pts = holdLinerOutline(meta, o, 0)
    const widthAt = (y: number) => {
      const zs = pts.filter(([, py]) => Math.abs(py - y) < 1e-6).map(([z]) => z)
      return Math.max(...zs) - Math.min(...zs)
    }
    const floor = g.holdTopY - g.holdTiers * g.tierPitchM
    expect(widthAt(floor)).toBeCloseTo(4 * g.rowPitchM, 6)
    expect(widthAt(g.holdTopY)).toBeCloseTo(o.zQuay - o.zSea, 6)
    expect(widthAt(floor)).toBeLessThan(widthAt(g.holdTopY))
  })
})

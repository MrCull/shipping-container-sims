/**
 * Spec #166 (#174): the `stowage.no-floating` invariant. Every box on board (discharge, load, transshipment and ROB)
 * above its stack base has a box directly below it. Through the headless engine (seam 1): a tampered snapshot must
 * fail it, and a clean run must not.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, INVARIANTS, restoreSimulation, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { planCargo } from '../scenario/bayPlan'
import { isStackBase, vesselClass, type CellHalf } from '../scenario/vesselClasses'
import type { ScenarioConfig } from '../scenario/types'
/** The engine state a snapshot carries (plain JSON, so tests may tamper with it). */
type SimState = ReturnType<Simulation['snapshot']>['state']

const ID = 'stowage.no-floating'

/** Snapshot at the first berth, cheat with `tamper`, restore with fail-fast off and check the next events. */
function tamperedViolations(name: string, tamper: (state: SimState) => void): string[] {
  const sim = createSimulation(fixtures[name])
  sim.runUntil({ eventType: 'BerthAllocated' })
  const snap = sim.snapshot()
  tamper(snap.state)
  const restored = restoreSimulation(snap, {}, { invariants: { failFast: false } })
  restored.runUntil({ maxEvents: 5 })
  return restored.invariantReport().violations.map((v) => v.invariant)
}

/** A slot above the stack base, and every slot of the cell (both halves, if any) directly below it. */
function aboveBase(state: SimState, pick: (s: SimState['vesselSlots'][string]) => boolean) {
  for (const s of Object.values(state.vesselSlots)) {
    if (!pick(s)) continue
    const spec = vesselClass(state.vessels[s.vesselId].sizeClass)
    if (isStackBase(spec, s.row, s.tier)) continue
    const belowCell = Object.values(state.vesselSlots).filter((b) => b.vesselId === s.vesselId && b.bay === s.bay && b.row === s.row && b.tier === s.tier - 1)
    if (belowCell.length > 0) return { upper: s, below: belowCell }
  }
  return null
}

describe('stowage.no-floating invariant', () => {
  it('is registered with a dotted id and reads the vessel and container kinds', () => {
    const inv = INVARIANTS.find((i) => i.id === ID)
    expect(inv).toBeDefined()
    expect(inv!.reads).toEqual(['vessel', 'container'])
    expect(inv!.scoped).toBe(true)
  })

  it.each(['vessel-ordering-pod-weight', 'hatch-cover-cycle', 'rob-bays', 'stow-mixed-20-40'])('stays silent on the arrival and a full run of %s', (name) => {
    const sim: Simulation = createSimulation(fixtures[name])
    sim.runUntil({ eventType: 'BerthAllocated' })
    expect(sim.invariantReport().violations.filter((v) => v.invariant === ID)).toEqual([])
    sim.runUntil({ maxEvents: 400_000 })
    expect(sim.firstError).toBeNull()
    expect(sim.invariantReport().violations.filter((v) => v.invariant === ID)).toEqual([])
  })

  it('fails a tampered snapshot with a floating discharge box (its box below is gone)', () => {
    const ids = tamperedViolations('vessel-ordering-pod-weight', (state) => {
      const hit = aboveBase(state, (s) => s.purpose === 'discharge' && s.containerId !== null)
      expect(hit, 'a discharge box above a box').not.toBeNull()
      // the whole cell below goes (both halves, if it has two): nothing is left under the box
      for (const b of hit!.below) b.containerId = null
    })
    expect(ids).toContain(ID)
  })

  it('fails a tampered snapshot with a floating load box (a box put in a slot whose lower cell is empty)', () => {
    const ids = tamperedViolations('vessel-ordering-pod-weight', (state) => {
      const hit = aboveBase(state, (s) => s.purpose === 'load' && s.plannedContainerId != null && s.containerId === null)
      expect(hit, 'a booked load slot above an empty cell').not.toBeNull()
      hit!.upper.containerId = hit!.upper.plannedContainerId as string
    })
    expect(ids).toContain(ID)
  })

  it('fails a tampered snapshot with a floating ROB box (the ROB box below is removed)', () => {
    const ids = tamperedViolations('rob-bays', (state) => {
      const robVessel = Object.values(state.vessels).find((v) => (v.robBoxes ?? []).length > 0)
      expect(robVessel, 'a vessel with ROB boxes').toBeDefined()
      const boxes = robVessel!.robBoxes!
      const spec = vesselClass(robVessel!.sizeClass)
      const upper = boxes.find((b) => !isStackBase(spec, b.row, b.tier))
      expect(upper, 'a ROB box above the stack base').toBeDefined()
      robVessel!.robBoxes = boxes.filter((b) => !(b.bay === upper!.bay && b.row === upper!.row && b.tier === upper!.tier - 1))
    })
    expect(ids).toContain(ID)
  })
})

/** Arrival stows: the plan of every fixture and preset leaves nothing floating, for the scenario seed and other seeds. */
describe('arrival stow floats nothing (plan, several seeds)', () => {
  const configs: [string, ScenarioConfig][] = [
    ...(Object.entries(fixtures) as [string, ScenarioConfig][]),
    ...Object.entries(presets).map(([name, make]) => [name, make()] as [string, ScenarioConfig]),
  ]
  it.each(configs)('%s', (_name, config) => {
    for (const seed of [config.seed, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const plan = planCargo(config, seed)
      const occupied = new Map<string, (CellHalf)[]>()
      const add = (vesselId: string, bay: number, row: number, tier: number, half: CellHalf) => {
        const key = `${vesselId}:${bay}:${row}:${tier}`
        occupied.set(key, [...(occupied.get(key) ?? []), half])
      }
      for (const s of plan.slots) add(s.vesselId, s.bay, s.row, s.tier, s.half)
      for (const b of plan.rob) add(b.vesselId, b.bay, b.row, b.tier, b.half)
      const floating: string[] = []
      for (const [key, halves] of occupied) {
        const [vesselId, bay, row, tier] = key.split(':')
        const spec = vesselClass(config.vessels.find((v) => v.id === vesselId)!.sizeClass)
        if (isStackBase(spec, Number(row), Number(tier))) continue
        const below = occupied.get(`${vesselId}:${bay}:${row}:${Number(tier) - 1}`) ?? []
        if (!halves.some((h) => below.some((g) => g === null || h === null || g === h))) floating.push(`seed ${seed} ${key}`)
      }
      expect(floating.slice(0, 5), `seed ${seed}`).toEqual([])
    }
  })
})

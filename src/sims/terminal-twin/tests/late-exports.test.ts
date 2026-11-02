/**
 * Spec #201 (#204): an export booked to a vessel after planning (a box a truck delivers) takes the lowest free
 * bottom-up cell of a bay over every non-ROB cell, including a cell whose discharge box leaves before the load.
 * Planner seam (`extraLoadCell`) and engine seam (headless run, invariant report).
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, type EngineEvent } from '../engine'
import { extraLoadCell, planCargo, type PlannedSlot } from '../scenario/bayPlan'
import { ScenarioBuilder } from '../scenario/builder'
import { stackBaseTier, vesselClass } from '../scenario/vesselClasses'

const HOUR = 3600
const spec = vesselClass('feeder')

/** A vessel whose every usable cell holds a discharge box and that has no load booking at all. */
function fullDischarge(): PlannedSlot[] {
  const slots: PlannedSlot[] = []
  const tiers = spec.holdTiers + spec.deckTiers
  for (let bay = 0; bay < spec.bays; bay++)
    for (let row = 0; row < spec.rows; row++)
      for (const deck of [false, true]) {
        const base = stackBaseTier(spec, row, deck)
        for (let tier = base; tier < (deck ? tiers : spec.holdTiers); tier++)
          slots.push({ id: `V:${bay}-${row}-${tier}`, vesselId: 'V', bay, row, tier, deck, half: null, purpose: 'discharge' })
      }
  return slots
}

describe('late exports: planner', () => {
  it('books a cell of a discharge stack, at the stack base, when every cell holds a discharge box at arrival', () => {
    const slots = fullDischarge()
    const cell = extraLoadCell('feeder', slots, '40')
    expect(cell).not.toBeNull()
    expect(slots.some((s) => s.bay === cell!.bay && s.row === cell!.row && s.tier === cell!.tier && s.deck === cell!.deck)).toBe(true)
    expect(cell!.tier).toBe(stackBaseTier(spec, cell!.row, cell!.deck))
    expect(cell!.deck).toBe(false)
  })

  it('tries the bay with the fewest bookings next, again at the stack base', () => {
    const slots = fullDischarge()
    const first = extraLoadCell('feeder', slots, '40')!
    const booked = slots.find((s) => s.bay === first.bay && s.row === first.row && s.tier === first.tier && s.deck === first.deck)!
    booked.loadPurpose = 'load'
    const next = extraLoadCell('feeder', slots, '40')!
    expect(next.bay).not.toBe(first.bay)
    expect(next.tier).toBe(stackBaseTier(spec, next.row, next.deck))
  })

  it('a 20 completes a lone aft half first and no 20 goes on a 40', () => {
    const config = new ScenarioBuilder('late20', 'late 20')
      .seed(3)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { sizeClass: 'feeder', discharge: 100, load: 61, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 40, tiers: 4 })
      .build()
    const plan = planCargo(config, 3)
    const booked = plan.slots.filter((s) => s.loadPurpose || s.purpose === 'load')
    const sameStack = (a: PlannedSlot, b: PlannedSlot) => a.bay === b.bay && a.row === b.row && a.deck === b.deck
    const lone = booked.find((s) => s.half === 'aft' && !booked.some((o) => o.half === 'fore' && sameStack(o, s) && o.tier === s.tier))
    const cell = extraLoadCell('feeder', plan.slots, '20')!
    if (lone) expect(cell).toMatchObject({ bay: lone.bay, row: lone.row, tier: lone.tier, half: 'fore' })
    expect(booked.filter((s) => s.half === null && s.bay === cell.bay && s.row === cell.row && s.deck === cell.deck && s.tier < cell.tier)).toEqual([])
  })
})

describe('late exports: engine', () => {
  it('books late exports into discharge cells on a busy vessel and reports no violation', () => {
    const config = new ScenarioBuilder('late-run', 'late exports')
      .seed(11)
      .moveVariation(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Only', sizeClass: 'feeder', arrivalS: 6 * HOUR, discharge: 200, load: 4, maxSts: 1, sizeMix: { '40': 1 } })
      .shcs(3)
      .ascsPerBlock(2)
      .block('B01', { x: 20, bays: 20, tiers: 4 })
      .block('B02', { x: 60, bays: 20, tiers: 4 })
      .landside({
        hourlyProfile: Array.from({ length: 24 }, () => 0),
        exportWindow: { minBeforeEtaS: HOUR, maxBeforeEtaS: 30 * 86400 },
        scripted: Array.from({ length: 6 }, (_, i) => ({ atS: 60 + i * 300, transaction: 'dropExport' as const })),
      })
      .endWhen({ vesselsCompleted: 1 })
      .build()
    const plan = planCargo(config, config.seed)
    const discharged = new Set(plan.slots.filter((s) => s.purpose === 'discharge').map((s) => `${s.bay}:${s.row}:${s.tier}:${s.deck}`))
    const sim = createSimulation(config)
    sim.runUntil()
    expect(sim.firstError).toBeNull()
    expect(sim.status).toBe('ended')
    const delivered = sim
      .eventLog()
      .filter((e): e is Extract<EngineEvent, { type: 'TruckArrived' }> => e.type === 'TruckArrived')
      .flatMap((e) => e.payload.legs.filter((l) => l.purpose === 'export'))
    expect(delivered.length).toBe(6)
    const late = sim.query.vesselSlots('V001').filter((s) => delivered.some((l) => l.containerId === s.plannedContainerId))
    expect(late.length).toBe(6)
    expect(late.some((s) => discharged.has(`${s.bay}:${s.row}:${s.tier}:${s.deck}`)), 'a late export sits in a discharge cell').toBe(true)
    expect(sim.invariantReport().violations).toEqual([])
  })
})

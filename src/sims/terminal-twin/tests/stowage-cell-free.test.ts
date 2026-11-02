/**
 * Spec #201 (#202): the `stowage.cell-free` invariant. A box is never loaded on board into a cell (bay, row, tier;
 * either half for a 40, the same half for a 20) that already holds a box. Tampered snapshots through the headless engine.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, INVARIANTS, restoreSimulation, type Simulation } from '../engine'
import { fixtures } from '../scenario/fixtures'

type SimState = ReturnType<Simulation['snapshot']>['state']
const ID = 'stowage.cell-free'

function tamperedMessages(tamper: (state: SimState) => void): string[] {
  const sim = createSimulation(fixtures['vessel-ordering-pod-weight'])
  sim.runUntil({ eventType: 'BerthAllocated' })
  const snap = sim.snapshot()
  tamper(snap.state)
  const restored = restoreSimulation(snap, {}, { invariants: { failFast: false } })
  restored.runUntil({ maxEvents: 5 })
  return restored.invariantReport().violations.filter((v) => v.invariant === ID).map((v) => v.message)
    .filter((m, i, all) => all.indexOf(m) === i) // the same breach is reported again on every later event
}

/** Move a booked load slot onto the cell of a filled discharge slot and fill it: returns both boxes. */
function loadIntoOccupied(state: SimState): { load: string; held: string; slot: string; vessel: string } | null {
  const slots = Object.values(state.vesselSlots)
  const alone = (s: (typeof slots)[number]) => slots.filter((o) => o.containerId && o.vesselId === s.vesselId && o.bay === s.bay && o.row === s.row && o.tier === s.tier).length === 1
  const held = slots.find((s) => s.purpose === 'discharge' && s.containerId !== null && alone(s))
  const load = slots.find((s) => s.purpose === 'load' && s.plannedContainerId != null && s.containerId === null && s.vesselId === held?.vesselId)
  if (!held || !load) return null
  load.bay = held.bay
  load.row = held.row
  load.tier = held.tier
  load.deck = held.deck
  load.half = held.half
  load.containerId = load.plannedContainerId as string
  return { load: load.containerId, held: held.containerId as string, slot: load.id, vessel: held.vesselId }
}

describe('stowage.cell-free invariant', () => {
  it('is registered, vessel-scoped, and reads vessel and container', () => {
    const inv = INVARIANTS.find((i) => i.id === ID)
    expect(inv).toBeDefined()
    expect(inv!.reads).toEqual(['vessel', 'container'])
    expect(inv!.scoped).toBe(true)
  })

  it('names the vessel, slot and both boxes when a load lands in an occupied cell', () => {
    let hit: ReturnType<typeof loadIntoOccupied> = null
    const msgs = tamperedMessages((state) => {
      hit = loadIntoOccupied(state)
    })
    expect(hit, 'a discharge box and a booked load slot').not.toBeNull()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain(hit!.vessel)
    expect(msgs[0]).toContain(hit!.slot)
    expect(msgs[0]).toContain(hit!.load)
    expect(msgs[0]).toContain(hit!.held)
  })

  it('a legal load (a booked load slot filled in its own empty cell) gets no violation', () => {
    let filled = false
    const msgs = tamperedMessages((state) => {
      const load = Object.values(state.vesselSlots).find((s) => s.purpose === 'load' && s.plannedContainerId != null && s.containerId === null)
      if (!load) return
      load.containerId = load.plannedContainerId as string
      filled = true
    })
    expect(filled, 'a booked load slot').toBe(true)
    expect(msgs).toEqual([])
  })

  it('a clean run reports none', () => {
    const sim = createSimulation(fixtures['vessel-ordering-pod-weight'])
    sim.runUntil({ maxEvents: 400_000 })
    expect(sim.invariantReport().violations.filter((v) => v.invariant === ID)).toEqual([])
  })
})

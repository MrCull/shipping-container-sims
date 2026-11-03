import { describe, expect, it } from 'vitest'
import { createSimulation, indexVesselSlotAdded, indexVesselSlotRemoved, vesselSlotsOf, type VesselSlotState } from '../engine'
import { presets } from '../scenario/presets'

const slot = (id: string, vesselId: string, bay: number): VesselSlotState =>
  ({ id, vesselId, bay, row: 1, tier: 1, half: null, purpose: 'load', containerId: null, plannedContainerId: null }) as unknown as VesselSlotState

const fresh = (slots: Record<string, VesselSlotState>, vesselId: string) => Object.values(slots).filter((s) => s.vesselId === vesselId)

describe('vessel slot index (#234)', () => {
  it('equals a fresh scan after slots are created, replaced and removed', () => {
    const slots: Record<string, VesselSlotState> = { a: slot('a', 'V1', 1), b: slot('b', 'V2', 1), c: slot('c', 'V1', 2) }
    const state = { vesselSlots: slots }
    expect(vesselSlotsOf(state, 'V1')).toEqual(fresh(slots, 'V1'))
    const d = slot('d', 'V1', 3)
    slots.d = d
    indexVesselSlotAdded(state, d)
    const n = slot('n', 'V3', 1)
    slots.n = n
    indexVesselSlotAdded(state, n)
    // overwriting a key keeps its place in Object.values
    const old = slots.a
    slots.a = slot('a', 'V1', 9)
    indexVesselSlotAdded(state, slots.a, old)
    const removed = slots.c
    delete slots.c
    indexVesselSlotRemoved(state, removed)
    for (const v of ['V1', 'V2', 'V3', 'none']) expect(vesselSlotsOf(state, v)).toEqual(fresh(slots, v))
    expect(vesselSlotsOf(state, 'V1').map((s) => s.id)).toEqual(['a', 'd'])
  })

  it('matches a fresh scan on a running scenario, including slots added by extra bookings', () => {
    const sim = createSimulation(presets['Small automated'](), {}, { invariants: { sweepEvery: 25 } })
    // adopt a snapshot so the test holds the live state object the engine keeps mutating
    const snap = sim.snapshot()
    sim.restore(snap, { adopt: true })
    const live = snap.state
    const vessels = Object.keys(live.vessels)
    for (const v of vessels) vesselSlotsOf(live, v) // build the index now, so later slots go through the add hook
    for (const t of [600, 1800, 3600]) {
      sim.runUntil({ time: t })
      for (const v of vessels) expect(vesselSlotsOf(live, v)).toEqual(fresh(live.vesselSlots, v))
    }
  })
})

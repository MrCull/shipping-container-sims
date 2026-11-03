import { describe, expect, it } from 'vitest'
import { cellKey, cellOfKey, createSimulation, occupancySlotCleared, occupancySlotFilled, vesselOccupancyOf, type VesselSlotState } from '../engine'
import { presets } from '../scenario/presets'

const slot = (id: string, bay: number, row: number, tier: number): VesselSlotState =>
  ({ id, vesselId: 'V1', bay, row, tier, half: null, purpose: 'load', containerId: null, plannedContainerId: null }) as unknown as VesselSlotState

/** What a fresh scan of the slots and ROB boxes gives: cell key to the sorted occupant ids. */
function fresh(state: { vesselSlots: Record<string, VesselSlotState>; vessels: Record<string, { robBoxes?: { slotId: string; bay: number; row: number; tier: number }[] }> }, vesselId: string) {
  const out = new Map<number, string[]>()
  const add = (bay: number, row: number, tier: number, id: string) => {
    const k = cellKey(bay, row, tier)
    out.set(k, [...(out.get(k) ?? []), id].sort())
  }
  for (const b of state.vessels[vesselId]?.robBoxes ?? []) add(b.bay, b.row, b.tier, `rob:${b.slotId}`)
  for (const s of Object.values(state.vesselSlots)) if (s.vesselId === vesselId && s.containerId) add(s.bay, s.row, s.tier, s.id)
  return out
}

function held(state: Parameters<typeof vesselOccupancyOf>[0], vesselId: string) {
  const occ = vesselOccupancyOf(state, vesselId)
  const out = new Map<number, string[]>()
  let shared = 0
  for (const [k, list] of occ.cells) {
    out.set(k, list.map((o) => ('containerId' in o ? o.id : `rob:${o.slotId}`)).sort())
    if (list.length > 1) shared++
  }
  return { cells: out, shared }
}

describe('vessel occupancy map (#237)', () => {
  it('packs a cell into one integer and back', () => {
    expect(cellOfKey(cellKey(37, 19, 12))).toEqual({ bay: 37, row: 19, tier: 12 })
    expect(new Set([cellKey(1, 2, 3), cellKey(1, 3, 2), cellKey(2, 1, 3)]).size).toBe(3)
  })

  it('equals a fresh scan after boxes are placed, lifted and moved', () => {
    const slots: Record<string, VesselSlotState> = { a: slot('a', 1, 1, 1), b: slot('b', 1, 1, 2), c: slot('c', 3, 2, 1) }
    const state = { vesselSlots: slots, vessels: { V1: { robBoxes: [{ slotId: 'r', bay: 5, row: 1, tier: 1 }] } } } as unknown as Parameters<typeof vesselOccupancyOf>[0]
    const check = () => {
      const got = held(state, 'V1')
      expect(got.cells).toEqual(fresh(state as never, 'V1'))
      expect(got.shared).toBe([...got.cells.values()].filter((l) => l.length > 1).length)
    }
    check()
    for (const [id, box] of [['a', 'x1'], ['b', 'x2']] as const) {
      slots[id].containerId = box
      occupancySlotFilled(state, slots[id])
      check()
    }
    // a shared cell (two boxes in one cell) counts once
    slots.c.bay = 1
    slots.c.row = 1
    slots.c.tier = 2
    slots.c.containerId = 'x3'
    occupancySlotFilled(state, slots.c)
    check()
    expect(held(state, 'V1').shared).toBe(1)
    // lift and move
    slots.b.containerId = null
    occupancySlotCleared(state, slots.b)
    check()
    slots.c.containerId = null
    occupancySlotCleared(state, slots.c)
    slots.a.containerId = null
    occupancySlotCleared(state, slots.a)
    slots.b.containerId = 'x2'
    occupancySlotFilled(state, slots.b)
    check()
    // filling twice or clearing an absent slot changes nothing
    occupancySlotFilled(state, slots.b)
    occupancySlotCleared(state, slots.a)
    check()
    expect(held(state, 'V1').shared).toBe(0)
  })

  it('matches a fresh scan on a running scenario at 600, 1800 and 3600 s', () => {
    const sim = createSimulation(presets['Small automated'](), {}, { invariants: { sweepEvery: 25 } })
    const snap = sim.snapshot()
    sim.restore(snap, { adopt: true })
    const live = snap.state
    const vessels = Object.keys(live.vessels)
    for (const v of vessels) vesselOccupancyOf(live, v) // build the maps now, so every later change goes through the hooks
    for (const t of [600, 1800, 3600]) {
      sim.runUntil({ time: t })
      for (const v of vessels) expect(held(live, v).cells).toEqual(fresh(live, v))
    }
    expect(vessels.some((v) => held(live, v).cells.size > 0)).toBe(true)
  })
})

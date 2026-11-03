/**
 * Derived occupied-cell map per vessel (#237): which boxes sit in which stowage cell (bay, row, tier), with a numeric
 * cell key. The stowage invariants (stowage.no-floating, stowage.cell-free, hull.profile) used to rebuild a string-keyed
 * map of every filled slot of the touched vessels on every call (the main cost left after #234, and most of the GC).
 *
 * Not part of `SimState` (which stays plain JSON): cached per `vesselSlots` object, like `vesselSlotsOf`, built from a
 * scan on first use and kept current with `occupancySlotFilled` / `occupancySlotCleared` wherever a slot's `containerId`
 * is set or cleared, and `occupancySlotCleared` where a slot object is overwritten. A restored snapshot has a new
 * `vesselSlots` object, so a tampered snapshot is scanned afresh. ROB boxes (static per vessel) are part of the map.
 */
import type { RobBox } from '../scenario/robBays'
import type { SimState, VesselSlotState } from './state'
import { vesselSlotsOf } from './vesselSlotIndex'

/** A cell occupant: a filled slot, or a ROB box (which has no `containerId`). */
export type CellOccupant = VesselSlotState | RobBox

export interface VesselOccupancy {
  /** Cell key (see `cellKey`) to the occupants of that cell, in fill order (ROB boxes first). */
  readonly cells: Map<number, CellOccupant[]>
  /** Number of cells that hold two or more occupants. 0 means no cell is shared. */
  shared: number
}

type Slots = Pick<SimState, 'vesselSlots'>
type World = Slots & Pick<SimState, 'vessels'>

const cache = new WeakMap<object, Map<string, VesselOccupancy>>()

/** Bay, row and tier packed into one integer (bay, row and tier stay below 128 on every vessel class). */
export const cellKey = (bay: number, row: number, tier: number): number => (bay * 128 + row) * 128 + tier

/** Inverse of `cellKey`. */
export const cellOfKey = (key: number): { bay: number; row: number; tier: number } => ({ bay: Math.floor(key / 16384), row: Math.floor(key / 128) % 128, tier: key % 128 })

export const isSlotOccupant = (o: CellOccupant): o is VesselSlotState => 'containerId' in o

function put(occ: VesselOccupancy, bay: number, row: number, tier: number, o: CellOccupant): void {
  const key = cellKey(bay, row, tier)
  const list = occ.cells.get(key)
  if (!list) occ.cells.set(key, [o])
  else {
    if (list.includes(o)) return
    list.push(o)
    if (list.length === 2) occ.shared++
  }
}

function take(occ: VesselOccupancy, bay: number, row: number, tier: number, o: CellOccupant): void {
  const key = cellKey(bay, row, tier)
  const list = occ.cells.get(key)
  const i = list ? list.indexOf(o) : -1
  if (!list || i < 0) return
  list.splice(i, 1)
  if (list.length === 1) occ.shared--
  else if (list.length === 0) occ.cells.delete(key)
}

/** The occupied cells of one vessel (scanned from its slots and ROB boxes on first use, then kept current). */
export function vesselOccupancyOf(state: World, vesselId: string): VesselOccupancy {
  let index = cache.get(state.vesselSlots)
  if (!index) {
    index = new Map()
    cache.set(state.vesselSlots, index)
  }
  let occ = index.get(vesselId)
  if (!occ) {
    occ = { cells: new Map(), shared: 0 }
    for (const b of state.vessels[vesselId]?.robBoxes ?? []) put(occ, b.bay, b.row, b.tier, b)
    for (const s of vesselSlotsOf(state, vesselId)) if (s.containerId) put(occ, s.bay, s.row, s.tier, s)
    index.set(vesselId, occ)
  }
  return occ
}

/** Call after setting a vessel slot's `containerId` (no-op until the vessel's map is first built). */
export function occupancySlotFilled(state: Slots, slot: VesselSlotState): void {
  const occ = cache.get(state.vesselSlots)?.get(slot.vesselId)
  if (occ) put(occ, slot.bay, slot.row, slot.tier, slot)
}

/** Call after clearing a vessel slot's `containerId`, or after overwriting the slot with a new object (pass the old one). */
export function occupancySlotCleared(state: Slots, slot: VesselSlotState): void {
  const occ = cache.get(state.vesselSlots)?.get(slot.vesselId)
  if (occ) take(occ, slot.bay, slot.row, slot.tier, slot)
}

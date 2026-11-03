/**
 * Derived lookup over `state.vesselSlots` (#234): the slots of each vessel, in the order `Object.values` gives them.
 * The stowage invariants (stowage.no-floating, stowage.cell-free, hull.profile) check only the vessels an event touched,
 * but used to find those slots by scanning every slot of every vessel.
 *
 * Not part of `SimState` (which stays plain JSON): cached per `vesselSlots` object, like `yardIndexOf`, and kept current
 * with `indexVesselSlotAdded` / `indexVesselSlotRemoved` wherever a slot is added, replaced or removed. The index holds the slot
 * objects themselves and a slot's vessel never changes, so a `containerId` change needs no call.
 */
import type { SimState, VesselSlotState } from './state'

const cache = new WeakMap<object, Map<string, VesselSlotState[]>>()

type Slots = Pick<SimState, 'vesselSlots'>

/** The slots of one vessel, in creation order (the same order a filtered `Object.values(state.vesselSlots)` gives). */
export function vesselSlotsOf(state: Slots, vesselId: string): readonly VesselSlotState[] {
  let index = cache.get(state.vesselSlots)
  if (!index) {
    index = new Map()
    for (const s of Object.values(state.vesselSlots)) {
      const list = index.get(s.vesselId)
      if (list) list.push(s)
      else index.set(s.vesselId, [s])
    }
    cache.set(state.vesselSlots, index)
  }
  return index.get(vesselId) ?? []
}

/** Call after adding an entry to `state.vesselSlots`, or after overwriting one with a new object (no-op until the index is first built). */
export function indexVesselSlotAdded(state: Slots, slot: VesselSlotState, replaced?: VesselSlotState): void {
  const index = cache.get(state.vesselSlots)
  if (!index) return
  const list = index.get(slot.vesselId)
  if (!list) return void index.set(slot.vesselId, [slot])
  // an overwritten key keeps its place in `Object.values`
  const i = replaced ? list.indexOf(replaced) : -1
  if (i >= 0) list[i] = slot
  else list.push(slot)
}

/** Call after deleting an entry of `state.vesselSlots`. */
export function indexVesselSlotRemoved(state: Slots, slot: VesselSlotState): void {
  const list = cache.get(state.vesselSlots)?.get(slot.vesselId)
  const i = list ? list.indexOf(slot) : -1
  if (list && i >= 0) list.splice(i, 1)
}

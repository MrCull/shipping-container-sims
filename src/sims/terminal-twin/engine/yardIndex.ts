/**
 * Derived lookup over `state.yardSlots` (TT-19): slots per block and per column ("bay-row").
 * The yard of a TTI-scale scenario holds tens of thousands of slots, and the rehandle code asks
 * "what stands on / under this box" on every dispatch, so a whole-state scan there dominated the run.
 *
 * Not part of `SimState` (which stays plain JSON): the index is cached per `yardSlots` object and is
 * kept current with `indexYardSlotAdded` / `indexYardSlotRemoved` wherever a slot is added or removed. A slot's bay, row, tier and
 * span never change and the index holds the slot objects themselves, so a `containerId` change needs no call.
 */
import type { SimState, YardSlotState } from './state'

export interface YardIndex {
  byBlock: Map<string, YardSlotState[]>
  /** `${blockId}|${bay}-${row}` -> slots covering that column. */
  byColumn: Map<string, YardSlotState[]>
}

const cache = new WeakMap<object, YardIndex>()

export const columnKey = (blockId: string, bay: number, row: number): string => `${blockId}|${bay}-${row}`

function addTo(index: YardIndex, s: YardSlotState): void {
  let list = index.byBlock.get(s.blockId)
  if (!list) index.byBlock.set(s.blockId, (list = []))
  list.push(s)
  for (let k = 0; k < s.span; k++) {
    const key = columnKey(s.blockId, s.bay + k, s.row)
    const col = index.byColumn.get(key)
    if (col) col.push(s)
    else index.byColumn.set(key, [s])
  }
}

function removeFrom(list: YardSlotState[] | undefined, s: YardSlotState): void {
  const i = list ? list.indexOf(s) : -1
  if (list && i >= 0) list.splice(i, 1)
}

export function yardIndexOf(state: Pick<SimState, 'yardSlots'>): YardIndex {
  let index = cache.get(state.yardSlots)
  if (index) return index
  index = { byBlock: new Map(), byColumn: new Map() }
  for (const s of Object.values(state.yardSlots)) addTo(index, s)
  cache.set(state.yardSlots, index)
  return index
}

/** Call after adding an entry to `state.yardSlots` (no-op until the index is first built). */
export function indexYardSlotAdded(state: Pick<SimState, 'yardSlots'>, slot: YardSlotState): void {
  const index = cache.get(state.yardSlots)
  if (index) addTo(index, slot)
}

/** Call after deleting an entry of `state.yardSlots`. */
export function indexYardSlotRemoved(state: Pick<SimState, 'yardSlots'>, slot: YardSlotState): void {
  const index = cache.get(state.yardSlots)
  if (!index) return
  removeFrom(index.byBlock.get(slot.blockId), slot)
  for (let k = 0; k < slot.span; k++) removeFrom(index.byColumn.get(columnKey(slot.blockId, slot.bay + k, slot.row)), slot)
}

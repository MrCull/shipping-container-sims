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
import { yardBoxView } from './decisions/yardGrouping'
import type { YardBoxView } from './decisions/types'
import { boxSpan, parseYardSlotId } from './yardLayout'

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

/**
 * Length of every stack of a block (`YardStacks.stackSpans`), derived from what is in it: the span of the tier-1 box,
 * stacked or claimed (a claimed slot is in an ASC job, not yet in `yardSlots`). 0 = empty. Nothing is stored, so
 * the lock lifts the moment a stack's bottom box leaves.
 * `without`: a slot to leave out, for the block as it looks once that box has been lifted (rehandle targets).
 */
export function stackSpansOf(state: SimState, blockId: string, without?: YardSlotState): number[] {
  const yard = state.yardBlocks[blockId]
  const spans = new Array<number>(yard.bays * yard.rows).fill(0)
  const mark = (bay: number, row: number, span: number): void => {
    for (let k = 0; k < span; k++) spans[(bay + k - 1) * yard.rows + (row - 1)] = span
  }
  for (const s of yardIndexOf(state).byBlock.get(blockId) ?? []) if (s.tier === 1 && s.containerId && s !== without) mark(s.bay, s.row, s.span)
  for (const j of Object.values(state.ascJobs)) {
    if (j.blockId !== blockId) continue
    // a stacking job's `yardSlotId` is its claim; a retrieve job's and a rehandle job's is the box being lifted (already
    // in `yardSlots`, or gone after the lift), so only a rehandle's `targetSlotId` is a claim there
    for (const id of [j.kind === undefined ? j.yardSlotId : undefined, j.targetSlotId]) {
      if (!id || id === without?.id) continue
      const cell = parseYardSlotId(id)
      const box = state.containers[j.containerId]
      if (cell.blockId === blockId && cell.tier === 1 && box) mark(cell.bay, cell.row, boxSpan(box.size))
    }
  }
  return spans
}

/**
 * The top box of every stack of a block as the grouped yard strategy sees it (same indexing as `heights`; null =
 * empty): placed boxes and claimed slots, so a box still on its way counts. Derived from the stack contents, never stored.
 */
export function stackTopsOf(state: SimState, blockId: string): (YardBoxView | null)[] {
  const yard = state.yardBlocks[blockId]
  const tops = new Array<YardBoxView | null>(yard.bays * yard.rows).fill(null)
  const tiers = new Array<number>(yard.bays * yard.rows).fill(0)
  const put = (bay: number, row: number, tier: number, containerId: string): void => {
    const box = state.containers[containerId]
    if (!box) return
    const span = boxSpan(box.size)
    const view = yardBoxView(box)
    for (let k = 0; k < span; k++) {
      const i = (bay + k - 1) * yard.rows + (row - 1)
      if (i < tops.length && tier >= tiers[i]) {
        tiers[i] = tier
        tops[i] = view
      }
    }
  }
  for (const s of yardIndexOf(state).byBlock.get(blockId) ?? []) if (s.containerId) put(s.bay, s.row, s.tier, s.containerId)
  for (const j of Object.values(state.ascJobs)) {
    if (j.blockId !== blockId) continue
    for (const id of [j.kind === undefined ? j.yardSlotId : undefined, j.targetSlotId]) {
      if (!id) continue
      const cell = parseYardSlotId(id)
      if (cell.blockId === blockId) put(cell.bay, cell.row, cell.tier, j.containerId)
    }
  }
  return tops
}

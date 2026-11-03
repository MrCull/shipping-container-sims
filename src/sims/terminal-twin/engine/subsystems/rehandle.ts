/**
 * Rehandle helpers (TT-12): which boxes block an export retrieval, and where a
 * blocker may go. Pure functions of the engine state; the job flow (events,
 * decision, ASC cycle) lives in `asc.ts`.
 *
 * A box is "buried" when other boxes stand on top of it in the stack. Only a
 * box with nothing above it in any bay it covers can be lifted, so the blockers
 * go top first. A blocker is a legal rehandle only when it is physically
 * stacked (not a claimed slot an ASC has not filled yet) and no ASC is on its
 * way to retrieve it.
 */
import type { RehandleCandidate } from '../decisions/types'
import { compareKeys, loadSequenceKey } from '../../scenario/exportYard'
import type { ScenarioConfig } from '../../scenario/types'
import type { AscJob, SimState, YardSlotState } from '../state'
import { candidateSlots, reeferFields, stackIndex, type BlockSpec } from '../yardLayout'
import { columnKey, stackSpansOf, yardIndexOf } from '../yardIndex'

/** Columns ("bay-row") a slot covers. */
export const columnsOfSlot = (s: Pick<YardSlotState, 'bay' | 'row' | 'span'>): string[] =>
  s.span === 1 ? [`${s.bay}-${s.row}`] : [`${s.bay}-${s.row}`, `${s.bay + 1}-${s.row}`]

/** Boxes standing on `slot` (any bay it covers), top first (tier ↓, then bay, row). */
export function boxesAbove(state: SimState, slot: YardSlotState): YardSlotState[] {
  const { byColumn } = yardIndexOf(state)
  const found = new Set<YardSlotState>()
  for (let k = 0; k < slot.span; k++)
    for (const s of byColumn.get(columnKey(slot.blockId, slot.bay + k, slot.row)) ?? []) if (s.tier > slot.tier) found.add(s)
  return [...found].sort((a, b) => b.tier - a.tier || a.bay - b.bay || a.row - b.row)
}

/**
 * Everything that must leave before `slot` can be lifted, top first: the boxes on it, and
 * the boxes on those (a 40 ft box lying across two stacks drags in the boxes of its other bay).
 */
export function blockersOf(state: SimState, slot: YardSlotState): YardSlotState[] {
  const seen = new Map<string, YardSlotState>()
  const queue = [slot]
  while (queue.length > 0) {
    for (const above of boxesAbove(state, queue.shift() as YardSlotState)) {
      if (seen.has(above.id)) continue
      seen.set(above.id, above)
      queue.push(above)
    }
  }
  return [...seen.values()].sort((a, b) => b.tier - a.tier || a.bay - b.bay || a.row - b.row)
}

/** The retrieval's box slot, or null if the box is not standing in its slot (carried, or already moved). */
export function retrievalSlot(state: SimState, job: AscJob): YardSlotState | null {
  const slot = state.yardSlots[job.yardSlotId ?? '']
  return slot && slot.containerId === job.containerId ? slot : null
}

/**
 * The next box to rehandle for a blocked retrieval: the highest box above it that is
 * free on top and not about to be retrieved itself. Null when the retrieval is not
 * buried or the blockers cannot be moved yet (a claimed box is still on its way).
 */
export function nextBlocker(state: SimState, job: AscJob): YardSlotState | null {
  const slot = retrievalSlot(state, job)
  if (!slot) return null
  const yard = state.yardBlocks[slot.blockId]
  const taken = new Set(
    Object.values(state.ascJobs)
      // #188: a retrieval whose ascDispatch decision is pending is taken as well (its ASC is assigned a moment later): a blocker
      // that is itself such a retrieval would otherwise be rehandled by the other ASC while the first lifts it
      .filter((j) => j.kind === 'retrieve' && (j.ascId !== null || j.dispatch === 'asked'))
      .map((j) => j.containerId),
  )
  return (
    blockersOf(state, slot).find(
      (s) =>
        !taken.has(s.containerId ?? '') &&
        s.containerId !== null &&
        [...Array(s.span).keys()].every((k) => yard.heights[stackIndex(yard, s.bay + k, s.row)] === s.tier),
    ) ?? null
  )
}

/**
 * Retrieval ranks of the block's export boxes: 0 = the box the block must retrieve
 * first, in load sequence (vessel order, bay, hold before deck, tier, row, aft before fore).
 */
export function retrievalRanks(state: SimState, config: ScenarioConfig, blockId: string): Map<string, number> {
  const slotOfBox = new Map<string, (typeof state.vesselSlots)[string]>()
  for (const s of Object.values(state.vesselSlots)) if (s.plannedContainerId) slotOfBox.set(s.plannedContainerId, s)
  const vesselIndex = new Map(config.vessels.map((v, i) => [v.id, i]))
  const boxes: { id: string; key: number[] }[] = []
  for (const y of yardIndexOf(state).byBlock.get(blockId) ?? []) {
    if (!y.containerId) continue
    const vs = slotOfBox.get(y.containerId)
    if (!vs) continue // an import box: never retrieved
    boxes.push({ id: y.containerId, key: [vesselIndex.get(vs.vesselId) ?? 0, ...loadSequenceKey({ ...vs, half: vs.half })] })
  }
  boxes.sort((a, b) => compareKeys(a.key, b.key))
  return new Map(boxes.map((b, i) => [b.id, i]))
}

/** Vessel of the box directly below `tier` in the column, or null. */
function vesselBelow(state: SimState, blockId: string, bay: number, row: number, tier: number): string | null {
  const below = yardIndexOf(state)
    .byColumn.get(columnKey(blockId, bay, row))
    ?.find((s) => s.tier === tier - 1)
  return below?.containerId ? state.containers[below.containerId].vesselId : null
}

/**
 * The slots a blocker may be rehandled to: legal stack positions for its size, as the
 * block looks once the blocker is lifted, never in a stack that is being dug out
 * (the box to retrieve, or any box that has to move before it).
 */
export function rehandleCandidates(
  state: SimState,
  config: ScenarioConfig,
  block: BlockSpec,
  blocker: YardSlotState,
  digging: YardSlotState,
): RehandleCandidate[] {
  const yard = state.yardBlocks[block.id]
  const heights = yard.heights.slice()
  const tops = yard.topVessels.slice()
  for (let k = 0; k < blocker.span; k++) {
    const i = stackIndex(yard, blocker.bay + k, blocker.row)
    heights[i] = blocker.tier - 1
    tops[i] = vesselBelow(state, block.id, blocker.bay + k, blocker.row, blocker.tier)
  }
  const forbidden = new Set([digging, ...blockersOf(state, digging)].flatMap(columnsOfSlot))
  // a box a truck is coming for (TT-13) is never buried again: its stack is no target either (else digging for
  // one truck's box would bury the next truck's box, and the blockers would shuttle between the stacks). TT-183: only a
  // truck that holds a stall counts. A pick of a truck still queued at the gate forbade its stack too, so with a
  // queue of picks every stack of a block was forbidden: no blocker found a target, the retrieval stayed "full" and no
  // ASC moved again (the peak-day silent deadlock at B12)
  for (const job of Object.values(state.ascJobs)) {
    if (job.kind !== 'retrieve' || job.truckId === undefined || job.ascId !== null) continue
    if (state.trucks[job.truckId]?.stallId == null) continue
    const slot = state.yardSlots[job.yardSlotId ?? '']
    if (slot && slot.containerId === job.containerId) for (const c of columnsOfSlot(slot)) forbidden.add(c)
  }
  const ranks = retrievalRanks(state, config, block.id)
  const soonest = new Map<string, number>()
  for (const y of yardIndexOf(state).byBlock.get(block.id) ?? []) {
    if (!y.containerId) continue
    const rank = ranks.get(y.containerId)
    if (rank === undefined) continue
    for (const c of columnsOfSlot(y)) soonest.set(c, Math.min(soonest.get(c) ?? Infinity, rank))
  }
  const box = state.containers[blocker.containerId as string]
  const stacks = {
    blockId: block.id,
    bays: block.bays,
    rows: block.rows,
    tiers: block.tiers,
    size: box.size,
    blockX: block.x,
    firstBayZ: block.firstBayZ,
    wtpX: block.x,
    wtpZ: block.wtpZ,
    heights,
    topVessels: tops,
    stackSpans: stackSpansOf(state, block.id, blocker),
    ...reeferFields(block, box.reefer),
  }
  const out: RehandleCandidate[] = []
  for (const c of candidateSlots(stacks)) {
    const cols = columnsOfSlot({ bay: c.bay, row: c.row, span: c.span })
    if (cols.some((x) => forbidden.has(x))) continue
    let rank: number | null = null
    for (const x of cols) {
      const r = soonest.get(x)
      if (r !== undefined) rank = rank === null ? r : Math.min(rank, r)
    }
    out.push({ ...c, soonestRank: rank })
  }
  return out
}

/**
 * TT-185: do the rehandles a pick needs have target room? A pick-only truck is sent to its block only when this holds.
 * Counted in stack cells: every blocker above the box needs `span` cells (20 ft: one, 40 ft: two) of free height in a stack
 * that is not being dug out and that no truck holding a stall is coming for (the rule `rehandleCandidates` applies). A
 * box that is not standing in its slot, or has nothing above it, needs no room.
 */
export function rehandleRoomFor(state: SimState, block: BlockSpec, job: AscJob, admitting?: string): boolean {
  const slot = retrievalSlot(state, job)
  if (!slot) return true
  const blockers = blockersOf(state, slot)
  if (blockers.length === 0) return true
  const forbidden = new Set([slot, ...blockers].flatMap(columnsOfSlot))
  for (const other of Object.values(state.ascJobs)) {
    if (other === job || other.kind !== 'retrieve' || other.truckId === undefined || other.ascId !== null) continue
    if (state.trucks[other.truckId]?.stallId == null && other.truckId !== admitting) continue
    const s = state.yardSlots[other.yardSlotId ?? '']
    if (s && s.containerId === other.containerId) for (const c of columnsOfSlot(s)) forbidden.add(c)
  }
  // TT-215: the room is already promised to the picks of trucks that hold a stall of this block: their blockers still have
  // to go somewhere, and the stacks they are dug out of are no target either. Without this, each admitted pick saw the
  // same free cells and the picks together overcommitted the block (a deadlock on rehandle room)
  const spans = blockers.map((b) => b.span)
  for (const other of Object.values(state.ascJobs)) {
    if (other === job || other.kind !== 'retrieve' || other.truckId === undefined || other.blockId !== block.id) continue
    if (other.truckId === job.truckId || (state.trucks[other.truckId]?.stallId == null && other.truckId !== admitting)) continue
    const s = retrievalSlot(state, other)
    if (!s) continue
    for (const b of blockersOf(state, s)) {
      spans.push(b.span)
      for (const c of columnsOfSlot(b)) forbidden.add(c)
    }
  }
  return placesFor(state, block, spans, forbidden)
}

/**
 * Can boxes of these lengths all be stacked in the block's stacks outside `forbidden` (columns `bay-row`)? A greedy
 * packing under the stacking rules (`candidateSlots`): a stack takes the length of its bottom box, a 40 ft box needs
 * two neighbouring stacks of equal height and length (or both empty), up to the tier limit. 40 ft boxes go first and
 * prefer stacks already locked to their length, so empty stacks stay free for either length.
 */
function placesFor(state: SimState, block: BlockSpec, spans: number[], forbidden: Set<string>): boolean {
  const yard = state.yardBlocks[block.id]
  const lock = stackSpansOf(state, block.id)
  const height = yard.heights.slice()
  const ok = (bay: number, row: number): boolean => !forbidden.has(`${bay}-${row}`) && height[stackIndex(yard, bay, row)] < block.tiers
  for (const span of [...spans].sort((x, y) => y - x)) {
    let placed = false
    if (span === 1) {
      for (const want of [1, 0]) {
        for (let bay = 1; bay <= block.bays && !placed; bay++)
          for (let row = 1; row <= block.rows && !placed; row++) {
            const i = stackIndex(yard, bay, row)
            if (!ok(bay, row) || lock[i] !== want) continue
            height[i]++
            lock[i] = 1
            placed = true
          }
        if (placed) break
      }
    } else {
      for (const want of [2, 0]) {
        for (let bay = 1; bay < block.bays && !placed; bay++)
          for (let row = 1; row <= block.rows && !placed; row++) {
            const i = stackIndex(yard, bay, row)
            const j = stackIndex(yard, bay + 1, row)
            if (!ok(bay, row) || !ok(bay + 1, row) || lock[i] !== want || lock[j] !== want || height[i] !== height[j]) continue
            height[i]++
            height[j]++
            lock[i] = lock[j] = 2
            placed = true
          }
        if (placed) break
      }
    }
    if (!placed) return false
  }
  return true
}

/**
 * TT-215: may `truckId` (a pick-only truck) take a stall of `block` as far as the picks that already hold one are
 * concerned? Its box's stack stops being a rehandle target the moment it holds a stall, and its own blockers take room,
 * so each admitted pick that still has blockers to move must keep room with the truck counted as admitted.
 */
export function admittedPicksKeepRoom(state: SimState, block: BlockSpec, truckId: string): boolean {
  for (const other of Object.values(state.ascJobs)) {
    if (other.kind !== 'retrieve' || other.truckId === undefined || other.truckId === truckId || other.blockId !== block.id) continue
    if (state.trucks[other.truckId]?.stallId == null) continue
    if (!rehandleRoomFor(state, block, other, truckId)) return false
  }
  return true
}

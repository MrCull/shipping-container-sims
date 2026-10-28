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
import { candidateSlots, stackIndex, type BlockSpec } from '../yardLayout'

/** Columns ("bay-row") a slot covers. */
export const columnsOfSlot = (s: Pick<YardSlotState, 'bay' | 'row' | 'span'>): string[] =>
  s.span === 1 ? [`${s.bay}-${s.row}`] : [`${s.bay}-${s.row}`, `${s.bay + 1}-${s.row}`]

/** Boxes standing on `slot` (any bay it covers), top first (tier ↓, then bay, row). */
export function boxesAbove(state: SimState, slot: YardSlotState): YardSlotState[] {
  const mine = new Set(columnsOfSlot(slot))
  return Object.values(state.yardSlots)
    .filter((s) => s.blockId === slot.blockId && s.tier > slot.tier && columnsOfSlot(s).some((c) => mine.has(c)))
    .sort((a, b) => b.tier - a.tier || a.bay - b.bay || a.row - b.row)
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
      .filter((j) => j.kind === 'retrieve' && j.ascId !== null)
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
  for (const y of Object.values(state.yardSlots)) {
    if (y.blockId !== blockId || !y.containerId) continue
    const vs = slotOfBox.get(y.containerId)
    if (!vs) continue // an import box: never retrieved
    boxes.push({ id: y.containerId, key: [vesselIndex.get(vs.vesselId) ?? 0, ...loadSequenceKey({ ...vs, half: vs.half })] })
  }
  boxes.sort((a, b) => compareKeys(a.key, b.key))
  return new Map(boxes.map((b, i) => [b.id, i]))
}

/** Vessel of the box directly below `tier` in the column, or null. */
function vesselBelow(state: SimState, blockId: string, bay: number, row: number, tier: number): string | null {
  const below = Object.values(state.yardSlots).find(
    (s) => s.blockId === blockId && s.row === row && s.tier === tier - 1 && s.bay <= bay && bay < s.bay + s.span,
  )
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
  // one truck's box would bury the next truck's box, and the blockers would shuttle between the stacks)
  for (const job of Object.values(state.ascJobs)) {
    if (job.kind !== 'retrieve' || job.truckId === undefined || job.ascId !== null) continue
    const slot = state.yardSlots[job.yardSlotId ?? '']
    if (slot && slot.containerId === job.containerId) for (const c of columnsOfSlot(slot)) forbidden.add(c)
  }
  const ranks = retrievalRanks(state, config, block.id)
  const soonest = new Map<string, number>()
  for (const y of Object.values(state.yardSlots)) {
    if (y.blockId !== block.id || !y.containerId) continue
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


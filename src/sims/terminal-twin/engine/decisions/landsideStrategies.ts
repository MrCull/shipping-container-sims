/**
 * Built-in gateLaneAssignment and transferStallSelection strategies (TT-13).
 * Pure: request in, reply out; no randomness.
 */
import type {
  GateLaneAssignmentReply,
  GateLaneAssignmentRequest,
  TransferStallOption,
  TransferStallSelectionReply,
  TransferStallSelectionRequest,
} from './types'

/** The free inbound lane with the lowest index (west first). */
export function lowestFreeLane(req: GateLaneAssignmentRequest): GateLaneAssignmentReply {
  return { laneId: req.lanes.find((l) => l.free)?.laneId ?? null }
}

/** The free inbound lane that has processed the fewest trucks (ties: lowest index): spreads the work over the lanes. */
export function leastUsedLane(req: GateLaneAssignmentRequest): GateLaneAssignmentReply {
  const free = req.lanes.filter((l) => l.free)
  free.sort((a, b) => a.processed - b.processed || a.index - b.index)
  return { laneId: free[0]?.laneId ?? null }
}

const isFree = (s: TransferStallOption) => s.occupiedBy === null

/**
 * Stalls of the block that holds the box to pick (so the ASC does not carry it across the yard); a truck that only
 * drops goes to the free stall nearest the gate. Within a block: the stall nearest the gate, then the lowest id.
 */
export function nearestToBoxStall(req: TransferStallSelectionRequest): TransferStallSelectionReply {
  const free = req.stalls.filter(isFree)
  const pickBlocks = new Set(req.legs.flatMap((l) => (l.kind === 'pick' && l.blockId ? [l.blockId] : [])))
  const preferred = free.filter((s) => pickBlocks.has(s.blockId))
  const pool = preferred.length > 0 ? preferred : free
  pool.sort((a, b) => a.distanceM - b.distanceM || (a.stallId < b.stallId ? -1 : 1))
  return { stallId: pool[0]?.stallId ?? null }
}

/**
 * Spread the trucks over the blocks: a free stall in the block with the fewest trucks holding or waiting for a stall
 * (ties: nearest the gate), whatever the box and the transaction.
 */
export function leastLoadedBlockStall(req: TransferStallSelectionRequest): TransferStallSelectionReply {
  const free = req.stalls.filter(isFree)
  free.sort(
    (a, b) =>
      (req.blockLoad[a.blockId] ?? 0) - (req.blockLoad[b.blockId] ?? 0) ||
      a.distanceM - b.distanceM ||
      (a.stallId < b.stallId ? -1 : 1),
  )
  return { stallId: free[0]?.stallId ?? null }
}

/**
 * Built-in emptyAllocation strategies (TT-11). Pure: request in, reply out.
 */
import type { EmptyAllocationReply, EmptyAllocationRequest, EmptyCandidate } from './types'

const byId = (a: EmptyCandidate, b: EmptyCandidate): number => (a.containerId < b.containerId ? -1 : 1)

function take(req: EmptyAllocationRequest, order: (a: EmptyCandidate, b: EmptyCandidate) => number): EmptyAllocationReply {
  return { containerIds: [...req.candidates].sort((a, b) => order(a, b) || byId(a, b)).slice(0, req.count).map((c) => c.containerId) }
}

/** The empties nearest the WTP pads (shortest ASC and SHC trips), lowest tier first. */
export function nearestWtpEmpties(req: EmptyAllocationRequest): EmptyAllocationReply {
  return take(req, (a, b) => a.distanceM - b.distanceM || a.tier - b.tier)
}

/** The empties that have stood in the yard longest (first in, first out). */
export function oldestFirstEmpties(req: EmptyAllocationRequest): EmptyAllocationReply {
  return take(req, (a, b) => a.yardSince - b.yardSince)
}

/**
 * `iso-type-best-position` (spec #106): the candidates already match the requested ISO type (and the line, with
 * `matchLine`; the engine filters). Picks the best yard positions one by one: fewest boxes on top, then the block
 * serving the vessel (rank 0) and the nearest its WTP pad, then next to an empty already allocated or picked (the ASC
 * takes them in consecutive moves), then container id. Replies in load order: boxes standing higher in a stack first,
 * so no pick is buried under a later one.
 */
export function isoTypeBestPositionEmpties(req: EmptyAllocationRequest): EmptyAllocationReply {
  const left = [...req.candidates]
  const picked: EmptyCandidate[] = []
  const neighbours = (a: EmptyCandidate, b: EmptyCandidate): boolean =>
    a.blockId === b.blockId && a.containerId !== b.containerId && Math.abs(a.row - b.row) <= 1 && Math.abs(a.bay - b.bay) <= 2
  const adjacency = (c: EmptyCandidate): number => (c.adjacentAllocated ?? 0) + picked.filter((p) => neighbours(c, p)).length
  while (picked.length < req.count && left.length > 0) {
    left.sort(
      (a, b) =>
        (a.boxesOnTop ?? 0) - (b.boxesOnTop ?? 0) ||
        (a.blockRank ?? 0) - (b.blockRank ?? 0) ||
        a.distanceM - b.distanceM ||
        adjacency(b) - adjacency(a) ||
        byId(a, b),
    )
    picked.push(left.shift() as EmptyCandidate)
  }
  const order = new Map(picked.map((c, i) => [c.containerId, i]))
  picked.sort((a, b) => (a.boxesOnTop ?? 0) - (b.boxesOnTop ?? 0) || (order.get(a.containerId) as number) - (order.get(b.containerId) as number))
  return { containerIds: picked.map((c) => c.containerId) }
}

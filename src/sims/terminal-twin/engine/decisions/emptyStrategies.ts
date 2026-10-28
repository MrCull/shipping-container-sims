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

/**
 * Built-in yardAllocation strategies (TT-06). Each picks a slot from
 * `candidateSlots(request)`; all are pure (randomness comes from `request.random`).
 */
import { candidateSlots, type YardCandidate } from '../yardLayout'
import type { YardAllocationReply, YardAllocationRequest } from './types'

/** Extra cost per tier (m of plan distance): spreads boxes over nearby stacks before stacking high. */
const TIER_COST_M = 6

/**
 * Bay pairs: bays (1,2), (3,4), ... A 40 ft box prefers an aligned pair (anchor on an odd bay) and a 20 ft box
 * prefers not to open a stack in a pair whose two stacks are both empty, so 20 ft and 40 ft areas form naturally.
 * Costs in m of plan distance: a preference, not zoning (every legal slot stays available).
 */
const MISALIGNED_40_COST_M = 30
const BREAK_EMPTY_PAIR_COST_M = 12

function pairingCost(req: YardAllocationRequest, c: YardCandidate): number {
  if (c.span === 2) return c.bay % 2 === 1 ? 0 : MISALIGNED_40_COST_M
  if (c.tier > 1) return 0
  const mate = c.bay % 2 === 1 ? c.bay + 1 : c.bay - 1
  if (mate < 1 || mate > req.bays) return 0
  return req.heights[(mate - 1) * req.rows + (c.row - 1)] === 0 ? BREAK_EMPTY_PAIR_COST_M : 0
}

const none: YardAllocationReply = { slotId: null }

/** Candidate with the lowest cost; ties by bay, row, tier. */
function cheapest(list: YardCandidate[], cost: (c: YardCandidate) => number): YardCandidate | null {
  let best: YardCandidate | null = null
  let bestCost = Infinity
  for (const c of list) {
    const k = cost(c)
    if (k < bestCost - 1e-9) {
      best = c
      bestCost = k
    }
  }
  return best
}

export function randomSlot(req: YardAllocationRequest): YardAllocationReply {
  const list = candidateSlots(req)
  if (list.length === 0) return none
  return { slotId: list[Math.min(list.length - 1, Math.floor(req.random * list.length))].slotId }
}

export function nearestWtpSlot(req: YardAllocationRequest): YardAllocationReply {
  const best = cheapest(candidateSlots(req), (c) => c.distanceM + TIER_COST_M * (c.tier - 1) + pairingCost(req, c))
  return { slotId: best?.slotId ?? null }
}

/**
 * Keep a vessel's boxes together: first on top of this vessel's own stacks
 * (lowest bay first), then in a bay holding only this vessel's boxes, then in
 * the lowest empty bay; otherwise like nearest-wtp.
 */
export function groupByVesselSlot(req: YardAllocationRequest): YardAllocationReply {
  const list = candidateSlots(req)
  const mine = (c: YardCandidate) => c.bayVesselIds.includes(req.vesselId)
  const own = list.filter((c) => c.bayVesselIds.length > 0 && c.bayVesselIds.every((v) => v === req.vesselId))
  const sameBay = own.length > 0 ? cheapest(own, (c) => c.bay * 1000 + c.tier * 20 + c.row) : null
  if (sameBay) return { slotId: sameBay.slotId }
  const empty = list.filter((c) => c.bayVesselIds.length === 0)
  const fresh = cheapest(empty, (c) => c.bay * 1000 + c.tier * 20 + c.row)
  if (fresh) return { slotId: fresh.slotId }
  const shared = cheapest(list.filter(mine), (c) => c.bay * 1000 + c.tier * 20 + c.row)
  if (shared) return { slotId: shared.slotId }
  return nearestWtpSlot(req)
}

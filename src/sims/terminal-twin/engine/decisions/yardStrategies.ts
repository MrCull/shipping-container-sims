/**
 * Built-in yardAllocation strategies (TT-06). Each picks a slot from
 * `candidateSlots(request)`; all are pure (randomness comes from `request.random`).
 */
import { candidateSlots, type YardCandidate } from '../yardLayout'
import type { YardAllocationReply, YardAllocationRequest } from './types'

/** Extra cost per tier (m of plan distance): spreads boxes over nearby stacks before stacking high. */
const TIER_COST_M = 6

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
  const best = cheapest(candidateSlots(req), (c) => c.distanceM + TIER_COST_M * (c.tier - 1))
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

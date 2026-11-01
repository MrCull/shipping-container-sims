/**
 * Built-in yardAllocation strategies (TT-06). Each picks a slot from
 * `candidateSlots(request)`; all are pure (randomness comes from `request.random`).
 */
import { candidateSlots, type YardCandidate } from '../yardLayout'
import { yardGroupBreak, yardGroupKey } from './yardGrouping'
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

/** Cost of a plain box taking a powered row (m of plan distance): plugs stay free for reefers when anything else fits (R19). */
const POWERED_ROW_COST_M = 60

function poweredRowCost(req: YardAllocationRequest, c: YardCandidate): number {
  return !req.reefer && req.poweredRows?.includes(c.row) ? POWERED_ROW_COST_M : 0
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
  const best = cheapest(candidateSlots(req), (c) => c.distanceM + TIER_COST_M * (c.tier - 1) + pairingCost(req, c) + poweredRowCost(req, c))
  return { slotId: best?.slotId ?? null }
}

/**
 * Keep a vessel's boxes together: first on top of this vessel's own stacks
 * (lowest bay first), then in a bay holding only this vessel's boxes, then in
 * the lowest empty bay; otherwise like nearest-wtp. The `grouped` strategy's fallback for a box without
 * properties (the pre-fill: its boxes do not exist yet).
 */
function vesselGroupedSlot(req: YardAllocationRequest): YardAllocationReply {
  // a plain box keeps out of the powered rows while anything else fits (R19; the pre-fill would otherwise fill the plugs, #114)
  const all = candidateSlots(req)
  const unpowered = req.reefer ? all : all.filter((c) => !req.poweredRows?.includes(c.row))
  const list = unpowered.length > 0 ? unpowered : all
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

/** Costs of a grouping mismatch (m of plan distance, like the other preferences): they outweigh a few bays of walking, never a slot's legality. */
const MIXED_STACK_COST_M = 90
const ORDER_BROKEN_COST_M = 45
const FOREIGN_BAY_COST_M = 25
const OWN_BAY_BONUS_M = 10

/**
 * Group boxes (spec #106, #111): imports by line (earlier planned departure higher), exports by outbound vessel and
 * POD (heavy at the bottom), transshipment boxes by onward vessel and POD, storage empties by line, size and type.
 * Prices every legal slot like nearest-wtp and adds the cost of the grouping preferences it would break: standing
 * on another group's box, standing in the wrong order, or opening a stack in a bay of other groups. A mismatch
 * costs score and never removes a slot, so a slot is found whenever one is legal. A request without box
 * properties (the pre-fill) falls back to keeping a vessel's boxes together.
 */
export function groupedSlot(req: YardAllocationRequest): YardAllocationReply {
  const box = req.box
  const tops = req.stackTops
  if (!box || !tops) return vesselGroupedSlot(req)
  const key = yardGroupKey(box)
  const topKeys = tops.map((t) => (t ? yardGroupKey(t) : null))
  const cost = (c: YardCandidate): number => {
    let group = 0
    if (c.tier > 1) {
      for (let k = 0; k < c.span; k++) {
        const below = tops[(c.bay + k - 1) * req.rows + (c.row - 1)]
        if (below) group = Math.max(group, { none: 0, order: ORDER_BROKEN_COST_M, mixed: MIXED_STACK_COST_M }[yardGroupBreak(box, below)])
      }
    } else {
      // opening a stack: prefer a bay that already holds this group, avoid a bay of other groups
      let foreign = false
      let own = false
      for (let b = 0; b < c.span; b++)
        for (let r = 1; r <= req.rows; r++) {
          const t = topKeys[(c.bay + b - 1) * req.rows + (r - 1)]
          if (t === null) continue
          if (t === key) own = true
          else foreign = true
        }
      group = own ? -OWN_BAY_BONUS_M : foreign ? FOREIGN_BAY_COST_M : 0
    }
    return c.distanceM + TIER_COST_M * (c.tier - 1) + pairingCost(req, c) + poweredRowCost(req, c) + group
  }
  const sameGroup = (c: YardCandidate): boolean => {
    if (c.tier === 1) return true
    for (let k = 0; k < c.span; k++) {
      const below = tops[(c.bay + k - 1) * req.rows + (c.row - 1)]
      if (below && yardGroupKey(below) !== key) return false
    }
    return true
  }
  const candidates = candidateSlots(req)
  return { slotId: cheapest(req.sameGroupOnly ? candidates.filter(sameGroup) : candidates, cost)?.slotId ?? null }
}

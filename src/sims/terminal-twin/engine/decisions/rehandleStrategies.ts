/**
 * Built-in rehandleTarget strategies (TT-12). Pure: request in, reply out.
 */
import type { RehandleCandidate, RehandleTargetReply, RehandleTargetRequest } from './types'

/** Plan distance from the blocker's current stack. */
const distance = (req: RehandleTargetRequest, c: RehandleCandidate): number =>
  Math.abs(c.x - req.from.x) + Math.abs(c.z - req.from.z)

function cheapest(list: RehandleCandidate[], cost: (c: RehandleCandidate) => number): RehandleTargetReply {
  let best: RehandleCandidate | null = null
  let bestCost = Infinity
  for (const c of list) {
    const k = cost(c)
    if (k < bestCost - 1e-9) {
      best = c
      bestCost = k
    }
  }
  return { slotId: best?.slotId ?? null }
}

/** The legal slot nearest the blocker's stack (fewest metres for the ASC); ties: low tier, then bay, row. */
export function nearestValidRehandle(req: RehandleTargetRequest): RehandleTargetReply {
  return cheapest(req.candidates, (c) => distance(req, c) * 1000 + c.tier * 100 + c.bay * 10 + c.row)
}

/**
 * Whether the box would bury a box that is retrieved before it: a stack holding
 * a box needed sooner than the blocker itself. A blocker never retrieved
 * (rank null) buries every box that will be retrieved.
 */
const buries = (req: RehandleTargetRequest, c: RehandleCandidate): boolean =>
  c.soonestRank !== null && (req.retrievalRank === null || c.soonestRank < req.retrievalRank)

/**
 * Keep future retrievals free: prefer a stack where the box buries nothing that is
 * retrieved before it (empty stacks and import-only stacks first, then stacks whose
 * boxes leave later than this one); if every slot buries something, bury the box
 * needed latest. Ties: low tier, then nearest.
 */
export function minFutureRehandles(req: RehandleTargetRequest): RehandleTargetReply {
  const burying = (c: RehandleCandidate): number => (buries(req, c) ? 1 : 0)
  const lateness = (c: RehandleCandidate): number => (burying(c) ? -(c.soonestRank as number) : 0)
  return cheapest(req.candidates, (c) => burying(c) * 1e9 + lateness(c) * 1e5 + c.tier * 1000 + distance(req, c) / 1000)
}

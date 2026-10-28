/**
 * Built-in strategy registry: 1–3 named strategies per decision point,
 * selected per scenario with `config.decisions.points.<dp>.strategy`.
 *
 * Built-in strategies are synchronous and pure (request + query → reply), so
 * they resolve within the same event step and both async modes give
 * identical runs. A strategy that needs randomness must take it from the
 * request, never from Math.random.
 */
import { groupByVesselSlot, nearestWtpSlot, randomSlot } from './yardStrategies'
import { balancedMovesSplit, bestFitBerth, equalBaysSplit, firstFitBerth } from './quayStrategies'
import type { DecisionHandler, DecisionPointId, HandlerSet, ShcDispatchPad, ShcDispatchRequest } from './types'

const isFree = (p: ShcDispatchPad) => p.occupiedBy === null && p.claimedBy === null

/** First free pad in list order. */
function firstFreePad(req: ShcDispatchRequest): string | null {
  return req.wtpPads.find(isFree)?.id ?? null
}

/** Free pad closest (plan distance) to a point; ties by list order. */
function nearestFreePad(req: ShcDispatchRequest, x: number, z: number): string | null {
  let best: ShcDispatchPad | null = null
  let bestD = Infinity
  for (const p of req.wtpPads) {
    if (!isFree(p)) continue
    const d = Math.abs(p.x - x) + Math.abs(p.z - z)
    if (d < bestD - 1e-9) {
      best = p
      bestD = d
    }
  }
  return best?.id ?? null
}

export interface StrategyDefinition<K extends DecisionPointId> {
  description: string
  handler: DecisionHandler<K>
}

export interface DecisionPointStrategies<K extends DecisionPointId> {
  /** Used when the scenario names no strategy, and as the default fallback. */
  default: string
  strategies: Record<string, StrategyDefinition<K>>
}

export type StrategyRegistry = { [K in DecisionPointId]: DecisionPointStrategies<K> }

export const strategies: StrategyRegistry = {
  stsGroundPosition: {
    default: 'lowest-free-lane',
    strategies: {
      'lowest-free-lane': {
        description: 'Free ground position nearest the quay (lowest lane).',
        handler: (msg) => ({
          groundPositionId: msg.payload.groundPositions.find((gp) => gp.occupiedBy === null)?.id ?? null,
        }),
      },
      'highest-free-lane': {
        description: 'Free ground position farthest from the quay (highest lane).',
        handler: (msg) => ({
          groundPositionId:
            [...msg.payload.groundPositions].reverse().find((gp) => gp.occupiedBy === null)?.id ?? null,
        }),
      },
    },
  },
  shcDispatch: {
    default: 'oldest-job',
    strategies: {
      'oldest-job': {
        description: 'Oldest open job first (FIFO by grounding time); first free WTP pad.',
        handler: (msg) => {
          const job = [...msg.payload.jobs].sort((a, b) => a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1))[0]
          const pad = job ? firstFreePad(msg.payload) : null
          return job && pad ? { jobId: job.jobId, wtpPadId: pad } : { jobId: null, wtpPadId: null }
        },
      },
      'nearest-job': {
        description: 'Nearest open job by route length; the free WTP pad nearest to that box.',
        handler: (msg) => {
          const job = [...msg.payload.jobs].sort(
            (a, b) => a.distanceM - b.distanceM || a.readyAt - b.readyAt || (a.jobId < b.jobId ? -1 : 1),
          )[0]
          const pad = job ? nearestFreePad(msg.payload, job.x, job.z) : null
          return job && pad ? { jobId: job.jobId, wtpPadId: pad } : { jobId: null, wtpPadId: null }
        },
      },
    },
  },
  yardAllocation: {
    default: 'nearest-wtp',
    strategies: {
      random: {
        description: 'A random legal slot (from the seeded RNG).',
        handler: (msg) => randomSlot(msg.payload),
      },
      'nearest-wtp': {
        description: 'The legal slot nearest the WTP pad, spreading over low tiers before stacking high.',
        handler: (msg) => nearestWtpSlot(msg.payload),
      },
      'group-by-vessel': {
        description: "Keeps a vessel's boxes together: its own bays first, then the lowest empty bay.",
        handler: (msg) => groupByVesselSlot(msg.payload),
      },
    },
  },
  berthAllocation: {
    default: 'first-fit',
    strategies: {
      'first-fit': {
        description: 'Lowest stern position along the quay where the vessel fits.',
        handler: (msg) => firstFitBerth(msg.payload),
      },
      'best-fit': {
        description: 'The free quay gap that leaves the least unused length.',
        handler: (msg) => bestFitBerth(msg.payload),
      },
    },
  },
  craneSplit: {
    default: 'balanced-moves',
    strategies: {
      'balanced-moves': {
        description: 'Up to max STS free cranes nearest the vessel; contiguous bay ranges with near-equal moves.',
        handler: (msg) => balancedMovesSplit(msg.payload),
      },
      'equal-bays': {
        description: 'Up to max STS free cranes nearest the vessel; contiguous bay ranges with equal numbers of bays.',
        handler: (msg) => equalBaysSplit(msg.payload),
      },
    },
  },
}

/** Look up a built-in strategy; throws with the available names if unknown. */
export function getStrategy<K extends DecisionPointId>(dp: K, name: string): DecisionHandler<K> {
  const entry = strategies[dp] as DecisionPointStrategies<K>
  const s = entry.strategies[name]
  if (!s) throw new Error(`Unknown ${dp} strategy "${name}" (available: ${Object.keys(entry.strategies).join(', ')})`)
  return s.handler
}

/** Each decision point's default strategy. */
export const defaultHandlers: HandlerSet = {
  stsGroundPosition: getStrategy('stsGroundPosition', strategies.stsGroundPosition.default),
  shcDispatch: getStrategy('shcDispatch', strategies.shcDispatch.default),
  yardAllocation: getStrategy('yardAllocation', strategies.yardAllocation.default),
  berthAllocation: getStrategy('berthAllocation', strategies.berthAllocation.default),
  craneSplit: getStrategy('craneSplit', strategies.craneSplit.default),
}

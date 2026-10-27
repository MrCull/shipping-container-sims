/**
 * Built-in strategy registry: 1–3 named strategies per decision point,
 * selected per scenario with `config.decisions.points.<dp>.strategy`.
 *
 * Built-in strategies are synchronous and pure (request + query → reply), so
 * they resolve within the same event step and both async modes give
 * identical runs. A strategy that needs randomness must take it from the
 * request, never from Math.random.
 */
import { balancedMovesSplit, bestFitBerth, equalBaysSplit, firstFitBerth } from './quayStrategies'
import type { DecisionHandler, DecisionPointId, HandlerSet } from './types'

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
  berthAllocation: getStrategy('berthAllocation', strategies.berthAllocation.default),
  craneSplit: getStrategy('craneSplit', strategies.craneSplit.default),
}

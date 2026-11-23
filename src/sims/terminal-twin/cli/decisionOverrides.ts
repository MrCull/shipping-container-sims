/**
 * Strategy, param and latency overrides per decision point, merged into `decisions.points`: shared by `tt:run`
 * (`--strategy`, `--param`, `--latency`) and experiment configs (`strategies`, `params`, `latency`), so both validate
 * and merge the same way.
 */
import {
  DECISION_POINT_IDS,
  getStrategy,
  resolveStrategyParams,
  strategies as builtInStrategies,
  type DecisionPointId,
  type DecisionsConfig,
} from '../engine'
import { parseLatencySpec } from './latencySpec'

export type DecisionPoints = NonNullable<DecisionsConfig['points']>

export interface DecisionOverrides {
  strategies?: Record<string, string>
  params?: Record<string, Record<string, number>>
  latency?: Record<string, string>
}

/**
 * Apply strategies, then params (checked against each point's strategy after the overrides), then latency, over
 * `base`. A problem throws `fail(field, message)`, the field being `strategies.<dp>`, `params.<dp>[.<name>]` or
 * `latency.<dp>`.
 */
export function applyDecisionOverrides(
  base: DecisionPoints | undefined,
  overrides: DecisionOverrides,
  fail: (field: string, message: string) => Error,
): DecisionPoints {
  const points = { ...base } as DecisionPoints
  const point = (field: string, dp: string) => {
    if (!DECISION_POINT_IDS.includes(dp as DecisionPointId))
      throw fail(field, `Unknown decision point "${dp}" (decision points: ${DECISION_POINT_IDS.join(', ')})`)
    return dp as DecisionPointId
  }
  for (const [dp, strategy] of Object.entries(overrides.strategies ?? {})) {
    const id = point(`strategies.${dp}`, dp)
    try {
      getStrategy(id, strategy)
    } catch (err) {
      throw fail(`strategies.${dp}`, (err as Error).message)
    }
    points[id] = { ...points[id], strategy }
  }
  for (const [dp, params] of Object.entries(overrides.params ?? {})) {
    const id = point(`params.${dp}`, dp)
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw fail(`params.${dp}`, 'must map param names to numbers')
    const strategy = points[id]?.strategy ?? builtInStrategies[id].default
    const merged: Record<string, number> = { ...points[id]?.params }
    for (const [name, value] of Object.entries(params)) {
      try {
        resolveStrategyParams(id, strategy, { [name]: value })
      } catch (err) {
        throw fail(`params.${dp}.${name}`, (err as Error).message)
      }
      merged[name] = value
    }
    points[id] = { ...points[id], params: merged }
  }
  for (const [dp, spec] of Object.entries(overrides.latency ?? {})) {
    const id = point(`latency.${dp}`, dp)
    let parsed: ReturnType<typeof parseLatencySpec>
    try {
      parsed = parseLatencySpec(spec)
    } catch (err) {
      throw fail(`latency.${dp}`, (err as Error).message)
    }
    points[id] = { ...points[id], latency: parsed.latency, ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }) }
  }
  return points
}

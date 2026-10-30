/**
 * Latency injector: decides, per call, how late a decision's reply arrives
 * and whether it times out or errors. Draws come from the decision RNG
 * stream (`SimState.decisions.rngState`), never from the main RNG, so
 * injecting latency in pause mode leaves the rest of the run unchanged.
 */
import { nextRandom } from '../rng'
import type { LatencyDelay, LatencySpec } from './types'

export type Injection =
  | { kind: 'reply'; delayMs: number }
  | { kind: 'error'; delayMs: number }
  /** The reply never arrives; the engine gives up after timeoutMs. */
  | { kind: 'timeout' }

export type DecisionRng = () => number

/** Create a draw function over a state holder (the stream state is plain JSON). */
export function decisionRng(holder: { rngState: number }): DecisionRng {
  return () => {
    const [value, next] = nextRandom(holder.rngState)
    holder.rngState = next
    return value
  }
}

function drawDelay(delay: LatencyDelay | undefined, random: DecisionRng): number {
  switch (delay?.kind ?? 'none') {
    case 'fixed':
      return (delay as { ms: number }).ms
    case 'uniform': {
      const d = delay as { minMs: number; maxMs: number }
      return d.minMs + random() * (d.maxMs - d.minMs)
    }
    case 'exponential':
      return -Math.log(1 - random()) * (delay as { meanMs: number }).meanMs
    default:
      return 0
  }
}

/** No spec = no draws at all, so un-injected runs consume nothing. */
export function drawInjection(spec: LatencySpec | undefined, timeoutMs: number, random: DecisionRng): Injection {
  if (!spec) return { kind: 'reply', delayMs: 0 }
  if (spec.timeoutPct && random() * 100 < spec.timeoutPct) return { kind: 'timeout' }
  const errored = !!spec.errorPct && random() * 100 < spec.errorPct
  const delayMs = drawDelay(spec.delay, random)
  if (delayMs >= timeoutMs) return { kind: 'timeout' }
  return { kind: errored ? 'error' : 'reply', delayMs }
}

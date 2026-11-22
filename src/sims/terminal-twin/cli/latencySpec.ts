/**
 * The latency spec syntax shared by `tt:run --latency <dp>=<spec>` and an experiment config's `latency` shorthand:
 * `none | fixed:<ms> | uniform:<min>-<max> | exp:<mean>`, then optional `,timeout:<pct>`, `,error:<pct>`, `,timeoutMs:<ms>`.
 */
import type { LatencySpec } from '../engine'

/** Parse one latency spec; throws `Error('Bad latency spec "<text>"')` on anything else. */
export function parseLatencySpec(text: string): { latency: LatencySpec; timeoutMs?: number } {
  const bad = () => new Error(`Bad latency spec "${String(text)}"`)
  if (typeof text !== 'string') throw bad()
  const num = (s: string | undefined) => {
    const n = Number(s)
    if (s === undefined || s === '' || !Number.isFinite(n) || n < 0) throw bad()
    return n
  }
  const [delay, ...extras] = text.split(',')
  const [kind, arg] = delay.split(':')
  const latency: LatencySpec = {}
  if (kind === 'none') latency.delay = { kind: 'none' }
  else if (kind === 'fixed') latency.delay = { kind: 'fixed', ms: num(arg) }
  else if (kind === 'exp') latency.delay = { kind: 'exponential', meanMs: num(arg) }
  else if (kind === 'uniform') {
    const [min, max] = (arg ?? '').split('-')
    latency.delay = { kind: 'uniform', minMs: num(min), maxMs: num(max) }
  } else throw bad()
  let timeoutMs: number | undefined
  for (const extra of extras) {
    const [key, value] = extra.split(':')
    if (key === 'timeout') latency.timeoutPct = num(value)
    else if (key === 'error') latency.errorPct = num(value)
    else if (key === 'timeoutMs') timeoutMs = num(value)
    else throw bad()
  }
  return { latency, timeoutMs }
}

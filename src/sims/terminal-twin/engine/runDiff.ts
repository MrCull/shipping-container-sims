/**
 * Run diff: find the first event at which two event logs differ (two seeds,
 * two strategies or two code versions). Events are compared in `seq` order
 * by their full JSON envelope (without the measured wall latency).
 */
import type { EngineEvent } from './events'

export interface RunDiffOptions {
  /** Events of context to include before and after the divergence (default 3). */
  context?: number
}

export type RunDiff =
  | {
      diverged: false
      /** Number of identical events (= length of both logs). */
      commonEvents: number
    }
  | {
      diverged: true
      /** Number of identical leading events. */
      commonEvents: number
      /** Sequence number of the first diverging event. */
      seq: number
      /** The diverging event in each run (null if that run has no event at `seq`). */
      a: EngineEvent | null
      b: EngineEvent | null
      /** Dotted paths of the fields that differ (`type`, `t`, `payload.groundPositionId`, …). */
      differences: string[]
      /** Identical events just before the divergence. */
      before: EngineEvent[]
      /** Events just after the diverging one, per run. */
      afterA: EngineEvent[]
      afterB: EngineEvent[]
    }

/** JSON for comparing events: a measured wall latency (DecisionResolved) is not reproducible, so it never counts as a difference. */
const comparable = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'wallLatencyMs' ? undefined : v))
const same = (x: unknown, y: unknown): boolean => comparable(x) === comparable(y)

/** Dotted paths at which two JSON values differ (leaf-most). */
export function jsonDifferences(a: unknown, b: unknown, path = ''): string[] {
  if (same(a, b)) return []
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [path || '(root)']
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  return keys.flatMap((k) => jsonDifferences(a[k], b[k], path ? `${path}.${k}` : k))
}

export function diffEventLogs(
  a: readonly EngineEvent[],
  b: readonly EngineEvent[],
  options: RunDiffOptions = {},
): RunDiff {
  const context = options.context ?? 3
  const n = Math.max(a.length, b.length)
  let i = 0
  while (i < n && i < a.length && i < b.length && same(a[i], b[i])) i++
  if (i === n) return { diverged: false, commonEvents: n }
  const evA = a[i] ?? null
  const evB = b[i] ?? null
  return {
    diverged: true,
    commonEvents: i,
    seq: evA?.seq ?? evB?.seq ?? i,
    a: evA,
    b: evB,
    differences: evA && evB ? jsonDifferences(evA, evB) : ['(missing event)'],
    before: a.slice(Math.max(0, i - context), i),
    afterA: a.slice(i + 1, i + 1 + context),
    afterB: b.slice(i + 1, i + 1 + context),
  }
}

/**
 * Warm-up start (TT-14): the run starts with an empty yard and `warmUpS` of normal truck and vessel activity. At
 * that time `WarmUpEnded` restarts the measured period: every KPI counter and the end-condition counters (vessels
 * completed, moves) go back to zero, the KPI series restart (see `simulation.ts`), and `simDurationS` counts from
 * here. Equipment, boxes, queues and the yard keep their state; only the counters restart.
 */
import type { ReactorMap } from '../context'
import type { SimState } from '../state'

/** Counters that hold a start time of a still-open state, not a total: kept as they are. */
const KEEP = /Since$/
/** Times of first/last events: absolute, so they restart as "none yet". */
const TIME_STAMPS = new Set(['firstMoveStartS', 'lastMoveEndS'])

function zero(obj: unknown): void {
  if (obj === null || typeof obj !== 'object') return
  const rec = obj as Record<string, unknown>
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === 'number') {
      if (TIME_STAMPS.has(k)) rec[k] = null
      else if (!KEEP.test(k)) rec[k] = 0
    } else if (v !== null && typeof v === 'object') zero(v)
  }
}

/** Restart the counters of the measured period. */
export function resetCounters(state: SimState): void {
  const w = state.warmUp
  if (w) {
    w.vesselsCompletedBefore = state.kpis.vesselsCompleted
    w.movesBefore = state.kpis.movesCompleted
    w.cellsAtEnd = {}
    for (const s of Object.values(state.yardSlots)) w.cellsAtEnd[s.blockId] = (w.cellsAtEnd[s.blockId] ?? 0) + s.span
  }
  zero(state.kpis)
  zero(state.decisions.kpis)
}

export const warmUpReactors: ReactorMap = {
  ScenarioStarted: (_e, ctx) => {
    const w = ctx.state.warmUp
    if (w) ctx.schedule('WarmUpEnded', w.durationS, {}, { warmUpS: w.durationS })
  },
  WarmUpEnded: (_e, ctx) => {
    const w = ctx.state.warmUp
    if (!w) return
    w.ended = true
    resetCounters(ctx.state)
  },
}

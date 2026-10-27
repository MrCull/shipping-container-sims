/**
 * KPI report: a plain, rounded (3 dp) summary derived from SimState. Later
 * tickets (TT-07) add time series, hourly/shift buckets and more groups.
 */
import type { SimState } from './state'

/** Per-decision-point (TOS handler) KPIs. Latencies are per resolved decision. */
export interface HandlerKpiReport {
  /** "strategy:<name>" or "custom". */
  handler: string
  calls: number
  resolved: number
  /** Answered by the handler. */
  ok: number
  /** Answered by the fallback strategy after a timeout or error. */
  fallbacks: number
  timeouts: number
  errors: number
  /** Async replies that arrived after their timeout (discarded). */
  lateReplies: number
  /** Pending backlog now, and its peak. */
  pending: number
  maxPending: number
  simLatencyS: { mean: number; max: number }
  /** Injected latency plus measured time of async handlers (sync handlers count as 0). */
  wallLatencyMs: { mean: number; max: number }
  /** Equipment idle time caused by waiting on this decision point (equipment × s). */
  equipmentIdleS: number
}

export interface KpiReport {
  simTimeS: number
  eventsProcessed: number
  movesCompleted: number
  vesselsCompleted: number
  sts: Record<string, { moves: number; grossMovesPerHour: number | null }>
  vessels: Record<string, { berthedAtS: number | null; departedAtS: number | null; turnaroundS: number | null }>
  /** TOS handler KPIs per decision point. */
  handlers: Record<string, HandlerKpiReport>
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function buildKpiReport(state: SimState, eventsProcessed: number): KpiReport {
  const sts: KpiReport['sts'] = {}
  for (const [id, k] of Object.entries(state.kpis.perSts)) {
    const span = k.firstMoveStartS !== null && k.lastMoveEndS !== null ? k.lastMoveEndS - k.firstMoveStartS : 0
    sts[id] = { moves: k.moves, grossMovesPerHour: span > 0 ? r3((k.moves * 3600) / span) : null }
  }
  const vessels: KpiReport['vessels'] = {}
  for (const v of Object.values(state.vessels)) {
    vessels[v.id] = {
      berthedAtS: v.berthedAt === null ? null : r3(v.berthedAt),
      departedAtS: v.departedAt === null ? null : r3(v.departedAt),
      turnaroundS: v.berthedAt !== null && v.departedAt !== null ? r3(v.departedAt - v.berthedAt) : null,
    }
  }
  const handlers: KpiReport['handlers'] = {}
  const pending = Object.values(state.decisions.pending)
  for (const [dp, k] of Object.entries(state.decisions.kpis)) {
    const mean = (total: number) => (k.resolved > 0 ? r3(total / k.resolved) : 0)
    handlers[dp] = {
      handler: k.handler,
      calls: k.calls,
      resolved: k.resolved,
      ok: k.ok,
      fallbacks: k.fallbacks,
      timeouts: k.timeouts,
      errors: k.errors,
      lateReplies: k.lateReplies,
      pending: pending.filter((p) => p.decisionPoint === dp).length,
      maxPending: k.maxPending,
      simLatencyS: { mean: mean(k.simLatencyTotalS), max: r3(k.simLatencyMaxS) },
      wallLatencyMs: { mean: mean(k.wallLatencyTotalMs), max: r3(k.wallLatencyMaxMs) },
      equipmentIdleS: r3(k.equipmentIdleS),
    }
  }
  return {
    simTimeS: r3(state.now),
    eventsProcessed,
    movesCompleted: state.kpis.movesCompleted,
    vesselsCompleted: state.kpis.vesselsCompleted,
    sts,
    vessels,
    handlers,
  }
}

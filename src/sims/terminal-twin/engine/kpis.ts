/**
 * KPI report: a plain, rounded (3 dp) summary derived from SimState. Later
 * tickets (TT-07) add time series, hourly/shift buckets and more groups.
 */
import type { SimState } from './state'

export interface KpiReport {
  simTimeS: number
  eventsProcessed: number
  movesCompleted: number
  vesselsCompleted: number
  sts: Record<string, { moves: number; grossMovesPerHour: number | null }>
  vessels: Record<string, { berthedAtS: number | null; departedAtS: number | null; turnaroundS: number | null }>
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
  return {
    simTimeS: r3(state.now),
    eventsProcessed,
    movesCompleted: state.kpis.movesCompleted,
    vesselsCompleted: state.kpis.vesselsCompleted,
    sts,
    vessels,
  }
}

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
  sts: Record<
    string,
    { moves: number; cycles: number; twinLifts: number; grossMovesPerHour: number | null; railWaitS: number }
  >
  vessels: Record<
    string,
    {
      sizeClass: string
      arrivedAtS: number | null
      /** Arrival → berth allocation. */
      anchorageWaitS: number | null
      berthX: number | null
      berthedAtS: number | null
      departedAtS: number | null
      /** All fast → departure. */
      turnaroundS: number | null
      /** STS cranes that worked the vessel. */
      sts: string[]
    }
  >
  /** Berth congestion: anchorage waits over vessels that have been allocated a berth. */
  quay: { vesselsWaited: number; anchorageWaitS: { total: number; mean: number; max: number } }
  /** TOS handler KPIs per decision point (decision points never called are omitted). */
  handlers: Record<string, HandlerKpiReport>
  /** Horizontal transport (only when SHCs are configured). */
  horizontal?: HorizontalKpiReport
  /** Yard blocks and ASCs (only when blocks are configured with SHCs). */
  yard?: YardKpiReport
  /** Work packages (only when some were released). */
  workPackages?: WorkPackageKpiReport
}

export interface WorkPackageKpiReport {
  released: number
  started: number
  completed: number
  /** Time from release to the start of work: the look-ahead the yard had (s). */
  leadTimeMeanS: number
  leadTimeMaxS: number
  /** Export boxes loaded. */
  boxesLoaded: number
}

export interface YardKpiReport {
  /** Boxes the ASCs have stacked. */
  boxesStacked: number
  /** Boxes on WTP pads or in ASC hands (not stacked yet). */
  boxesInTransit: number
  /** yardAllocation replies with no slot (block full). */
  allocationFailures: number
  /** Per block: stacked boxes, slots in use (20 ft cells) and the highest stack. */
  blocks: Record<string, { boxes: number; cells: number; capacityCells: number; maxHeight: number }>
  ascs: Record<
    string,
    {
      jobs: number
      gantryM: number
      trolleyM: number
      hoistM: number
      padWaitS: number
      /** Twin-ASC blocks only: seconds jobs waited for the other ASC's rail segments. */
      railWaitS?: number
      /** Twin-ASC blocks only: seconds on cycles and yield moves. */
      busyS?: number
      /** Twin-ASC blocks only: times this ASC stepped aside. */
      yields?: number
    }
  >
}

export interface HorizontalKpiReport {
  /** Boxes SHCs delivered to WTP pads. */
  boxesToWtp: number
  shcs: Record<string, { jobs: number; emptyDistanceM: number; loadedDistanceM: number; reservationWaitS: number }>
  /** STS seconds spent waiting for a free ground position (SHCs too slow). */
  stsGroundPositionWaitS: Record<string, number>
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function buildKpiReport(state: SimState, eventsProcessed: number): KpiReport {
  const sts: KpiReport['sts'] = {}
  for (const [id, k] of Object.entries(state.kpis.perSts)) {
    const span = k.firstMoveStartS !== null && k.lastMoveEndS !== null ? k.lastMoveEndS - k.firstMoveStartS : 0
    sts[id] = {
      moves: k.moves,
      cycles: k.cycles,
      twinLifts: k.twinLifts,
      grossMovesPerHour: span > 0 ? r3((k.moves * 3600) / span) : null,
      railWaitS: r3(k.railWaitS),
    }
  }
  const vessels: KpiReport['vessels'] = {}
  const n3 = (x: number | null) => (x === null ? null : r3(x))
  const waits: number[] = []
  for (const v of Object.values(state.vessels)) {
    if (v.anchorageWaitS !== null) waits.push(v.anchorageWaitS)
    vessels[v.id] = {
      sizeClass: v.sizeClass,
      arrivedAtS: n3(v.arrivedAt),
      anchorageWaitS: n3(v.anchorageWaitS),
      berthX: n3(v.berthX),
      berthedAtS: n3(v.berthedAt),
      departedAtS: n3(v.departedAt),
      turnaroundS: v.berthedAt !== null && v.departedAt !== null ? r3(v.departedAt - v.berthedAt) : null,
      sts: [...v.stsHistory],
    }
  }
  const totalWait = waits.reduce((a, b) => a + b, 0)
  const quay: KpiReport['quay'] = {
    vesselsWaited: waits.filter((w) => w > 0).length,
    anchorageWaitS: {
      total: r3(totalWait),
      mean: waits.length ? r3(totalWait / waits.length) : 0,
      max: waits.length ? r3(Math.max(...waits)) : 0,
    },
  }
  const handlers: KpiReport['handlers'] = {}
  const pending = Object.values(state.decisions.pending)
  for (const [dp, k] of Object.entries(state.decisions.kpis)) {
    if (k.calls === 0) continue
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
  const h = state.kpis.horizontal
  const horizontal: HorizontalKpiReport | undefined = h && {
    boxesToWtp: h.boxesToWtp,
    shcs: Object.fromEntries(
      Object.entries(h.perShc).map(([id, k]) => [
        id,
        {
          jobs: k.jobs,
          emptyDistanceM: r3(k.emptyDistanceM),
          loadedDistanceM: r3(k.loadedDistanceM),
          reservationWaitS: r3(k.reservationWaitS),
        },
      ]),
    ),
    stsGroundPositionWaitS: Object.fromEntries(Object.entries(h.stsGroundPositionWaitS).map(([id, s]) => [id, r3(s)])),
  }
  const y = state.kpis.yard
  const yard: YardKpiReport | undefined = y && {
    boxesStacked: y.boxesStacked,
    boxesInTransit: Object.keys(state.ascJobs).length,
    allocationFailures: y.allocationFailures,
    blocks: Object.fromEntries(
      Object.values(state.yardBlocks).map((b) => {
        const slots = Object.values(state.yardSlots).filter((s) => s.blockId === b.id)
        return [
          b.id,
          {
            boxes: slots.length,
            cells: slots.reduce((n, s) => n + s.span, 0),
            capacityCells: b.bays * b.rows * b.tiers,
            maxHeight: slots.reduce((m, s) => Math.max(m, s.tier), 0),
          },
        ]
      }),
    ),
    ascs: Object.fromEntries(
      Object.entries(y.perAsc).map(([id, k]) => [
        id,
        {
          jobs: k.jobs,
          gantryM: r3(k.gantryM),
          trolleyM: r3(k.trolleyM),
          hoistM: r3(k.hoistM),
          padWaitS: r3(k.padWaitS),
          ...(k.railWaitS !== undefined ? { railWaitS: r3(k.railWaitS), busyS: r3(k.busyS ?? 0), yields: k.yields ?? 0 } : {}),
        },
      ]),
    ),
  }
  return {
    simTimeS: r3(state.now),
    eventsProcessed,
    movesCompleted: state.kpis.movesCompleted,
    vesselsCompleted: state.kpis.vesselsCompleted,
    sts,
    vessels,
    quay,
    handlers,
    ...(horizontal ? { horizontal } : {}),
    ...(yard ? { yard } : {}),
    ...(state.kpis.workPackages.released > 0
      ? {
          workPackages: {
            released: state.kpis.workPackages.released,
            started: state.kpis.workPackages.started,
            completed: state.kpis.workPackages.completed,
            leadTimeMeanS: r3(state.kpis.workPackages.started > 0 ? state.kpis.workPackages.leadTimeSumS / state.kpis.workPackages.started : 0),
            leadTimeMaxS: r3(state.kpis.workPackages.leadTimeMaxS),
            boxesLoaded: state.kpis.workPackages.boxesLoaded,
          },
        }
      : {}),
  }
}

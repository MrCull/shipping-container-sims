/**
 * KPI collector: folds the event stream into per-hour component sums (counts,
 * seconds in a state, metres, gauges) and derives every KPI series from them.
 *
 * - It is a pure function of the event log (plus the vessel box totals), so it
 *   is rebuilt by replaying the log after a snapshot restore and never stored.
 * - Components are stored per clock hour. A KPI value for an hour, a shift or
 *   the whole run is `value(window)` over the summed components, so ratios and
 *   means are exact at every aggregation level (never an average of averages).
 * - Later tickets add KPIs by observing more events (`observe`) and appending
 *   to `KPI_DEFS`.
 */
import type { EngineEvent } from '../events'
import { DECISION_POINT_IDS } from '../decisions/types'
import { appointmentWindowS } from '../appointments'
import { ascIdOf } from '../state'
import { SHC_OPERATIONAL_STATES, type ShcOperationalState } from '../shcStates'
import { blockSpecs, boxSpan } from '../yardLayout'
import type { ContainerSize, ScenarioConfig } from '../../scenario/types'
import {
  hourBuckets,
  hourIndexOf,
  HOUR_S,
  kpiClockOf,
  shiftBuckets,
  type HourBucket,
  type KpiClock,
  type ShiftBucket,
} from './clock'

export type KpiUnit = 'count' | 'moves/h' | 's' | 'pct' | 'ratio' | 'm'
export type KpiEntityKind = 'terminal' | 'sts' | 'vessel' | 'shc' | 'asc' | 'block' | 'handler'

export interface KpiSeriesEntity {
  /** One value per hour bucket (null = no data, e.g. no moves to divide by). */
  hourly: (number | null)[]
  /** One value per shift bucket. */
  shifts: (number | null)[]
  /** The whole run so far. */
  total: number | null
}

export interface KpiSeries {
  id: string
  unit: KpiUnit
  entityKind: KpiEntityKind
  entities: Record<string, KpiSeriesEntity>
}

export interface KpiSeriesReport {
  clock: KpiClock
  elapsedS: number
  hours: HourBucket[]
  shifts: ShiftBucket[]
  series: Record<string, KpiSeries>
}

export interface KpiCollector {
  ingest(event: EngineEvent): void
  /** Every KPI as hourly, per-shift and total series at sim time `now`. */
  report(now: number): KpiSeriesReport
  /** Run totals per SHC at `now`: seconds in each operational state and handovers (cheap; no series). */
  shcTotals(now: number): Record<string, { stateS: Record<ShcOperationalState, number>; handovers: number }>
}

// ---------------------------------------------------------------- accumulators

class Acc {
  sums: Record<string, Record<string, number[]>> = {}
  gauges: Record<string, Record<string, (number | undefined)[]>> = {}

  add(comp: string, entity: string, hour: number, v: number): void {
    const arr = ((this.sums[comp] ??= {})[entity] ??= [])
    arr[hour] = (arr[hour] ?? 0) + v
  }

  /** Add `ratePerS` × seconds to every hour bucket that [t0, t1) overlaps. */
  interval(clock: KpiClock, comp: string, entity: string, t0: number, t1: number, ratePerS = 1): void {
    if (!(t1 > t0)) return
    const lo = Math.max(0, t0)
    if (!(t1 > lo)) return
    const base = Math.floor(clock.startTimeOfDayS / HOUR_S)
    for (let h = hourIndexOf(clock, lo); h <= hourIndexOf(clock, t1); h++) {
      const hs = (base + h) * HOUR_S - clock.startTimeOfDayS
      const from = Math.max(lo, hs)
      const to = Math.min(t1, hs + HOUR_S)
      if (to > from) this.add(comp, entity, h, (to - from) * ratePerS)
    }
  }

  gauge(comp: string, entity: string, hour: number, v: number): void {
    ;((this.gauges[comp] ??= {})[entity] ??= [])[hour] = v
  }

  clone(): Acc {
    const c = new Acc()
    for (const [k, v] of Object.entries(this.sums)) c.sums[k] = Object.fromEntries(Object.entries(v).map(([e, a]) => [e, [...a]]))
    c.gauges = this.gauges
    return c
  }
}

// ------------------------------------------------------------------- windows

/** The component sums of one hour, shift or the whole run. */
interface Window {
  /** Seconds of the run inside the window. */
  spanS: number
  sum(comp: string, entity: string): number
  /** Gauge value at the end of the window (carried forward). */
  gauge(comp: string, entity: string): number
}

interface KpiDef {
  id: string
  unit: KpiUnit
  entityKind: KpiEntityKind
  entities(ctx: DefContext): string[]
  value(w: Window, entity: string, ctx: DefContext): number | null
}

interface DefContext {
  config: ScenarioConfig
  capacityCells: Record<string, number>
  decisionPoints: string[]
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const ratio = (a: number, b: number): number | null => (b > 0 ? r3(a / b) : null)
const hoursOf = (s: number) => s / HOUR_S

const TERMINAL = ['terminal']
const stsIds = (c: DefContext) => c.config.sts.map((s) => s.id)
const shcIds = (c: DefContext) => (c.config.shcs ?? []).map((s) => s.id)
const blockIds = (c: DefContext) => Object.keys(c.capacityCells)
const ascIds = (c: DefContext) =>
  blockIds(c).flatMap((b) => Array.from({ length: c.config.yard?.ascsPerBlock ?? 1 }, (_, n) => ascIdOf(b, n + 1)))

const stsOnVesselS = (w: Window, id: string) => w.spanS - w.sum('sts.waitWorkS', id)

export const KPI_DEFS: KpiDef[] = [
  // Quay
  { id: 'sts.moves', unit: 'count', entityKind: 'sts', entities: stsIds, value: (w, id) => w.sum('sts.moves', id) },
  {
    id: 'sts.gross-moves-per-hour',
    unit: 'moves/h',
    entityKind: 'sts',
    entities: stsIds,
    value: (w, id) => ratio(w.sum('sts.moves', id), hoursOf(stsOnVesselS(w, id))),
  },
  {
    id: 'sts.net-moves-per-hour',
    unit: 'moves/h',
    entityKind: 'sts',
    entities: stsIds,
    value: (w, id) =>
      ratio(w.sum('sts.moves', id), hoursOf(stsOnVesselS(w, id) - w.sum('sts.waitShcS', id) - w.sum('sts.waitRailS', id))),
  },
  { id: 'sts.wait-shc-s', unit: 's', entityKind: 'sts', entities: stsIds, value: (w, id) => r3(w.sum('sts.waitShcS', id)) },
  { id: 'wp.released', unit: 'count', entityKind: 'sts', entities: stsIds, value: (w, id) => w.sum('wp.released', id) },
  { id: 'wp.completed', unit: 'count', entityKind: 'sts', entities: stsIds, value: (w, id) => w.sum('wp.completed', id) },
  {
    id: 'wp.lead-time-s',
    unit: 's',
    entityKind: 'sts',
    entities: stsIds,
    value: (w, id) => ratio(w.sum('wp.leadS', id), w.sum('wp.started', id)),
  },
  { id: 'sts.wait-work-s', unit: 's', entityKind: 'sts', entities: stsIds, value: (w, id) => r3(w.sum('sts.waitWorkS', id)) },
  { id: 'sts.wait-rail-s', unit: 's', entityKind: 'sts', entities: stsIds, value: (w, id) => r3(w.sum('sts.waitRailS', id)) },
  {
    id: 'berth.moves-per-hour',
    unit: 'moves/h',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('berth.moves', 'terminal'), hoursOf(w.sum('berth.berthedS', 'terminal'))),
  },
  {
    id: 'vessel.remaining-moves',
    unit: 'count',
    entityKind: 'vessel',
    entities: (c) => c.config.vessels.map((v) => v.id),
    value: (w, id) => w.gauge('vessel.remaining', id),
  },
  {
    id: 'vessel.turnaround-s',
    unit: 's',
    entityKind: 'vessel',
    entities: (c) => c.config.vessels.map((v) => v.id),
    value: (w, id) => ratio(w.sum('vessel.turnS', id), w.sum('vessel.departed', id)),
  },
  {
    id: 'vessel.anchorage-wait-s',
    unit: 's',
    entityKind: 'vessel',
    entities: (c) => c.config.vessels.map((v) => v.id),
    value: (w, id) => ratio(w.sum('vessel.anchorageS', id), w.sum('vessel.allocated', id)),
  },
  // Horizontal transport
  {
    id: 'shc.loaded-pct',
    unit: 'pct',
    entityKind: 'shc',
    entities: shcIds,
    value: (w, id) => (w.spanS > 0 ? r3((100 * w.sum('shc.loadedS', id)) / w.spanS) : null),
  },
  {
    id: 'shc.empty-pct',
    unit: 'pct',
    entityKind: 'shc',
    entities: shcIds,
    value: (w, id) => (w.spanS > 0 ? r3((100 * w.sum('shc.emptyS', id)) / w.spanS) : null),
  },
  {
    id: 'shc.idle-pct',
    unit: 'pct',
    entityKind: 'shc',
    entities: shcIds,
    value: (w, id) => (w.spanS > 0 ? r3(100 - (100 * (w.sum('shc.loadedS', id) + w.sum('shc.emptyS', id))) / w.spanS) : null),
  },
  {
    id: 'shc.empty-travel-ratio',
    unit: 'ratio',
    entityKind: 'shc',
    entities: shcIds,
    value: (w, id) => ratio(w.sum('shc.emptyM', id), w.sum('shc.emptyM', id) + w.sum('shc.loadedM', id)),
  },
  { id: 'shc.empty-distance-m', unit: 'm', entityKind: 'shc', entities: shcIds, value: (w, id) => r3(w.sum('shc.emptyM', id)) },
  { id: 'shc.loaded-distance-m', unit: 'm', entityKind: 'shc', entities: shcIds, value: (w, id) => r3(w.sum('shc.loadedM', id)) },
  ...SHC_OPERATIONAL_STATES.map(
    (op): KpiDef => ({
      id: `shc.state.${op}-s`,
      unit: 's',
      entityKind: 'shc',
      entities: shcIds,
      value: (w, id) => r3(w.sum(`shc.state.${op}`, id)),
    }),
  ),
  { id: 'shc.handovers', unit: 'count', entityKind: 'shc', entities: shcIds, value: (w, id) => w.sum('shc.handovers', id) },
  { id: 'shc.jobs', unit: 'count', entityKind: 'shc', entities: shcIds, value: (w, id) => w.sum('shc.cycles', id) },
  {
    id: 'shc.cycle-time-s',
    unit: 's',
    entityKind: 'shc',
    entities: shcIds,
    value: (w, id) => ratio(w.sum('shc.cycleS', id), w.sum('shc.cycles', id)),
  },
  {
    id: 'wtp.dwell-s',
    unit: 's',
    entityKind: 'block',
    entities: blockIds,
    value: (w, id) => ratio(w.sum('wtp.dwellS', id), w.sum('wtp.boxes', id)),
  },
  // Yard
  {
    id: 'asc.utilisation-pct',
    unit: 'pct',
    entityKind: 'asc',
    entities: ascIds,
    value: (w, id) => (w.spanS > 0 ? r3((100 * w.sum('asc.busyS', id)) / w.spanS) : null),
  },
  { id: 'asc.jobs', unit: 'count', entityKind: 'asc', entities: ascIds, value: (w, id) => w.sum('asc.cycles', id) },
  {
    id: 'asc.cycle-time-s',
    unit: 's',
    entityKind: 'asc',
    entities: ascIds,
    value: (w, id) => ratio(w.sum('asc.cycleS', id), w.sum('asc.cycles', id)),
  },
  {
    id: 'yard.rehandles-per-move',
    unit: 'ratio',
    entityKind: 'block',
    entities: blockIds,
    value: (w, id) => ratio(w.sum('yard.rehandles', id), w.sum('yard.moves', id)),
  },
  {
    id: 'yard.fill-pct',
    unit: 'pct',
    entityKind: 'block',
    entities: blockIds,
    value: (w, id, c) => ratio(100 * w.gauge('yard.cells', id), c.capacityCells[id]),
  },
  // Landside
  { id: 'landside.trucks-in', unit: 'count', entityKind: 'terminal', entities: () => TERMINAL, value: (w) => w.sum('ls.in', 'terminal') },
  { id: 'landside.trucks-out', unit: 'count', entityKind: 'terminal', entities: () => TERMINAL, value: (w) => w.sum('ls.out', 'terminal') },
  {
    id: 'landside.truck-turn-s',
    unit: 's',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.turnS', 'terminal'), w.sum('ls.out', 'terminal')),
  },
  { id: 'landside.gate-queue', unit: 'count', entityKind: 'terminal', entities: () => TERMINAL, value: (w) => w.gauge('ls.queue', 'terminal') },
  {
    id: 'landside.gate-wait-s',
    unit: 's',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.gateWaitS', 'terminal'), w.sum('ls.gateStarted', 'terminal')),
  },
  {
    id: 'landside.stall-wait-s',
    unit: 's',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.stallWaitS', 'terminal'), w.sum('ls.stallServed', 'terminal')),
  },
  {
    id: 'landside.gate-processing-s',
    unit: 's',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.procS', 'terminal'), w.sum('ls.in', 'terminal')),
  },
  {
    id: 'landside.internal-drive-s',
    unit: 's',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.driveS', 'terminal'), w.sum('ls.out', 'terminal')),
  },
  {
    id: 'landside.total-turnaround-s',
    unit: 's',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.totalTurnS', 'terminal'), w.sum('ls.out', 'terminal')),
  },
  {
    id: 'landside.road-trucks',
    unit: 'ratio',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => ratio(w.sum('ls.roadS', 'terminal'), w.spanS),
  },
  {
    id: 'landside.holding-utilisation-pct',
    unit: 'pct',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w, _id, c) => ratio(100 * w.sum('ls.holdS', 'terminal'), (c.config.landside?.holding?.positions ?? 0) * w.spanS),
  },
  {
    id: 'landside.appointments-delayed',
    unit: 'count',
    entityKind: 'terminal',
    entities: () => TERMINAL,
    value: (w) => w.sum('ls.delayed', 'terminal'),
  },
  // TOS handlers
  { id: 'handler.calls', unit: 'count', entityKind: 'handler', entities: (c) => c.decisionPoints, value: (w, id) => w.sum('handler.calls', id) },
  {
    id: 'handler.mean-latency-s',
    unit: 's',
    entityKind: 'handler',
    entities: (c) => c.decisionPoints,
    value: (w, id) => ratio(w.sum('handler.latencyS', id), w.sum('handler.resolved', id)),
  },
  {
    // measured wall latency of the replies resolved in the bucket, read from DecisionResolved.wallLatencyMs
    id: 'handler.wall-latency-s',
    unit: 's',
    entityKind: 'handler',
    entities: (c) => c.decisionPoints,
    value: (w, id) => ratio(w.sum('handler.wallS', id), w.sum('handler.resolved', id)),
  },
  {
    id: 'handler.fallbacks',
    unit: 'count',
    entityKind: 'handler',
    entities: (c) => c.decisionPoints,
    value: (w, id) => w.sum('handler.fallbacks', id),
  },
  {
    id: 'handler.failures',
    unit: 'count',
    entityKind: 'handler',
    entities: (c) => c.decisionPoints,
    value: (w, id) => w.sum('handler.failures', id),
  },
  {
    id: 'handler.backlog',
    unit: 'count',
    entityKind: 'handler',
    entities: (c) => c.decisionPoints,
    value: (w, id) => w.gauge('handler.backlog', id),
  },
  {
    id: 'handler.equipment-idle-s',
    unit: 's',
    entityKind: 'handler',
    entities: (c) => c.decisionPoints,
    value: (w, id) => r3(w.sum('handler.idleS', id)),
  },
]

/** KPI groups that only exist when the scenario has the subsystem. */
function defApplies(def: KpiDef, config: ScenarioConfig, ctx: DefContext): boolean {
  if (def.id.startsWith('shc.') || def.id.startsWith('wtp.')) return (config.shcs?.length ?? 0) > 0
  if (def.id.startsWith('asc.') || def.id.startsWith('yard.')) return Object.keys(ctx.capacityCells).length > 0
  if (def.id.startsWith('landside.')) {
    if (config.landside === undefined || Object.keys(ctx.capacityCells).length === 0) return false
    if (def.id.startsWith('landside.holding-')) return (config.landside.holding?.positions ?? 0) > 0
    if (def.id.startsWith('landside.appointments-')) return config.landside.appointments !== undefined
    return true
  }
  return true
}

// ------------------------------------------------------------------ the fold

const LOADED_SHC_EVENTS = new Set([
  'ShcRoutingLoaded',
  'ShcPositioningAtDropoff',
  'ShcLowering',
  'ShcUnlocking',
  'ShcDroppedAtWtp',
  'ShcDroppedAtGround',
])

interface Open {
  kind: 'empty' | 'loaded'
  since: number
}

/** Static facts the event stream does not carry. */
export interface KpiStaticInfo {
  /** Discharge boxes per vessel at the start (for "remaining moves"). */
  vesselBoxes: Record<string, number>
  containerSize(containerId: string): ContainerSize
  /** Boxes standing in the stacks at the start, per block, as 20 ft cells (export pre-fill). */
  initialCells?: Record<string, number>
}

export function createKpiCollector(config: ScenarioConfig, info: KpiStaticInfo): KpiCollector {
  // a copy: boxes booked after the start (truck-delivered exports, V11-14) are added as their TruckArrived events are fed
  const vesselBoxes = { ...info.vesselBoxes }
  const clock = kpiClockOf(config)
  const acc = new Acc()
  const hourOf = (t: number) => Math.max(0, hourIndexOf(clock, t))

  const capacityCells: Record<string, number> = {}
  if (config.yard) for (const b of blockSpecs(config)) capacityCells[b.id] = b.bays * b.rows * b.tiers

  // open states (closed at the report time on a copy)
  const waitWorkSince: Record<string, number | null> = Object.fromEntries(config.sts.map((s) => [s.id, 0]))
  const waitShcSince: Record<string, number | null> = {}
  const railSince: Record<string, number | null> = {}
  const railEnd: Record<string, number | null> = {}
  const shcOpen: Record<string, Open | null> = {}
  const shcDepart: Record<string, number> = {}
  /** Operational state of each SHC since when (closed into `shc.state.<op>` on every change). */
  const shcOp: Record<string, { op: ShcOperationalState; since: number }> = Object.fromEntries(
    (config.shcs ?? []).map((s) => [s.id, { op: 'parked', since: 0 }]),
  )
  const ascBusy: Record<string, { since: number } | null> = {}
  const berthedSince: Record<string, number> = {}
  const wtpDropAt: Record<string, number> = {}
  const requestedAt: Record<string, number> = {}
  const berthedAt: Record<string, number> = {}
  const pending: Record<string, number> = {}
  const picked: Record<string, number> = {}
  const cells: Record<string, number> = { ...(info.initialCells ?? {}) }
  for (const [block, n] of Object.entries(cells)) acc.gauge('yard.cells', block, 0, n)
  const seenDecisionPoints = new Set<string>()
  const atStallAt: Record<string, number> = {}
  const servedTrucks = new Set<string>()
  // TT-R18 truck turnaround: per-truck stamps and open intervals (closed at the report time on a copy)
  const arrivedAtGate: Record<string, number> = {}
  const driveSince: Record<string, number> = {}
  const driveInbound: Record<string, number> = {}
  const holdSince: Record<string, number> = {}
  const windowS = config.landside?.appointments ? appointmentWindowS(config) : 0
  const bookedTrucks = new Set<string>()
  const driveStart = (id: string, t: number) => {
    driveSince[id] = t
  }
  const driveEnd = (id: string, t: number, inbound: boolean) => {
    const since = driveSince[id]
    if (since === undefined) return
    acc.interval(clock, 'ls.roadS', 'terminal', since, t)
    if (inbound) driveInbound[id] = (driveInbound[id] ?? 0) + (t - since)
    delete driveSince[id]
  }
  const holdEnd = (id: string, t: number) => {
    const since = holdSince[id]
    if (since === undefined) return
    acc.interval(clock, 'ls.holdS', 'terminal', since, t)
    delete holdSince[id]
  }

  function flushRail(upTo: number): void {
    for (const id of Object.keys(railEnd)) {
      const end = railEnd[id]
      if (end !== null && upTo > end) {
        acc.interval(clock, 'sts.waitRailS', id, railSince[id] ?? end, end)
        railSince[id] = null
        railEnd[id] = null
      }
    }
  }

  function shcTransition(id: string, kind: Open['kind'] | null, closeAt: number, openAt = closeAt): void {
    const open = shcOpen[id]
    if (open) acc.interval(clock, open.kind === 'empty' ? 'shc.emptyS' : 'shc.loadedS', id, open.since, closeAt)
    shcOpen[id] = kind ? { kind, since: openAt } : null
  }

  /** The SHC enters operational state `op` at `at` (a later `at` than the event time is a state that starts then). */
  function shcState(id: string, op: ShcOperationalState, at: number): void {
    const open = shcOp[id]
    if (open) acc.interval(clock, `shc.state.${open.op}`, id, open.since, at)
    shcOp[id] = { op, since: at }
  }

  function distance(id: string, comp: string, segments: { axis: string; from: number; to: number; t0: number; t1: number }[]): void {
    for (const s of segments) {
      if (s.axis !== 'x' && s.axis !== 'z') continue
      const d = Math.abs(s.to - s.from)
      if (d === 0) continue
      if (s.t1 <= s.t0) acc.add(comp, id, hourOf(s.t1), d)
      else acc.interval(clock, comp, id, s.t0, s.t1, d / (s.t1 - s.t0))
    }
  }

  function decisionPoint(dp: string): string {
    seenDecisionPoints.add(dp)
    return dp
  }

  function observe(e: EngineEvent): void {
    const h = hourOf(e.t)
    switch (e.type) {
      case 'WorkPackageReleased':
        acc.add('wp.released', e.payload.stsId, h, 1)
        break
      case 'WorkPackageStarted':
        acc.add('wp.started', e.payload.stsId, h, 1)
        acc.add('wp.leadS', e.payload.stsId, h, e.payload.leadTimeS)
        break
      case 'WorkPackageCompleted':
        acc.add('wp.completed', e.payload.stsId, h, 1)
        break
      case 'StsWaitingForBox':
        waitShcSince[e.payload.stsId] = e.t
        break
      case 'StsBoxWaitEnded': {
        const id = e.payload.stsId
        acc.interval(clock, 'sts.waitShcS', id, waitShcSince[id] ?? e.t - e.payload.waitedS, e.t)
        waitShcSince[id] = null
        break
      }
      case 'StsLoaded': {
        acc.add('sts.moves', e.payload.stsId, h, 1)
        acc.add('berth.moves', 'terminal', h, 1)
        const vessel = e.payload.vesselId
        picked[vessel] = (picked[vessel] ?? 0) + 1
        acc.gauge('vessel.remaining', vessel, h, (vesselBoxes[vessel] ?? 0) - picked[vessel])
        break
      }
      case 'StsLoadStarted':
      case 'StsMoveStarted': {
        const id = e.payload.stsId
        if (waitWorkSince[id] !== null && waitWorkSince[id] !== undefined) {
          acc.interval(clock, 'sts.waitWorkS', id, waitWorkSince[id], e.t)
          waitWorkSince[id] = null
        }
        if (railSince[id] != null) railEnd[id] = e.t
        break
      }
      case 'StsWaitingForRail': {
        const id = e.payload.stsId
        railSince[id] ??= e.t
        railEnd[id] = null
        break
      }
      case 'StsWaitingForGroundPosition':
        waitShcSince[e.payload.stsId] = e.t
        break
      case 'StsGroundPositionWaitEnded': {
        const id = e.payload.stsId
        acc.interval(clock, 'sts.waitShcS', id, waitShcSince[id] ?? e.t - e.payload.waitedS, e.t)
        waitShcSince[id] = null
        break
      }
      case 'StsWorkComplete':
        waitWorkSince[e.payload.stsId] = e.t
        break
      case 'StsPicked': {
        for (const from of [e.payload.from, e.payload.twin?.from]) {
          if (!from) continue
          const vessel = from.id.split(':')[0]
          picked[vessel] = (picked[vessel] ?? 0) + 1
          acc.gauge('vessel.remaining', vessel, h, (vesselBoxes[vessel] ?? 0) - picked[vessel])
        }
        break
      }
      case 'StsGrounded':
        acc.add('sts.moves', e.payload.stsId, h, 1)
        acc.add('berth.moves', 'terminal', h, 1)
        break
      case 'BerthAllocated':
        acc.add('vessel.anchorageS', e.payload.vesselId, h, e.payload.anchorageWaitS)
        acc.add('vessel.allocated', e.payload.vesselId, h, 1)
        break
      case 'VesselBerthed':
        berthedSince[e.payload.vesselId] = e.t
        berthedAt[e.payload.vesselId] = e.t
        break
      case 'VesselDeparted': {
        const at = berthedAt[e.payload.vesselId]
        if (at !== undefined) {
          acc.add('vessel.turnS', e.payload.vesselId, h, e.t - at)
          acc.add('vessel.departed', e.payload.vesselId, h, 1)
        }
        break
      }
      case 'VesselWorkComplete': {
        const since = berthedSince[e.payload.vesselId]
        if (since !== undefined) acc.interval(clock, 'berth.berthedS', 'terminal', since, e.t)
        delete berthedSince[e.payload.vesselId]
        break
      }
      case 'ShcJobAssigned': {
        const id = e.payload.shcId
        shcDepart[id] = e.payload.departAt
        shcState(id, 'queuing-to-collect', e.t)
        shcState(id, 'moving-to-collect', e.payload.departAt)
        shcTransition(id, 'empty', e.t, e.payload.departAt)
        break
      }
      case 'ShcRoutingToParking':
        shcState(e.payload.shcId, 'moving-to-collect', e.t)
        shcTransition(e.payload.shcId, 'empty', e.t, e.payload.departAt)
        break
      case 'ShcRoutingEmpty':
        shcState(e.payload.shcId, 'collecting', e.t)
        break
      case 'ShcRoutingLoaded':
        shcState(e.payload.shcId, 'delivering', e.t)
        break
      case 'ShcPicked':
      case 'ShcPickedAtWtp':
        shcState(e.payload.shcId, 'moving-to-deliver', e.t)
        acc.add('shc.handovers', e.payload.shcId, h, 1)
        shcTransition(e.payload.shcId, 'loaded', e.t)
        break
      case 'ShcDroppedAtGround':
        acc.add('shc.handovers', e.payload.shcId, h, 1)
        shcTransition(e.payload.shcId, 'empty', e.t)
        break
      case 'ShcDroppedAtWtp':
        acc.add('shc.handovers', e.payload.shcId, h, 1)
        shcTransition(e.payload.shcId, 'empty', e.t)
        wtpDropAt[e.payload.containerId] = e.t
        break
      case 'ShcCleared': {
        const id = e.payload.shcId
        shcState(id, 'parked', e.t)
        shcTransition(id, null, e.t)
        acc.add('shc.cycleS', id, h, e.t - (shcDepart[id] ?? e.t))
        acc.add('shc.cycles', id, h, 1)
        break
      }
      case 'ShcParked':
        shcState(e.payload.shcId, 'parked', e.t)
        shcTransition(e.payload.shcId, null, e.t)
        break
      case 'AscJobAssigned':
        ascBusy[e.payload.ascId] = { since: e.payload.departAt }
        if (e.payload.truckId && !servedTrucks.has(e.payload.truckId)) {
          servedTrucks.add(e.payload.truckId)
          acc.add('ls.stallWaitS', 'terminal', h, e.payload.departAt - (atStallAt[e.payload.truckId] ?? e.t))
          acc.add('ls.stallServed', 'terminal', h, 1)
        }
        break
      case 'TruckArrived':
        arrivedAtGate[e.payload.truckId] = e.t
        if (e.payload.appointmentId !== undefined) bookedTrucks.add(e.payload.truckId)
        acc.gauge('ls.queue', 'terminal', h, e.payload.queueLength)
        for (const l of e.payload.legs) if (l.slotId && l.vesselId) vesselBoxes[l.vesselId] = (vesselBoxes[l.vesselId] ?? 0) + 1
        break
      case 'TruckGateStarted':
        acc.gauge('ls.queue', 'terminal', h, e.payload.queueLength)
        acc.add('ls.gateWaitS', 'terminal', h, e.payload.queueWaitS)
        acc.add('ls.gateStarted', 'terminal', h, 1)
        if (bookedTrucks.has(e.payload.truckId) && windowS > 0 && e.t >= (Math.floor((arrivedAtGate[e.payload.truckId] ?? e.t) / windowS) + 1) * windowS)
          acc.add('ls.delayed', 'terminal', h, 1)
        break
      case 'TruckGateIn':
        acc.add('ls.in', 'terminal', h, 1)
        acc.add('ls.procS', 'terminal', h, e.payload.processingS)
        break
      case 'TruckHoldingAssigned':
        holdSince[e.payload.truckId] = e.t
        break
      case 'TruckRoutingToHolding':
        driveStart(e.payload.truckId, e.t)
        break
      case 'TruckAtHolding':
        driveEnd(e.payload.truckId, e.t, true)
        break
      case 'TruckRoutingToStall':
        holdEnd(e.payload.truckId, e.t)
        driveStart(e.payload.truckId, e.t)
        break
      case 'TruckRoutingToExit':
        driveStart(e.payload.truckId, e.t)
        break
      case 'TruckAtStall':
        driveEnd(e.payload.truckId, e.t, true)
        atStallAt[e.payload.truckId] = e.t
        break
      case 'TruckGateOut':
        driveEnd(e.payload.truckId, e.t, false)
        acc.add('ls.out', 'terminal', h, 1)
        acc.add('ls.turnS', 'terminal', h, e.payload.turnS)
        acc.add('ls.driveS', 'terminal', h, driveInbound[e.payload.truckId] ?? 0)
        acc.add('ls.totalTurnS', 'terminal', h, e.t - (arrivedAtGate[e.payload.truckId] ?? e.t))
        break
      case 'TruckDeparted':
        delete arrivedAtGate[e.payload.truckId]
        delete driveInbound[e.payload.truckId]
        bookedTrucks.delete(e.payload.truckId)
        delete atStallAt[e.payload.truckId]
        servedTrucks.delete(e.payload.truckId)
        break
      case 'AscPicked': {
        const dropped = wtpDropAt[e.payload.containerId]
        if (dropped !== undefined) {
          acc.add('wtp.dwellS', e.payload.blockId, h, e.t - dropped)
          acc.add('wtp.boxes', e.payload.blockId, h, 1)
          delete wtpDropAt[e.payload.containerId]
        }
        break
      }
      case 'AscReady': {
        const id = e.payload.ascId
        const busy = ascBusy[id]
        if (busy) {
          acc.interval(clock, 'asc.busyS', id, busy.since, e.t)
          acc.add('asc.cycleS', id, h, e.t - busy.since)
          acc.add('asc.cycles', id, h, 1)
          ascBusy[id] = null
        }
        break
      }
      case 'DecisionRequested': {
        const dp = decisionPoint(e.payload.decisionPoint)
        if (e.payload.decisionPoint === 'wtpPadSelection') shcState(e.payload.request.shcId, 'queuing-to-collect', e.t)
        acc.add('handler.calls', dp, h, 1)
        requestedAt[e.payload.correlationId] = e.t
        pending[dp] = (pending[dp] ?? 0) + 1
        acc.gauge('handler.backlog', dp, h, pending[dp])
        break
      }
      case 'DecisionFailed': {
        const dp = decisionPoint(e.payload.decisionPoint)
        acc.add('handler.failures', dp, h, 1)
        break
      }
      case 'DecisionResolved': {
        const dp = decisionPoint(e.payload.decisionPoint)
        // a dispatch or pad decision with no taker leaves the SHC idle
        if (e.payload.decisionPoint === 'wtpPadSelection' && e.payload.reply.wtpPadId === null) shcState(e.payload.request.shcId, 'parked', e.t)
        else if (e.payload.decisionPoint === 'shcDispatch' && e.payload.reply.jobId === null) shcState(e.payload.request.shcId, 'parked', e.t)
        const asked = requestedAt[e.payload.correlationId]
        delete requestedAt[e.payload.correlationId]
        acc.add('handler.resolved', dp, h, 1)
        const latencyS = asked === undefined ? 0 : e.t - asked
        acc.add('handler.latencyS', dp, h, latencyS)
        acc.add('handler.wallS', dp, h, (e.payload.wallLatencyMs ?? 0) / 1000)
        acc.add('handler.idleS', dp, h, latencyS * (e.subjects.equipment?.length ?? 0))
        if (e.payload.outcome === 'fallback') acc.add('handler.fallbacks', dp, h, 1)
        pending[dp] = Math.max(0, (pending[dp] ?? 1) - 1)
        acc.gauge('handler.backlog', dp, h, pending[dp])
        break
      }
    }
  }

  return {
    ingest(e) {
      flushRail(e.t)
      observe(e)
      // geometry-carrying events: SHC distance (empty vs loaded by phase)
      switch (e.type) {
        case 'ShcRoutingEmpty':
        case 'ShcPositioningAtPickup':
        case 'ShcLocking':
        case 'ShcPicked':
        case 'ShcPickedAtWtp':
        case 'ShcDroppedAtGround':
        case 'ShcRoutingLoaded':
        case 'ShcPositioningAtDropoff':
        case 'ShcLowering':
        case 'ShcUnlocking':
        case 'ShcDroppedAtWtp':
        case 'ShcCleared':
        case 'ShcParked':
          distance(e.payload.shcId, LOADED_SHC_EVENTS.has(e.type) ? 'shc.loadedM' : 'shc.emptyM', e.payload.segments)
          break
      }
      if (e.type === 'AscRetrieved') {
        const block = e.payload.blockId
        cells[block] = Math.max(0, (cells[block] ?? 0) - boxSpan(info.containerSize(e.payload.containerId)))
        acc.gauge('yard.cells', block, hourOf(e.t), cells[block])
      }
      if (e.type === 'AscStacked' && e.payload.rehandle) acc.add('yard.rehandles', e.payload.blockId, hourOf(e.t), 1)
      else if (e.type === 'AscStacked' || e.type === 'AscDroppedAtWtp' || e.type === 'AscDroppedAtStall')
        acc.add('yard.moves', e.payload.blockId, hourOf(e.t), 1)
      if (e.type === 'AscStacked') {
        const block = e.payload.blockId
        cells[block] = (cells[block] ?? 0) + boxSpan(info.containerSize(e.payload.containerId))
        acc.gauge('yard.cells', block, hourOf(e.t), cells[block])
      }
    },

    shcTotals(now) {
      const out: ReturnType<KpiCollector['shcTotals']> = {}
      for (const [id, o] of Object.entries(shcOp)) {
        const stateS = Object.fromEntries(SHC_OPERATIONAL_STATES.map((op) => [op, 0])) as Record<ShcOperationalState, number>
        for (const op of SHC_OPERATIONAL_STATES) for (const v of acc.sums[`shc.state.${op}`]?.[id] ?? []) stateS[op] += v ?? 0
        if (now > o.since) stateS[o.op] += now - o.since
        for (const op of SHC_OPERATIONAL_STATES) stateS[op] = r3(stateS[op])
        let handovers = 0
        for (const v of acc.sums['shc.handovers']?.[id] ?? []) handovers += v ?? 0
        out[id] = { stateS, handovers }
      }
      return out
    },

    report(now) {
      const copy = acc.clone()
      // close the open states at `now`
      for (const [id, since] of Object.entries(waitWorkSince)) if (since !== null) copy.interval(clock, 'sts.waitWorkS', id, since, now)
      for (const [id, since] of Object.entries(waitShcSince)) if (since != null) copy.interval(clock, 'sts.waitShcS', id, since, now)
      for (const [id, since] of Object.entries(railSince)) {
        if (since == null) continue
        copy.interval(clock, 'sts.waitRailS', id, since, railEnd[id] ?? now)
      }
      for (const [id, open] of Object.entries(shcOpen))
        if (open) copy.interval(clock, open.kind === 'empty' ? 'shc.emptyS' : 'shc.loadedS', id, open.since, now)
      for (const [id, o] of Object.entries(shcOp)) copy.interval(clock, `shc.state.${o.op}`, id, o.since, now)
      for (const [id, busy] of Object.entries(ascBusy)) if (busy) copy.interval(clock, 'asc.busyS', id, busy.since, now)
      for (const since of Object.values(driveSince)) copy.interval(clock, 'ls.roadS', 'terminal', since, now)
      for (const since of Object.values(holdSince)) copy.interval(clock, 'ls.holdS', 'terminal', since, now)
      for (const since of Object.values(berthedSince)) copy.interval(clock, 'berth.berthedS', 'terminal', since, now)
      return buildReport(config, clock, copy, now, capacityCells, [...seenDecisionPoints])
    },
  }
}

function buildReport(
  config: ScenarioConfig,
  clock: KpiClock,
  acc: Acc,
  now: number,
  capacityCells: Record<string, number>,
  seen: string[],
): KpiSeriesReport {
  const hours = hourBuckets(clock, now)
  const shifts = shiftBuckets(clock, hours, now)
  const decisionPoints = DECISION_POINT_IDS.filter((dp) => seen.includes(dp))
  const ctx: DefContext = { config, capacityCells, decisionPoints }

  // gauges carry forward through hours without events
  const carried: Record<string, Record<string, number[]>> = {}
  for (const [comp, byEntity] of Object.entries(acc.gauges)) {
    carried[comp] = {}
    for (const [entity, arr] of Object.entries(byEntity)) {
      let last = 0
      carried[comp][entity] = hours.map((hb) => (last = arr[hb.index] ?? last))
    }
  }
  const sumOver = (comp: string, entity: string, a: number, b: number): number => {
    const arr = acc.sums[comp]?.[entity]
    let s = 0
    if (arr) for (let i = a; i <= b; i++) s += arr[i] ?? 0
    return s
  }
  const window = (a: number, b: number, spanS: number): Window => ({
    spanS,
    sum: (comp, entity) => sumOver(comp, entity, a, b),
    gauge: (comp, entity) => carried[comp]?.[entity]?.[b] ?? 0,
  })
  const hourWindows = hours.map((hb) => window(hb.index, hb.index, Math.max(0, hb.endS - hb.startS)))
  const shiftWindows = shifts.map((s) => window(s.firstHour, s.lastHour, Math.max(0, s.endS - s.startS)))
  const totalWindow = window(0, hours.length - 1, now)

  const series: Record<string, KpiSeries> = {}
  for (const def of KPI_DEFS) {
    if (!defApplies(def, config, ctx)) continue
    const entities: Record<string, KpiSeriesEntity> = {}
    for (const entity of def.entities(ctx)) {
      entities[entity] = {
        hourly: hourWindows.map((w) => def.value(w, entity, ctx)),
        shifts: shiftWindows.map((w) => def.value(w, entity, ctx)),
        total: def.value(totalWindow, entity, ctx),
      }
    }
    series[def.id] = { id: def.id, unit: def.unit, entityKind: def.entityKind, entities }
  }
  return { clock, elapsedS: r3(now), hours, shifts, series }
}

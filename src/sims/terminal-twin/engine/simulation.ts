/**
 * createSimulation: the single public engine API. The CLI, tests, the Web
 * Worker host and the browser dev API all drive the engine through it.
 */
import type { EngineContext, ReactorMap } from './context'
import { createDecisionRuntime } from './decisions/runtime'
import type { AsyncMode } from './decisions/types'
import { heapPop, heapPush } from './eventQueue'
import type { EngineEvent, EventOf, EventPayloads, EventSubjects, EventType } from './events'
import type { HandlerSet } from './handlers'
import { hashDigest, hashUpdate } from './hash'
import { DEFAULT_SWEEP_EVERY, InvariantTracker, type InvariantViolation } from './invariants'
import { buildKpiReport, type KpiReport } from './kpis'
import { kpiClockOf } from './kpi/clock'
import { createKpiCollector, type KpiSeriesReport } from './kpi/collector'
import { warmUpReactors } from './subsystems/warmUp'
import { createPrefillDriver } from './subsystems/prefill'
import { createEventLogger, type LogOptions } from './logging'
import { createQuery, type SimQuery } from './query'
import { nextRandom } from './rng'
import { createInitialState, resolveSubsystemModes, type CustodyRef, type SimState } from './state'
import { ascReactors } from './subsystems/asc'
import { berthReactors } from './subsystems/berth'
import { quayReactors } from './subsystems/quay'
import { loadPrepReactors } from './subsystems/loadPrep'
import { workPackageReactors } from './subsystems/workPackages'
import { hatchReactors } from './subsystems/hatch'
import { emptiesReactors } from './subsystems/empties'
import { transshipmentReactors } from './subsystems/transshipment'
import { shcReactors } from './subsystems/shc'
import { predictedReady, type PredictedReady } from './predictions'
import { landsideReactors } from './subsystems/landside'
import type { ScenarioConfig, SubsystemModes } from '../scenario/types'
import { assertValidScenario } from '../scenario/validate'

/** Bump when engine behaviour changes in a way that invalidates snapshots. */
export const ENGINE_VERSION = '0.27.0'
export const SNAPSHOT_SCHEMA_VERSION = 1

/** Subsystem reactors, in call order (the decision runtime's bookkeeping reactors run first). */
const REACTORS: ReactorMap[] = [berthReactors, workPackageReactors, hatchReactors, quayReactors, loadPrepReactors, shcReactors, ascReactors, emptiesReactors, transshipmentReactors, landsideReactors, warmUpReactors]

export interface SimulationOptions {
  /** Overrides `config.seed`. */
  seed?: number
  /** Overrides `config.decisions.asyncMode` (default 'keep-running'). */
  asyncMode?: AsyncMode
  invariants?: {
    /** Check all invariants after every event (default true). */
    enabled?: boolean
    /** Stop the run at the first violation (default true). */
    failFast?: boolean
    /**
     * Run a full sweep of every invariant every Nth event (default 1000). Between sweeps each event is checked
     * incrementally (only the invariants and entities it touched); the event that ends the run is always swept.
     * `1` sweeps after every event.
     */
    sweepEvery?: number
  }
  /**
   * Subsystem modes (override `config.subsystems`): real, instant (same
   * events, no durations) or off. SHC defaults to real when SHCs and blocks
   * exist; ASC defaults to real when blocks exist.
   */
  subsystems?: SubsystemModes
  /**
   * Skip the pre-run phase of a pre-filled start (V11-13): the caller is about to `restore` a snapshot, which
   * brings its own state, so no handler is asked. Used by `restoreSimulation`.
   */
  skipPreRun?: boolean
  /** Structured logging: each committed event that passes the verbosity filter is written as a `LogRecord`. */
  log?: LogOptions
}

export type SimStatus = 'ready' | 'ended' | 'failed'

export interface RunCondition {
  /** Stop once all events at or before this sim time are processed; `now` becomes `time`. */
  time?: number
  /** Stop right after an event of this type. */
  eventType?: EventType
  vesselsCompleted?: number
  moves?: number
  /** Stop after this many events in this call. */
  maxEvents?: number
  /** Stop right after an event for which this returns true. */
  predicate?: (event: EngineEvent) => boolean
}

/**
 * `waiting-for-decision`: the engine cannot proceed until an async handler
 * replies (pause mode with a pending decision, or nothing else queued).
 * `runUntilAsync` awaits the reply and continues.
 */
export type StopReason = 'condition' | 'ended' | 'failed' | 'idle' | 'max-events' | 'waiting-for-decision'

export interface RunResult {
  reason: StopReason
  eventsProcessed: number
  now: number
}

export interface SimError {
  /** Event being processed when the error occurred (null if none). */
  eventId: number | null
  t: number
  message: string
}

export interface InvariantReport {
  enabled: boolean
  /** Number of events after which invariants were checked (incrementally or by a full sweep). */
  checks: number
  violations: InvariantViolation[]
}

/** Why a snapshot cannot be restored by this engine. */
export type SnapshotCompat =
  | { ok: true }
  | {
      ok: false
      reason: 'not-a-snapshot' | 'engine-version' | 'schema-version'
      savedEngineVersion?: string
      currentEngineVersion: string
    }

/** Whether `snapshot` can be restored by this engine (does not throw; `restore` throws a `SnapshotCompatError` for the same cases). */
export function checkSnapshotCompat(snapshot: SimSnapshot): SnapshotCompat {
  if (snapshot?.kind !== 'terminal-twin-snapshot') return { ok: false, reason: 'not-a-snapshot', currentEngineVersion: ENGINE_VERSION }
  if (snapshot.engineVersion !== ENGINE_VERSION)
    return { ok: false, reason: 'engine-version', savedEngineVersion: snapshot.engineVersion, currentEngineVersion: ENGINE_VERSION }
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION)
    return { ok: false, reason: 'schema-version', savedEngineVersion: snapshot.engineVersion, currentEngineVersion: ENGINE_VERSION }
  return { ok: true }
}

export class SnapshotCompatError extends Error {
  readonly reason: 'not-a-snapshot' | 'engine-version' | 'schema-version'
  readonly savedEngineVersion?: string
  readonly currentEngineVersion: string
  constructor(c: Extract<SnapshotCompat, { ok: false }>) {
    super(
      c.reason === 'not-a-snapshot'
        ? 'Not a Terminal Twin snapshot'
        : c.reason === 'engine-version'
          ? `Snapshot engine version ${c.savedEngineVersion} != ${c.currentEngineVersion}`
          : `Snapshot schema version differs from this engine's (${SNAPSHOT_SCHEMA_VERSION})`,
    )
    this.name = 'SnapshotCompatError'
    this.reason = c.reason
    this.savedEngineVersion = c.savedEngineVersion
    this.currentEngineVersion = c.currentEngineVersion
  }
}

export interface SimSnapshot {
  kind: 'terminal-twin-snapshot'
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION
  engineVersion: string
  config: ScenarioConfig
  seed: number
  status: SimStatus
  firstError: SimError | null
  invariants: InvariantReport
  state: SimState
  log: EngineEvent[]
}

export type EventListener = (event: EngineEvent) => void

export interface Simulation {
  readonly config: ScenarioConfig
  readonly seed: number
  readonly status: SimStatus
  /** Current sim time (s from scenario start). */
  readonly now: number
  /** First reactor error or invariant violation, if any. */
  readonly firstError: SimError | null
  readonly query: SimQuery
  /** Process the next event. Returns it, or null if nothing was processed. */
  step(): EngineEvent | null
  /** Run until the condition, the scenario end, a failure or an empty queue. No condition = to the end. */
  runUntil(condition?: RunCondition): RunResult
  /** Like runUntil, but awaits async (Promise) handlers instead of stopping with 'waiting-for-decision'. */
  runUntilAsync(condition?: RunCondition): Promise<RunResult>
  readonly asyncMode: AsyncMode
  snapshot(): SimSnapshot
  /** Replace this simulation's state with a snapshot's (handlers, options and subscribers are kept). */
  restore(snapshot: SimSnapshot): void
  /** The event and its cause chain back to the root: [event, parent, …, root]. */
  why(eventId: number): EngineEvent[]
  subscribe(listener: EventListener, filter?: { types?: EventType[] }): () => void
  /** Schedule an external event (dev API / tests) as an extra root (`causedBy` null) at sim time `at` (>= now). */
  inject<K extends EventType>(type: K, at: number, subjects: EventSubjects, payload: EventPayloads[K]): EventOf<K>
  eventLog(): readonly EngineEvent[]
  eventLogHash(): string
  kpiReport(): KpiReport
  /** Every KPI as hourly, per-shift and whole-run series (the collector behind the KPI strip, report and exports). */
  kpiSeries(): KpiSeriesReport
  invariantReport(): InvariantReport
  /** Predicted ready times of upcoming boxes (STS ground positions, WTP pads), soonest first (TT-R13). */
  predictedReady(): PredictedReady[]
  /** Cost of invariant checking so far (not part of the report or snapshots: wall time is not deterministic). */
  invariantStats(): InvariantStats
}

export interface InvariantStats {
  /** Events checked incrementally, and full sweeps run (the first check after a restore is a sweep). */
  incremental: number
  sweeps: number
  /** Wall time spent in invariant checks, ms. */
  wallMs: number
}

/** The event as the measured clock sees it (warm-up removed): its time and any planned motion segments move back. */
function shiftEvent(ev: EngineEvent, by: number): EngineEvent {
  const payload = ev.payload as unknown as { segments?: { t0: number; t1: number }[] }
  const shifted: unknown = Array.isArray(payload.segments)
    ? { ...payload, segments: payload.segments.map((s) => ({ ...s, t0: s.t0 - by, t1: s.t1 - by })) }
    : ev.payload
  return { ...ev, t: ev.t - by, payload: shifted } as EngineEvent
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createSimulation(
  config: ScenarioConfig,
  handlers: Partial<HandlerSet> = {},
  options: SimulationOptions = {},
): Simulation {
  assertValidScenario(config, options.subsystems)
  const seed = options.seed ?? config.seed
  const invariantsEnabled = options.invariants?.enabled ?? true
  const failFast = options.invariants?.failFast ?? true
  const sweepEvery = Math.max(1, Math.floor(options.invariants?.sweepEvery ?? DEFAULT_SWEEP_EVERY))
  const tracker = new InvariantTracker()
  let invariantWallMs = 0
  let sinceSweep = 0

  let state = createInitialState(config, seed, resolveSubsystemModes(config, options.subsystems))
  let log: EngineEvent[] = []
  let byId = new Map<number, EngineEvent>()
  let status: SimStatus = 'ready'
  let firstError: SimError | null = null
  let invariants: InvariantReport = { enabled: invariantsEnabled, checks: 0, violations: [] }
  const listeners = new Set<{ fn: EventListener; types?: Set<EventType> }>()
  const query = createQuery(() => state)
  const decisions = createDecisionRuntime({
    getState: () => state,
    config: config.decisions,
    handlers,
    asyncMode: options.asyncMode ?? config.decisions?.asyncMode ?? 'keep-running',
    query,
    scheduleFrom: (causedBy, type, at, subjects, payload) => schedule(makeEvent(type, at, causedBy, subjects, payload) as EngineEvent),
  })
  const prefill = createPrefillDriver(() => state, config, seed)
  const reactorMaps: ReactorMap[] = [decisions.reactors, ...REACTORS, prefill.reactors]
  const vesselBoxes = Object.fromEntries(Object.values(state.vessels).map((v) => [v.id, v.remainingDischarge + v.remainingLoad]))
  const startCells: Record<string, number> = {}
  for (const s of Object.values(state.yardSlots)) startCells[s.blockId] = (startCells[s.blockId] ?? 0) + s.span
  // a pre-filled start places its boxes in the pre-run phase: its stacks are counted once the last one is placed
  const initialCells = (): Record<string, number> => state.prefillCells ?? startCells
  // a warm-up start (TT-14): the KPI series start when the measured period does, on a clock moved by the warm-up
  const warmUpS = (): number => (state.warmUp?.ended ? state.warmUp.durationS : 0)
  const newCollector = () => {
    const w = state.warmUp
    if (!w?.ended)
      return createKpiCollector(config, { vesselBoxes, containerSize: (id) => state.containers[id].size, initialCells: initialCells() })
    const clock = kpiClockOf(config)
    return createKpiCollector(
      { ...config, kpi: { ...config.kpi, startTimeOfDayS: clock.startTimeOfDayS + w.durationS } },
      { vesselBoxes, containerSize: (id) => state.containers[id].size, initialCells: w.cellsAtEnd ?? {} },
    )
  }
  /** Feed the collector: warm-up events are dropped; measured events are shifted to the measured clock. */
  const feed = (ev: EngineEvent): void => {
    // the pre-run phase is not part of the measured run: its decisions are in the log but not in the KPI series.
    // The collector starts from the stacks the pre-run built, so it is renewed once the last box is placed.
    if ((ev.payload as { preRun?: boolean }).preRun) {
      if (state.prefillCells && !collectorSeeded) {
        collectorSeeded = true
        collector = newCollector()
      }
      return
    }
    const w = state.warmUp
    if (!w) return collector.ingest(ev)
    if (ev.type === 'WarmUpEnded') collector = newCollector()
    if (!w.ended || ev.t < w.durationS) return
    collector.ingest(shiftEvent(ev, w.durationS))
  }
  let collectorSeeded = false
  let collector = newCollector()
  if (options.log) listeners.add({ fn: createEventLogger(options.log) })

  function makeEvent<K extends EventType>(
    type: K,
    t: number,
    causedBy: number | null,
    subjects: EventSubjects,
    payload: EventPayloads[K],
  ): EventOf<K> {
    return { id: state.nextEventId++, seq: -1, t, type, causedBy, subjects, payload }
  }

  function schedule(ev: EngineEvent): void {
    if (ev.t < state.now) throw new Error(`Cannot schedule ${ev.type} at ${ev.t} before now (${state.now})`)
    heapPush(state.queue, ev)
  }

  /** The event's JSON for the log hash. A measured wall latency is not reproducible with a real async handler, so it is not hashed. */
  function hashedJson(ev: EngineEvent): string {
    if (ev.type === 'DecisionResolved' && ev.payload.wallLatencyMs !== undefined) {
      return JSON.stringify(ev, (k, v) => (k === 'wallLatencyMs' ? undefined : v))
    }
    return JSON.stringify(ev)
  }

  /** Append a processed event to the log, hash it and notify subscribers. */
  function commit(ev: EngineEvent): void {
    ev.seq = state.nextSeq++
    log.push(ev)
    byId.set(ev.id, ev)
    feed(ev)
    state.logHash = hashUpdate(state.logHash, hashedJson(ev))
    for (const l of listeners) if (!l.types || l.types.has(ev.type)) l.fn(ev)
  }

  function fail(error: SimError): void {
    status = 'failed'
    firstError ??= error
  }

  function endScenario(reason: string, t: number, causedBy: number | null): void {
    state.now = t
    state.ended = { reason, t }
    commit(makeEvent('ScenarioEnded', t, causedBy, {}, { reason }))
    status = 'ended'
  }

  /** Sim time at which `simDurationS` is reached: it counts the measured period, so a warm-up comes first. */
  function durationEnd(): number | undefined {
    const d = config.endConditions.simDurationS
    return d === undefined ? undefined : d + (state.warmUp?.durationS ?? 0)
  }

  function endConditionMet(): string | null {
    const ec = config.endConditions
    // no end condition configured: end when every scheduled vessel has departed
    if (state.warmUp && !state.warmUp.ended) return null // warm-up counts toward nothing
    if (ec.vesselsCompleted === undefined && ec.moves === undefined && ec.simDurationS === undefined) {
      const n = config.vessels.length - (state.warmUp?.vesselsCompletedBefore ?? 0)
      return n > 0 && state.kpis.vesselsCompleted >= n ? `vesselsCompleted >= ${n}` : null
    }
    if (ec.vesselsCompleted !== undefined && state.kpis.vesselsCompleted >= ec.vesselsCompleted)
      return `vesselsCompleted >= ${ec.vesselsCompleted}`
    if (ec.moves !== undefined && state.kpis.movesCompleted >= ec.moves) return `moves >= ${ec.moves}`
    return null
  }

  function makeContext(current: EngineEvent): EngineContext {
    const ctx: EngineContext = {
      state,
      config,
      query,
      current,
      schedule: (type, at, subjects, payload) => {
        const ev = makeEvent(type, at, current.id, subjects, payload)
        schedule(ev as EngineEvent)
        return ev
      },
      requestDecision: (dp, request, subjects, opts) => decisions.request(ctx, dp, request, subjects, opts),
      random: () => {
        const [value, next] = nextRandom(state.rngState)
        state.rngState = next
        return value
      },
      transferCustody: (containerId: string, to: CustodyRef) => {
        const box = state.containers[containerId]
        if (!box) throw new Error(`transferCustody: unknown container ${containerId}`)
        box.custody = { ...to }
        box.custodyHistory.push({ t: state.now, owner: { ...to }, eventId: current.id })
      },
    }
    return ctx
  }

  function react(ev: EngineEvent): void {
    const ctx = makeContext(ev)
    for (const reactors of reactorMaps) {
      const reactor = reactors[ev.type] as ((e: EngineEvent, c: EngineContext) => void) | undefined
      reactor?.(ev, ctx)
    }
  }

  /**
   * Check the invariants after `ev`: incrementally, or by a full sweep when one is due or `forceSweep` is set.
   * Violations are logged; returns true when a fail-fast violation stopped the run.
   */
  function checkInvariants(ev: EngineEvent, forceSweep: boolean, counted = true): boolean {
    const started = performance.now()
    const sweep = ++sinceSweep >= sweepEvery || forceSweep
    if (sweep) sinceSweep = 0
    if (counted) invariants.checks++ // `checks` is in the golden summaries: the closing sweep of a duration-ended run is not an event check
    const violations = sweep ? tracker.sweep(state, config) : tracker.check(state, config, ev)
    invariantWallMs += performance.now() - started
    for (const v of violations) {
      invariants.violations.push({ ...v, eventId: ev.id, t: ev.t })
      commit(
        makeEvent('InvariantViolated', ev.t, ev.id, {}, {
          invariant: v.invariant,
          message: v.message,
          offendingEventId: ev.id,
        }),
      )
      if (failFast) fail({ eventId: ev.id, t: ev.t, message: `[${v.invariant}] ${v.message}` })
    }
    return violations.length > 0 && failFast
  }

  function step(): EngineEvent | null {
    if (status !== 'ready') return null
    decisions.drain()
    if (decisions.waiting()) return null
    const next = state.queue[0]
    const duration = durationEnd()
    if (duration !== undefined && (!next || next.t > duration)) {
      // the run's last event is always swept, even when the run ends on its duration instead of on an event
      if (invariantsEnabled && sinceSweep > 0 && log.length > 0 && checkInvariants(log[log.length - 1], true, false)) return log[log.length - 1]
      endScenario(`simDurationS >= ${config.endConditions.simDurationS}`, Math.max(state.now, duration), null)
      return log[log.length - 1]
    }
    const ev = heapPop(state.queue)
    if (!ev) return null
    state.now = ev.t
    try {
      react(ev)
    } catch (err) {
      commit(ev)
      fail({ eventId: ev.id, t: ev.t, message: err instanceof Error ? err.message : String(err) })
      return ev
    }
    commit(ev)
    const endReason = endConditionMet()
    // the pre-run phase builds the yard box by box: nothing runs yet, so its events are not checked one by one;
    // the last pre-run event is swept (the whole starting state)
    const midPreRun = state.prefill !== undefined
    const endsPreRun = !midPreRun && (ev.payload as { preRun?: boolean }).preRun === true
    if (invariantsEnabled && !midPreRun && checkInvariants(ev, Boolean(endReason) || endsPreRun)) return ev
    if (endReason) endScenario(endReason, ev.t, ev.id)
    return ev
  }

  function runUntil(cond: RunCondition = {}): RunResult {
    let processed = 0
    const done = (reason: StopReason): RunResult => ({ reason, eventsProcessed: processed, now: state.now })
    for (;;) {
      if (status === 'ended') return done('ended')
      if (status === 'failed') return done('failed')
      if (cond.maxEvents !== undefined && processed >= cond.maxEvents) return done('max-events')
      decisions.drain()
      // keep-running + a time condition: the clock may advance past an in-flight async reply
      if (decisions.waiting() && (decisions.asyncMode === 'pause' || cond.time === undefined))
        return done('waiting-for-decision')
      const next = state.queue[0]
      if (cond.time !== undefined && (!next || next.t > cond.time)) {
        const duration = durationEnd()
        if (duration === undefined || cond.time < duration) {
          state.now = Math.max(state.now, cond.time)
          return done('condition')
        }
      }
      const ev = step()
      if (!ev) return done('idle')
      processed++
      if (cond.eventType !== undefined && ev.type === cond.eventType) return done('condition')
      if (cond.predicate?.(ev)) return done('condition')
      if (cond.vesselsCompleted !== undefined && state.kpis.vesselsCompleted >= cond.vesselsCompleted)
        return done('condition')
      if (cond.moves !== undefined && state.kpis.movesCompleted >= cond.moves) return done('condition')
    }
  }

  async function runUntilAsync(cond: RunCondition = {}): Promise<RunResult> {
    let processed = 0
    for (;;) {
      const left = cond.maxEvents === undefined ? undefined : cond.maxEvents - processed
      const result = runUntil({ ...cond, maxEvents: left })
      processed += result.eventsProcessed
      if (result.reason !== 'waiting-for-decision') return { ...result, eventsProcessed: processed }
      await decisions.nextSettled()
    }
  }

  // Root event: everything else descends from it. A pre-filled start runs its pre-run phase first (the last
  // pre-run decision schedules ScenarioStarted); a synchronous handler completes it right here, an async one
  // leaves it in flight (the run then reports `waiting-for-decision`).
  if (!state.prefill) schedule(makeEvent('ScenarioStarted', 0, null, {}, { scenario: config.name, seed }))
  else if (!options.skipPreRun) {
    const rootEvent = { id: -1, seq: -1, t: 0, type: 'ScenarioStarted', causedBy: null, subjects: {}, payload: { scenario: config.name, seed } } as EngineEvent
    const root: EngineContext = {
      ...makeContext(rootEvent),
      schedule: (type, at, subjects, payload) => {
        const ev = makeEvent(type, at, null, subjects, payload)
        schedule(ev as EngineEvent)
        return ev
      },
      requestDecision: (dp, request, subjects, opts) => decisions.request(root, dp, request, subjects, opts),
    }
    prefill.start(root)
    while (status === 'ready' && state.prefill && step()) {
      // run the pre-run phase while it needs no async reply
    }
  }

  return {
    config,
    seed,
    get status() {
      return status
    },
    get now() {
      return state.now
    },
    get firstError() {
      return firstError
    },
    get asyncMode() {
      return decisions.asyncMode
    },
    query,
    step,
    runUntil,
    runUntilAsync,
    snapshot: () =>
      clone({
        kind: 'terminal-twin-snapshot',
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        config,
        seed,
        status,
        firstError,
        invariants,
        state,
        log,
      }),
    restore(snapshot) {
      const compat = checkSnapshotCompat(snapshot)
      if (!compat.ok) throw new SnapshotCompatError(compat)
      const copy = clone(snapshot)
      state = copy.state
      log = copy.log
      byId = new Map(log.map((e) => [e.id, e]))
      status = copy.status
      firstError = copy.firstError
      invariants = { ...copy.invariants, enabled: invariantsEnabled }
      tracker.reset()
      decisions.reset()
      prefill.reset()
      collectorSeeded = Boolean(state.prefillCells)
      collector = newCollector()
      for (const ev of log) feed(ev)
    },
    why(eventId) {
      const chain: EngineEvent[] = []
      let ev = byId.get(eventId)
      if (!ev) throw new Error(`why: event ${eventId} is not in the log`)
      while (ev) {
        chain.push(ev)
        ev = ev.causedBy === null ? undefined : byId.get(ev.causedBy)
      }
      return chain
    },
    subscribe(fn, filter) {
      const entry = { fn, types: filter?.types ? new Set(filter.types) : undefined }
      listeners.add(entry)
      return () => listeners.delete(entry)
    },
    inject(type, at, subjects, payload) {
      const ev = makeEvent(type, at, null, subjects, payload)
      schedule(ev as EngineEvent)
      return ev
    },
    eventLog: () => log,
    eventLogHash: () => hashDigest(state.logHash),
    kpiReport: () => {
      const report = buildKpiReport(state, log.length)
      // time per operational state and handovers come from the collector (measured period)
      const totals = collector.shcTotals(Math.max(0, state.now - warmUpS()))
      for (const [id, k] of Object.entries(report.horizontal?.shcs ?? {})) Object.assign(k, totals[id])
      return report
    },
    kpiSeries: () => collector.report(Math.max(0, state.now - warmUpS())),
    invariantReport: () => clone(invariants),
    predictedReady: () => predictedReady({ state, config }),
    invariantStats: () => ({ ...tracker.stats, wallMs: invariantWallMs }),
  }
}

/** Create a simulation from a snapshot (config and seed come from the snapshot). */
export function restoreSimulation(
  snapshot: SimSnapshot,
  handlers: Partial<HandlerSet> = {},
  options: Omit<SimulationOptions, 'seed'> = {},
): Simulation {
  const sim = createSimulation(snapshot.config, handlers, { ...options, seed: snapshot.seed, skipPreRun: true })
  sim.restore(snapshot)
  return sim
}

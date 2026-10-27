/**
 * createSimulation: the single public engine API. The CLI, tests, the Web
 * Worker host and the browser dev API all drive the engine through it.
 */
import type { EngineContext, ReactorMap } from './context'
import { heapPop, heapPush } from './eventQueue'
import type { EngineEvent, EventOf, EventPayloads, EventSubjects, EventType } from './events'
import { defaultHandlers, type HandlerSet } from './handlers'
import { hashDigest, hashUpdate } from './hash'
import { checkInvariants, type InvariantViolation } from './invariants'
import { buildKpiReport, type KpiReport } from './kpis'
import { createEventLogger, type LogOptions } from './logging'
import { createQuery, type SimQuery } from './query'
import { nextRandom } from './rng'
import { createInitialState, type CustodyRef, type SimState } from './state'
import { quayReactors } from './subsystems/quay'
import type { ScenarioConfig } from '../scenario/types'

/** Bump when engine behaviour changes in a way that invalidates snapshots. */
export const ENGINE_VERSION = '0.1.0'
export const SNAPSHOT_SCHEMA_VERSION = 1

const REACTORS: ReactorMap[] = [quayReactors]

export interface SimulationOptions {
  /** Overrides `config.seed`. */
  seed?: number
  invariants?: {
    /** Check all invariants after every event (default true). */
    enabled?: boolean
    /** Stop the run at the first violation (default true). */
    failFast?: boolean
  }
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

export type StopReason = 'condition' | 'ended' | 'failed' | 'idle' | 'max-events'

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
  /** Number of events after which all invariants were checked. */
  checks: number
  violations: InvariantViolation[]
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
  snapshot(): SimSnapshot
  /** Replace this simulation's state with a snapshot's (handlers, options and subscribers are kept). */
  restore(snapshot: SimSnapshot): void
  /** The event and its cause chain back to the root: [event, parent, …, root]. */
  why(eventId: number): EngineEvent[]
  subscribe(listener: EventListener, filter?: { types?: EventType[] }): () => void
  eventLog(): readonly EngineEvent[]
  eventLogHash(): string
  kpiReport(): KpiReport
  invariantReport(): InvariantReport
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createSimulation(
  config: ScenarioConfig,
  handlers: Partial<HandlerSet> = {},
  options: SimulationOptions = {},
): Simulation {
  const handlerSet: HandlerSet = { ...defaultHandlers, ...handlers }
  const seed = options.seed ?? config.seed
  const invariantsEnabled = options.invariants?.enabled ?? true
  const failFast = options.invariants?.failFast ?? true

  let state = createInitialState(config, seed)
  let log: EngineEvent[] = []
  let byId = new Map<number, EngineEvent>()
  let status: SimStatus = 'ready'
  let firstError: SimError | null = null
  let invariants: InvariantReport = { enabled: invariantsEnabled, checks: 0, violations: [] }
  const listeners = new Set<{ fn: EventListener; types?: Set<EventType> }>()
  const query = createQuery(() => state)
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

  /** Append a processed event to the log, hash it and notify subscribers. */
  function commit(ev: EngineEvent): void {
    ev.seq = state.nextSeq++
    log.push(ev)
    byId.set(ev.id, ev)
    state.logHash = hashUpdate(state.logHash, JSON.stringify(ev))
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

  function endConditionMet(): string | null {
    const ec = config.endConditions
    if (ec.vesselsCompleted !== undefined && state.kpis.vesselsCompleted >= ec.vesselsCompleted)
      return `vesselsCompleted >= ${ec.vesselsCompleted}`
    if (ec.moves !== undefined && state.kpis.movesCompleted >= ec.moves) return `moves >= ${ec.moves}`
    return null
  }

  function makeContext(current: EngineEvent): EngineContext {
    return {
      state,
      config,
      handlers: handlerSet,
      query,
      current,
      schedule: (type, at, subjects, payload) => {
        const ev = makeEvent(type, at, current.id, subjects, payload)
        schedule(ev as EngineEvent)
        return ev
      },
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
  }

  function react(ev: EngineEvent): void {
    const ctx = makeContext(ev)
    for (const reactors of REACTORS) {
      const reactor = reactors[ev.type] as ((e: EngineEvent, c: EngineContext) => void) | undefined
      reactor?.(ev, ctx)
    }
  }

  function step(): EngineEvent | null {
    if (status !== 'ready') return null
    const next = state.queue[0]
    const duration = config.endConditions.simDurationS
    if (duration !== undefined && (!next || next.t > duration)) {
      endScenario(`simDurationS >= ${duration}`, Math.max(state.now, duration), null)
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
    if (invariantsEnabled) {
      invariants.checks++
      const violations = checkInvariants(state)
      for (const v of violations) {
        const violation = { ...v, eventId: ev.id, t: ev.t }
        invariants.violations.push(violation)
        commit(
          makeEvent('InvariantViolated', ev.t, ev.id, {}, {
            invariant: v.invariant,
            message: v.message,
            offendingEventId: ev.id,
          }),
        )
        if (failFast) fail({ eventId: ev.id, t: ev.t, message: `[${v.invariant}] ${v.message}` })
      }
      if (violations.length > 0 && failFast) return ev
    }
    const reason = endConditionMet()
    if (reason) endScenario(reason, ev.t, ev.id)
    return ev
  }

  function runUntil(cond: RunCondition = {}): RunResult {
    let processed = 0
    const done = (reason: StopReason): RunResult => ({ reason, eventsProcessed: processed, now: state.now })
    for (;;) {
      if (status === 'ended') return done('ended')
      if (status === 'failed') return done('failed')
      if (cond.maxEvents !== undefined && processed >= cond.maxEvents) return done('max-events')
      const next = state.queue[0]
      if (cond.time !== undefined && (!next || next.t > cond.time)) {
        const duration = config.endConditions.simDurationS
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

  // Root event: everything else descends from it.
  schedule(makeEvent('ScenarioStarted', 0, null, {}, { scenario: config.name, seed }))

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
    query,
    step,
    runUntil,
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
      if (snapshot.kind !== 'terminal-twin-snapshot') throw new Error('Not a Terminal Twin snapshot')
      if (snapshot.engineVersion !== ENGINE_VERSION)
        throw new Error(`Snapshot engine version ${snapshot.engineVersion} != ${ENGINE_VERSION}`)
      const copy = clone(snapshot)
      state = copy.state
      log = copy.log
      byId = new Map(log.map((e) => [e.id, e]))
      status = copy.status
      firstError = copy.firstError
      invariants = { ...copy.invariants, enabled: invariantsEnabled }
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
    eventLog: () => log,
    eventLogHash: () => hashDigest(state.logHash),
    kpiReport: () => buildKpiReport(state, log.length),
    invariantReport: () => clone(invariants),
  }
}

/** Create a simulation from a snapshot (config and seed come from the snapshot). */
export function restoreSimulation(
  snapshot: SimSnapshot,
  handlers: Partial<HandlerSet> = {},
  options: Omit<SimulationOptions, 'seed'> = {},
): Simulation {
  const sim = createSimulation(snapshot.config, handlers, { ...options, seed: snapshot.seed })
  sim.restore(snapshot)
  return sim
}

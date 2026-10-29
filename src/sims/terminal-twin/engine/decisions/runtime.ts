/**
 * Decision runtime: routes decision requests to handlers, applies the
 * latency injector and the async mode, handles timeouts/errors with the
 * fallback strategy, and keeps per-handler KPIs.
 *
 * Event flow for one decision (all events carry the correlation id):
 *
 *   <asking reactor> ctx.requestDecision(dp, request, subjects)
 *     → DecisionRequested     handler called here
 *     → [DecisionFailed]      timeout or error: the fallback strategy answers
 *     → DecisionResolved      bookkeeping here, then the asking subsystem's
 *                             DecisionResolved reactor acts on the reply
 *
 * Timing of DecisionResolved/DecisionFailed after the request (a pre-run decision, see subsystems/prefill.ts, always resolves at the same sim time):
 *   - sync handler, no injection: same sim time (same event step);
 *   - injected delay d ms: keep-running → now + d/1000 × simSecondsPerWallSecond;
 *     pause → now (the sim clock is frozen while the decision is pending);
 *   - async handler (Promise): when the Promise settles, at the sim time the
 *     engine has reached when it next gets control (see `drain`).
 *
 * All of this state is plain JSON in `SimState.decisions`, except in-flight
 * Promises, which live only in this runtime (a restore re-sends them).
 */
import type { EngineContext, ReactorMap } from '../context'
import type { EventPayloads, EventSubjects, EventType } from '../events'
import type { SimQuery } from '../query'
import { seedState } from '../rng'
import type { SimState } from '../state'
import { decisionRng, drawInjection, type Injection } from './latency'
import { getStrategy, strategies } from './strategies'
import {
  DECISION_CONTRACT_VERSIONS,
  DECISION_POINT_IDS,
  DEFAULT_DECISION_TIMEOUT_MS,
  type AsyncMode,
  type DecisionHandler,
  type DecisionPointConfig,
  type DecisionPointId,
  type DecisionRequestMessage,
  type DecisionRequests,
  type DecisionsConfig,
  type HandlerSet,
} from './types'

export interface PendingDecision {
  correlationId: string
  decisionPoint: DecisionPointId
  message: DecisionRequestMessage
  requestEventId: number
  requestedAt: number
  /** Equipment idling while it waits (from the request's subjects). */
  equipment: string[]
  injection: Injection
  /** True while an async handler's Promise has not settled into the queue. */
  awaitingExternal: boolean
  /** Wall latency (injected + measured), known once the outcome is scheduled. */
  wallMs: number
  /** A pre-run decision (before the scenario starts): resolved at the same sim time whatever the latency. */
  preRun?: true
  /** Containers the request concerns (from its subjects), carried onto the outcome events. */
  containers?: string[]
}

export interface HandlerKpiCounters {
  handler: string
  calls: number
  resolved: number
  ok: number
  fallbacks: number
  timeouts: number
  errors: number
  /** Async replies that arrived after their timeout (discarded). */
  lateReplies: number
  maxPending: number
  simLatencyTotalS: number
  simLatencyMaxS: number
  wallLatencyTotalMs: number
  wallLatencyMaxMs: number
  /** Σ over decisions of sim latency × equipment waiting on it. */
  equipmentIdleS: number
}

export interface DecisionState {
  nextCorrelation: number
  /** Separate RNG stream for the latency injector. */
  rngState: number
  pending: Record<string, PendingDecision>
  kpis: Record<string, HandlerKpiCounters>
}

/** Mixed into the seed so the injector stream differs from the main RNG. */
const DECISION_RNG_SALT = 0x5bd1e995

export function createDecisionState(seed: number): DecisionState {
  const kpis: Record<string, HandlerKpiCounters> = {}
  for (const dp of DECISION_POINT_IDS) {
    kpis[dp] = {
      handler: '',
      calls: 0,
      resolved: 0,
      ok: 0,
      fallbacks: 0,
      timeouts: 0,
      errors: 0,
      lateReplies: 0,
      maxPending: 0,
      simLatencyTotalS: 0,
      simLatencyMaxS: 0,
      wallLatencyTotalMs: 0,
      wallLatencyMaxMs: 0,
      equipmentIdleS: 0,
    }
  }
  return { nextCorrelation: 0, rngState: seedState(seed ^ DECISION_RNG_SALT), pending: {}, kpis }
}

/** Subjects of a decision's outcome events: the waiting equipment, plus the boxes of a pre-run decision (so invariants see them). */
const outcomeSubjects = (p: PendingDecision): EventSubjects => (p.containers ? { equipment: p.equipment, containers: p.containers } : { equipment: p.equipment })

type Outcome = { reply: unknown } | { failure: 'timeout' | 'error'; message: string }

type ScheduleFn = <K extends EventType>(type: K, at: number, subjects: EventSubjects, payload: EventPayloads[K]) => void

export interface DecisionRuntimeDeps {
  getState(): SimState
  config: DecisionsConfig | undefined
  handlers: Partial<HandlerSet>
  asyncMode: AsyncMode
  query: SimQuery
  /** Schedule an event caused by `causedBy` (used when draining async replies). */
  scheduleFrom: <K extends EventType>(
    causedBy: number,
    type: K,
    at: number,
    subjects: EventSubjects,
    payload: EventPayloads[K],
  ) => void
}

export interface DecisionRuntime {
  readonly asyncMode: AsyncMode
  /** Bookkeeping reactors for DecisionRequested / DecisionFailed / DecisionResolved. */
  readonly reactors: ReactorMap
  /** Send a request (called by reactors through `ctx.requestDecision`). */
  request<K extends DecisionPointId>(
    ctx: EngineContext,
    dp: K,
    request: DecisionRequests[K],
    subjects: EventSubjects,
    options?: { preRun?: boolean },
  ): string
  /** Schedule outcomes of async handlers that settled since the last call. */
  drain(): void
  /** True if the engine must not process the next event yet (see `waiting-for-decision`). */
  waiting(): boolean
  /** Resolves when an in-flight async decision settles (immediately if one already has). */
  nextSettled(): Promise<void>
  /** After a restore: forget in-flight Promises and re-send pending async requests. */
  reset(): void
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

const nowMs = () => performance.now()

export function createDecisionRuntime(deps: DecisionRuntimeDeps): DecisionRuntime {
  const { getState, asyncMode, query } = deps
  const scale = deps.config?.simSecondsPerWallSecond ?? 1
  const pointConfig = (dp: DecisionPointId): DecisionPointConfig => deps.config?.points?.[dp] ?? {}
  const timeoutMs = (dp: DecisionPointId) => pointConfig(dp).timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS

  // Resolve every decision point's handler and fallback up front, so a bad
  // strategy name fails at createSimulation rather than mid-run.
  const resolved = {} as Record<DecisionPointId, { fn: DecisionHandler<DecisionPointId>; name: string }>
  const fallbacks = {} as Record<DecisionPointId, { fn: DecisionHandler<DecisionPointId>; name: string }>
  for (const dp of DECISION_POINT_IDS) {
    const cfg = pointConfig(dp)
    const custom = deps.handlers[dp]
    const strategy = cfg.strategy ?? strategies[dp].default
    resolved[dp] = custom
      ? { fn: custom as DecisionHandler<DecisionPointId>, name: 'custom' }
      : { fn: getStrategy(dp, strategy), name: `strategy:${strategy}` }
    const fb = cfg.fallbackStrategy ?? strategies[dp].default
    fallbacks[dp] = { fn: getStrategy(dp, fb), name: `fallback:${fb}` }
  }

  // In-flight async decisions (not in SimState: Promises are not JSON).
  const inflight = new Map<string, { started: number; timer: ReturnType<typeof setTimeout> }>()
  const inbox: { correlationId: string; outcome: Outcome; externalMs: number }[] = []
  let wake: (() => void) | null = null

  function labelHandlers(): void {
    for (const dp of DECISION_POINT_IDS) getState().decisions.kpis[dp].handler = resolved[dp].name
  }
  labelHandlers()

  const wallField = (ms: number) => (ms > 0 ? { wallLatencyMs: Math.round(ms * 1000) / 1000 } : {})

  /** Turn an outcome + injection into a scheduled DecisionResolved or DecisionFailed. */
  function deliver(p: PendingDecision, outcome: Outcome, externalMs: number, schedule: ScheduleFn): void {
    const inj = p.injection
    let failure: { failure: 'timeout' | 'error'; message: string } | null = null
    let delayMs: number
    if (inj.kind === 'timeout') {
      delayMs = timeoutMs(p.decisionPoint)
      failure = { failure: 'timeout', message: `no reply within ${delayMs} ms (injected)` }
    } else {
      delayMs = inj.delayMs
      if (inj.kind === 'error') failure = { failure: 'error', message: 'injected error reply' }
      else if ('failure' in outcome) failure = outcome
    }
    p.wallMs = delayMs + externalMs
    const state = getState()
    // a pre-run decision never moves the sim clock: the wall latency is still measured and counted
    const at = state.now + (asyncMode === 'keep-running' && !p.preRun ? (delayMs / 1000) * scale : 0)
    const subjects = outcomeSubjects(p)
    const base = { correlationId: p.correlationId, decisionPoint: p.decisionPoint, ...(p.preRun ? { preRun: true as const } : {}) }
    if (failure) {
      schedule('DecisionFailed', at, subjects, { ...base, ...failure, fallback: fallbacks[p.decisionPoint].name })
    } else {
      schedule('DecisionResolved', at, subjects, {
        ...base,
        version: p.message.version,
        outcome: 'ok',
        handler: resolved[p.decisionPoint].name,
        request: p.message.payload,
        reply: (outcome as { reply: unknown }).reply,
        ...wallField(p.wallMs),
      } as EventPayloads['DecisionResolved'])
    }
  }

  function settle(correlationId: string, outcome: Outcome, externalMs: number): void {
    const entry = inflight.get(correlationId)
    if (!entry) {
      const p = getState().decisions.pending[correlationId]
      const dp = p?.decisionPoint ?? (correlationId.split('-')[0] as DecisionPointId)
      const kpi = getState().decisions.kpis[dp]
      if (kpi) kpi.lateReplies++
      return
    }
    clearTimeout(entry.timer)
    inflight.delete(correlationId)
    inbox.push({ correlationId, outcome, externalMs })
    wake?.()
    wake = null
  }

  function send(p: PendingDecision, schedule: ScheduleFn): void {
    const handler = resolved[p.decisionPoint].fn
    let result: unknown
    try {
      result = handler(p.message as DecisionRequestMessage<DecisionPointId>, query)
    } catch (err) {
      deliver(p, { failure: 'error', message: `handler threw: ${errorMessage(err)}` }, 0, schedule)
      return
    }
    if (!isThenable(result)) {
      deliver(p, { reply: result }, 0, schedule)
      return
    }
    p.awaitingExternal = true
    const started = nowMs()
    const limit = timeoutMs(p.decisionPoint)
    const timer = setTimeout(
      () => settle(p.correlationId, { failure: 'timeout', message: `no reply within ${limit} ms` }, limit),
      limit,
    )
    inflight.set(p.correlationId, { started, timer })
    result.then(
      (reply) => settle(p.correlationId, { reply }, nowMs() - started),
      (err: unknown) =>
        settle(p.correlationId, { failure: 'error', message: `handler rejected: ${errorMessage(err)}` }, nowMs() - started),
    )
  }

  const reactors: ReactorMap = {
    DecisionRequested: (e, ctx) => {
      const { decisions } = ctx.state
      const dp = e.payload.decisionPoint
      const message: DecisionRequestMessage = {
        correlationId: e.payload.correlationId,
        decisionPoint: dp,
        version: e.payload.version,
        t: e.t,
        payload: e.payload.request,
      }
      const p: PendingDecision = {
        correlationId: message.correlationId,
        decisionPoint: dp,
        message,
        requestEventId: e.id,
        requestedAt: e.t,
        equipment: e.subjects.equipment ?? [],
        injection: drawInjection(pointConfig(dp).latency, timeoutMs(dp), decisionRng(decisions)),
        awaitingExternal: false,
        wallMs: 0,
        ...(e.payload.preRun ? { preRun: true as const } : {}),
        ...(e.payload.preRun && e.subjects.containers ? { containers: e.subjects.containers } : {}),
      }
      decisions.pending[p.correlationId] = p
      const kpi = decisions.kpis[dp]
      kpi.calls++
      kpi.maxPending = Math.max(kpi.maxPending, Object.keys(decisions.pending).length)
      send(p, ctx.schedule)
    },

    DecisionFailed: (e, ctx) => {
      const p = ctx.state.decisions.pending[e.payload.correlationId]
      if (!p) throw new Error(`DecisionFailed for unknown decision ${e.payload.correlationId}`)
      const kpi = ctx.state.decisions.kpis[p.decisionPoint]
      if (e.payload.failure === 'timeout') kpi.timeouts++
      else kpi.errors++
      const fb = fallbacks[p.decisionPoint]
      const reply = fb.fn(p.message as DecisionRequestMessage<DecisionPointId>, query)
      if (isThenable(reply)) throw new Error(`Fallback strategy ${fb.name} must be synchronous`)
      ctx.schedule('DecisionResolved', e.t, outcomeSubjects(p), {
        correlationId: p.correlationId,
        decisionPoint: p.decisionPoint,
        ...(p.preRun ? { preRun: true as const } : {}),
        version: p.message.version,
        outcome: 'fallback',
        handler: fb.name,
        request: p.message.payload,
        reply,
        ...wallField(p.wallMs),
      } as EventPayloads['DecisionResolved'])
    },

    DecisionResolved: (e, ctx) => {
      const { decisions } = ctx.state
      const p = decisions.pending[e.payload.correlationId]
      if (!p) throw new Error(`DecisionResolved for unknown decision ${e.payload.correlationId}`)
      delete decisions.pending[p.correlationId]
      const kpi = decisions.kpis[p.decisionPoint]
      const simLatency = e.t - p.requestedAt
      kpi.resolved++
      if (e.payload.outcome === 'ok') kpi.ok++
      else kpi.fallbacks++
      kpi.simLatencyTotalS += simLatency
      kpi.simLatencyMaxS = Math.max(kpi.simLatencyMaxS, simLatency)
      kpi.wallLatencyTotalMs += p.wallMs
      kpi.wallLatencyMaxMs = Math.max(kpi.wallLatencyMaxMs, p.wallMs)
      kpi.equipmentIdleS += simLatency * p.equipment.length
    },
  }

  return {
    asyncMode,
    reactors,
    request(ctx, dp, request, subjects, options) {
      const decisions = ctx.state.decisions
      const correlationId = `${dp}-${++decisions.nextCorrelation}`
      ctx.schedule('DecisionRequested', ctx.state.now, subjects, {
        correlationId,
        decisionPoint: dp,
        version: DECISION_CONTRACT_VERSIONS[dp],
        request,
        ...(options?.preRun ? { preRun: true as const } : {}),
      } as EventPayloads['DecisionRequested'])
      return correlationId
    },
    drain() {
      while (inbox.length > 0) {
        const { correlationId, outcome, externalMs } = inbox.shift()!
        const p = getState().decisions.pending[correlationId]
        if (!p || !p.awaitingExternal) continue
        p.awaitingExternal = false
        deliver(p, outcome, externalMs, (type, at, subjects, payload) =>
          deps.scheduleFrom(p.requestEventId, type, at, subjects, payload),
        )
      }
    },
    waiting() {
      const state = getState()
      const next = state.queue[0]
      const pending = Object.values(state.decisions.pending)
      if (asyncMode === 'pause' && pending.length > 0 && (!next || next.t > state.now)) return true
      return !next && pending.some((p) => p.awaitingExternal)
    },
    nextSettled() {
      if (inbox.length > 0 || inflight.size === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        wake = resolve
      })
    },
    reset() {
      for (const { timer } of inflight.values()) clearTimeout(timer)
      inflight.clear()
      inbox.length = 0
      labelHandlers()
      for (const p of Object.values(getState().decisions.pending)) {
        if (!p.awaitingExternal) continue
        send(p, (type, at, subjects, payload) => deps.scheduleFrom(p.requestEventId, type, at, subjects, payload))
      }
    },
  }
}

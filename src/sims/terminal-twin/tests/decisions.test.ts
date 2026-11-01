/**
 * Seam 2, decision-point handler interfaces (TOS seams), driven through the
 * public engine API: scripted handlers, strategies, async modes, the latency
 * injector, timeouts/errors with fallback, and per-handler KPIs.
 */
import { describe, expect, it } from 'vitest'
import { createSimulation, diffEventLogs, restoreSimulation, strategies, type EngineEvent, type EventOf, type HandlerSet } from '../engine'
import { ScenarioBuilder } from '../scenario/builder'
import { fixtures } from '../scenario/fixtures'
import type { ScenarioConfig } from '../scenario/types'

const tracer = fixtures['tracer-1sts-10-boxes']

const ofType = <K extends EngineEvent['type']>(sim: { eventLog(): readonly EngineEvent[] }, type: K) =>
  sim.eventLog().filter((e) => e.type === type) as unknown as EventOf<K>[]

/** Decision events of the ground-position decision point only (berth and crane-split decisions also run). */
const gpOfType = <K extends 'DecisionRequested' | 'DecisionResolved'>(sim: { eventLog(): readonly EngineEvent[] }, type: K) =>
  ofType(sim, type).filter((e) => e.payload.decisionPoint === 'stsGroundPosition')

/** Run condition: stop right after a ground-position decision event of this type. */
const gpEvent = (type: 'DecisionRequested' | 'DecisionResolved') => ({
  predicate: (e: EngineEvent) => e.type === type && e.payload.decisionPoint === 'stsGroundPosition',
})

describe('swapping a handler through the engine API', () => {
  it('a scripted handler replaces the built-in strategy and receives message-shaped requests', () => {
    const received: { correlationId: string; decisionPoint: string; version: number; stsId: string }[] = []
    // Scripted TOS: fill the lanes from the far end.
    const scripted: Partial<HandlerSet> = {
      stsGroundPosition: (msg) => {
        received.push({
          correlationId: msg.correlationId,
          decisionPoint: msg.decisionPoint,
          version: msg.version,
          stsId: msg.payload.stsId,
        })
        const free = msg.payload.groundPositions.filter((gp) => gp.occupiedBy === null)
        return { groundPositionId: free[free.length - 1].id }
      },
    }
    const sim = createSimulation(tracer, scripted)
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(received).toHaveLength(10)
    expect(new Set(received.map((r) => r.correlationId)).size).toBe(10)
    expect(received[0]).toMatchObject({ decisionPoint: 'stsGroundPosition', version: 1, stsId: 'STS01' })
    // first box went to the last lane (GP10), the last box to GP1
    const grounded = ofType(sim, 'StsGrounded')
    expect(grounded[0].payload.groundPositionId).toBe('STS01-GP10')
    expect(grounded[9].payload.groundPositionId).toBe('STS01-GP1')
  })

  it('every decision raises DecisionRequested and DecisionResolved with the same correlation id', () => {
    const sim = createSimulation(tracer)
    sim.runUntil()
    const requested = gpOfType(sim, 'DecisionRequested')
    const resolved = gpOfType(sim, 'DecisionResolved')
    expect(requested).toHaveLength(10)
    expect(resolved.map((e) => e.payload.correlationId)).toEqual(requested.map((e) => e.payload.correlationId))
    for (const [i, req] of requested.entries()) {
      const res = resolved[i]
      expect(req.payload.decisionPoint).toBe('stsGroundPosition')
      expect(res.payload).toMatchObject({ outcome: 'ok', handler: 'strategy:lowest-free-lane' })
      expect(res.t).toBe(req.t) // built-ins resolve within the same event step
      expect(sim.why(res.id).map((e) => e.type).slice(0, 3)).toEqual(['DecisionResolved', 'DecisionRequested', 'StsPicked'])
    }
  })
})

const withDecisions = (decisions: ScenarioConfig['decisions'], base: ScenarioConfig = tracer): ScenarioConfig => ({
  ...base,
  decisions,
})

describe('built-in strategies', () => {
  it('the scenario selects a built-in strategy by name', () => {
    const sim = createSimulation(withDecisions({ points: { stsGroundPosition: { strategy: 'highest-free-lane' } } }))
    sim.runUntil()
    const lanes = ofType(sim, 'StsGrounded').map((e) => e.payload.groundPositionId)
    expect(lanes[0]).toBe('STS01-GP10')
    expect(lanes[9]).toBe('STS01-GP1')
    expect(gpOfType(sim, 'DecisionResolved')[0].payload.handler).toBe('strategy:highest-free-lane')
  })

  it('the registry lists 1–5 strategies per decision point, and an unknown name fails at creation', () => {
    for (const entry of Object.values(strategies)) {
      const n = Object.keys(entry.strategies).length
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(5) // shcDispatch grew past 3 with chained-nearest and predispatch
      expect(entry.strategies[entry.default]).toBeDefined()
    }
    expect(() =>
      createSimulation(withDecisions({ points: { stsGroundPosition: { strategy: 'nope' } } })),
    ).toThrow(/Unknown stsGroundPosition strategy "nope".*lowest-free-lane/)
  })

  it.each(['lowest-free-lane', 'highest-free-lane'])(
    'with %s, keep-running and pause produce identical runs',
    (strategy) => {
      const run = (asyncMode: 'keep-running' | 'pause') => {
        const sim = createSimulation(withDecisions({ asyncMode, points: { stsGroundPosition: { strategy } } }))
        sim.runUntil()
        return sim
      }
      const keep = run('keep-running')
      const pause = run('pause')
      expect(keep.asyncMode).toBe('keep-running')
      expect(pause.asyncMode).toBe('pause')
      expect(pause.eventLogHash()).toBe(keep.eventLogHash())
      expect(pause.eventLog()).toEqual(keep.eventLog())
      expect(pause.kpiReport()).toEqual(keep.kpiReport())
    },
  )
})

/** Two STS on one vessel, no move variation: one crane's pending decision does not stop the other. */
const twoCranes = new ScenarioBuilder('two-sts', '2 STS share one vessel').hatch({ enabled: false })
  .seed(3)
  .quay(400, { mooringS: 60, unmooringS: 60 })
  .sts('STS01', { gantryX: 30, groundPositions: 10 })
  .sts('STS02', { gantryX: 100, groundPositions: 10 })
  .vesselCall('V001', { sizeClass: 'feeder', discharge: 10, maxSts: 2, sizeMix: { '40': 1 } })
  .endWhen({ vesselsCompleted: 1 })
  .build()

const pairs = (sim: { eventLog(): readonly EngineEvent[] }) => {
  const resolved = new Map(ofType(sim, 'DecisionResolved').map((e) => [e.payload.correlationId, e]))
  return ofType(sim, 'DecisionRequested')
    .filter((req) => req.payload.decisionPoint === 'stsGroundPosition')
    .map((req) => ({ req, res: resolved.get(req.payload.correlationId)! }))
}

describe('keep-running mode with injected latency', () => {
  const fixed20s = {
    points: { stsGroundPosition: { timeoutMs: 60_000, latency: { delay: { kind: 'fixed' as const, ms: 20_000 } } } },
  }

  it('the sim advances while decisions are pending and the waiting equipment idles', () => {
    const baseline = createSimulation(twoCranes)
    baseline.runUntil()
    const sim = createSimulation(withDecisions(fixed20s, twoCranes))
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(sim.kpiReport().movesCompleted).toBe(10)

    const log = sim.eventLog()
    for (const { req, res } of pairs(sim)) expect(res.t - req.t).toBeCloseTo(20, 9)
    // while one decision is pending, the other crane's events are processed at later sim times
    const overlapped = pairs(sim).some(({ req, res }) =>
      log.some((e) => e.t > req.t && e.t < res.t && e.type.startsWith('Sts') && e.subjects.equipment?.[0] !== req.subjects.equipment?.[0]),
    )
    expect(overlapped).toBe(true)
    // the STS sits in waiting-for-decision while the reply is in flight
    const mid = createSimulation(withDecisions(fixed20s, twoCranes))
    mid.runUntil(gpEvent('DecisionRequested'))
    const waitingSts = mid.eventLog().at(-1)!.subjects.equipment![0]
    mid.runUntil({ time: mid.now + 10 })
    expect(mid.query.sts(waitingSts).status).toBe('waiting-for-decision')

    const h = sim.kpiReport().handlers.stsGroundPosition
    expect(h).toMatchObject({ handler: 'strategy:lowest-free-lane', calls: 10, resolved: 10, ok: 10, pending: 0 })
    expect(h.simLatencyS).toEqual({ mean: 20, max: 20 })
    expect(h.wallLatencyMs).toEqual({ mean: 20_000, max: 20_000 })
    expect(h.equipmentIdleS).toBe(200) // 10 decisions × 20 s × 1 waiting STS
    expect(h.maxPending).toBeGreaterThanOrEqual(1)
    expect(baseline.kpiReport().handlers.stsGroundPosition.equipmentIdleS).toBe(0)
    expect(sim.kpiReport().vessels.V001.turnaroundS!).toBeGreaterThan(baseline.kpiReport().vessels.V001.turnaroundS! + 90)
  })

  it('simSecondsPerWallSecond scales injected latency into sim time', () => {
    const sim = createSimulation(withDecisions({ ...fixed20s, simSecondsPerWallSecond: 3 }, twoCranes))
    sim.runUntil()
    for (const { req, res } of pairs(sim)) expect(res.t - req.t).toBeCloseTo(60, 9)
  })

  it('random latency is reproducible for a seed and leaves the main RNG stream alone', () => {
    const cfg = withDecisions({
      points: { stsGroundPosition: { latency: { delay: { kind: 'uniform', minMs: 1000, maxMs: 4000 } } } },
    })
    const a = createSimulation(cfg)
    const b = createSimulation(cfg)
    a.runUntil()
    b.runUntil()
    expect(a.eventLogHash()).toBe(b.eventLogHash())
    const latencies = pairs(a).map(({ req, res }) => res.t - req.t)
    expect(new Set(latencies).size).toBeGreaterThan(1)
    for (const l of latencies) expect(l >= 1 && l <= 4).toBe(true)
  })
})

describe('pause mode with injected latency', () => {
  it('no sim time passes while decisions are pending, and the event log equals the no-latency run', () => {
    const latency = { delay: { kind: 'exponential' as const, meanMs: 800 } }
    const plain = createSimulation(withDecisions({ asyncMode: 'pause' }, twoCranes))
    plain.runUntil()
    const sim = createSimulation(withDecisions({ asyncMode: 'pause', points: { stsGroundPosition: { latency } } }, twoCranes))
    sim.runUntil()

    for (const { req, res } of pairs(sim)) expect(res.t).toBe(req.t)
    // the measured wall latency rides on DecisionResolved (V11-16); everything else is identical
    const withoutWall = (log: readonly EngineEvent[]) =>
      log.map((e) => {
        if (e.type !== 'DecisionResolved') return e
        const payload = { ...e.payload }
        delete payload.wallLatencyMs
        return { ...e, payload }
      })
    expect(withoutWall(sim.eventLog())).toEqual(withoutWall(plain.eventLog()))
    expect(sim.eventLogHash()).toBe(plain.eventLogHash()) // the hash leaves the measurement out
    expect(diffEventLogs(sim.eventLog(), plain.eventLog()).diverged).toBe(false)
    expect(sim.eventLog().some((e) => e.type === 'DecisionResolved' && (e.payload.wallLatencyMs ?? 0) > 0)).toBe(true)
    const h = sim.kpiReport().handlers.stsGroundPosition
    expect(h.simLatencyS).toEqual({ mean: 0, max: 0 })
    expect(h.equipmentIdleS).toBe(0)
    expect(h.wallLatencyMs.mean).toBeGreaterThan(0) // the latency was real, but in wall time only
  })
})

describe('injected timeouts and errors', () => {
  const faulty = (asyncMode: 'keep-running' | 'pause', pct: { timeoutPct?: number; errorPct?: number }) =>
    withDecisions({
      asyncMode,
      points: {
        stsGroundPosition: {
          strategy: 'highest-free-lane',
          fallbackStrategy: 'lowest-free-lane',
          timeoutMs: 2000,
          latency: { delay: { kind: 'fixed', ms: 500 }, ...pct },
        },
      },
    })

  it('a timeout raises DecisionFailed after timeoutMs and the fallback strategy answers', () => {
    const sim = createSimulation(faulty('keep-running', { timeoutPct: 100 }))
    sim.runUntil()
    expect(sim.status).toBe('ended')
    const failed = ofType(sim, 'DecisionFailed')
    expect(failed).toHaveLength(10)
    expect(failed[0].payload).toMatchObject({ failure: 'timeout', fallback: 'fallback:lowest-free-lane' })
    for (const { req, res } of pairs(sim)) {
      expect(res.t - req.t).toBeCloseTo(2, 9)
      expect(res.payload).toMatchObject({ outcome: 'fallback', handler: 'fallback:lowest-free-lane' })
    }
    // the fallback (lowest lane), not the configured strategy (highest lane), placed the boxes
    expect(ofType(sim, 'StsGrounded')[0].payload.groundPositionId).toBe('STS01-GP1')
    expect(sim.kpiReport().handlers.stsGroundPosition).toMatchObject({ calls: 10, ok: 0, fallbacks: 10, timeouts: 10, errors: 0, equipmentIdleS: 20 })
  })

  it('an error reply arrives after the injected delay, raises DecisionFailed, and the fallback answers', () => {
    const sim = createSimulation(faulty('keep-running', { errorPct: 100 }))
    sim.runUntil()
    const failed = ofType(sim, 'DecisionFailed')
    expect(failed).toHaveLength(10)
    expect(failed[0].payload.failure).toBe('error')
    for (const { req, res } of pairs(sim)) expect(res.t - req.t).toBeCloseTo(0.5, 9)
    expect(sim.kpiReport().handlers.stsGroundPosition).toMatchObject({ errors: 10, fallbacks: 10, timeouts: 0 })
  })

  it('a partial failure rate fails some calls and is reproducible', () => {
    const run = () => {
      const sim = createSimulation(faulty('keep-running', { timeoutPct: 30, errorPct: 30 }))
      sim.runUntil()
      return sim
    }
    const a = run()
    const h = a.kpiReport().handlers.stsGroundPosition
    expect(h.ok).toBeGreaterThan(0)
    expect(h.timeouts + h.errors).toBeGreaterThan(0)
    expect(h.ok + h.fallbacks).toBe(10)
    expect(run().eventLogHash()).toBe(a.eventLogHash())
  })

  it('in pause mode a timeout costs no sim time', () => {
    const sim = createSimulation(faulty('pause', { timeoutPct: 100 }))
    sim.runUntil()
    expect(ofType(sim, 'DecisionFailed')).toHaveLength(10)
    for (const { req, res } of pairs(sim)) expect(res.t).toBe(req.t)
    expect(sim.kpiReport().handlers.stsGroundPosition.wallLatencyMs).toEqual({ mean: 2000, max: 2000 })
  })

  it('a handler that throws is treated as an error and falls back', () => {
    const sim = createSimulation(tracer, {
      stsGroundPosition: () => {
        throw new Error('TOS down')
      },
    })
    sim.runUntil()
    expect(sim.status).toBe('ended')
    expect(ofType(sim, 'DecisionFailed')[0].payload).toMatchObject({ failure: 'error', message: 'handler threw: TOS down' })
    expect(sim.kpiReport().handlers.stsGroundPosition).toMatchObject({ handler: 'custom', errors: 10, fallbacks: 10 })
  })
})

describe('async (Promise) handlers', () => {
  /** The event log with DecisionResolved.handler blanked ("custom" vs "strategy:…" is the only expected difference) and the measured wall latency dropped. */
  const withoutHandlerLabel = (sim: { eventLog(): readonly EngineEvent[] }) =>
    sim.eventLog().map((e) => {
      if (e.type !== 'DecisionResolved') return e
      const payload = { ...e.payload, handler: '' }
      delete payload.wallLatencyMs
      return { ...e, payload }
    })

  /** A scripted remote TOS: answers after `ms` of wall time. */
  const remote = (ms: number): Partial<HandlerSet> => ({
    stsGroundPosition: (msg) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ groundPositionId: msg.payload.groundPositions.find((g) => g.occupiedBy === null)!.id }),
          ms,
        ),
      ),
  })

  it('runUntil stops with waiting-for-decision; runUntilAsync awaits the replies', async () => {
    const sim = createSimulation(tracer, remote(1))
    expect(sim.runUntil().reason).toBe('waiting-for-decision')
    const result = await sim.runUntilAsync()
    expect(result.reason).toBe('ended')
    const h = sim.kpiReport().handlers.stsGroundPosition
    expect(h).toMatchObject({ handler: 'custom', calls: 10, ok: 10, pending: 0 })
    expect(h.wallLatencyMs.mean).toBeGreaterThan(0)
  })

  it('keep-running: a paced host advances sim time while the reply is in flight; the idle time is attributed', async () => {
    const sim = createSimulation(tracer, remote(1))
    sim.runUntil(gpEvent('DecisionRequested'))
    const requestedAt = sim.now
    // e.g. the browser worker advancing the clock frame by frame
    expect(sim.runUntil({ time: requestedAt + 30 }).reason).toBe('condition')
    expect(sim.now).toBe(requestedAt + 30)
    expect(sim.query.sts('STS01').status).toBe('waiting-for-decision')
    await new Promise((r) => setTimeout(r, 10))
    sim.runUntil(gpEvent('DecisionResolved'))
    expect(sim.now).toBe(requestedAt + 30)
    const h = sim.kpiReport().handlers.stsGroundPosition
    expect(h.simLatencyS.max).toBe(30)
    expect(h.equipmentIdleS).toBe(30)

    const paused = createSimulation(withDecisions({ asyncMode: 'pause' }), remote(1))
    paused.runUntil(gpEvent('DecisionRequested'))
    const frozenAt = paused.now
    expect(paused.runUntil({ time: frozenAt + 30 }).reason).toBe('waiting-for-decision')
    expect(paused.now).toBe(frozenAt)
  })

  it('in pause mode an async handler gives the same event log as the built-in strategy', async () => {
    const pause = withDecisions({ asyncMode: 'pause' })
    const builtIn = createSimulation(pause)
    builtIn.runUntil()
    const sim = createSimulation(pause, remote(1))
    await sim.runUntilAsync()
    expect(withoutHandlerLabel(sim)).toEqual(withoutHandlerLabel(builtIn))
  })

  it('a reply slower than timeoutMs times out in wall time; the late reply is counted and discarded', async () => {
    const sim = createSimulation(withDecisions({ points: { stsGroundPosition: { timeoutMs: 5 } } }, tracer), remote(40))
    await sim.runUntilAsync(gpEvent('DecisionResolved'))
    expect(ofType(sim, 'DecisionFailed')[0].payload.failure).toBe('timeout')
    await new Promise((r) => setTimeout(r, 60))
    expect(sim.kpiReport().handlers.stsGroundPosition.lateReplies).toBe(1)
  })

  it('a rejected Promise is an error and falls back', async () => {
    const sim = createSimulation(tracer, { stsGroundPosition: () => Promise.reject(new Error('503')) })
    await sim.runUntilAsync()
    expect(sim.status).toBe('ended')
    expect(ofType(sim, 'DecisionFailed')[0].payload).toMatchObject({ failure: 'error', message: 'handler rejected: 503' })
  })

  it('a snapshot taken while a decision is pending resumes by re-sending the request', async () => {
    const reference = createSimulation(tracer)
    reference.runUntil()
    const sim = createSimulation(tracer, remote(1))
    sim.runUntil()
    const snap = JSON.parse(JSON.stringify(sim.snapshot()))
    expect(sim.kpiReport().handlers.stsGroundPosition.pending).toBe(1)
    const resumed = restoreSimulation(snap, remote(1))
    await resumed.runUntilAsync()
    expect(resumed.status).toBe('ended')
    expect(resumed.kpiReport().movesCompleted).toBe(10)
    expect(withoutHandlerLabel(resumed)).toEqual(withoutHandlerLabel(reference)) // 1 STS: the reply lands at the request time
  })
})

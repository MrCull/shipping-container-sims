/**
 * Engine host: owns one Simulation (public engine API only) and serves
 * WorkerRequests, collecting a compact Delta of what changed. Used by the
 * Web Worker entry (`engine.worker.ts`); it has no worker or DOM globals.
 */
import { createSimulation, summarizeRun, type EngineEvent, type Simulation } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import {
  EVENT_SUMMARY_CAP,
  summarizeEvent,
  type CustodyChange,
  type Delta,
  type EngineInfo,
  type QueryKind,
  type WorkerReply,
  type WorkerRequestMessage,
} from './protocol'

function emptyDelta(): Delta {
  return { motion: [], custody: [], entities: [], reservations: [], events: [], eventCounts: {} }
}

/** Keep only the latest entry per key (order of last occurrence). */
function latestBy<T>(items: T[], key: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    const k = key(item)
    map.delete(k)
    map.set(k, item)
  }
  return [...map.values()]
}

export function createEngineHost() {
  let sim: Simulation | null = null
  let loaded: { config: ScenarioConfig; seed: number } | null = null
  let delta = emptyDelta()
  let motionRefs = new Map<string, unknown>()
  let statusRefs = new Map<string, string>()
  let lastReservationId = -1

  function observe(ev: EngineEvent): void {
    if (!sim) return
    delta.events.push(summarizeEvent(ev))
    if (delta.events.length > EVENT_SUMMARY_CAP * 2) delta.events.splice(0, delta.events.length - EVENT_SUMMARY_CAP)
    delta.eventCounts[ev.type] = (delta.eventCounts[ev.type] ?? 0) + 1
    for (const id of ev.subjects.containers ?? []) {
      const box = sim.query.container(id)
      const last = box.custodyHistory[box.custodyHistory.length - 1]
      if (last && last.eventId === ev.id) {
        const change: CustodyChange = { containerId: id, t: last.t, owner: { ...last.owner }, eventId: last.eventId }
        if (last.owner.kind === 'groundPosition') {
          change.x = sim.query.sts(sim.query.groundPosition(last.owner.id).stsId).gantryX
        }
        delta.custody.push(change)
      }
    }
    for (const s of sim.config.sts) {
      const sts = sim.query.sts(s.id)
      if (motionRefs.get(s.id) !== sts.motion) {
        motionRefs.set(s.id, sts.motion)
        if (sts.motion.length > 0) delta.motion.push({ entityId: s.id, segments: sts.motion.map((m) => ({ ...m })) })
      }
      const key = `sts:${s.id}`
      if (statusRefs.get(key) !== sts.status) {
        statusRefs.set(key, sts.status)
        delta.entities.push({ kind: 'sts', id: s.id, t: ev.t, status: sts.status })
      }
    }
    for (const c of sim.config.shcs ?? []) {
      const shc = sim.query.shc(c.id)
      if (motionRefs.get(c.id) !== shc.motion) {
        motionRefs.set(c.id, shc.motion)
        if (shc.motion.length > 0) delta.motion.push({ entityId: c.id, segments: shc.motion.map((m) => ({ ...m })) })
      }
      const key = `shc:${c.id}`
      if (statusRefs.get(key) !== shc.status) {
        statusRefs.set(key, shc.status)
        delta.entities.push({ kind: 'shc', id: c.id, t: ev.t, status: shc.status })
      }
    }
    for (const r of sim.query.reservations()) {
      if (r.id <= lastReservationId) continue
      lastReservationId = r.id
      delta.reservations.push({ ...r })
    }
    for (const v of sim.config.vessels) {
      const status = sim.query.vessel(v.id).status
      const key = `vessel:${v.id}`
      if (statusRefs.get(key) !== status) {
        statusRefs.set(key, status)
        delta.entities.push({ kind: 'vessel', id: v.id, t: ev.t, status })
      }
    }
  }

  function start(config: ScenarioConfig, seed: number): void {
    sim = createSimulation(config, {}, { seed })
    loaded = { config, seed }
    motionRefs = new Map()
    statusRefs = new Map()
    for (const s of config.sts) {
      motionRefs.set(s.id, sim.query.sts(s.id).motion)
      statusRefs.set(`sts:${s.id}`, sim.query.sts(s.id).status)
    }
    for (const v of config.vessels) statusRefs.set(`vessel:${v.id}`, sim.query.vessel(v.id).status)
    for (const c of config.shcs ?? []) {
      motionRefs.set(c.id, sim.query.shc(c.id).motion)
      statusRefs.set(`shc:${c.id}`, sim.query.shc(c.id).status)
    }
    lastReservationId = -1
    sim.subscribe(observe)
  }

  function requireSim(): Simulation {
    if (!sim) throw new Error('No scenario loaded')
    return sim
  }

  function info(s: Simulation): EngineInfo {
    const log = s.eventLog()
    const last = log[log.length - 1]
    const ended = last?.type === 'ScenarioEnded' ? last : null
    const kpis = s.kpiReport()
    return {
      now: s.now,
      status: s.status,
      endT: ended ? ended.t : null,
      endReason: ended ? ended.payload.reason : null,
      eventsTotal: log.length,
      movesCompleted: kpis.movesCompleted,
      vesselsCompleted: kpis.vesselsCompleted,
      eventLogHash: s.eventLogHash(),
      firstError: s.firstError ? s.firstError.message : null,
    }
  }

  async function serve(req: WorkerRequestMessage): Promise<unknown> {
    switch (req.op) {
      case 'load':
        start(req.config, req.seed)
        return null
      case 'reset':
        if (!loaded) throw new Error('No scenario loaded')
        start(loaded.config, loaded.seed)
        return null
      case 'advance':
        // Async variant: awaits Promise handlers (pause mode) instead of stalling the horizon.
        return requireSim().runUntilAsync({ time: req.to })
      case 'run': {
        const result = await requireSim().runUntilAsync(req.condition)
        delta.motion = latestBy(delta.motion, (m) => m.entityId)
        delta.custody = latestBy(delta.custody, (c) => c.containerId)
        delta.entities = latestBy(delta.entities, (e) => `${e.kind}:${e.id}`)
        delta.reservations = delta.reservations.filter((r) => r.to > requireSim().now)
        return result
      }
      case 'step': {
        const ev = requireSim().step()
        return ev ? summarizeEvent(ev) : null
      }
      case 'inject': {
        const s = requireSim()
        return summarizeEvent(s.inject(req.type, req.at, req.subjects, req.payload as never) as EngineEvent)
      }
      case 'snapshot':
        return requireSim().snapshot()
      case 'why':
        return requireSim().why(req.eventId)
      case 'query':
        return query(requireSim(), req.kind, req.id)
    }
  }

  function query(s: Simulation, kind: QueryKind, id?: string): unknown {
    const need = () => {
      if (!id) throw new Error(`query ${kind} needs an id`)
      return id
    }
    switch (kind) {
      case 'container':
        return s.query.container(need())
      case 'containers':
        return s.query.containers().map((c) => ({ id: c.id, size: c.size, line: c.line, custody: c.custody }))
      case 'vessel':
        return s.query.vessel(need())
      case 'vessels':
        return s.config.vessels.map((v) => s.query.vessel(v.id))
      case 'sts':
        return s.query.sts(need())
      case 'stsList':
        return s.config.sts.map((x) => s.query.sts(x.id))
      case 'groundPosition':
        return s.query.groundPosition(need())
      case 'shc':
        return s.query.shc(need())
      case 'shcList':
        return s.query.shcs()
      case 'wtpPad':
        return s.query.wtpPad(need())
      case 'reservations':
        return s.query.reservations()
      case 'kpis':
        return s.kpiReport()
      case 'summary':
        return summarizeRun(s)
      case 'invariants':
        return s.invariantReport()
      case 'eventLog':
        return s.eventLog().map(summarizeEvent)
    }
  }

  return {
    /** Serve one request. Callers must not overlap requests (the worker entry serialises them). */
    async handle(req: WorkerRequestMessage): Promise<WorkerReply> {
      delta = emptyDelta()
      try {
        const result = await serve(req)
        const s = requireSim()
        if (delta.events.length > EVENT_SUMMARY_CAP) delta.events = delta.events.slice(-EVENT_SUMMARY_CAP)
        return { rid: req.rid, ok: true, result, delta, info: info(s) }
      } catch (err) {
        return { rid: req.rid, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

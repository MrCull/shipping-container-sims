/**
 * Engine host: owns one Simulation (public engine API only) and serves
 * WorkerRequests, collecting a compact Delta of what changed. Used by the
 * Web Worker entry (`engine.worker.ts`); it has no worker or DOM globals.
 */
import { firstBreakpointHit, type Breakpoint } from '../modules/breakpoints'
import { blockFillPct } from '../modules/dashboardModel'
import { buildTimeline, createSimulation, hashDigest, exportRun, headlineKpis, highlightsOf, summarizeRun, type EngineEvent, type Simulation } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import { HALF_OFFSET_M } from '../scenario/vesselClasses'
import {
  EVENT_SUMMARY_CAP,
  summarizeEvent,
  DEFAULT_CHECKPOINT_S,
  type Checkpoint,
  type CustodyChange,
  type DashboardData,
  type Delta,
  type EngineInfo,
  type MotionPlan,
  type QueryKind,
  type ReplayResult,
  type WorkerReply,
  type WorkerRequestMessage,
} from './protocol'

function emptyDelta(): Delta {
  return { newContainers: [], motion: [], custody: [], entities: [], reservations: [], events: [], eventCounts: {}, breakpoint: null }
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

/**
 * Compact motion plans to the latest segment of each axis per entity. (The
 * latest plan alone may lack an axis, e.g. a hoist-only plan after a gantry
 * move, which would leave the scene at the crane's initial gantry position.)
 */
function compactMotion(plans: MotionPlan[]): MotionPlan[] {
  // Per entity: its latest plan whole (an SHC trip is one multi-segment plan that is still
  // being driven), plus the latest earlier segment of every axis that plan does not move.
  const byEntity = new Map<string, { latest: MotionPlan['segments']; earlier: Map<string, MotionPlan['segments'][number]> }>()
  for (const plan of plans) {
    const entry = byEntity.get(plan.entityId) ?? { latest: [], earlier: new Map() }
    for (const seg of entry.latest) entry.earlier.set(seg.axis, seg)
    entry.latest = plan.segments
    byEntity.delete(plan.entityId)
    byEntity.set(plan.entityId, entry)
  }
  return [...byEntity.entries()].map(([entityId, { latest, earlier }]) => {
    const moved = new Set(latest.map((s) => s.axis))
    const kept = [...earlier.values()].filter((s) => !moved.has(s.axis))
    return { entityId, segments: [...kept, ...latest].sort((a, b) => a.t0 - b.t0) }
  })
}

/** Reply info before any scenario is loaded (only settings requests are served then). */
const NO_INFO: EngineInfo = { now: 0, status: 'ready', endT: null, endReason: null, eventsTotal: 0, movesCompleted: 0, vesselsCompleted: 0, eventLogHash: '', firstError: null }

export function createEngineHost() {
  let sim: Simulation | null = null
  let loaded: { config: ScenarioConfig; seed: number } | null = null
  let delta = emptyDelta()
  let motionRefs = new Map<string, unknown>()
  let statusRefs = new Map<string, string>()
  let lastReservationId = -1
  /** Containers created during the run that the scene has been told about. */
  const announced = new Set<string>()
  let breakpoints: Breakpoint[] = []
  /** Rewind points of the current timeline (TT-17). */
  let checkpoints: Checkpoint[] = []
  let checkpointS = DEFAULT_CHECKPOINT_S
  let prevHash = ''

  /** Stop predicate of every run: records the first breakpoint an event hits (the run stops after it). */
  function stopAtBreakpoint(ev: EngineEvent): boolean {
    const bp = firstBreakpointHit(breakpoints, ev)
    if (!bp) return false
    delta.breakpoint = { breakpointId: bp.id, event: summarizeEvent(ev) }
    return true
  }

  function observe(ev: EngineEvent): void {
    if (!sim) return
    // rewind points: every boundary this event passes, with the log as it stood before it
    while (ev.t >= (checkpoints.length + 1) * checkpointS) {
      checkpoints.push({ t: (checkpoints.length + 1) * checkpointS, events: sim.eventLog().length - 1, hash: prevHash })
    }
    prevHash = sim.eventLogHash()
    delta.events.push(summarizeEvent(ev))
    if (delta.events.length > EVENT_SUMMARY_CAP * 2) delta.events.splice(0, delta.events.length - EVENT_SUMMARY_CAP)
    delta.eventCounts[ev.type] = (delta.eventCounts[ev.type] ?? 0) + 1
    for (const id of ev.subjects.containers ?? []) {
      const box = sim.query.container(id)
      // a box created while the run is going (a truck brings it): the scene registers it, with its first custody, before anything else
      const first = box.custodyHistory[0]
      if (first.eventId !== null && !announced.has(id)) {
        announced.add(id)
        ;(delta.newContainers ??= []).push({ id, size: box.size, line: box.line })
        delta.custody.push({ containerId: id, t: first.t, owner: { ...first.owner }, eventId: first.eventId })
      }
      const last = box.custodyHistory[box.custodyHistory.length - 1]
      if (last && last.eventId === ev.id) {
        const change: CustodyChange = { containerId: id, t: last.t, owner: { ...last.owner }, eventId: last.eventId }
        if (last.owner.kind === 'groundPosition') {
          change.x =
            ev.type === 'StsGrounded' || ev.type === 'ShcDroppedAtGround'
              ? ev.payload.x
              : sim.query.sts(sim.query.groundPosition(last.owner.id).stsId).gantryX
        }
        if (last.owner.kind === 'sts' && ev.type === 'StsPicked' && ev.payload.twin) {
          change.dx = id === ev.payload.twin.containerId ? HALF_OFFSET_M : -HALF_OFFSET_M
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
    for (const asc of sim.query.ascs()) {
      if (motionRefs.get(asc.id) !== asc.motion) {
        motionRefs.set(asc.id, asc.motion)
        if (asc.motion.length > 0) delta.motion.push({ entityId: asc.id, segments: asc.motion.map((m) => ({ ...m })) })
      }
      const key = `asc:${asc.id}`
      if (statusRefs.get(key) !== asc.status) {
        statusRefs.set(key, asc.status)
        delta.entities.push({ kind: 'asc', id: asc.id, t: ev.t, status: asc.status })
      }
    }
    if (ev.type.startsWith('Truck') || ev.type === 'AscJobAssigned') {
      for (const truck of sim.query.trucks()) {
        if (motionRefs.get(truck.id) !== truck.motion) {
          motionRefs.set(truck.id, truck.motion)
          if (truck.motion.length > 0) delta.motion.push({ entityId: truck.id, segments: truck.motion.map((m) => ({ ...m })) })
        }
        const key = `truck:${truck.id}`
        if (statusRefs.get(key) !== truck.status) {
          statusRefs.set(key, truck.status)
          const first = truck.legs[0]
          delta.entities.push({ kind: 'truck', id: truck.id, t: ev.t, status: truck.status, loadSize: first ? sim.query.container(first.containerId).size : undefined })
        }
      }
      if (ev.type === 'TruckDeparted') {
        const id = ev.payload.truckId
        motionRefs.delete(id)
        statusRefs.delete(`truck:${id}`)
        delta.entities.push({ kind: 'truck', id, t: ev.t, status: 'gone' })
      }
    }
    for (const r of sim.query.reservations()) {
      if (r.id <= lastReservationId) continue
      lastReservationId = r.id
      delta.reservations.push({ ...r })
    }
    for (const v of sim.config.vessels) {
      const vessel = sim.query.vessel(v.id)
      const key = `vessel:${v.id}`
      if (statusRefs.get(key) !== vessel.status) {
        statusRefs.set(key, vessel.status)
        delta.entities.push({ kind: 'vessel', id: v.id, t: ev.t, status: vessel.status, berthX: vessel.berthX })
      }
    }
  }

  function start(config: ScenarioConfig, seed: number): void {
    sim = createSimulation(config, {}, { seed })
    loaded = { config, seed }
    announced.clear()
    checkpoints = []
    seedRefs(sim, config)
    sim.subscribe(observe)
  }

  /** Remember the current state of every entity, so only later changes go into deltas. */
  function seedRefs(s: Simulation, config: ScenarioConfig): void {
    motionRefs = new Map()
    statusRefs = new Map()
    for (const x of config.sts) {
      motionRefs.set(x.id, s.query.sts(x.id).motion)
      statusRefs.set(`sts:${x.id}`, s.query.sts(x.id).status)
    }
    for (const v of config.vessels) statusRefs.set(`vessel:${v.id}`, s.query.vessel(v.id).status)
    for (const c of config.shcs ?? []) {
      motionRefs.set(c.id, s.query.shc(c.id).motion)
      statusRefs.set(`shc:${c.id}`, s.query.shc(c.id).status)
    }
    for (const asc of s.query.ascs()) {
      motionRefs.set(asc.id, asc.motion)
      statusRefs.set(`asc:${asc.id}`, asc.status)
    }
    lastReservationId = -1
    prevHash = s.eventLogHash()
  }

  /** Compact the delta of a flat-out run (latest state per entity only). */
  function compactDelta(): void {
    delta.motion = compactMotion(delta.motion)
    delta.custody = latestBy(delta.custody, (c) => c.containerId)
    delta.entities = latestBy(delta.entities, (e) => `${e.kind}:${e.id}`)
    delta.reservations = delta.reservations.filter((r) => r.to > requireSim().now)
  }

  /** Start the scenario and replay `events` events (no breakpoints); the delta holds everything the scene needs. */
  async function replay(config: ScenarioConfig, seed: number, events: number): Promise<Simulation> {
    start(config, seed)
    const s = requireSim()
    if (events > 0) await s.runUntilAsync({ maxEvents: events })
    return s
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
        return requireSim().runUntilAsync({ time: req.to, predicate: stopAtBreakpoint })
      case 'run': {
        const result = await requireSim().runUntilAsync({ ...req.condition, predicate: stopAtBreakpoint })
        compactDelta()
        return result
      }
      case 'step': {
        const ev = requireSim().step()
        if (ev) stopAtBreakpoint(ev)
        return ev ? summarizeEvent(ev) : null
      }
      case 'setBreakpoints': {
        breakpoints = req.breakpoints.map((b) => ({ ...b }))
        return null
      }
      case 'inject': {
        const s = requireSim()
        return summarizeEvent(s.inject(req.type, req.at, req.subjects, req.payload as never) as EngineEvent)
      }
      case 'snapshot':
        return requireSim().snapshot()
      case 'setCheckpointInterval':
        if (!(req.seconds > 0)) throw new Error('Rewind interval must be positive')
        checkpointS = req.seconds
        return null
      case 'rewind': {
        if (!loaded) throw new Error('No scenario loaded')
        const s = await replay(loaded.config, loaded.seed, req.events)
        compactDelta()
        return { hashMatched: s.eventLogHash() === req.hash } satisfies ReplayResult
      }
      case 'restore': {
        const snap = req.snapshot
        const s = await replay(snap.config, snap.seed, snap.log.length)
        const hashMatched = s.eventLogHash() === hashDigest(snap.state.logHash)
        // the replay taught the scene the history; the snapshot's exact state (now, queue, injected events) wins
        s.restore(snap)
        seedRefs(s, snap.config)
        compactDelta()
        return { hashMatched } satisfies ReplayResult
      }
      case 'why':
        return requireSim().why(req.eventId)
      case 'export':
        return exportRun(requireSim(), req.kind)
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
      case 'vesselSlots':
        return s.query.vesselSlots(id)
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
      case 'shcJobs':
        return s.query.shcJobs()
      case 'wtpPad':
        return s.query.wtpPad(need())
      case 'asc':
        return s.query.asc(need())
      case 'ascList':
        return s.query.ascs()
      case 'truck':
        return s.query.truck(need())
      case 'trucks':
        return s.query.trucks()
      case 'transferStalls':
        return s.query.transferStalls()
      case 'yardBlocks':
        return s.query.yardBlocks()
      case 'yardSlots':
        return s.query.yardSlots(id)
      case 'reservations':
        return s.query.reservations()
      case 'kpis':
        return s.kpiReport()
      case 'kpiSeries':
        return s.kpiSeries()
      case 'kpiHeadline': {
        const series = s.kpiSeries()
        const report = s.kpiReport()
        return { headline: headlineKpis(series, report), highlights: highlightsOf(series, report) }
      }
      case 'dashboard': {
        const data: DashboardData = {
          series: s.kpiSeries(),
          timeline: buildTimeline(s.eventLog(), s.now),
          yard: s.query.yardBlocks().map((b) => ({ id: b.id, fillPct: blockFillPct(b, s.query.yardSlots(b.id)) })),
        }
        return data
      }
      case 'summary':
        return summarizeRun(s)
      case 'invariants':
        return s.invariantReport()
      case 'eventLog':
        return s.eventLog().map(summarizeEvent)
      case 'checkpoints':
        return checkpoints
    }
  }

  return {
    /** Serve one request. Callers must not overlap requests (the worker entry serialises them). */
    async handle(req: WorkerRequestMessage): Promise<WorkerReply> {
      delta = emptyDelta()
      try {
        const result = await serve(req)
        if (!sim) return { rid: req.rid, ok: true, result, delta, info: NO_INFO }
        const s = requireSim()
        if (delta.events.length > EVENT_SUMMARY_CAP) delta.events = delta.events.slice(-EVENT_SUMMARY_CAP)
        return { rid: req.rid, ok: true, result, delta, info: info(s) }
      } catch (err) {
        return { rid: req.rid, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

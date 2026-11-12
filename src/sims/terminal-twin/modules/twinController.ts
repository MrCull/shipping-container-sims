/**
 * TwinController: the non-reactive run orchestrator on the main thread.
 *
 * - Owns the EngineClient (worker) and the SceneModel (render timelines).
 * - Owns the playback clock: `displayTime` advances with wall time × speed and
 *   never passes the engine horizon (`info.now`) or the scenario end.
 * - While playing, keeps the engine a look-ahead window ahead of the display
 *   (`advance`), so motion segments for the displayed instant are always known.
 *   While paused it does not run ahead.
 * - "Run to…" / runUntil / step run the engine flat out (no rendering while
 *   `busy`) and jump the display to the engine time.
 *
 * The Pinia store mirrors the few fields the UI shows; the dev API calls this.
 */
import type { EventPayloads, EventSubjects, EventType, RunResult } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import type { SimSnapshot } from '../engine'
import type { BreakpointHit, Checkpoint, Delta, EngineInfo, EventSummary, QueryKind, ReplayResult, WorkerRequest, WorkerRunCondition } from '../worker/protocol'
import type { Breakpoint } from './breakpoints'
import { EngineClient, type EngineResponse } from './engineClient'
import { SceneModel } from './sceneModel'

/** Speed steps (× real time). Pause is separate. */
export const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600] as const

/** The speed every run start (load, reset, restore) returns to (#157). A rewind keeps the current speed. */
export const DEFAULT_SPEED = 10

/** How far (wall seconds of playback) the engine runs ahead of the display. */
const LOOKAHEAD_WALL_S = 1.5
const MIN_LOOKAHEAD_SIM_S = 5

/** One look-ahead request costs the worker about this much wall time (#251), so a reply never holds it for longer. */
const REQUEST_BUDGET_MS = 150
/** First request's size (sim s) before the engine's rate is known; the next ones grow while a request costs under half the budget. */
const INITIAL_CHUNK_SIM_S = 30
const MIN_CHUNK_SIM_S = 5
/** The engine rate estimate smooths over about this much worker wall time. */
const RATE_SMOOTHING_MS = 1000
/** Items of a reply's delta the model takes per frame (a larger reply is applied over several frames, in order). */
export const APPLY_ITEMS_PER_FRAME = 2000

export interface PlaybackOptions {
  /** Wall clock in ms (the same time base as `tick`); default `performance.now`. */
  now?: () => number
  /** Items of a reply applied per frame. */
  applyItemsPerFrame?: number
}

/**
 * Cuts a delta into slices of at most `maxItems` items that, applied in order, give the same model as applying it whole.
 * Order: new containers, entities, motion, custody, reservations, hatch (each field's own order is kept, and the fields only
 * depend on the ones before them). The first slice carries the delta's events, counts and breakpoint; none is empty.
 */
export function sliceDelta(delta: Delta, maxItems: number): Delta[] {
  const out: Delta[] = []
  const blank = (): Delta => ({ motion: [], custody: [], entities: [], reservations: [], events: [], eventCounts: {}, breakpoint: null })
  let cur = blank()
  let n = 0
  const flush = (): void => {
    if (n > 0) out.push(cur)
    cur = blank()
    n = 0
  }
  const add = <T,>(list: readonly T[] | undefined, weight: (x: T) => number, put: (d: Delta, x: T) => void): void => {
    for (const x of list ?? []) {
      const w = weight(x)
      if (n > 0 && n + w > maxItems) flush()
      put(cur, x)
      n += w
    }
  }
  add(delta.newContainers, () => 1, (d, x) => (d.newContainers ??= []).push(x))
  add(delta.entities, () => 1, (d, x) => d.entities.push(x))
  add(delta.motion, (p) => Math.max(1, p.segments.length), (d, x) => d.motion.push(x))
  add(delta.custody, () => 1, (d, x) => d.custody.push(x))
  add(delta.reservations, () => 1, (d, x) => d.reservations.push(x))
  add(delta.hatch, () => 1, (d, x) => (d.hatch ??= []).push(x))
  flush()
  return out
}

/** What the controller needs from the engine worker (an in-process fake in tests). */
export interface EngineLink {
  request<T = unknown>(req: WorkerRequest): Promise<EngineResponse<T>>
  dispose(): void
}

export class TwinController {
  model: SceneModel | null = null
  info: EngineInfo | null = null
  displayTime = 0
  speed: number = DEFAULT_SPEED
  paused = true
  /** A flat-out run is in progress (rendering is skipped). */
  busy = false
  private inflight = false
  private lastWall: number | null = null
  private generation = 0
  /** The breakpoint that paused playback; cleared when playback resumes or a new scenario starts. */
  breakHit: BreakpointHit | null = null
  /** A breakpoint the engine has stopped at but the display has not reached yet (look-ahead). */
  private pendingBreak: BreakpointHit | null = null
  private breakpoints: Breakpoint[] = []
  /** Sim s per worker wall s, smoothed over about a second of look-ahead requests; null until one has been measured. */
  engineRate: number | null = null
  /** Size (sim s) of the last look-ahead request, and what it cost (ms). */
  private chunk = INITIAL_CHUNK_SIM_S
  /** Slices of replies the model has not taken yet, and the horizon they bring (`info` stays the applied one until they are in). */
  private pendingSlices: Delta[] = []
  private pendingInfo: EngineInfo | null = null
  private readonly now: () => number
  private readonly applyItems: number

  constructor(
    private onDelta: (delta: Delta) => void = () => {},
    private client: EngineLink = new EngineClient(),
    opts: PlaybackOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now())
    this.applyItems = opts.applyItemsPerFrame ?? APPLY_ITEMS_PER_FRAME
  }

  /**
   * The speed playback really runs at: the chosen speed, or the engine's rate while the display is close behind the horizon
   * and the engine cannot supply the chosen speed (#251). The top bar shows it when it is more than 10 % below the chosen one.
   */
  get achievedSpeed(): number {
    return this.pacedRate() === null ? this.speed : Math.min(this.speed, this.engineRate ?? this.speed)
  }

  /** The display rate the engine's rate and the gap to the horizon allow, or null when pacing does not apply (no cap). */
  private pacedRate(): number | null {
    const est = this.engineRate
    if (est === null || est >= this.speed || !this.info || this.info.status !== 'ready' || this.pendingBreak) return null
    const gap = this.limit - this.displayTime
    const margin = Math.max(1, Math.min(est * 0.5, this.speed * LOOKAHEAD_WALL_S * 0.5))
    const rate = est * (gap / margin)
    return rate < this.speed ? rate : null
  }

  get ended(): boolean {
    return this.info?.status !== 'ready' && this.info !== null && this.displayTime >= this.limit
  }

  /** The furthest time the display may show. */
  private get limit(): number {
    if (!this.info) return 0
    return this.info.endT ?? this.info.now
  }

  private async call<T>(req: WorkerRequest): Promise<EngineResponse<T> | null> {
    const gen = this.generation
    const res = await this.client.request<T>(req)
    if (gen !== this.generation) return null // stale: a new scenario was loaded meanwhile
    this.flushPending()
    if (req.op === 'advance') {
      // A large reply is taken over several frames (`tick`); `info` (the horizon the display may reach) follows the last slice.
      const slices = sliceDelta(res.delta, this.applyItems)
      if (slices.length > 1) {
        this.pendingSlices = slices
        this.pendingInfo = res.info
      } else {
        this.model?.apply(res.delta)
        this.info = res.info
      }
    } else {
      this.model?.apply(res.delta)
      this.info = res.info
    }
    if (res.delta.breakpoint) this.pendingBreak = res.delta.breakpoint
    this.onDelta(res.delta)
    return res
  }

  /** Applies every slice still waiting (before anything that must see the whole model). */
  private flushPending(): void {
    while (this.pendingSlices.length > 0) this.applySlice()
  }

  private applySlice(): void {
    const slice = this.pendingSlices.shift()
    if (slice) this.model?.apply(slice)
    if (this.pendingSlices.length === 0 && this.pendingInfo) {
      this.info = this.pendingInfo
      this.pendingInfo = null
    }
  }

  async load(config: ScenarioConfig, seed: number, strict = false): Promise<void> {
    this.speed = DEFAULT_SPEED
    await this.restart({ op: 'load', config, seed, strict }, config, seed)
  }

  /** Back to t = 0 with the same config and seed. */
  async reset(): Promise<void> {
    if (!this.model) throw new Error('No scenario loaded')
    this.speed = DEFAULT_SPEED
    await this.restart({ op: 'reset' }, this.model.config, this.model.seed)
  }

  /** Resume from a snapshot of this engine version: the display starts at the snapshot's sim time, paused. Returns whether the replay matched. */
  async restore(snapshot: SimSnapshot, strict = false): Promise<boolean> {
    this.speed = DEFAULT_SPEED
    const res = await this.restart({ op: 'restore', snapshot, strict }, snapshot.config, snapshot.seed)
    this.displayTime = Math.min(snapshot.state.now, this.limit)
    return res?.hashMatched ?? false
  }

  /** Jump back to a rewind point of the loaded scenario (paused there); running on reproduces the original run. */
  async rewind(point: Checkpoint): Promise<boolean> {
    if (!this.model) throw new Error('No scenario loaded')
    const res = await this.restart({ op: 'rewind', events: point.events, hash: point.hash }, this.model.config, this.model.seed)
    this.displayTime = Math.min(point.t, this.limit)
    return res?.hashMatched ?? false
  }

  /** Automatic rewind points every `seconds` of sim time; applies from the next load, reset, restore or rewind. */
  async setCheckpointInterval(seconds: number): Promise<void> {
    await this.client.request({ op: 'setCheckpointInterval', seconds })
  }

  private async restart(req: WorkerRequest, config: ScenarioConfig, seed: number): Promise<ReplayResult | null> {
    this.generation++
    this.inflight = false
    this.busy = false
    this.paused = true
    this.breakHit = null
    this.pendingBreak = null
    this.pendingSlices = []
    this.pendingInfo = null
    this.engineRate = null
    this.chunk = INITIAL_CHUNK_SIM_S
    this.displayTime = 0
    this.info = null
    this.model = new SceneModel(config, seed)
    const res = await this.call<ReplayResult | null>(req)
    return res?.result ?? null
  }

  /** Advance the playback clock; call once per animation frame. */
  tick(wallMs: number): void {
    const dt = this.lastWall === null ? 0 : Math.max(0, (wallMs - this.lastWall) / 1000)
    this.lastWall = wallMs
    if (!this.model || !this.info || this.busy) return
    // one frame's share of a large reply; the horizon moves on when its last slice is in
    if (this.pendingSlices.length > 0) this.applySlice()
    if (!this.paused) {
      const cap = this.pacedRate()
      const rate = cap === null ? this.speed : Math.min(this.speed, cap)
      this.displayTime = Math.min(this.displayTime + dt * rate, this.limit)
    }
    const lookahead = Math.max(MIN_LOOKAHEAD_SIM_S, this.speed * LOOKAHEAD_WALL_S)
    // Look ahead only while playing: when paused, the engine stays at the displayed
    // time, so dev-API queries and the scene describe the same instant.
    this.settleBreak()
    if (!this.paused && !this.pendingBreak && !this.inflight && this.pendingSlices.length === 0 && this.info.status === 'ready' && this.info.now < this.displayTime + lookahead) {
      this.lookAhead(this.displayTime + lookahead)
    }
    this.model.prune(this.displayTime)
  }

  /** One look-ahead request toward `target`, no bigger than the worker can serve in about REQUEST_BUDGET_MS (#251). */
  private lookAhead(target: number): void {
    const from = this.info!.now
    const size = Math.max(MIN_CHUNK_SIM_S, this.chunk)
    const limited = target - from > size
    const to = limited ? from + size : target
    this.inflight = true
    const gen = this.generation
    const sent = this.now()
    void this.call({ op: 'advance', to })
      .then((res) => {
        if (!res || gen !== this.generation) return
        // the worker's own time when it reports it: the round trip also holds the main thread's frame latency
        const cost = Math.max(1, res.workMs ?? this.now() - sent)
        const advanced = Math.max(0, res.info.now - from)
        if (limited && advanced > 0) {
          const r = (advanced / cost) * 1000
          const w = 1 - Math.exp(-cost / RATE_SMOOTHING_MS)
          this.engineRate = this.engineRate === null ? r : this.engineRate + w * (r - this.engineRate)
          const fit = (this.engineRate * REQUEST_BUDGET_MS) / 1000
          this.chunk = cost < REQUEST_BUDGET_MS / 2 ? Math.max(fit, size * 2) : fit
        }
      })
      .catch((err: unknown) => console.error('Terminal Twin: advance failed', err))
      .finally(() => {
        if (gen === this.generation) this.inflight = false
      })
  }

  /** Pause when the display reaches the event the engine stopped at for a breakpoint. */
  private settleBreak(): void {
    const hit = this.pendingBreak
    if (!hit || this.displayTime < hit.event.t) return
    this.pendingBreak = null
    this.breakHit = hit
    this.paused = true
  }

  /** Replace the breakpoints (the engine worker keeps them across resets). */
  async setBreakpoints(list: Breakpoint[]): Promise<void> {
    this.breakpoints = list.map((b) => ({ ...b }))
    if (this.pendingBreak && !this.breakpoints.some((b) => b.id === this.pendingBreak?.breakpointId)) this.pendingBreak = null
    await this.call({ op: 'setBreakpoints', breakpoints: this.breakpoints })
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.paused = false
    this.breakHit = null
  }

  pause(): void {
    this.paused = true
  }

  play(): void {
    this.paused = false
    this.breakHit = null
  }

  private async flatOut<T>(req: WorkerRequest, displayAt: (info: EngineInfo) => number): Promise<T> {
    this.busy = true
    try {
      const res = await this.call<T>(req)
      if (!res) throw new Error('Scenario was replaced during the run')
      this.displayTime = Math.max(this.displayTime, Math.min(displayAt(res.info), this.limit))
      this.settleBreak()
      return res.result
    } finally {
      this.busy = false
    }
  }

  /** "Run to…": run flat out to sim time `time`, then resume at the current speed. */
  async runTo(time: number): Promise<RunResult> {
    if (!this.info) throw new Error('No scenario loaded')
    this.breakHit = null
    this.pendingBreak = null
    if (time <= this.displayTime) throw new Error('Run to: pick a time after the current sim time')
    return this.flatOut<RunResult>({ op: 'run', condition: { time } }, () => time)
  }

  /** "Run to… next vessel departure": run flat out until the next `VesselDeparted`, then resume at the current speed. */
  async runToNextDeparture(): Promise<RunResult> {
    if (!this.info) throw new Error('No scenario loaded')
    this.breakHit = null
    this.pendingBreak = null
    return this.flatOut<RunResult>({ op: 'run', condition: { eventType: 'VesselDeparted' } }, (info) => info.now)
  }

  /** Dev API: run flat out until a condition, then pause at the engine time. */
  async runUntil(condition: WorkerRunCondition = {}): Promise<RunResult> {
    this.paused = true
    this.breakHit = null
    this.pendingBreak = null
    return this.flatOut<RunResult>({ op: 'run', condition }, (info) => info.now)
  }

  /** Process the next engine event and show its time (pauses playback). */
  async step(): Promise<EventSummary | null> {
    this.paused = true
    this.breakHit = null
    this.pendingBreak = null
    return this.flatOut<EventSummary | null>({ op: 'step' }, (info) => info.now)
  }

  async query<T = unknown>(kind: QueryKind, id?: string): Promise<T> {
    const res = await this.call<T>({ op: 'query', kind, id })
    if (!res) throw new Error('Scenario was replaced during the query')
    return res.result
  }

  async inject<K extends EventType>(type: K, at: number, subjects: EventSubjects, payload: EventPayloads[K]): Promise<EventSummary> {
    const res = await this.call<EventSummary>({ op: 'inject', type, at, subjects, payload })
    if (!res) throw new Error('Scenario was replaced during inject')
    return res.result
  }

  async passthrough<T>(req: WorkerRequest): Promise<T> {
    const res = await this.call<T>(req)
    if (!res) throw new Error('Scenario was replaced during the request')
    return res.result
  }

  dispose(): void {
    this.generation++
    this.client.dispose()
  }
}

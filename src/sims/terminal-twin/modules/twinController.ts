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
import type { Delta, EngineInfo, EventSummary, QueryKind, WorkerRequest, WorkerRunCondition } from '../worker/protocol'
import { EngineClient, type EngineResponse } from './engineClient'
import { SceneModel } from './sceneModel'

/** Speed steps (× real time). Pause is separate. */
export const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 300, 600] as const

/** How far (wall seconds of playback) the engine runs ahead of the display. */
const LOOKAHEAD_WALL_S = 1.5
const MIN_LOOKAHEAD_SIM_S = 5

export class TwinController {
  model: SceneModel | null = null
  info: EngineInfo | null = null
  displayTime = 0
  speed = 10
  paused = true
  /** A flat-out run is in progress (rendering is skipped). */
  busy = false
  private client = new EngineClient()
  private inflight = false
  private lastWall: number | null = null
  private generation = 0

  constructor(private onDelta: (delta: Delta) => void = () => {}) {}

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
    this.model?.apply(res.delta)
    this.info = res.info
    this.onDelta(res.delta)
    return res
  }

  async load(config: ScenarioConfig, seed: number): Promise<void> {
    await this.restart({ op: 'load', config, seed }, config)
  }

  /** Back to t = 0 with the same config and seed. */
  async reset(): Promise<void> {
    if (!this.model) throw new Error('No scenario loaded')
    await this.restart({ op: 'reset' }, this.model.config)
  }

  private async restart(req: WorkerRequest, config: ScenarioConfig): Promise<void> {
    this.generation++
    this.inflight = false
    this.busy = false
    this.paused = true
    this.displayTime = 0
    this.info = null
    this.model = new SceneModel(config)
    await this.call(req)
  }

  /** Advance the playback clock; call once per animation frame. */
  tick(wallMs: number): void {
    const dt = this.lastWall === null ? 0 : Math.max(0, (wallMs - this.lastWall) / 1000)
    this.lastWall = wallMs
    if (!this.model || !this.info || this.busy) return
    if (!this.paused) this.displayTime = Math.min(this.displayTime + dt * this.speed, this.limit)
    const lookahead = Math.max(MIN_LOOKAHEAD_SIM_S, this.speed * LOOKAHEAD_WALL_S)
    // Look ahead only while playing: when paused, the engine stays at the displayed
    // time, so dev-API queries and the scene describe the same instant.
    if (!this.paused && !this.inflight && this.info.status === 'ready' && this.info.now < this.displayTime + lookahead) {
      this.inflight = true
      const gen = this.generation
      void this.call({ op: 'advance', to: this.displayTime + lookahead })
        .catch((err: unknown) => console.error('Terminal Twin: advance failed', err))
        .finally(() => {
          if (gen === this.generation) this.inflight = false
        })
    }
    this.model.prune(this.displayTime)
  }

  setSpeed(speed: number): void {
    this.speed = speed
    this.paused = false
  }

  pause(): void {
    this.paused = true
  }

  play(): void {
    this.paused = false
  }

  private async flatOut<T>(req: WorkerRequest, displayAt: (info: EngineInfo) => number): Promise<T> {
    this.busy = true
    try {
      const res = await this.call<T>(req)
      if (!res) throw new Error('Scenario was replaced during the run')
      this.displayTime = Math.max(this.displayTime, Math.min(displayAt(res.info), this.limit))
      return res.result
    } finally {
      this.busy = false
    }
  }

  /** "Run to…": run flat out to sim time `time`, then resume at the current speed. */
  async runTo(time: number): Promise<RunResult> {
    if (!this.info) throw new Error('No scenario loaded')
    if (time <= this.displayTime) throw new Error('Run to: pick a time after the current sim time')
    return this.flatOut<RunResult>({ op: 'run', condition: { time } }, () => time)
  }

  /** Dev API: run flat out until a condition, then pause at the engine time. */
  async runUntil(condition: WorkerRunCondition = {}): Promise<RunResult> {
    this.paused = true
    return this.flatOut<RunResult>({ op: 'run', condition }, (info) => info.now)
  }

  /** Process the next engine event and show its time (pauses playback). */
  async step(): Promise<EventSummary | null> {
    this.paused = true
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

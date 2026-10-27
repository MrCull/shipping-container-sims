/**
 * Dev-only browser API: `window.__tt`, for Playwright smoke tests and agents.
 *
 * Installed by TerminalTwin.vue only when `import.meta.env.DEV` (this module
 * is dynamically imported inside that branch, so production builds contain
 * none of it). Every method is async-safe to call from `page.evaluate`.
 *
 *   await __tt.load('tracer-1sts-10-boxes', { seed: 42 })
 *   await __tt.runUntil()                      // to the end (or { time, eventType, moves, vesselsCompleted, maxEvents })
 *   await __tt.query('summary')                // also: container/vessel/sts/groundPosition (+ id), containers, stsList, kpis, eventLog…
 *   __tt.scene()                               // rendered counts { containers, sts, vessels, frames, containerLods, containerAssets }
 *   await __tt.step(); await __tt.why(id); await __tt.snapshot()
 *   await __tt.inject('VesselBerthed', 120, { vessels: ['V001'] }, { vesselId: 'V001', berthX: 50 })
 *   __tt.select('STS01'); __tt.cameraTo('STS01'); __tt.setSpeed(600); __tt.pause(); __tt.clock()
 *   __tt.setDisplay({ locale: 'de-DE', units: 'imperial' }); __tt.display(); __tt.config(); __tt.ui()
 */
import type { DisplaySettings, ScenarioConfig } from '../scenario/types'
import type { CustodyRef, EngineEvent, EventPayloads, EventSubjects, EventType, RunResult, SimSnapshot } from '../engine'
import type { RenderedLivery, SceneStats } from '../modules/sceneRenderer'
import type { StsPose } from '../modules/sceneModel'
import type { TwinController } from '../modules/twinController'
import { resolveScenario, type useTwinStore } from '../store/twinStore'
import type { EngineInfo, EventSummary, QueryKind, WorkerRunCondition } from '../worker/protocol'

export interface TwinClock {
  /** Displayed sim time (s). */
  displayTime: number
  speed: number
  paused: boolean
  busy: boolean
  /** Engine status and horizon. */
  engine: EngineInfo | null
}

export interface TwinDevApi {
  /** Load a fixture or preset (default: the current choice) and wait until it is ready. Starts paused unless autoplay. */
  load(name?: string, options?: { seed?: number; startDateTime?: string; autoplay?: boolean }): Promise<EngineInfo | null>
  step(): Promise<EventSummary | null>
  runUntil(condition?: WorkerRunCondition): Promise<RunResult>
  /** "Run to…" a sim time (s), like the top bar. */
  runTo(time: number): Promise<RunResult>
  query<T = unknown>(kind: QueryKind, id?: string): Promise<T>
  inject<K extends EventType>(type: K, at: number, subjects: EventSubjects, payload: EventPayloads[K]): Promise<EventSummary>
  snapshot(): Promise<SimSnapshot>
  why(eventId: number): Promise<EngineEvent[]>
  select(entityId: string | null): void
  /** Point the camera at an entity (container, STS or vessel id), optionally from `distanceM`; false if unknown. */
  cameraTo(entityId: string, distanceM?: number): boolean
  setSpeed(speed: number): void
  pause(): void
  play(): void
  reset(): Promise<void>
  newScenario(): void
  clock(): TwinClock
  /** Rendered counts (null if there is no 3D view). */
  scene(): (SceneStats & { frames: number }) | null
  /** What the scene shows at the displayed time: custody per container, status and pose per STS, status per vessel. */
  sceneState(): SceneState | null
  /** Locale + units in use (display only). */
  display(): DisplaySettings
  /** Change locale and/or units live (like the setup dialog). */
  setDisplay(next: Partial<DisplaySettings>): DisplaySettings
  /** The loaded scenario's config (SI) with the current display settings: what a save stores. */
  config(): ScenarioConfig | null
  /** Keyboard-driven UI state. */
  ui(): TwinUiState
}

export interface TwinUiState {
  selectedId: string | null
  following: boolean
  overlaysVisible: boolean
  dashboardOpen: boolean
  helpOpen: boolean
}

export interface SceneState {
  displayTime: number
  containers: Record<string, CustodyRef | null>
  sts: Record<string, { status: string } & StsPose>
  vessels: Record<string, { status: string }>
  /** Per container: livery atlas index, model size and LOD actually drawn (phase 2 assets). */
  liveries: Record<string, RenderedLivery>
}

declare global {
  interface Window {
    __tt?: TwinDevApi
  }
}

export function installDevApi(store: ReturnType<typeof useTwinStore>): () => void {
  const ctl = (): TwinController => {
    const c = store.controller()
    if (!c || !store.hasScenario) throw new Error('No scenario loaded: call __tt.load() first')
    return c
  }
  const synced = async <T>(p: Promise<T>): Promise<T> => {
    try {
      return await p
    } finally {
      store.sync()
    }
  }

  const api: TwinDevApi = {
    async load(name, options = {}) {
      await store.startScenario(
        {
          name: name ?? store.choice.name,
          // Default: the scenario's own seed (so a fixture reproduces its golden run).
          seed: options.seed ?? (name ? resolveScenario(name).seed : store.choice.seed),
          startDateTime: options.startDateTime ?? store.choice.startDateTime,
        },
        { autoplay: options.autoplay ?? false },
      )
      return store.controller()?.info ?? null
    },
    step: () => synced(ctl().step()),
    runUntil: (condition) => synced(ctl().runUntil(condition)),
    runTo: (time) => synced(ctl().runTo(time)),
    query: (kind, id) => ctl().query(kind, id),
    inject: (type, at, subjects, payload) => ctl().inject(type, at, subjects, payload),
    snapshot: () => ctl().passthrough<SimSnapshot>({ op: 'snapshot' }),
    why: (eventId) => ctl().passthrough<EngineEvent[]>({ op: 'why', eventId }),
    select: (id) => store.select(id),
    cameraTo: (id, distanceM) => store.view()?.cameraTo(id, distanceM) ?? false,
    setSpeed: (s) => store.setSpeed(s),
    pause: () => {
      ctl().pause()
      store.sync()
    },
    play: () => {
      ctl().play()
      store.sync()
    },
    reset: () => store.reset(),
    newScenario: () => store.newScenario(),
    clock: () => {
      const c = store.controller()
      return {
        displayTime: c?.displayTime ?? 0,
        speed: c?.speed ?? 0,
        paused: c?.paused ?? true,
        busy: c?.busy ?? false,
        engine: c?.info ?? null,
      }
    },
    scene: () => store.view()?.stats() ?? null,
    sceneState: () => {
      const c = store.controller()
      const model = c?.model
      if (!c || !model) return null
      const t = c.displayTime
      return {
        displayTime: t,
        containers: Object.fromEntries(model.containerIds.map((id) => [id, model.custodyAt(id, t)])),
        sts: Object.fromEntries(model.stsIds.map((id) => [id, { status: model.statusAt('sts', id, t), ...model.stsPose(id, t) }])),
        vessels: Object.fromEntries(model.vesselIds.map((id) => [id, { status: model.statusAt('vessel', id, t) }])),
        liveries: store.view()?.liveries() ?? {},
      }
    },
    display: () => ({ ...store.display }),
    setDisplay: (next) => {
      store.setDisplay(next)
      return { ...store.display }
    },
    config: () => (store.config ? (JSON.parse(JSON.stringify(store.config)) as ScenarioConfig) : null),
    ui: () => ({
      selectedId: store.selectedId,
      following: store.following,
      overlaysVisible: store.overlaysVisible,
      dashboardOpen: store.dashboardOpen,
      helpOpen: store.helpOpen,
    }),
  }

  window.__tt = api
  return () => {
    if (window.__tt === api) delete window.__tt
  }
}

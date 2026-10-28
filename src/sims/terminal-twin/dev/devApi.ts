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
 *   __tt.scene()                               // rendered counts { containers, sts, vessels, frames, containerLods, containerAssets, shcLods, shcAssets }
 *   await __tt.step(); await __tt.why(id); await __tt.snapshot()
 *   await __tt.inject('VesselBerthed', 120, { vessels: ['V001'] }, { vesselId: 'V001', berthX: 50 })
 *   __tt.select('STS01'); __tt.cameraTo('STS01'); __tt.setSpeed(600); __tt.pause(); __tt.clock()
 *   __tt.overlays({ laneGraph: true, reservations: true })   // 3D debug overlays
 *   await __tt.query('ascList'); await __tt.query('yardSlots', 'B01'); __tt.sceneState().ascs   // yard (TT-06)
 *   __tt.setDisplay({ locale: 'de-DE', units: 'imperial' }); __tt.display(); __tt.config(); __tt.ui()
 *   await __tt.query('kpiHeadline'); await __tt.query('kpiSeries'); await __tt.exportRun('kpi-csv')   // KPIs and exports (TT-07)
 *   __tt.load(name, { endConditions: { moves: 5 } })   // end after 5 moves; __tt.report() = final report state
 *   await __tt.addBreakpoint('eventType', 'StsPicked'); __tt.setSpeed(600)   // plays, pauses at the hit; __tt.debug().breakHit
 *   await __tt.inspectEvent(id); __tt.debug().inspectedEvent.chain   // cause chain, newest first, root last
 *   __tt.screenPoint('STS01'); __tt.pickAt(x, y)                         // 3D picking, client coordinates
 */
import type { ScenarioOverrides } from '../scenario/overrides'
import type { DisplaySettings, ScenarioConfig } from '../scenario/types'
import type {
  CustodyRef,
  EngineEvent,
  EventPayloads,
  EventSubjects,
  EventType,
  ExportKind,
  HeadlineKpis,
  Highlight,
  RunResult,
  SimSnapshot,
} from '../engine'
import type { Breakpoint, BreakpointKind } from '../modules/breakpoints'
import type { OverlayState } from '../modules/overlays'
import type { RenderedLivery, SceneStats } from '../modules/sceneRenderer'
import type { ShcRigState } from '../modules/shcAssets'
import type { AscPose, ShcPose, StsPose } from '../modules/sceneModel'
import type { TwinController } from '../modules/twinController'
import { resolveScenario, type ScenarioChoice, type useTwinStore } from '../store/twinStore'
import type { BreakpointHit, EngineInfo, EventSummary, QueryKind, WorkerRunCondition } from '../worker/protocol'

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
  load(
    name?: string,
    options?: {
      seed?: number
      startDateTime?: string
      autoplay?: boolean
      overrides?: ScenarioOverrides
      shc?: ScenarioChoice['shc']
      yard?: ScenarioChoice['yard']
      endConditions?: ScenarioChoice['endConditions']
    },
  ): Promise<EngineInfo | null>
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
  /** Turn 3D debug overlays on/off (omitted keys unchanged); returns the new state. */
  overlays(next?: Partial<OverlayState>): OverlayState
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
  /** The KPI report or the event log as the exported text (JSON or CSV), built in the worker. */
  exportRun(kind: ExportKind): Promise<string>
  /** What the KPI strip and the final report show right now. */
  report(): TwinReportState
  /** Add a breakpoint (event type, container id, equipment id or decision-point id); returns the new list. */
  addBreakpoint(kind: BreakpointKind, value: string): Promise<Breakpoint[]>
  removeBreakpoint(id: number): Promise<Breakpoint[]>
  clearBreakpoints(): Promise<Breakpoint[]>
  breakpoints(): Breakpoint[]
  /** Show an event in the inspector (payload, decision request/reply, cause chain to the root). */
  inspectEvent(eventId: number): Promise<void>
  /** Debugger state: the breakpoint that paused playback, the inspected event and the inspected selection. */
  debug(): TwinDebugState
  /** Entity id under a viewport point (client coordinates) at the displayed time, like a click. */
  pickAt(clientX: number, clientY: number): string | null
  /** Viewport (client) coordinates of an entity's centre, or null when it is not drawn or off screen. */
  screenPoint(entityId: string): { x: number; y: number } | null
  /** Where the orbit camera looks (follow-camera checks). */
  cameraTarget(): { x: number; y: number; z: number } | null
}

export interface TwinReportState {
  /** The run has ended and the display has reached its end (time controls are locked). */
  ended: boolean
  /** The final report panel is on screen. */
  open: boolean
  headline: HeadlineKpis | null
  highlights: Highlight[]
  /** The final report data has been fetched. */
  reportReady: boolean
}

export interface TwinDebugState {
  breakHit: BreakpointHit | null
  paused: boolean
  /** The inspected event, with its cause chain (newest first, the root last). */
  inspectedEvent: { id: number; type: string; chain: { id: number; type: string; causedBy: number | null }[] } | null
  entity: { kind: string; id: string; status: string | null } | null
}

export interface TwinUiState {
  selectedId: string | null
  following: boolean
  overlaysVisible: boolean
  dashboardOpen: boolean
  helpOpen: boolean
  reportOpen: boolean
  feedOpen: boolean
  inspectorOpen: boolean
}

export interface SceneState {
  displayTime: number
  containers: Record<string, CustodyRef | null>
  sts: Record<string, { status: string } & StsPose>
  shcs: Record<string, { status: string } & ShcPose>
  /** The ASCs of every yard block (1 or 2 each): status and spreader pose (gantry Z, trolley X, hoist height). */
  ascs: Record<string, { status: string } & AscPose>
  vessels: Record<string, { status: string }>
  /** Conflict zones reserved at the displayed time (zone → holder). */
  reservations: Record<string, string>
  /** Per container: livery atlas index, model size and LOD actually drawn (phase 2 assets). */
  liveries: Record<string, RenderedLivery>
  /** Per SHC, the phase 2 rig as last drawn: LOD, steering, wheel roll, hoist travel, carrying (empty until the GLB loads). */
  shcRigs: Record<string, ShcRigState>
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
          overrides: options.overrides,
          shc: options.shc,
          yard: options.yard,
          endConditions: options.endConditions,
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
    overlays: (next = {}) => store.setOverlays(next),
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
        shcs: Object.fromEntries(model.shcIds.map((id) => [id, { status: model.statusAt('shc', id, t), ...model.shcPose(id, t) }])),
        ascs: Object.fromEntries(model.ascIds.map((id) => [id, { status: model.statusAt('asc', id, t), ...model.ascPose(id, t) }])),
        reservations: model.activeReservations(t),
        vessels: Object.fromEntries(model.vesselIds.map((id) => [id, { status: model.statusAt('vessel', id, t) }])),
        liveries: store.view()?.liveries() ?? {},
        shcRigs: store.view()?.shcRigs() ?? {},
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
      reportOpen: store.reportOpen,
      feedOpen: store.feedOpen,
      inspectorOpen: store.inspectorOpen,
    }),
    exportRun: (kind) => store.exportRun(kind),
    report: () => ({
      ended: store.runEnded,
      open: store.runEnded && store.reportOpen,
      headline: store.kpi?.headline ?? null,
      highlights: store.finalReport?.highlights ?? store.kpi?.highlights ?? [],
      reportReady: store.finalReport !== null,
    }),
    addBreakpoint: async (kind, value) => {
      await store.addBreakpoint(kind, value)
      return store.breakpoints.map((b) => ({ ...b }))
    },
    removeBreakpoint: async (id) => {
      await store.removeBreakpoint(id)
      return store.breakpoints.map((b) => ({ ...b }))
    },
    clearBreakpoints: async () => {
      await store.clearBreakpoints()
      return []
    },
    breakpoints: () => store.breakpoints.map((b) => ({ ...b })),
    inspectEvent: (eventId) => store.inspectEvent(eventId),
    debug: () => {
      const inspected = store.inspectedEvent
      const entity = store.entityView
      const c = store.controller()
      return {
        breakHit: c?.breakHit ?? null,
        paused: c?.paused ?? true,
        inspectedEvent: inspected
          ? {
              id: inspected.chain[inspected.index].id,
              type: inspected.chain[inspected.index].type,
              chain: inspected.chain.map((e) => ({ id: e.id, type: e.type, causedBy: e.causedBy })),
            }
          : null,
        entity: entity ? { kind: entity.kind, id: entity.id, status: String(entity.facts.find((f) => f.label === 'inspector.fact.status')?.value ?? '') || null } : null,
      }
    },
    pickAt: (x, y) => store.view()?.pickAt(x, y) ?? null,
    screenPoint: (id) => store.view()?.screenPoint(id) ?? null,
    cameraTarget: () => store.view()?.cameraTarget() ?? null,
  }

  window.__tt = api
  return () => {
    if (window.__tt === api) delete window.__tt
  }
}

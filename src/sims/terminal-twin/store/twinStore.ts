/**
 * Terminal Twin Pinia store: the UI-facing facade over the run.
 *
 * Small UI state is reactive (phase, setup, clock, speed, engine info). The
 * TwinController, SceneModel, worker and Three.js view live outside
 * reactivity (closure variables / markRaw); large collections such as the
 * recent-event buffer use shallowRef + triggerRef (Box Empire pattern).
 */
import type { ViewPresetName } from '../modules/viewPresets'
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, triggerRef } from 'vue'
import { fixtures } from '../scenario/fixtures'
import { type ScenarioOverrides } from '../scenario/overrides'
import { composeScenario } from '../scenario/compose'
import { presets } from '../scenario/presets'
import type { YardSetup } from '../scenario/builder'
import type { DisplaySettings, EndConditions, ScenarioConfig, ShcKinematics } from '../scenario/types'
import { EXPORT_FILES, ScenarioValidationError, validateScenario, type EngineEvent, type SimSnapshot, type ExportKind, type HeadlineKpis, type Highlight, type KpiReport, type KpiSeriesReport } from '../engine'
import type { BreakpointHit, Checkpoint, DashboardData, Delta, EngineInfo, EventSummary } from '../worker/protocol'
import { parseBreakpointInput, type Breakpoint, type BreakpointKind } from '../modules/breakpoints'
import { describeEntity, entityKind, entityQueryKind, type EntityView } from '../modules/entityInspector'
import { EQUIPMENT_KINDS } from '../modules/equipmentKinds'
import { describeEvent, type EventDescription } from '../modules/eventInspector'
import { FEED_BUFFER_CAP } from '../modules/eventFeed'
import type { Bucketing, KpiGroupId } from '../modules/dashboardModel'
import { makeConfigSave, makeSnapshotSave, parseSaveFile, planLoad, saveFileName, SaveFormatError, type SaveFile, type SaveMeta, type SaveType } from '../persistence/saves'
import { openSaveStore, StorageUnavailableError, type SaveStore } from '../persistence/saveStore'
import { SPEEDS, TwinController } from '../modules/twinController'
import { loadDisplaySettings, runConfigFor, saveDisplaySettings } from '../i18n/display'
import { createFormatter } from '../i18n/format'
import { t, type MessageKey, type MessageParams } from '../i18n/messages'
import { defaultStartDate } from '../modules/time'
import { NO_OVERLAYS, type OverlayState } from '../modules/overlays'
import type { RenderedLivery, SceneStats } from '../modules/sceneRenderer'
import { CuePlanner } from '../modules/cues'
import { SoundPlayer } from '../modules/soundPlayer'
import type { AtmosphereState } from '../modules/atmosphereRig'
import type { BackdropKind } from '../modules/backdrop'
import { daylightLockDefault } from '../modules/atmosphere'

export type TwinPhase = 'setup' | 'running'
export type DashboardTab = 'charts' | 'report'

/** What the dashboard has rendered (read by the dev API and smoke tests). */
export interface DashboardRendered {
  chartLibLoaded: boolean
  /** KPI charts currently drawn (ids) and the lines in each. */
  charts: { kpiId: string; lines: string[]; points: number; zoom: { start: number; end: number } | null; drawn: boolean }[]
  heatmap: { blocks: string[]; hours: number[]; values: Record<string, (number | null)[]>; liveFill: Record<string, number> } | null
  gantt: { rows: string[]; bars: { row: string; phase: string; startS: number; endS: number }[] } | null
}

export interface ScenarioChoice {
  /** Fixture or preset name. */
  name: string
  seed: number
  /** ISO date-time of sim t = 0. */
  startDateTime: string
  /** Setup-dialog edits: quay length, STS count, vessel table. */
  overrides?: ScenarioOverrides
  /** SHC fleet overrides from the setup dialog (scenarios with SHCs only). */
  shc?: { count: number; kinematics: ShcKinematics }
  /** Yard block and ASC overrides from the setup dialog (scenarios with yard blocks only). */
  yard?: YardSetup
  /** End conditions from the setup dialog (replace the scenario's own). */
  endConditions?: EndConditions
}

/** The headline KPIs and highlights the strip and report show. */
export interface KpiHeadlineState {
  headline: HeadlineKpis
  highlights: Highlight[]
}

/** Everything the final report shows (fetched once the run has ended). */
export interface FinalReportData extends KpiHeadlineState {
  kpis: KpiReport
  series: KpiSeriesReport
  eventLogHash: string
}

/** What the 3D view registers so the dev API can reach it. */
export interface TwinView {
  /** Aim at an entity, keeping the view direction (and, if given, at `distanceM`). */
  cameraTo(entityId: string, distanceM?: number): boolean
  /** Frame a view preset (V11-05); false when the scene has no such region (no landside for the gate view). */
  viewPreset(preset: ViewPresetName): boolean
  /** The entity under a viewport point (client coordinates) at the displayed time, or null. */
  pickAt(clientX: number, clientY: number): string | null
  /** Viewport (client) coordinates of an entity's centre; null when it is not drawn or off screen. */
  screenPoint(entityId: string): { x: number; y: number } | null
  /** Where the orbit camera currently looks. */
  cameraTarget(): { x: number; y: number; z: number } | null
  /** Rendered entity counts plus frames rendered so far and the last frame's draw calls/triangles; null without a 3D view. */
  stats(): (SceneStats & { frames: number; render: RenderInfo }) | null
  /** Livery index, size and LOD drawn per container; null without a 3D view. */
  liveries(): Record<string, RenderedLivery> | null
  /** Rig state per entity, per equipment kind (`EquipmentKindDef.rigKey` names the dev-API key); null without a 3D view. */
  rigs(): Record<string, Record<string, unknown>> | null
  /** Where the draw calls go: visible drawables per scene group and geometry type (TT-19 perf tool); null without a 3D view. */
  drawBreakdown(): Record<string, { objects: number; triangles: number }> | null
  /** Time-of-day lighting state and the backdrop in use (TT-21); null without a 3D view. */
  atmosphere(): (AtmosphereState & { backdrop: { kind: BackdropKind; parts: string[]; models: 'procedural' | 'glb' } }) | null
}

/** The banner shown on a vessel departure or when the scenario completes (TT-21). */
export interface TwinBanner {
  id: number
  kind: 'departure' | 'complete'
  vesselName: string
}

/** The last rendered frame (main pass + shadow pass), from `renderer.info`. */
export interface RenderInfo {
  calls: number
  triangles: number
}

const RECENT_EVENTS_CAP = FEED_BUFFER_CAP
const TOAST_MS = 1600
const KPI_POLL_MS = 1000

/** localStorage, or null where it is unavailable (private mode, blocked, tests). */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function browserLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
}

/** Fixtures and presets offered by the setup dialog. */
export function scenarioCatalogue(): { name: string; kind: 'fixture' | 'preset'; description: string }[] {
  return [
    ...Object.values(fixtures).map((f) => ({ name: f.name, kind: 'fixture' as const, description: f.description })),
    ...Object.entries(presets).map(([name, build]) => ({ name, kind: 'preset' as const, description: build().description })),
  ]
}

export function resolveScenario(name: string): ScenarioConfig {
  const fixture = fixtures[name]
  if (fixture) return fixture
  const preset = presets[name]
  if (preset) return preset()
  throw new Error(`Unknown fixture or preset: ${name}`)
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/** An inspected event with its cause chain (newest first, root last). */
export interface InspectedEvent {
  chain: EventDescription[]
  /** Which chain entry the inspector shows. */
  index: number
}

export const useTwinStore = defineStore('terminal-twin', () => {
  const phase = ref<TwinPhase>('setup')
  const choice = ref<ScenarioChoice>({
    name: Object.keys(fixtures)[0] ?? '',
    seed: fixtures[Object.keys(fixtures)[0]]?.seed ?? 1,
    startDateTime: defaultStartDate().toISOString(),
  })
  /** Whether a scenario has been loaded (so the setup dialog can be cancelled). */
  const hasScenario = ref(false)
  /** The loaded scenario has SHCs (shows the SHC overlay toggles). */
  const hasShcs = ref(false)
  const loading = ref(false)
  const displayTime = ref(0)
  const speed = ref(10)
  const paused = ref(true)
  const busy = ref(false)
  const info = shallowRef<EngineInfo | null>(null)
  const error = ref<string | null>(null)
  const selectedId = ref<string | null>(null)
  const recentEvents = shallowRef<EventSummary[]>(markRaw([]))
  /** 3D debug overlays (lane graph, active reservations). */
  const overlays = ref<OverlayState>({ ...NO_OVERLAYS })
  /** Locale + units: browser defaults on first open, then the remembered choice. Display only. */
  const display = ref<DisplaySettings>(loadDisplaySettings(browserStorage(), browserLanguages()))
  /** Formatter for the current display settings (Intl objects; rebuilt when they change). */
  const fmt = computed(() => markRaw(createFormatter(display.value)))
  /** The SI config of the loaded scenario, with the current display settings (what a save stores). */
  const config = shallowRef<ScenarioConfig | null>(null)
  /** Keyboard-driven view state (TT-16 dashboard and TT-18 overlays/follow camera build on these). */
  const following = ref(false)
  /** "Follow next truck" was asked and no truck arrival at or after `followNextFrom` is known yet (resolved in `sync`). */
  const followNextPending = ref(false)
  let followNextFrom = 0
  const overlaysVisible = ref(true)
  const dashboardOpen = ref(false)
  /** Dashboard tab (TT-16): KPI charts, yard heatmap and Gantt, or the final report. */
  const dashboardTab = ref<DashboardTab>('charts')
  /** Data the dashboard shows (refreshed while it is open). */
  const dashboardData = shallowRef<DashboardData | null>(null)
  const dashboardGroup = ref<KpiGroupId>('quay')
  const dashboardBucketing = ref<Bucketing>('hour')
  const dashboardRendered = shallowRef<DashboardRendered | null>(null)
  const helpOpen = ref(false)
  const toast = ref<{ id: number; text: string } | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  /** Headline KPIs of the engine's current state (null until the first poll). */
  const kpi = shallowRef<KpiHeadlineState | null>(null)
  /** The final report data, once the run has ended. */
  const finalReport = shallowRef<FinalReportData | null>(null)
  const reportOpen = ref(true)
  /** The run is over and the display has reached its end: only Reset and New Scenario remain. */
  const runEnded = computed(() => {
    const i = info.value
    return !!i && i.status !== 'ready' && displayTime.value >= (i.endT ?? i.now)
  })
  /** Debugger (TT-18): breakpoints, the one that paused playback, panels, inspected event and selection. */
  const breakpoints = ref<Breakpoint[]>([])
  const breakHit = shallowRef<BreakpointHit | null>(null)
  const feedOpen = ref(false)
  const inspectorOpen = ref(false)
  const feedFilter = ref('')
  const inspectedEvent = shallowRef<InspectedEvent | null>(null)
  const entityView = shallowRef<EntityView | null>(null)
  let nextBreakpointId = 1

  /** Sound effects (TT-21): off by default; the player only exists to be used while on. */
  const soundOn = ref(false)
  const sounds = markRaw(new SoundPlayer())
  /** Keep the sun daylight all day (default on for the Stress test preset). */
  const lockDaylight = ref(false)
  const banner = ref<TwinBanner | null>(null)
  const cues = markRaw(new CuePlanner())
  let bannerTimer: ReturnType<typeof setTimeout> | null = null
  let bannerId = 0

  /** Saves and rewind (TT-17). */
  const savesOpen = ref(false)
  const saves = shallowRef<SaveMeta[]>([])
  /** IndexedDB state: unknown until first opened; `unavailable` means file export/import only. */
  const storage = ref<'unknown' | 'ok' | 'unavailable'>('unknown')
  const savesMessage = ref<{ kind: 'info' | 'error'; text: string } | null>(null)
  /** A snapshot from another engine version waits here for the user's choice: restart from its config, or cancel. */
  const versionPrompt = shallowRef<{ name: string; savedEngineVersion: string; currentEngineVersion: string; config: ScenarioConfig; seed: number } | null>(null)
  /** Automatic rewind points of the current timeline; the interval (sim-minutes) applies from the next load, reset or rewind. */
  const rewindPoints = shallowRef<Checkpoint[]>([])
  const rewindIntervalMin = ref(15)
  let saveStore: Promise<SaveStore | null> | null = null
  let rewindEvents = -1

  let controller: TwinController | null = null
  let view: TwinView | null = null
  let kpiTimer: ReturnType<typeof setInterval> | null = null
  let kpiEvents = -1
  let kpiBusy = false
  let dashEvents = -1
  let dashBusy = false

  function onDelta(delta: Delta): void {
    if (delta.events.length === 0) return
    cues.ingest(delta.events)
    const list = recentEvents.value
    list.push(...delta.events)
    if (list.length > RECENT_EVENTS_CAP) list.splice(0, list.length - RECENT_EVENTS_CAP)
    triggerRef(recentEvents)
  }

  function ctl(): TwinController {
    controller ??= markRaw(new TwinController(onDelta))
    return controller
  }

  function showBanner(kind: TwinBanner['kind'], vesselId: string | undefined): void {
    const name = config.value?.vessels.find((v) => v.id === vesselId)?.name ?? ''
    banner.value = { id: ++bannerId, kind, vesselName: name }
    if (bannerTimer) clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => {
      banner.value = null
    }, 3500)
  }

  /** Cues the display clock has reached: banners always, sounds only when the toggle is on. */
  function releaseCues(displayT: number, playSpeed: number, flatOut: boolean): void {
    const due = cues.drain(displayT, playSpeed)
    for (const c of due) {
      if (c.banner === 'departure') showBanner('departure', c.vesselId)
      if (!flatOut && soundOn.value) sounds.play(c, playSpeed, performance.now())
    }
  }

  function toggleSound(): void {
    soundOn.value = !soundOn.value
    showToast(soundOn.value ? 'twin.toast.soundOn' : 'twin.toast.soundOff')
  }

  function toggleLockDaylight(): void {
    lockDaylight.value = !lockDaylight.value
    showToast(lockDaylight.value ? 'twin.toast.daylightLocked' : 'twin.toast.daylightFollows')
  }

  /** Copy the controller's playback state into reactive refs (once per frame and after actions). */
  function sync(): void {
    if (!controller) return
    displayTime.value = controller.displayTime
    if (followNextPending.value) resolveFollowNext()
    speed.value = controller.speed
    paused.value = controller.paused
    busy.value = controller.busy
    if (info.value !== controller.info) info.value = controller.info
    releaseCues(controller.displayTime, controller.speed, controller.busy)
    if (breakHit.value !== controller.breakHit) {
      breakHit.value = controller.breakHit
      if (controller.breakHit) {
        inspectorOpen.value = true
        void inspectEvent(controller.breakHit.event.id)
      }
    }
    // the ended run is frozen: the display stays at its end
    if (runEnded.value && !controller.paused) {
      controller.pause()
      paused.value = true
    }
  }

  /** Fetch the headline KPIs (and, once the run has ended, the final report data). */
  async function refreshKpis(): Promise<void> {
    const c = controller
    if (!c || kpiBusy || !c.info) return
    kpiBusy = true
    try {
      const eventsAt = c.info.eventsTotal
      kpi.value = markRaw(await c.query<KpiHeadlineState>('kpiHeadline'))
      kpiEvents = eventsAt
      if (c.info.status !== 'ready' && finalReport.value?.eventLogHash !== c.info.eventLogHash) {
        const [kpis, series] = await Promise.all([c.query<KpiReport>('kpis'), c.query<KpiSeriesReport>('kpiSeries')])
        const first = finalReport.value === null
        finalReport.value = markRaw({ ...kpi.value, kpis, series, eventLogHash: c.info.eventLogHash })
        // the run is over: the final report opens as the dashboard's report tab and stays browsable
        if (first) {
          dashboardTab.value = 'report'
          dashboardOpen.value = true
          void refreshDashboard()
        }
      }
    } catch {
      // the scenario was replaced meanwhile: the next poll catches up
    } finally {
      kpiBusy = false
      sync()
    }
  }

  /** Fetch the dashboard's data (KPI series, timeline, yard fill) from the engine. */
  async function refreshDashboard(): Promise<void> {
    const c = controller
    if (!c || dashBusy || !c.info) return
    dashBusy = true
    try {
      const eventsAt = c.info.eventsTotal
      dashboardData.value = markRaw(await c.query<DashboardData>('dashboard'))
      dashEvents = eventsAt
    } catch {
      // the scenario was replaced meanwhile: the next poll catches up
    } finally {
      dashBusy = false
    }
  }

  function startKpiPolling(): void {
    if (kpiTimer) return
    kpiTimer = setInterval(() => {
      const c = controller
      if (!c || c.busy || !c.info) return
      if (c.info.eventsTotal !== kpiEvents) void refreshKpis()
      if (dashboardOpen.value && c.info.eventsTotal !== dashEvents) void refreshDashboard()
      if (c.info.eventsTotal !== rewindEvents) void refreshRewind()
    }, KPI_POLL_MS)
  }

  function setDashboardTab(tab: DashboardTab): void {
    dashboardTab.value = tab
  }

  function resetKpis(): void {
    kpi.value = null
    finalReport.value = null
    reportOpen.value = true
    kpiEvents = -1
    dashboardOpen.value = false
    dashboardTab.value = 'charts'
    dashboardData.value = null
    dashEvents = -1
  }

  /** Download the KPI report or the event log (JSON or CSV), built by the engine in the worker. */
  async function exportRun(kind: ExportKind): Promise<string> {
    const text = await ctl().passthrough<string>({ op: 'export', kind })
    return text
  }

  async function downloadExport(kind: ExportKind): Promise<void> {
    try {
      const text = await exportRun(kind)
      const file = EXPORT_FILES[kind]
      const blob = new Blob([text], { type: file.mime })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${choice.value.name}-seed${choice.value.seed}-${file.suffix}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (err) {
      showToast('report.exportFailed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function run<T>(action: () => Promise<T>): Promise<T> {
    error.value = null
    try {
      return await action()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      sync()
    }
  }

  async function startScenario(next: ScenarioChoice, options: { autoplay?: boolean } = {}): Promise<void> {
    const base = composeScenario(resolveScenario(next.name), next)
    const runConfig = runConfigFor(base, next.startDateTime, display.value)
    await launch(runConfig, next, (c) => c.load(runConfig, next.seed), options)
  }

  /** Start a run from a ready config: validate, load through `load`, and reset the run's UI state. */
  async function launch(runConfig: ScenarioConfig, next: ScenarioChoice, load: (c: TwinController) => Promise<unknown>, options: { autoplay?: boolean } = {}): Promise<void> {
    choice.value = { ...next }
    loading.value = true
    try {
      await run(async () => {
        // impossible configurations never reach the engine
        const { errors } = validateScenario(runConfig)
        if (errors.length > 0) throw new ScenarioValidationError(errors)
        const c = ctl()
        await c.setCheckpointInterval(rewindIntervalMin.value * 60)
        return load(c)
      })
      config.value = markRaw(runConfig)
      recentEvents.value = markRaw([])
      resetKpis()
      rewindPoints.value = []
      rewindEvents = -1
      selectedId.value = null
      entityView.value = null
      inspectedEvent.value = null
      following.value = false
      hasScenario.value = true
      cues.reset()
      cues.setVesselSize((id) => {
        const cls = runConfig.vessels.find((v) => v.id === id)?.sizeClass
        return cls !== undefined && cls !== 'feeder' && cls !== 'feedermax'
      })
      sounds.reset()
      banner.value = null
      lockDaylight.value = daylightLockDefault(next.name)
      hasShcs.value = (runConfig.shcs?.length ?? 0) > 0
      phase.value = 'running'
      if (options.autoplay ?? true) ctl().play()
      startKpiPolling()
      void refreshKpis()
      void refreshRewind()
    } finally {
      loading.value = false
      sync()
    }
  }

  async function reset(): Promise<void> {
    await run(() => ctl().reset())
    cues.reset()
    sounds.reset()
    banner.value = null
    recentEvents.value = markRaw([])
    resetKpis()
    rewindPoints.value = []
    rewindEvents = -1
    void refreshKpis()
    inspectedEvent.value = null
    void refreshEntity()
  }

  function newScenario(): void {
    ctl().pause()
    phase.value = 'setup'
    sync()
  }

  function cancelSetup(): void {
    if (hasScenario.value) phase.value = 'running'
  }

  function setSpeed(s: number): void {
    if (runEnded.value) return
    ctl().setSpeed(s)
    sync()
  }

  function togglePause(): void {
    if (runEnded.value) return
    const c = ctl()
    if (c.paused) c.play()
    else c.pause()
    sync()
  }

  function runTo(time: number) {
    if (runEnded.value) return Promise.resolve(null)
    return run(() => ctl().runTo(time).then((r) => (void refreshKpis(), r)))
  }

  function runToNextDeparture() {
    if (runEnded.value) return Promise.resolve(null)
    return run(() => ctl().runToNextDeparture().then((r) => (void refreshKpis(), r)))
  }

  function setOverlays(next: Partial<OverlayState>): OverlayState {
    overlays.value = { ...overlays.value, ...next }
    return { ...overlays.value }
  }

  function select(id: string | null): void {
    selectedId.value = id
    followNextPending.value = false
    if (!id) {
      following.value = false
      entityView.value = null
      return
    }
    inspectorOpen.value = true
    void refreshEntity()
  }

  /** Re-read the selected entity from the engine (the inspector calls this a few times per second). */
  async function refreshEntity(): Promise<void> {
    const id = selectedId.value
    const c = controller
    if (!id || !c?.model) {
      entityView.value = null
      return
    }
    const kind = entityKind(c.model, id)
    if (!kind) {
      entityView.value = null
      return
    }
    try {
      const state = await c.query(entityQueryKind(kind), id)
      const def = EQUIPMENT_KINDS.find((d) => d.kind === kind)
      const extras = (await def?.loadExtras?.(state, (q) => c.query(q))) ?? {}
      if (selectedId.value === id) entityView.value = markRaw(describeEntity(kind, state, extras))
    } catch {
      // The scenario was replaced meanwhile; the next refresh shows the new state.
    }
  }

  /** Inspect an event: payload, decision request/reply and the cause chain back to the root. */
  async function inspectEvent(eventId: number): Promise<void> {
    const current = inspectedEvent.value
    const inChain = current?.chain.findIndex((e) => e.id === eventId) ?? -1
    if (current && inChain >= 0) {
      inspectedEvent.value = { chain: current.chain, index: inChain }
      inspectorOpen.value = true
      return
    }
    const chain = await ctl().passthrough<EngineEvent[]>({ op: 'why', eventId })
    inspectedEvent.value = markRaw({ chain: chain.map(describeEvent), index: 0 })
    inspectorOpen.value = true
  }

  async function addBreakpoint(kind: BreakpointKind, text: string): Promise<boolean> {
    const parsed = parseBreakpointInput(kind, text)
    if (!parsed) return false
    breakpoints.value = [...breakpoints.value, { id: nextBreakpointId++, ...parsed }]
    await ctl().setBreakpoints(breakpoints.value)
    return true
  }

  async function removeBreakpoint(id: number): Promise<void> {
    breakpoints.value = breakpoints.value.filter((b) => b.id !== id)
    await ctl().setBreakpoints(breakpoints.value)
  }

  async function clearBreakpoints(): Promise<void> {
    breakpoints.value = []
    await ctl().setBreakpoints([])
  }

  /** Resume after a breakpoint (or play when paused). */
  function resume(): void {
    ctl().play()
    sync()
  }

  function toggleFeed(): void {
    feedOpen.value = !feedOpen.value
  }

  function toggleInspector(): void {
    inspectorOpen.value = !inspectorOpen.value
  }

  // ---- Saves and rewind (TT-17) ----

  function savesError(err: unknown): void {
    if (err instanceof SaveFormatError) savesMessage.value = { kind: 'error', text: t(err.key, err.params) }
    else if (err instanceof StorageUnavailableError) savesMessage.value = { kind: 'error', text: t('saves.storageUnavailable') }
    else savesMessage.value = { kind: 'error', text: t('saves.failed', { error: err instanceof Error ? err.message : String(err) }) }
  }

  function savesInfo(key: MessageKey, params?: MessageParams): void {
    savesMessage.value = { kind: 'info', text: t(key, params) }
  }

  /** The IndexedDB store, opened once; null where it is unavailable (the UI then says so). */
  function openStore(): Promise<SaveStore | null> {
    saveStore ??= openSaveStore().then(
      (s) => {
        storage.value = 'ok'
        return s
      },
      () => {
        storage.value = 'unavailable'
        return null
      },
    )
    return saveStore
  }

  async function refreshSaves(): Promise<void> {
    const s = await openStore()
    if (!s) return
    try {
      saves.value = markRaw(await s.list())
    } catch (err) {
      savesError(err)
    }
  }

  async function openSaves(): Promise<void> {
    savesOpen.value = true
    savesMessage.value = null
    versionPrompt.value = null
    await refreshSaves()
  }

  function closeSaves(): void {
    savesOpen.value = false
  }

  async function refreshRewind(): Promise<void> {
    const c = controller
    if (!c?.info) return
    const at = c.info.eventsTotal
    try {
      rewindPoints.value = markRaw(await c.query<Checkpoint[]>('checkpoints'))
      rewindEvents = at
    } catch {
      // the scenario was replaced meanwhile: the next poll catches up
    }
  }

  function defaultSaveName(type: SaveType): string {
    const base = `${choice.value.name} / seed ${choice.value.seed}`
    return type === 'snapshot' ? `${base} / ${fmt.value.clock(choice.value.startDateTime, displayTime.value).elapsed}` : base
  }

  /** The save document of the current run: its config, or the engine's full snapshot. */
  async function buildSave(type: SaveType, name?: string): Promise<SaveFile> {
    const c = controller
    const cfg = config.value
    if (!c?.model || !cfg) throw new Error('No scenario loaded')
    const label = name?.trim() || defaultSaveName(type)
    if (type === 'config') return makeConfigSave(label, cfg, c.model.seed)
    const snapshot = await c.passthrough<SimSnapshot>({ op: 'snapshot' })
    return makeSnapshotSave(label, { ...snapshot, config: cfg }, new Date())
  }

  /** Save the current run to the browser's IndexedDB list. Null (with a message) where storage is unavailable. */
  async function saveToBrowser(type: SaveType, name?: string): Promise<SaveMeta | null> {
    savesMessage.value = null
    try {
      const file = await buildSave(type, name)
      const s = await openStore()
      if (!s) {
        savesMessage.value = { kind: 'error', text: t('saves.storageUnavailable') }
        return null
      }
      const meta = await s.put(file)
      await refreshSaves()
      savesInfo('saves.saved', { name: meta.name })
      return meta
    } catch (err) {
      savesError(err)
      return null
    }
  }

  function download(file: SaveFile): void {
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = saveFileName(file)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  /** Download the current run as a JSON file (works without IndexedDB). */
  async function exportToFile(type: SaveType, name?: string): Promise<void> {
    savesMessage.value = null
    try {
      const file = await buildSave(type, name)
      download(file)
      savesInfo('saves.exported', { name: file.name })
    } catch (err) {
      savesError(err)
    }
  }

  async function exportSaved(id: string): Promise<void> {
    try {
      const file = await (await openStore())?.get(id)
      if (file) download(file)
    } catch (err) {
      savesError(err)
    }
  }

  async function deleteSaved(id: string): Promise<void> {
    try {
      await (await openStore())?.remove(id)
      await refreshSaves()
    } catch (err) {
      savesError(err)
    }
  }

  /** Make a save's locale and units the UI's. */
  function adoptDisplay(cfg: ScenarioConfig): ScenarioConfig {
    if (cfg.display) {
      display.value = { ...cfg.display }
      saveDisplaySettings(browserStorage(), display.value)
      return cfg
    }
    return { ...cfg, display: { ...display.value } }
  }

  /** Start a run from a config and seed (paused at t = 0). */
  async function startFromConfig(cfg: ScenarioConfig, seed: number): Promise<void> {
    const runConfig = adoptDisplay(JSON.parse(JSON.stringify(cfg)) as ScenarioConfig)
    await launch(runConfig, { name: runConfig.name, seed, startDateTime: runConfig.startDateTime }, (c) => c.load(runConfig, seed), { autoplay: false })
  }

  /** Apply a parsed save: start the config, resume the snapshot, or (other engine version) ask first. */
  async function applySave(file: SaveFile): Promise<'loaded' | 'version-mismatch'> {
    const plan = planLoad(file)
    versionPrompt.value = null
    if (plan.action === 'config') {
      await startFromConfig(plan.config, plan.seed)
      savesInfo('saves.loadedConfig', { name: file.name })
      return 'loaded'
    }
    if (plan.action === 'snapshot-mismatch') {
      versionPrompt.value = { name: file.name, savedEngineVersion: plan.savedEngineVersion, currentEngineVersion: plan.currentEngineVersion, config: plan.config, seed: plan.seed }
      return 'version-mismatch'
    }
    const snap = plan.snapshot
    const runConfig = adoptDisplay(JSON.parse(JSON.stringify(snap.config)) as ScenarioConfig)
    await launch(runConfig, { name: runConfig.name, seed: snap.seed, startDateTime: runConfig.startDateTime }, (c) => c.restore({ ...snap, config: runConfig }), { autoplay: false })
    savesInfo('saves.loadedSnapshot', { name: file.name })
    return 'loaded'
  }

  async function guarded<T>(action: () => Promise<T>): Promise<T | null> {
    savesMessage.value = null
    try {
      return await action()
    } catch (err) {
      savesError(err)
      return null
    }
  }

  async function loadSaved(id: string): Promise<'loaded' | 'version-mismatch' | null> {
    return guarded(async () => {
      const file = await (await openStore())?.get(id)
      if (!file) throw new Error('Save not found')
      return applySave(file)
    })
  }

  /** Load a save from the text of a file the user picked (or the dev API passes). */
  async function importSaveText(text: string): Promise<'loaded' | 'version-mismatch' | null> {
    return guarded(() => applySave(parseSaveFile(text)))
  }

  /** After a version-mismatch warning: start the snapshot's embedded config from t = 0 instead. */
  async function restartFromEmbeddedConfig(): Promise<void> {
    const p = versionPrompt.value
    if (!p) return
    versionPrompt.value = null
    await guarded(async () => {
      await startFromConfig(p.config, p.seed)
      savesInfo('saves.restarted', { name: p.name })
    })
  }

  function dismissVersionPrompt(): void {
    versionPrompt.value = null
  }

  /** Jump back to a rewind point (paused there); running on reproduces the original run. */
  async function rewindTo(index: number): Promise<boolean> {
    const point = rewindPoints.value[index]
    const c = controller
    if (!point || !c) return false
    const matched = await run(() => c.rewind(point))
    recentEvents.value = markRaw([])
    cues.reset()
    banner.value = null
    resetKpis()
    rewindEvents = -1
    inspectedEvent.value = null
    void refreshKpis()
    void refreshRewind()
    void refreshEntity()
    return matched
  }

  /** Rewind interval in sim-minutes (applies from the next load, reset or rewind). */
  async function setRewindInterval(minutes: number): Promise<void> {
    if (!(minutes > 0)) return
    rewindIntervalMin.value = minutes
    await controller?.setCheckpointInterval(minutes * 60)
  }

  /** Change locale and/or units: applies live, is remembered, and is stored with the scenario config. */
  function setDisplay(next: Partial<DisplaySettings>): void {
    display.value = { ...display.value, ...next }
    saveDisplaySettings(browserStorage(), display.value)
    if (config.value) config.value = markRaw({ ...config.value, display: { ...display.value } })
  }

  /** Speed step by index into SPEEDS (keyboard 1–9); out of range is ignored. */
  function setSpeedStep(index: number): void {
    const s = SPEEDS[index]
    if (s !== undefined) setSpeed(s)
  }

  function pause(): void {
    ctl().pause()
    sync()
  }

  /** Single-step to the next engine event (pauses). */
  async function step() {
    if (runEnded.value) return null
    const ev = await run(() => ctl().step())
    void refreshKpis()
    if (ev) void inspectEvent(ev.id)
    return ev
  }

  function showToast(key: MessageKey, params?: MessageParams): void {
    const id = (toast.value?.id ?? 0) + 1
    toast.value = { id, text: t(key, params) }
    if (toastTimer) clearTimeout(toastTimer)
    if (bannerTimer) clearTimeout(bannerTimer)
    banner.value = null
    toastTimer = setTimeout(() => {
      if (toast.value?.id === id) toast.value = null
    }, TOAST_MS)
  }

  function toggleFollow(): void {
    followNextPending.value = false
    if (following.value) {
      following.value = false
      showToast('twin.toast.followOff')
    } else if (selectedId.value) {
      following.value = true
      showToast('twin.toast.followOn', { id: selectedId.value })
    } else {
      showToast('twin.toast.followNothing')
    }
  }

  /** Select and follow the truck at `followNextFrom` or later, if the engine already knows one. */
  function resolveFollowNext(): string | null {
    const next = controller?.model?.nextTruckArrival(followNextFrom)
    if (!next) return null
    select(next.id) // clears the pending flag
    following.value = true
    view?.cameraTo('gate') // the follow camera takes over once the truck is at the gate
    showToast('twin.toast.followNext', { id: next.id })
    return next.id
  }

  /**
   * "Follow next truck" (button, N, dev API): select the next truck to arrive at or after the display time and follow it
   * through the gate, its stall and out. Returns its id, or null when none is known yet (the request stays pending and
   * resolves as the engine runs on) or the terminal has no landside.
   */
  function followNextTruck(): string | null {
    const c = controller
    if (!c?.model) return null
    if (!c.model.landside) {
      showToast('followNext.unavailable')
      return null
    }
    followNextFrom = c.displayTime
    followNextPending.value = true
    const id = resolveFollowNext()
    if (!id) showToast('followNext.waiting')
    return id
  }

  function toggleOverlays(): void {
    overlaysVisible.value = !overlaysVisible.value
    showToast(overlaysVisible.value ? 'twin.toast.overlaysOn' : 'twin.toast.overlaysOff')
  }

  function toggleDashboard(): void {
    dashboardOpen.value = !dashboardOpen.value
    if (dashboardOpen.value) void refreshDashboard()
  }

  function setHelpOpen(open: boolean): void {
    helpOpen.value = open
  }

  /** Frame a view preset (shortcut, button, dev API). Stops following, since the preset sets the camera itself. */
  function setViewPreset(preset: ViewPresetName): boolean {
    if (!view) return false
    const ok = view.viewPreset(preset)
    if (!ok) {
      showToast('view.unavailable')
      return false
    }
    following.value = false
    followNextPending.value = false
    return true
  }

  function attachView(v: TwinView | null): void {
    view = v ? markRaw(v) : null
  }

  function dispose(): void {
    if (kpiTimer) clearInterval(kpiTimer)
    kpiTimer = null
    resetKpis()
    controller?.dispose()
    controller = null
    if (toastTimer) clearTimeout(toastTimer)
    toast.value = null
    config.value = null
    savesOpen.value = false
    breakpoints.value = []
    breakHit.value = null
    inspectedEvent.value = null
    entityView.value = null
    hasScenario.value = false
    phase.value = 'setup'
    info.value = null
  }

  return {
    phase,
    choice,
    hasScenario,
    hasShcs,
    loading,
    displayTime,
    speed,
    paused,
    busy,
    info,
    error,
    selectedId,
    recentEvents,
    breakpoints,
    breakHit,
    feedOpen,
    inspectorOpen,
    feedFilter,
    inspectedEvent,
    entityView,
    refreshEntity,
    inspectEvent,
    addBreakpoint,
    removeBreakpoint,
    clearBreakpoints,
    resume,
    toggleFeed,
    toggleInspector,
    overlays,
    setOverlays,
    display,
    fmt,
    config,
    following,
    followNextPending,
    followNextTruck,
    overlaysVisible,
    dashboardOpen,
    dashboardTab,
    dashboardData,
    dashboardGroup,
    dashboardBucketing,
    dashboardRendered,
    setDashboardTab,
    refreshDashboard,
    helpOpen,
    soundOn,
    sounds,
    toggleSound,
    lockDaylight,
    toggleLockDaylight,
    banner,
    toast,
    kpi,
    finalReport,
    reportOpen,
    runEnded,
    refreshKpis,
    exportRun,
    downloadExport,
    controller: () => controller,
    view: () => view,
    sync,
    startScenario,
    reset,
    newScenario,
    cancelSetup,
    setSpeed,
    togglePause,
    runTo,
    runToNextDeparture,
    select,
    setDisplay,
    savesOpen,
    saves,
    storage,
    savesMessage,
    versionPrompt,
    rewindPoints,
    rewindIntervalMin,
    openSaves,
    closeSaves,
    refreshSaves,
    refreshRewind,
    buildSave,
    saveToBrowser,
    exportToFile,
    exportSaved,
    deleteSaved,
    loadSaved,
    importSaveText,
    restartFromEmbeddedConfig,
    dismissVersionPrompt,
    rewindTo,
    setRewindInterval,
    setSpeedStep,
    pause,
    step,
    toggleFollow,
    toggleOverlays,
    toggleDashboard,
    setHelpOpen,
    setViewPreset,
    attachView,
    dispose,
  }
})

/**
 * Terminal Twin Pinia store: the UI-facing facade over the run.
 *
 * Small UI state is reactive (phase, setup, clock, speed, engine info). The
 * TwinController, SceneModel, worker and Three.js view live outside
 * reactivity (closure variables / markRaw); large collections such as the
 * recent-event buffer use shallowRef + triggerRef (Box Empire pattern).
 */
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, triggerRef } from 'vue'
import { fixtures } from '../scenario/fixtures'
import { applyOverrides, type ScenarioOverrides } from '../scenario/overrides'
import { presets } from '../scenario/presets'
import { withShcFleet, withYard, type YardSetup } from '../scenario/builder'
import type { DisplaySettings, EndConditions, ScenarioConfig, ShcKinematics } from '../scenario/types'
import { EXPORT_FILES, type ExportKind, type HeadlineKpis, type Highlight, type KpiReport, type KpiSeriesReport } from '../engine'
import type { Delta, EngineInfo, EventSummary } from '../worker/protocol'
import { SPEEDS, TwinController } from '../modules/twinController'
import { loadDisplaySettings, runConfigFor, saveDisplaySettings } from '../i18n/display'
import { createFormatter } from '../i18n/format'
import { t, type MessageKey, type MessageParams } from '../i18n/messages'
import { defaultStartDate } from '../modules/time'
import type { OverlayState, RenderedLivery, SceneStats } from '../modules/sceneRenderer'

export type TwinPhase = 'setup' | 'running'

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
  /** Rendered entity counts plus frames rendered so far; null without a 3D view. */
  stats(): (SceneStats & { frames: number }) | null
  /** Livery index, size and LOD drawn per container; null without a 3D view. */
  liveries(): Record<string, RenderedLivery> | null
}

const RECENT_EVENTS_CAP = 500
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
  const overlays = ref<OverlayState>({ laneGraph: false, reservations: false })
  /** Locale + units: browser defaults on first open, then the remembered choice. Display only. */
  const display = ref<DisplaySettings>(loadDisplaySettings(browserStorage(), browserLanguages()))
  /** Formatter for the current display settings (Intl objects; rebuilt when they change). */
  const fmt = computed(() => markRaw(createFormatter(display.value)))
  /** The SI config of the loaded scenario, with the current display settings (what a save stores). */
  const config = shallowRef<ScenarioConfig | null>(null)
  /** Keyboard-driven view state (TT-16 dashboard and TT-18 overlays/follow camera build on these). */
  const following = ref(false)
  const overlaysVisible = ref(true)
  const dashboardOpen = ref(false)
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

  let controller: TwinController | null = null
  let view: TwinView | null = null
  let kpiTimer: ReturnType<typeof setInterval> | null = null
  let kpiEvents = -1
  let kpiBusy = false

  function onDelta(delta: Delta): void {
    if (delta.events.length === 0) return
    const list = recentEvents.value
    list.push(...delta.events)
    if (list.length > RECENT_EVENTS_CAP) list.splice(0, list.length - RECENT_EVENTS_CAP)
    triggerRef(recentEvents)
  }

  function ctl(): TwinController {
    controller ??= markRaw(new TwinController(onDelta))
    return controller
  }

  /** Copy the controller's playback state into reactive refs (once per frame and after actions). */
  function sync(): void {
    if (!controller) return
    displayTime.value = controller.displayTime
    speed.value = controller.speed
    paused.value = controller.paused
    busy.value = controller.busy
    if (info.value !== controller.info) info.value = controller.info
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
        finalReport.value = markRaw({ ...kpi.value, kpis, series, eventLogHash: c.info.eventLogHash })
      }
    } catch {
      // the scenario was replaced meanwhile: the next poll catches up
    } finally {
      kpiBusy = false
      sync()
    }
  }

  function startKpiPolling(): void {
    if (kpiTimer) return
    kpiTimer = setInterval(() => {
      const c = controller
      if (!c || c.busy || !c.info || c.info.eventsTotal === kpiEvents) return
      void refreshKpis()
    }, KPI_POLL_MS)
  }

  function resetKpis(): void {
    kpi.value = null
    finalReport.value = null
    reportOpen.value = true
    kpiEvents = -1
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
    const base = applyOverrides(resolveScenario(next.name), next.overrides ?? {})
    let runConfig = runConfigFor(base, next.startDateTime, display.value)
    if (next.shc && (base.shcs?.length ?? 0) > 0) runConfig = withShcFleet(runConfig, next.shc.count, next.shc.kinematics)
    if (next.yard && (base.yard?.blocks.length ?? 0) > 0) runConfig = withYard(runConfig, next.yard)
    if (next.endConditions) runConfig = { ...runConfig, endConditions: { ...next.endConditions } }
    choice.value = { ...next }
    loading.value = true
    try {
      await run(() => ctl().load(runConfig, next.seed))
      config.value = markRaw(runConfig)
      recentEvents.value = markRaw([])
      resetKpis()
      selectedId.value = null
      following.value = false
      hasScenario.value = true
      hasShcs.value = (runConfig.shcs?.length ?? 0) > 0
      phase.value = 'running'
      if (options.autoplay ?? true) ctl().play()
      startKpiPolling()
      void refreshKpis()
    } finally {
      loading.value = false
      sync()
    }
  }

  async function reset(): Promise<void> {
    await run(() => ctl().reset())
    recentEvents.value = markRaw([])
    resetKpis()
    void refreshKpis()
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

  function setOverlays(next: Partial<OverlayState>): OverlayState {
    overlays.value = { ...overlays.value, ...next }
    return { ...overlays.value }
  }

  function select(id: string | null): void {
    selectedId.value = id
    if (!id) following.value = false
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
  function step() {
    if (runEnded.value) return Promise.resolve(null)
    return run(() => ctl().step().then((r) => (void refreshKpis(), r)))
  }

  function showToast(key: MessageKey, params?: MessageParams): void {
    const id = (toast.value?.id ?? 0) + 1
    toast.value = { id, text: t(key, params) }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (toast.value?.id === id) toast.value = null
    }, TOAST_MS)
  }

  function toggleFollow(): void {
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

  function toggleOverlays(): void {
    overlaysVisible.value = !overlaysVisible.value
    showToast(overlaysVisible.value ? 'twin.toast.overlaysOn' : 'twin.toast.overlaysOff')
  }

  function toggleDashboard(): void {
    dashboardOpen.value = !dashboardOpen.value
  }

  function setHelpOpen(open: boolean): void {
    helpOpen.value = open
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
    overlays,
    setOverlays,
    display,
    fmt,
    config,
    following,
    overlaysVisible,
    dashboardOpen,
    helpOpen,
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
    select,
    setDisplay,
    setSpeedStep,
    pause,
    step,
    toggleFollow,
    toggleOverlays,
    toggleDashboard,
    setHelpOpen,
    attachView,
    dispose,
  }
})

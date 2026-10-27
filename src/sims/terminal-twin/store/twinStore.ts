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
import { presets } from '../scenario/presets'
import type { DisplaySettings, ScenarioConfig } from '../scenario/types'
import type { Delta, EngineInfo, EventSummary } from '../worker/protocol'
import { SPEEDS, TwinController } from '../modules/twinController'
import { loadDisplaySettings, runConfigFor, saveDisplaySettings } from '../i18n/display'
import { createFormatter } from '../i18n/format'
import { t, type MessageKey, type MessageParams } from '../i18n/messages'
import { defaultStartDate } from '../modules/time'
import type { RenderedLivery, SceneStats } from '../modules/sceneRenderer'

export type TwinPhase = 'setup' | 'running'

export interface ScenarioChoice {
  /** Fixture or preset name. */
  name: string
  seed: number
  /** ISO date-time of sim t = 0. */
  startDateTime: string
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
  const loading = ref(false)
  const displayTime = ref(0)
  const speed = ref(10)
  const paused = ref(true)
  const busy = ref(false)
  const info = shallowRef<EngineInfo | null>(null)
  const error = ref<string | null>(null)
  const selectedId = ref<string | null>(null)
  const recentEvents = shallowRef<EventSummary[]>(markRaw([]))
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

  let controller: TwinController | null = null
  let view: TwinView | null = null

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
    const runConfig = runConfigFor(resolveScenario(next.name), next.startDateTime, display.value)
    choice.value = { ...next }
    loading.value = true
    try {
      await run(() => ctl().load(runConfig, next.seed))
      config.value = markRaw(runConfig)
      recentEvents.value = markRaw([])
      selectedId.value = null
      following.value = false
      hasScenario.value = true
      phase.value = 'running'
      if (options.autoplay ?? true) ctl().play()
    } finally {
      loading.value = false
      sync()
    }
  }

  async function reset(): Promise<void> {
    await run(() => ctl().reset())
    recentEvents.value = markRaw([])
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
    ctl().setSpeed(s)
    sync()
  }

  function togglePause(): void {
    const c = ctl()
    if (c.paused) c.play()
    else c.pause()
    sync()
  }

  function runTo(time: number) {
    return run(() => ctl().runTo(time))
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
    return run(() => ctl().step())
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
    loading,
    displayTime,
    speed,
    paused,
    busy,
    info,
    error,
    selectedId,
    recentEvents,
    display,
    fmt,
    config,
    following,
    overlaysVisible,
    dashboardOpen,
    helpOpen,
    toast,
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

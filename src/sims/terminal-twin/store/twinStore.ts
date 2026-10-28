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
import { withShcFleet } from '../scenario/builder'
import type { DisplaySettings, ScenarioConfig, ShcKinematics } from '../scenario/types'
import type { EngineEvent } from '../engine'
import type { BreakpointHit, Delta, EngineInfo, EventSummary } from '../worker/protocol'
import { parseBreakpointInput, type Breakpoint, type BreakpointKind } from '../modules/breakpoints'
import { describeEntity, entityKind, entityQueryKind, type EntityView } from '../modules/entityInspector'
import { describeEvent, type EventDescription } from '../modules/eventInspector'
import { FEED_BUFFER_CAP } from '../modules/eventFeed'
import { SPEEDS, TwinController } from '../modules/twinController'
import { loadDisplaySettings, runConfigFor, saveDisplaySettings } from '../i18n/display'
import { createFormatter } from '../i18n/format'
import { t, type MessageKey, type MessageParams } from '../i18n/messages'
import { defaultStartDate } from '../modules/time'
import { NO_OVERLAYS, type OverlayState } from '../modules/overlays'
import type { RenderedLivery, SceneStats } from '../modules/sceneRenderer'

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
}

/** What the 3D view registers so the dev API can reach it. */
export interface TwinView {
  /** Aim at an entity, keeping the view direction (and, if given, at `distanceM`). */
  cameraTo(entityId: string, distanceM?: number): boolean
  /** The entity under a viewport point (client coordinates) at the displayed time, or null. */
  pickAt(clientX: number, clientY: number): string | null
  /** Viewport (client) coordinates of an entity's centre; null when it is not drawn or off screen. */
  screenPoint(entityId: string): { x: number; y: number } | null
  /** Where the orbit camera currently looks. */
  cameraTarget(): { x: number; y: number; z: number } | null
  /** Rendered entity counts plus frames rendered so far; null without a 3D view. */
  stats(): (SceneStats & { frames: number }) | null
  /** Livery index, size and LOD drawn per container; null without a 3D view. */
  liveries(): Record<string, RenderedLivery> | null
}

const RECENT_EVENTS_CAP = FEED_BUFFER_CAP
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
  const overlaysVisible = ref(true)
  const dashboardOpen = ref(false)
  const helpOpen = ref(false)
  const toast = ref<{ id: number; text: string } | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  /** Debugger (TT-18): breakpoints, the one that paused playback, panels, inspected event and selection. */
  const breakpoints = ref<Breakpoint[]>([])
  const breakHit = shallowRef<BreakpointHit | null>(null)
  const feedOpen = ref(false)
  const inspectorOpen = ref(false)
  const feedFilter = ref('')
  const inspectedEvent = shallowRef<InspectedEvent | null>(null)
  const entityView = shallowRef<EntityView | null>(null)
  let nextBreakpointId = 1

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
    if (breakHit.value !== controller.breakHit) {
      breakHit.value = controller.breakHit
      if (controller.breakHit) {
        inspectorOpen.value = true
        void inspectEvent(controller.breakHit.event.id)
      }
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
    choice.value = { ...next }
    loading.value = true
    try {
      await run(() => ctl().load(runConfig, next.seed))
      config.value = markRaw(runConfig)
      recentEvents.value = markRaw([])
      selectedId.value = null
      entityView.value = null
      inspectedEvent.value = null
      following.value = false
      hasScenario.value = true
      hasShcs.value = (runConfig.shcs?.length ?? 0) > 0
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

  function setOverlays(next: Partial<OverlayState>): OverlayState {
    overlays.value = { ...overlays.value, ...next }
    return { ...overlays.value }
  }

  function select(id: string | null): void {
    selectedId.value = id
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
      let job
      if (kind === 'shc') job = (await c.query<{ id: string }[]>('shcJobs')).find((j) => j.id === (state as { jobId: string | null }).jobId)
      if (selectedId.value === id) entityView.value = markRaw(describeEntity(kind, state, { job: job as never }))
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
    const ev = await run(() => ctl().step())
    if (ev) void inspectEvent(ev.id)
    return ev
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

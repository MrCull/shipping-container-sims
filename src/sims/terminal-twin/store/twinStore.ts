/**
 * Terminal Twin Pinia store: the UI-facing facade over the run.
 *
 * Small UI state is reactive (phase, setup, clock, speed, engine info). The
 * TwinController, SceneModel, worker and Three.js view live outside
 * reactivity (closure variables / markRaw); large collections such as the
 * recent-event buffer use shallowRef + triggerRef (Box Empire pattern).
 */
import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef, triggerRef } from 'vue'
import { fixtures } from '../scenario/fixtures'
import { presets } from '../scenario/presets'
import { withShcFleet } from '../scenario/builder'
import type { ScenarioConfig, ShcKinematics } from '../scenario/types'
import type { Delta, EngineInfo, EventSummary } from '../worker/protocol'
import { TwinController } from '../modules/twinController'
import { defaultStartDate } from '../modules/time'
import type { OverlayState, SceneStats } from '../modules/sceneRenderer'

export type TwinPhase = 'setup' | 'running'

export interface ScenarioChoice {
  /** Fixture or preset name. */
  name: string
  seed: number
  /** ISO date-time of sim t = 0. */
  startDateTime: string
  /** SHC fleet overrides from the setup dialog (scenarios with SHCs only). */
  shc?: { count: number; kinematics: ShcKinematics }
}

/** What the 3D view registers so the dev API can reach it. */
export interface TwinView {
  cameraTo(entityId: string): boolean
  /** Rendered entity counts plus frames rendered so far; null without a 3D view. */
  stats(): (SceneStats & { frames: number }) | null
}

const RECENT_EVENTS_CAP = 500

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
    const base = resolveScenario(next.name)
    let config: ScenarioConfig = JSON.parse(JSON.stringify({ ...base, startDateTime: next.startDateTime }))
    if (next.shc && (base.shcs?.length ?? 0) > 0) config = withShcFleet(config, next.shc.count, next.shc.kinematics)
    choice.value = { ...next }
    loading.value = true
    try {
      await run(() => ctl().load(config, next.seed))
      recentEvents.value = markRaw([])
      selectedId.value = null
      hasScenario.value = true
      hasShcs.value = (config.shcs?.length ?? 0) > 0
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

  function setOverlays(next: Partial<OverlayState>): OverlayState {
    overlays.value = { ...overlays.value, ...next }
    return { ...overlays.value }
  }

  function select(id: string | null): void {
    selectedId.value = id
  }

  function attachView(v: TwinView | null): void {
    view = v ? markRaw(v) : null
  }

  function dispose(): void {
    controller?.dispose()
    controller = null
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
    attachView,
    dispose,
  }
})

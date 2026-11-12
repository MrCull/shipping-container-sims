/**
 * Runner of the one-click benchmark (#254). Works in a production build: it uses the store, the perf store and the
 * 3D view's `TwinView` (never `window.__tt`). It loads the benchmark scenario, runs it flat out to a stocked yard, then
 * plays the stage plan (`planStages`) unattended: per stage it sets quality, speed and camera, lets the scene settle,
 * samples every animation frame and summarises. Frame times are gaps between this loop's own animation frames, which
 * is what the viewer's display refresh sees; draw calls, triangles, posing and hero counters come from the perf panel's
 * stats. At the end it downloads one JSON file and restores the quality setting, speed and pause state.
 */
import { ENGINE_VERSION } from '../engine'
import { resolveScenario, useTwinStore } from '../store/twinStore'
import { usePerfStore } from '../store/perfStore'
import { defaultStartDate } from '../modules/time'
import type { CameraPose } from '../modules/cameraKeys'
import {
  benchmarkFileName,
  BENCHMARK_FORMAT,
  BENCHMARK_VIEW_NOTES,
  BENCHMARK_VIEW_SPEED,
  FULL_BENCHMARK,
  planStages,
  QUICK_BENCHMARK,
  summariseStage,
  type BenchmarkMachine,
  type BenchmarkOptions,
  type BenchmarkReport,
  type BenchmarkStagePlan,
  type FrameSample,
  type StageResult,
} from '../modules/frameBenchmark'

/** The options a page URL asks for: `?benchmark=quick` is the shortened tour the smoke spec uses. */
export function benchmarkOptionsFromUrl(search: string): BenchmarkOptions {
  return new URLSearchParams(search).get('benchmark') === 'quick' ? QUICK_BENCHMARK : FULL_BENCHMARK
}

function gpuNames(): { gpu: string | null; vendor: string | null } {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (!gl || !info) return { gpu: null, vendor: null }
    return { gpu: String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)), vendor: String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) }
  } catch {
    return { gpu: null, vendor: null }
  }
}

function machine(viewport: string): BenchmarkMachine {
  const { gpu, vendor } = gpuNames()
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    viewport,
    gpu,
    gpuVendor: vendor,
  }
}

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve))

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function useFrameBenchmark() {
  const store = useTwinStore()
  const perf = usePerfStore()
  let cancelled = false

  /** Moves the camera for a stage and returns the per-frame mover for the fly-through (null for fixed views). */
  function aim(plan: BenchmarkStagePlan): ((t: number) => void) | null {
    const view = store.view()
    if (!view) return null
    const blockId = store.config?.yard?.blocks[0]?.id
    const stsId = store.controller()?.model?.stsIds[0]
    switch (plan.view) {
      case 'overview':
      case 'yard':
        view.viewPreset(plan.view)
        return null
      case 'crane':
        view.viewPreset('quay')
        if (stsId) view.cameraTo(stsId, 60)
        return null
      case 'closeup':
        view.viewPreset('yard')
        if (blockId) view.cameraTo(blockId, 10)
        return null
      case 'flythrough': {
        view.viewPreset('yard')
        const from = view.cameraPose()
        view.viewPreset('quay')
        const quay = view.cameraPose()
        if (stsId) view.cameraTo(stsId, 60)
        const to = view.cameraPose() ?? quay
        view.viewPreset('yard')
        if (!from || !to) return null
        const end: CameraPose = { ...to, distance: Math.min(to.distance, 60), polar: Math.min(to.polar, 1.1) }
        return (t) =>
          view.setCameraPose({
            target: { x: lerp(from.target.x, end.target.x, t), y: lerp(from.target.y, end.target.y, t), z: lerp(from.target.z, end.target.z, t) },
            distance: lerp(from.distance, end.distance, t),
            azimuth: lerp(from.azimuth, end.azimuth, t),
            polar: lerp(from.polar, end.polar, t),
          })
      }
    }
  }

  async function runStage(plan: BenchmarkStagePlan, o: BenchmarkOptions): Promise<StageResult> {
    const controller = store.controller()
    if (!controller) throw new Error('no scenario')
    perf.setSetting(plan.quality)
    store.setSpeed(plan.speed)
    if (controller.paused && !store.runEnded) controller.play()
    const move = aim(plan)
    const settleUntil = performance.now() + o.warmupMs
    while (performance.now() < settleUntil && !cancelled) await nextFrame()
    const samples: FrameSample[] = []
    const t0 = performance.now()
    for (;;) {
      const at = await nextFrame()
      if (cancelled) break
      const elapsed = performance.now() - t0
      move?.(Math.min(1, elapsed / o.stageMs))
      const s = perf.stats
      samples.push({ at, simTime: controller.displayTime, calls: s.calls, triangles: s.triangles, poseMs: s.poseMs, cpuMs: s.cpuMs, boxesPosed: s.boxesPosed, heroFaces: s.heroFaces })
      if ((elapsed >= o.stageMs && samples.length >= o.minFrames) || elapsed >= o.maxStageMs) break
    }
    return summariseStage(plan, samples, store.runEnded)
  }

  /** Runs the whole benchmark and downloads the report; resolves with it (null when cancelled). */
  async function start(options: BenchmarkOptions = benchmarkOptionsFromUrl(window.location.search)): Promise<BenchmarkReport | null> {
    if (perf.benchmark) return null
    cancelled = false
    const plan = planStages(options)
    const startedAt = new Date().toISOString()
    const wallStart = performance.now()
    const keep = { setting: perf.setting, speed: store.speed, paused: store.controller()?.paused ?? true }
    perf.benchmark = { stage: 0, total: plan.length, label: 'loading' }
    try {
      const preset = resolveScenario(options.scenario)
      await store.startScenario({ name: options.scenario, seed: preset.seed, startDateTime: defaultStartDate().toISOString() }, { autoplay: false })
      if (options.warmSimSeconds > 0) {
        perf.benchmark = { stage: 0, total: plan.length, label: 'warming up' }
        await store.runTo(options.warmSimSeconds)
      }
      const stages: StageResult[] = []
      for (const [i, stage] of plan.entries()) {
        if (cancelled) return null
        perf.benchmark = { stage: i + 1, total: plan.length, label: stage.name }
        stages.push(await runStage(stage, options))
      }
      if (cancelled) return null
      const canvas = document.querySelector('canvas.tt-canvas') as HTMLCanvasElement | null
      const report: BenchmarkReport = {
        format: BENCHMARK_FORMAT,
        startedAt,
        durationS: Math.round((performance.now() - wallStart) / 100) / 10,
        scenario: { name: options.scenario, seed: preset.seed, warmSimSeconds: options.warmSimSeconds },
        machine: machine(canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : 'none'),
        build: {
          engineVersion: ENGINE_VERSION,
          builtAt: typeof __BUILD_TIME__ === 'string' && !import.meta.env.DEV ? __BUILD_TIME__ : null,
          commit: typeof __BUILD_COMMIT__ === 'string' && __BUILD_COMMIT__ !== '' && !import.meta.env.DEV ? __BUILD_COMMIT__ : null,
          production: !import.meta.env.DEV,
        },
        settings: { stageMs: options.stageMs, warmupMs: options.warmupMs, minFrames: options.minFrames, viewSpeed: BENCHMARK_VIEW_SPEED, viewNotes: BENCHMARK_VIEW_NOTES },
        stages,
      }
      download(benchmarkFileName(startedAt, report.machine.gpu), JSON.stringify(report, null, 2))
      return report
    } finally {
      perf.setSetting(keep.setting)
      store.setSpeed(keep.speed)
      if (keep.paused) store.controller()?.pause()
      store.view()?.viewPreset('overview')
      perf.benchmark = null
    }
  }

  function cancel(): void {
    cancelled = true
  }

  return { start, cancel }
}

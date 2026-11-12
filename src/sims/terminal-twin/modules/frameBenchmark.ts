/**
 * One-click frame-rate benchmark (#254): the pure part. The plan (which stages, in which order), the per-stage
 * frame summary and the report the performance panel downloads as one JSON file. The runner that drives the camera,
 * the quality setting and the playback speed is `composables/useFrameBenchmark.ts`; it works in a production build,
 * where the dev API (`window.__tt`) does not exist. Nothing here touches the engine.
 */
import type { QualityLevel } from './quality'

/** Bump when a field changes meaning, so a recorded file says which layout it has. */
export const BENCHMARK_FORMAT = 1

export const BENCHMARK_VIEWS = ['overview', 'yard', 'crane', 'closeup', 'flythrough'] as const
export type BenchmarkView = (typeof BENCHMARK_VIEWS)[number]

/** What each view looks like, for the report reader. */
export const BENCHMARK_VIEW_NOTES: Record<BenchmarkView, string> = {
  overview: 'view preset Overview: the whole terminal in frame',
  yard: 'view preset Yard',
  crane: 'first STS crane from 60 m',
  closeup: 'first yard block from 10 m (hero containers)',
  flythrough: 'camera glides from the Yard preset to 60 m above the quay over the stage',
}

export const BENCHMARK_QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high']
/** The speed steps of the speed stages (sim seconds per wall second), played at Overview on High. */
export const BENCHMARK_SPEEDS: readonly number[] = [60, 300, 600, 1200, 3600]
/** The speed every view stage plays at. */
export const BENCHMARK_VIEW_SPEED = 60

export interface BenchmarkOptions {
  /** Scenario name; the full-scale TTI baseline preset by default. */
  scenario: string
  /** Sim seconds to run flat out before the tour, so the yard is stocked and the quay busy. */
  warmSimSeconds: number
  /** Measured wall time per stage, ms. */
  stageMs: number
  /** Settling time per stage before measuring, ms (hero detail and LODs arrive during it). */
  warmupMs: number
  /** A stage ends once it holds at least this many frames, even past `stageMs` (software GL is slow). */
  minFrames: number
  /** Hard cap on one stage, ms. */
  maxStageMs: number
  qualities: readonly QualityLevel[]
  views: readonly BenchmarkView[]
  speeds: readonly number[]
}

export const FULL_BENCHMARK: BenchmarkOptions = {
  scenario: 'TTI Algeciras baseline',
  warmSimSeconds: 7200,
  stageMs: 8000,
  warmupMs: 3000,
  minFrames: 30,
  maxStageMs: 30000,
  qualities: BENCHMARK_QUALITIES,
  views: BENCHMARK_VIEWS,
  speeds: BENCHMARK_SPEEDS,
}

/** A shortened tour for tests (`?benchmark=quick`): the small tracer fixture, Low only, two speeds, under a second per stage. */
export const QUICK_BENCHMARK: BenchmarkOptions = {
  scenario: 'tracer-1sts-10-boxes',
  warmSimSeconds: 0,
  stageMs: 400,
  warmupMs: 200,
  minFrames: 2,
  maxStageMs: 15000,
  qualities: ['low'],
  views: BENCHMARK_VIEWS,
  speeds: [60, 600],
}

export interface BenchmarkStagePlan {
  name: string
  view: BenchmarkView
  quality: QualityLevel
  speed: number
}

/** Stage order: every view at every quality (at the view speed), then the speed steps (Overview, on High or the highest chosen quality). */
export function planStages(options: BenchmarkOptions): BenchmarkStagePlan[] {
  const stages: BenchmarkStagePlan[] = []
  for (const quality of options.qualities) {
    for (const view of options.views) stages.push({ name: `${view}-${quality}`, view, quality, speed: BENCHMARK_VIEW_SPEED })
  }
  const speedQuality = options.qualities.includes('high') ? 'high' : options.qualities[options.qualities.length - 1]
  for (const speed of options.speeds) stages.push({ name: `speed-x${speed}`, view: 'overview', quality: speedQuality, speed })
  return stages
}

/** One sample per animation frame while a stage is measured. */
export interface FrameSample {
  /** Animation-frame timestamp, ms. */
  at: number
  /** Displayed sim time, s. */
  simTime: number
  calls: number
  triangles: number
  poseMs: number
  cpuMs: number
  boxesPosed: number
  heroFaces: number
}

export interface StageResult {
  name: string
  view: BenchmarkView
  quality: QualityLevel
  /** The playback speed chosen for the stage. */
  speed: number
  frames: number
  wallMs: number
  fps: number
  /** Frame-to-frame time, ms. */
  frameMs: { p50: number; p95: number; p99: number; longest: number }
  /** Main-thread ms per frame spent posing (mean of the panel's moving average), and posing plus render submit. */
  poseMs: number
  cpuMs: number
  drawCalls: { mean: number; max: number }
  triangles: { mean: number; max: number }
  boxesPosed: { mean: number; max: number }
  heroFaces: number
  /** Sim seconds the displayed clock advanced per wall second over the stage (what `x` shows when the engine keeps up). */
  achievedSpeed: number
  simStartS: number
  simEndS: number
  /** True when the sim had ended by the stage (the clock stood still). */
  simEnded: boolean
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
const max = (xs: number[]): number => xs.reduce((a, b) => Math.max(a, b), 0)

/** Nearest-rank percentile of an ascending list (q in 0..100). */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((q / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

const round = (x: number, digits = 2): number => {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

/** Turns one stage's samples into its result. Frame time is the gap between consecutive samples. */
export function summariseStage(plan: BenchmarkStagePlan, samples: FrameSample[], simEnded = false): StageResult {
  const gaps: number[] = []
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].at - samples[i - 1].at)
  const sorted = [...gaps].sort((a, b) => a - b)
  const wallMs = samples.length > 1 ? samples[samples.length - 1].at - samples[0].at : 0
  const simStart = samples[0]?.simTime ?? 0
  const simEnd = samples[samples.length - 1]?.simTime ?? 0
  const col = (pick: (s: FrameSample) => number): number[] => samples.map(pick)
  const stat = (xs: number[]): { mean: number; max: number } => ({ mean: round(mean(xs), 1), max: round(max(xs), 1) })
  return {
    name: plan.name,
    view: plan.view,
    quality: plan.quality,
    speed: plan.speed,
    frames: samples.length,
    wallMs: round(wallMs, 1),
    fps: wallMs > 0 ? round(gaps.length / (wallMs / 1000), 2) : 0,
    frameMs: { p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), longest: round(max(gaps)) },
    poseMs: round(mean(col((s) => s.poseMs))),
    cpuMs: round(mean(col((s) => s.cpuMs))),
    drawCalls: stat(col((s) => s.calls)),
    triangles: stat(col((s) => s.triangles)),
    boxesPosed: stat(col((s) => s.boxesPosed)),
    heroFaces: round(mean(col((s) => s.heroFaces)), 1),
    achievedSpeed: wallMs > 0 ? round((simEnd - simStart) / (wallMs / 1000), 1) : 0,
    simStartS: round(simStart, 1),
    simEndS: round(simEnd, 1),
    simEnded,
  }
}

export interface BenchmarkMachine {
  userAgent: string
  platform: string
  hardwareConcurrency: number | null
  deviceMemoryGb: number | null
  devicePixelRatio: number
  screen: string
  /** Canvas size in CSS pixels. */
  viewport: string
  /** The GPU as the browser names it (unmasked renderer), or null when hidden. */
  gpu: string | null
  gpuVendor: string | null
}

export interface BenchmarkBuild {
  engineVersion: string
  /** Vite build time (ISO) and short commit; null in a dev build or without git. */
  builtAt: string | null
  commit: string | null
  production: boolean
}

export interface BenchmarkReport {
  format: typeof BENCHMARK_FORMAT
  startedAt: string
  durationS: number
  scenario: { name: string; seed: number; warmSimSeconds: number }
  machine: BenchmarkMachine
  build: BenchmarkBuild
  /** What the benchmark ran with (stage time, warm-up) and what each view means. */
  settings: { stageMs: number; warmupMs: number; minFrames: number; viewSpeed: number; viewNotes: Record<BenchmarkView, string> }
  stages: StageResult[]
}

/** File name of the download: sortable, no characters a file system dislikes. */
export function benchmarkFileName(startedAt: string, gpu: string | null): string {
  const stamp = startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const slug = (gpu ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  return `terminal-twin-benchmark-${stamp}${slug ? `-${slug}` : ''}.json`
}

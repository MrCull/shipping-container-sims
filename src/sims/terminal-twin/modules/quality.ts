/**
 * Graphics quality (TT-19): Low / Medium / High / Auto. Pure TypeScript (no Three.js), so the
 * profiles and the Auto controller are unit-tested; `SceneRenderer.setQuality` and `useTwinScene`
 * apply a profile.
 *
 * Auto (#261) judges frame time over one-second windows (the median and the share of slow frames,
 * so stutter counts even when the average is fine) and walks a fixed shedding ladder: hero cap,
 * hero marking resolution, hero off, shadows and render resolution, then the Medium and Low
 * profiles. It climbs back in the reverse order, with a back-off so a rung that does not hold is
 * not retried every few seconds. The ladder is a pure function of the rung (`profileForRung`,
 * `markStepForRung`); the manual levels fix it at their rung.
 */

import type { HeroMarkStep } from './markStep'

export type QualityLevel = 'low' | 'medium' | 'high'
export type QualitySetting = QualityLevel | 'auto'

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high']
export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high']
export const DEFAULT_QUALITY_SETTING: QualitySetting = 'auto'

export interface QualityProfile {
  /** Sun shadow map on/off. */
  shadows: boolean
  /** Shadow map edge in texels. */
  shadowMapSize: number
  /** Container LOD0 distance (m) and cap on boxes drawn at LOD0. */
  lod0DistanceM: number
  lod0Cap: number
  /**
   * Container close-up markings (#119, #143): faces within this camera distance (m) get markings. On on every level
   * (#158): Auto settles on Low on a typical laptop, and with Low off nobody ever saw a marking. Low has the shortest
   * reach (the orbit camera stops 8 m from its target) and the smallest budget.
   */
  closeupDistanceM: number
  /** Close-up marking faces drawn at most (#143; 0 = off, which no level uses). */
  closeupFaceBudget: number
  /** Hero level (#258): boxes' worth of hero faces drawn at most (3 faces each; `heroCaps` in budgets.json), 0 on Low. */
  heroBoxes: number
  /** Multiplier on the LOD switch distances of the cranes and carriers (STS, SHC, ASC): below 1 they drop to cheaper LODs sooner. */
  lodScale: number
  /** Multiplier on the device pixel ratio (render resolution), before the cap of 2. */
  resolutionScale: number
  /** Water plane subdivisions per side (1 = a flat quad); also picks the water material. */
  oceanSegments: number
  /** Most high-mast glow points night mode draws (the atmosphere adds no real lights; 400 = every mast). */
  nightLights: number
  /** Sky reflections on the standard materials (#248): a procedural environment per lighting mode. */
  environmentReflections: boolean
  /** Soft darkening where boxes meet each other and the ground (#248), in the container shader. */
  contactShadows: boolean
  /** Antialiasing is chosen at renderer creation, so it is not part of a live profile. */
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: { shadows: false, shadowMapSize: 512, lod0DistanceM: 40, lod0Cap: 60, closeupDistanceM: 18, closeupFaceBudget: 48, heroBoxes: 0, lodScale: 0.4, resolutionScale: 0.65, oceanSegments: 1, nightLights: 24, environmentReflections: false, contactShadows: false },
  medium: { shadows: true, shadowMapSize: 1024, lod0DistanceM: 90, lod0Cap: 180, closeupDistanceM: 25, closeupFaceBudget: 120, heroBoxes: 12, lodScale: 0.7, resolutionScale: 0.85, oceanSegments: 24, nightLights: 120, environmentReflections: true, contactShadows: true },
  high: { shadows: true, shadowMapSize: 2048, lod0DistanceM: 140, lod0Cap: 300, closeupDistanceM: 35, closeupFaceBudget: 400, heroBoxes: 32, lodScale: 1, resolutionScale: 1, oceanSegments: 96, nightLights: 400, environmentReflections: true, contactShadows: true },
}

export const profileFor = (level: QualityLevel): QualityProfile => QUALITY_PROFILES[level]

/** Frames per second over the last second of frames. */
export class FpsMeter {
  private times: number[] = []
  fps = 0

  frame(nowMs: number): void {
    this.times.push(nowMs)
    while (this.times.length > 2 && nowMs - this.times[0] > 1000) this.times.shift()
    const n = this.times.length
    const span = this.times[n - 1] - this.times[0]
    this.fps = n > 1 && span > 0 ? ((n - 1) * 1000) / span : 0
  }

  reset(): void {
    this.times = []
    this.fps = 0
  }
}

/**
 * The shedding ladder, best look first. A rung is all there is to Auto's state: `profileForRung` and
 * `markStepForRung` are pure functions of it.
 *
 * The ticket lists hero cap (full, half, quarter, none), then hero marking resolution. Marking
 * resolution only costs anything while hero faces are drawn, so the marking step sits between
 * quarter and none: after none it would shed nothing.
 */
export const AUTO_RUNGS = [
  { name: 'hero-full', level: 'high', heroShare: 1, marks: 'sharp' },
  { name: 'hero-half', level: 'high', heroShare: 0.5, marks: 'sharp' },
  { name: 'hero-quarter', level: 'high', heroShare: 0.25, marks: 'sharp' },
  { name: 'hero-marks-standard', level: 'high', heroShare: 0.25, marks: 'standard' },
  { name: 'hero-off', level: 'high', heroShare: 0, marks: 'standard' },
  { name: 'shadows-resolution', level: 'high', heroShare: 0, marks: 'standard' },
  { name: 'medium', level: 'medium', heroShare: 0, marks: 'standard' },
  { name: 'low', level: 'low', heroShare: 0, marks: 'standard' },
] as const

export type AutoRungName = (typeof AUTO_RUNGS)[number]['name']
export const TOP_RUNG = 0
export const BOTTOM_RUNG = AUTO_RUNGS.length - 1
/** The rungs the manual levels fix the ladder at: High is the top, Low the bottom, Medium the Medium profile as it is (with its own hero cap). */
export const MANUAL_RUNG: Readonly<Record<QualityLevel, number>> = {
  high: TOP_RUNG,
  medium: AUTO_RUNGS.findIndex((r) => r.name === 'medium'),
  low: BOTTOM_RUNG,
}

export const clampRung = (rung: number): number => Math.max(TOP_RUNG, Math.min(BOTTOM_RUNG, Math.round(rung)))

export function rungName(rung: number): AutoRungName {
  return AUTO_RUNGS[clampRung(rung)].name
}

/** The quality level a rung belongs to (the level shown in the picker and the dev API). */
export function levelOfRung(rung: number): QualityLevel {
  return AUTO_RUNGS[clampRung(rung)].level
}

/** The profile Auto puts in force at a rung. Hero caps are shares of High's; the shadows-resolution rung takes Medium's shadow map and render resolution. */
export function profileForRung(rung: number): QualityProfile {
  const r = AUTO_RUNGS[clampRung(rung)]
  const base = QUALITY_PROFILES[r.level]
  const heroBoxes = Math.floor(QUALITY_PROFILES.high.heroBoxes * r.heroShare)
  if (r.name === 'shadows-resolution') {
    const medium = QUALITY_PROFILES.medium
    return { ...base, heroBoxes, shadowMapSize: medium.shadowMapSize, resolutionScale: medium.resolutionScale }
  }
  return { ...base, heroBoxes }
}

export function markStepForRung(rung: number): HeroMarkStep {
  return AUTO_RUNGS[clampRung(rung)].marks
}

/*
 * PROVISIONAL (#261): every threshold below is a first guess, to be retuned on real hardware by the laptop benchmark ticket (#262).
 */
/** Step down when a window's median frame time is above this (ms, about 45 fps) ... */
export const AUTO_DOWN_MEDIAN_MS = 1000 / 45
/** ... or when more than this share of its frames are slow (a slow frame is over 1.5 times the down median, about 30 fps). */
export const AUTO_SLOW_SHARE_DOWN = 0.1
export const AUTO_SLOW_FRAME_FACTOR = 1.5
/** Step up when a window's median is at or under this (ms, about 57 fps) and at most this share of its frames are slow. */
export const AUTO_UP_MEDIAN_MS = 1000 / 57
export const AUTO_SLOW_SHARE_UP = 0.02
/** The fps the median thresholds correspond to (the dev API retunes them in fps). */
export const AUTO_DOWN_FPS = 45
export const AUTO_UP_FPS = 57
/** Windows (one second each) in a row that must be bad before a step down, and good before a step up (doubled after an undone step up, up to the max). */
export const AUTO_DOWN_WINDOWS = 4
export const AUTO_UP_WINDOWS = 8
export const AUTO_MAX_UP_WINDOWS = 240
const WINDOW_MS = 1000
/** A step up that is undone within this long counts as one that did not hold. */
const HOLD_MS = 30_000
/** A frame gap longer than this (tab in the background, a long pause) is not load; it is skipped. */
const HICCUP_MS = 1000

interface WindowVerdict {
  medianMs: number
  slowShare: number
}

export class AutoQuality {
  rung = TOP_RUNG
  /** Median frame time (ms) and slow-frame share of the last judged window. */
  lastWindow: WindowVerdict = { medianMs: 0, slowShare: 0 }
  /** Step down above this median or slow share; step up at or under the up median with at most the up share. Retunable by tests and the dev API. */
  downMedianMs = AUTO_DOWN_MEDIAN_MS
  upMedianMs = AUTO_UP_MEDIAN_MS
  slowShareDown = AUTO_SLOW_SHARE_DOWN
  slowShareUp = AUTO_SLOW_SHARE_UP
  private last: number | null = null
  private windowStart = 0
  private dts: number[] = []
  private recent: WindowVerdict[] = []
  private upWindows = AUTO_UP_WINDOWS
  private lastUpAt = -Infinity

  constructor(private readonly onChange?: (rung: number) => void) {}

  get level(): QualityLevel {
    return levelOfRung(this.rung)
  }

  /** Retune the median thresholds from fps (the slow-frame cut-off follows the down one); null restores the defaults. */
  setFpsThresholds(down: number | null, up: number | null): void {
    this.downMedianMs = down ? 1000 / down : AUTO_DOWN_MEDIAN_MS
    this.upMedianMs = up ? 1000 / up : AUTO_UP_MEDIAN_MS
  }

  /** Call once per rendered frame with a monotonic timestamp (ms). */
  frame(nowMs: number): void {
    if (this.last === null || nowMs - this.last > HICCUP_MS) {
      // first frame, or not load: start the window over
      this.windowStart = nowMs
      this.dts = []
      this.last = nowMs
      return
    }
    this.dts.push(nowMs - this.last)
    this.last = nowMs
    if (nowMs - this.windowStart < WINDOW_MS) return
    this.recent.push(this.judge())
    this.windowStart = nowMs
    this.dts = []
    if (this.recent.length > AUTO_MAX_UP_WINDOWS) this.recent.shift()
    this.evaluate(nowMs)
  }

  private judge(): WindowVerdict {
    const sorted = [...this.dts].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    const slowAbove = this.downMedianMs * AUTO_SLOW_FRAME_FACTOR
    const slowShare = sorted.filter((d) => d > slowAbove).length / sorted.length
    this.lastWindow = { medianMs, slowShare }
    return this.lastWindow
  }

  private evaluate(nowMs: number): void {
    const tail = (n: number) => (this.recent.length >= n ? this.recent.slice(-n) : null)
    const slow = tail(AUTO_DOWN_WINDOWS)
    if (slow && this.rung < BOTTOM_RUNG && slow.every((w) => w.medianMs > this.downMedianMs || w.slowShare > this.slowShareDown)) {
      if (nowMs - this.lastUpAt < HOLD_MS) this.upWindows = Math.min(AUTO_MAX_UP_WINDOWS, this.upWindows * 2)
      this.set(this.rung + 1)
      return
    }
    const fast = tail(this.upWindows)
    if (fast && this.rung > TOP_RUNG && fast.every((w) => w.medianMs <= this.upMedianMs && w.slowShare <= this.slowShareUp)) {
      this.lastUpAt = nowMs
      this.set(this.rung - 1)
    }
  }

  private set(rung: number): void {
    this.rung = rung
    this.recent = [] // judge the new rung on its own frames
    this.onChange?.(rung)
  }

  /** Forget the history (setting changed, scenario reloaded). */
  reset(rung: number = TOP_RUNG): void {
    this.rung = clampRung(rung)
    this.recent = []
    this.last = null
    this.dts = []
    this.upWindows = AUTO_UP_WINDOWS
    this.lastUpAt = -Infinity
  }
}

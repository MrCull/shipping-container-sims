/**
 * Graphics quality (TT-19): Low / Medium / High / Auto. Pure TypeScript (no Three.js), so the
 * profiles and the Auto controller are unit-tested; `SceneRenderer.setQuality` and `useTwinScene`
 * apply a profile.
 *
 * Auto steps down one level when the frame rate has stayed under 45 fps for several seconds and
 * steps back up when it has had headroom for longer, with a back-off so a level that does not
 * hold is not retried every few seconds.
 */

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
  /** Container close-up detail (#119): distance (m) and cap on boxes drawn with markings; 0 = off. */
  closeupDistanceM: number
  /** Close-up marking faces drawn at most (#143; 0 = off). */
  closeupFaceBudget: number
  /** Multiplier on the LOD switch distances of the cranes and carriers (STS, SHC, ASC): below 1 they drop to cheaper LODs sooner. */
  lodScale: number
  /** Multiplier on the device pixel ratio (render resolution), before the cap of 2. */
  resolutionScale: number
  /** Water plane subdivisions per side (1 = a flat quad); also picks the water material. */
  oceanSegments: number
  /** Most high-mast glow points night mode draws (the atmosphere adds no real lights; 400 = every mast). */
  nightLights: number
  /** Antialiasing is chosen at renderer creation, so it is not part of a live profile. */
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: { shadows: false, shadowMapSize: 512, lod0DistanceM: 40, lod0Cap: 60, closeupDistanceM: 0, closeupFaceBudget: 0, lodScale: 0.4, resolutionScale: 0.65, oceanSegments: 1, nightLights: 24 },
  medium: { shadows: true, shadowMapSize: 1024, lod0DistanceM: 90, lod0Cap: 180, closeupDistanceM: 25, closeupFaceBudget: 120, lodScale: 0.7, resolutionScale: 0.85, oceanSegments: 24, nightLights: 120 },
  high: { shadows: true, shadowMapSize: 2048, lod0DistanceM: 140, lod0Cap: 300, closeupDistanceM: 35, closeupFaceBudget: 400, lodScale: 1, resolutionScale: 1, oceanSegments: 96, nightLights: 400 },
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

export const AUTO_DOWN_FPS = 45
export const AUTO_UP_FPS = 57
const WINDOW_MS = 1000
const DOWN_WINDOWS = 4
const UP_WINDOWS = 8
const MAX_UP_WINDOWS = 240
/** A step up that is undone within this long counts as one that did not hold. */
const HOLD_MS = 30_000
/** A frame gap longer than this (tab in the background, a long pause) is not load; it is skipped. */
const HICCUP_MS = 1000

export class AutoQuality {
  level: QualityLevel = 'high'
  /** Step down below this and up at or above that (fps). Fixed in the app; tests and the dev API retune them to suit a slow renderer. */
  downFps = AUTO_DOWN_FPS
  upFps = AUTO_UP_FPS
  private last: number | null = null
  private windowStart = 0
  private frames = 0
  private recent: number[] = []
  private upWindows = UP_WINDOWS
  private lastUpAt = -Infinity

  constructor(private readonly onChange?: (level: QualityLevel) => void) {}

  /** Call once per rendered frame with a monotonic timestamp (ms). */
  frame(nowMs: number): void {
    if (this.last !== null && nowMs - this.last > HICCUP_MS) {
      // not load: start the window over
      this.windowStart = nowMs
      this.frames = 0
      this.last = nowMs
      return
    }
    if (this.last === null) this.windowStart = nowMs
    this.last = nowMs
    this.frames++
    if (nowMs - this.windowStart < WINDOW_MS) return
    const fps = (this.frames * 1000) / (nowMs - this.windowStart)
    this.windowStart = nowMs
    this.frames = 0
    this.recent.push(fps)
    if (this.recent.length > MAX_UP_WINDOWS) this.recent.shift()
    this.evaluate(nowMs)
  }

  private evaluate(nowMs: number): void {
    const idx = QUALITY_LEVELS.indexOf(this.level)
    const tail = (n: number) => (this.recent.length >= n ? this.recent.slice(-n) : null)
    const slow = tail(DOWN_WINDOWS)
    if (slow && idx > 0 && slow.every((f) => f < this.downFps)) {
      if (nowMs - this.lastUpAt < HOLD_MS) this.upWindows = Math.min(MAX_UP_WINDOWS, this.upWindows * 2)
      this.set(QUALITY_LEVELS[idx - 1])
      return
    }
    const fast = tail(this.upWindows)
    if (fast && idx < QUALITY_LEVELS.length - 1 && fast.every((f) => f >= this.upFps)) {
      this.lastUpAt = nowMs
      this.set(QUALITY_LEVELS[idx + 1])
    }
  }

  private set(level: QualityLevel): void {
    this.level = level
    this.recent = [] // judge the new level on its own frames
    this.onChange?.(level)
  }

  /** Forget the history (setting changed, scenario reloaded). */
  reset(level: QualityLevel = 'high'): void {
    this.level = level
    this.recent = []
    this.last = null
    this.frames = 0
    this.upWindows = UP_WINDOWS
    this.lastUpAt = -Infinity
  }
}

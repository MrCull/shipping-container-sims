/**
 * Smooth arrival of hero detail (#259), pure. Three small pieces the hero renderer composes:
 *
 * - `CameraGate`: no new hero face is prepared while the camera moves faster than `HERO_CAMERA_SPEED_MPS`; preparation
 *   starts once it has been at or below that for `HERO_SETTLE_MS`.
 * - `runPrep`: the time-sliced scheduler. Work items run nearest first until the per-frame allowance
 *   (`HERO_PREP_ALLOWANCE_MS`) is spent; an item is not started when the last one's cost would push the frame past
 *   it, but one item always runs so a backlog drains.
 * - `fadeAlpha`: a ready face fades in over `HERO_FADE_MS`, so the zoom shows the close-up look first, then sharpens.
 */

/** Per-frame time (ms) for preparing hero faces: model build, paint and wear set-up, instance set-up. */
export const HERO_PREP_ALLOWANCE_MS = 3
/** A ready face fades in over this long (ms). */
export const HERO_FADE_MS = 200
/** Above this camera speed (m/s, position change) no new hero face is prepared. */
export const HERO_CAMERA_SPEED_MPS = 5
/** The camera must stay at or below the speed threshold this long (ms) before preparation starts. */
export const HERO_SETTLE_MS = 150

export class CameraGate {
  private last: { x: number; y: number; z: number; t: number } | null = null
  private calmSince = -1

  constructor(
    private readonly speedMps = HERO_CAMERA_SPEED_MPS,
    private readonly settleMs = HERO_SETTLE_MS,
  ) {}

  /** Feeds the camera position at time `nowMs`; true when new faces may be prepared now. */
  update(x: number, y: number, z: number, nowMs: number): boolean {
    const prev = this.last
    if (!prev) this.calmSince = nowMs
    else if (nowMs > prev.t) {
      const speed = Math.hypot(x - prev.x, y - prev.y, z - prev.z) / ((nowMs - prev.t) / 1000)
      if (speed > this.speedMps) this.calmSince = -1
      else if (this.calmSince < 0) this.calmSince = nowMs
    }
    this.last = { x, y, z, t: nowMs }
    return this.calmSince >= 0 && nowMs - this.calmSince >= this.settleMs
  }
}

export interface PrepItem {
  /** Squared distance to the camera: nearest first. */
  d2: number
  run(): void
}

/**
 * Runs `items` nearest first within `allowanceMs` of `now()`. Returns how many ran. The items array is sorted in place.
 * An item is skipped (left for the next frame) when the previous item's cost would not fit in what is left.
 */
export function runPrep(items: PrepItem[], now: () => number, allowanceMs = HERO_PREP_ALLOWANCE_MS): number {
  items.sort((a, b) => a.d2 - b.d2)
  const start = now()
  let ran = 0
  let lastCost = 0
  for (const item of items) {
    const t0 = now()
    if (ran > 0 && t0 - start + lastCost > allowanceMs) break
    item.run()
    lastCost = now() - t0
    ran++
  }
  return ran
}

/** Opacity of a face prepared at `readyAtMs`, 0 to 1 (linear). */
export function fadeAlpha(readyAtMs: number, nowMs: number, fadeMs = HERO_FADE_MS): number {
  if (fadeMs <= 0) return 1
  return Math.min(1, Math.max(0, (nowMs - readyAtMs) / fadeMs))
}

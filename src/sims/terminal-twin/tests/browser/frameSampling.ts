/**
 * Load-proof frame sampling for browser smoke tests (V11-07).
 *
 * Software WebGL on a loaded 2-core runner may render only a few frames a second, so a test must never assert an
 * absolute frame count or sample over a fixed number of frames. It samples on every animation frame for a minimum
 * wall-clock window (extended until a minimum number of frames has been seen, up to a cap) and asserts RATIOS:
 * sim seconds per wall second, and "the display clock advanced on every frame".
 *
 * `wall` is the animation-frame timestamp, the same one the scene hands to the playback clock, so
 * `(sim1 - sim0) / (wall1 - wall0)` is exact however slow the frames are.
 */
import type { Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

export interface FrameSample {
  sim: number
  /** Animation-frame timestamp, ms. */
  wall: number
  /** Frames rendered by the scene so far. */
  frames: number
  /** SHC positions (only when `withShcs`). */
  shcs: Record<string, { x: number; z: number }>
}

export interface SampleOptions {
  /** Minimum wall-clock window, ms. */
  minWallMs: number
  /** Keep sampling past `minWallMs` until this many animation frames were seen (default 3). */
  minFrames?: number
  /** Hard cap on the window, ms (default 30 s). */
  maxWallMs?: number
  withShcs?: boolean
}

export async function sampleFrames(page: Page, options: SampleOptions): Promise<FrameSample[]> {
  const opts = { minFrames: 3, maxWallMs: 30_000, withShcs: false, ...options }
  return page.evaluate(async (o) => {
    const tt = window.__tt!
    const samples: FrameSample[] = []
    await new Promise<void>((resolve) => {
      let t0: number | null = null
      const tick = (ts: number) => {
        t0 ??= ts
        const shcs: FrameSample['shcs'] = {}
        if (o.withShcs) for (const [id, p] of Object.entries(tt.sceneState()!.shcs)) shcs[id] = { x: p.x, z: p.z }
        samples.push({ sim: tt.clock().displayTime, wall: ts, frames: tt.scene()?.frames ?? 0, shcs })
        const elapsed = ts - t0
        if (elapsed >= o.maxWallMs || (elapsed >= o.minWallMs && samples.length >= o.minFrames)) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return samples
  }, opts)
}

/** Sim seconds per wall second between the first and last sample. */
export function simPerWallSecond(samples: FrameSample[]): number {
  const first = samples[0]
  const last = samples[samples.length - 1]
  return (last.sim - first.sim) / ((last.wall - first.wall) / 1000)
}

/**
 * Fraction of frame steps where the display clock advanced. The clock may wait a frame or two for the engine while it
 * catches up at x600 (more often on a loaded runner), so this is a ratio, not "every frame".
 */
export function advancedFraction(samples: FrameSample[]): number {
  let advanced = 0
  for (let i = 1; i < samples.length; i++) if (samples[i].sim > samples[i - 1].sim) advanced++
  return advanced / Math.max(1, samples.length - 1)
}

/** True when the display clock never ran backwards. */
export function neverBackwards(samples: FrameSample[]): boolean {
  return samples.every((s, i) => i === 0 || s.sim >= samples[i - 1].sim)
}

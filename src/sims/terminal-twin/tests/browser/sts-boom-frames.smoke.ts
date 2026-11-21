/**
 * #304 frame-rate proof for the STS booms (spec #297): the TTI preset with booms up draws the same number of draw calls
 * as the same scene with every boom down, the forestays and boom-hoist ropes stay attached to the raised boom (read
 * through `__tt.sceneState().stsRendered[id].stayGapM`), and the frame ratio is not lower. Booms down is the same
 * preset with the `boom` subsystem forced `off` (every boom at the working angle), so the box count does not move the
 * draw calls. Headless Chromium renders with SwiftShader: frame RATES say nothing about a real GPU, so the frame check
 * is a ratio of frames per wall second over a minimum wall-clock window (`frameSampling.ts`), never an absolute count.
 * The real-GPU check is the owner's `__tt.perf()` run in `docs/optimising/frame-rate.md`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { sampleFrames, type FrameSample } from './frameSampling'
import { openTwin } from './openTwin'

function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

interface Measure {
  calls: number
  triangles: number
  /** Boom angle drawn, per crane. */
  booms: Record<string, number>
  /** Largest stay gap over all cranes (m). */
  stayGapM: number
  /** Frames rendered per wall second while playing at x60. */
  framesPerWallS: number
}

/** Frames rendered per wall second between the first and last sample (a rate, compared only as a ratio). */
function framesPerWallSecond(s: FrameSample[]): number {
  const a = s[0]
  const b = s[s.length - 1]
  return (b.frames - a.frames) / ((b.wall - a.wall) / 1000)
}

async function waitFrames(page: Page, n: number): Promise<void> {
  const f = await page.evaluate(() => window.__tt!.scene()!.frames)
  await page.waitForFunction(([f0, k]) => window.__tt!.scene()!.frames > f0 + k, [f, n] as const, { timeout: 120_000 })
}

/** Loads the TTI preset with booms `real` (the preset's own mode) or forced `off`, and measures the overview camera. */
async function measure(page: Page, boom: 'real' | 'off'): Promise<Measure> {
  await page.evaluate(
    (mode) => window.__tt!.load('TTI Algeciras baseline', mode === 'off' ? { overrides: { subsystems: { boom: 'off' } } } : {}),
    boom,
  )
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.waitForFunction(() => (window.__tt!.scene()?.containers ?? 0) > 8_000, undefined, { timeout: 120_000 })
  await page.waitForFunction(() => window.__tt!.scene()!.containerAssets === 'loaded', undefined, { timeout: 60_000 })
  await page.waitForFunction(() => Object.keys(window.__tt!.sceneState()!.stsRendered).length >= 8, undefined, { timeout: 60_000 })
  await page.evaluate(() => window.__tt!.cameraTo('STS104', 1100)) // overview: every crane in view
  await waitFrames(page, 8)
  const still = await page.evaluate(() => {
    const tt = window.__tt!
    const rendered = tt.sceneState()!.stsRendered as Record<string, { boomAngleDeg: number; stayGapM: number }>
    return {
      calls: tt.scene()!.render.calls,
      triangles: tt.scene()!.render.triangles,
      booms: Object.fromEntries(Object.entries(rendered).map(([id, r]) => [id, r.boomAngleDeg])),
      stayGapM: Math.max(...Object.values(rendered).map((r) => r.stayGapM)),
    }
  })
  await page.evaluate(() => {
    window.__tt!.setSpeed(60)
    window.__tt!.play()
  })
  const samples = await sampleFrames(page, { minWallMs: 8_000, minFrames: 4 })
  await page.evaluate(() => window.__tt!.pause())
  return { ...still, framesPerWallS: framesPerWallSecond(samples) }
}

test('TTI booms up: forestays attached, no extra draw calls and no lower frame ratio than booms down', async ({ page }) => {
  test.setTimeout(480_000)
  const errors = watch(page)
  // render and High: the spec counts draw calls and frames at the High LOD distances it measures.
  await openTwin(page, { quality: 'high', render: true })
  await page.evaluate(() => window.localStorage.clear())

  // Warm-up load: the first load pays GLB fetch and shader compile, which would count against whichever mode ran first.
  await measure(page, 'off')
  const down = await measure(page, 'off')
  const up = await measure(page, 'real')
  test.info().annotations.push({ type: 'sts-boom-frames', description: JSON.stringify({ down, up }) })
  console.log('STS boom frames', JSON.stringify({ down, up }))

  // Booms down: every crane at the working angle. Booms up: idle cranes at t0 park raised (#298).
  expect(Object.values(down.booms).every((d) => d === 0)).toBe(true)
  const raised = Object.entries(up.booms).filter(([, d]) => d >= 70)
  expect(raised.length, JSON.stringify(up.booms)).toBeGreaterThan(0)
  // Forestays and boom-hoist ropes end on their anchors whatever the angle (#299).
  expect(up.stayGapM).toBeLessThan(0.05)
  expect(down.stayGapM).toBeLessThan(0.05)
  // Raising a boom adds no draw calls (main plus shadow pass).
  expect(up.calls).toBeLessThanOrEqual(down.calls)
  // Frame ratio not lower: software GL on a shared runner is noisy, so allow 25 % either way of a real drop.
  expect(up.framesPerWallS / down.framesPerWallS).toBeGreaterThan(0.75)
  expect(errors).toEqual([])
})

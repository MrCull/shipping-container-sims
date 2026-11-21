/**
 * Rendering-budget guard (#326): a heavier scene is a deliberate, reviewed change, not something found out from smoke
 * timeouts. Loads the TTI Algeciras baseline with `?render=off&quality=high`, runs it to a fixed event count, puts the
 * camera at fixed poses (Overview, and a close-up of the first yard block), draws exactly one frame per pose with
 * `__tt.renderOnce()` and checks its draw calls and triangles against `renderBudget.budget.ts`. Counts, not frame
 * rates, so it is deterministic on any runner (viewport 1280x720 from playwright.config.ts).
 *
 * Why the `dev` project and not `prod`: the real production build has no dev API, so it cannot fix the run point or
 * the camera pose, nor draw one frame on demand (the in-app Benchmark plays at speed and is not deterministic). The
 * guard runs on the smoke build instead (the default server for `dev`, locally and in CI, #323, #344): a production
 * bundle with the dev API kept, so the renderer code it measures is the one users get. The opt-in Vite dev server
 * (`SMOKE_SERVER=dev`) gives the same counts. Run alone with `pnpm run test:smoke --project=dev terminal-twin-render-budget`.
 * Belongs to the core smoke set (`@core`): it runs on every PR that changes `src/`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import type { CameraPose } from '../../modules/cameraKeys'
import { openTwin } from './openTwin'
import { renderBudgetFailures } from './renderBudget'
import { RENDER_BUDGETS, RENDER_BUDGET_FILE, RENDER_BUDGET_TOLERANCE } from './renderBudget.budget'

/** The run point: this many engine events after load, so the quay and yard are the same on every run. */
const RUN_EVENTS = 2000

/**
 * Fixed camera poses (what the view had on 21 Nov 2026, written out so a change to a preset does not move the guard):
 * `start` is the view a scenario opens at (the view #320 measured: about 786 draw calls and 1.06 M triangles), `overview`
 * the Overview preset, `yard-closeup` the first yard block from 10 m (hero containers), as the Benchmark's close-up.
 */
const POSES: Record<keyof typeof RENDER_BUDGETS, CameraPose> = {
  start: { target: { x: 89.05, y: 8, z: 30 }, distance: 218.4605, azimuth: 0.18822, polar: 1.36332 },
  overview: { target: { x: 425, y: 3, z: 322.5 }, distance: 993.6047, azimuth: 0.46365, polar: 0.72973 },
  'yard-closeup': { target: { x: 125, y: 3, z: 222.75 }, distance: 10, azimuth: 0.46365, polar: 0.72973 },
}

test('TTI baseline on High at fixed cameras stays within the rendering budget @core', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  await openTwin(page, { scenario: 'TTI Algeciras baseline', quality: 'high' }) // the budget is for High; draws only via renderOnce
  await page.evaluate((n) => window.__tt!.runUntil({ maxEvents: n }), RUN_EVENTS)
  await page.evaluate(() => window.__tt!.pause())
  await page.waitForFunction(() => {
    const s = window.__tt!.scene()
    return !!s && s.containers > 8_000 && s.containerAssets === 'loaded' && s.vesselAssets === 'loaded'
  }, undefined, { timeout: 150_000 })
  expect((await page.evaluate(() => window.__tt!.perf())).effective).toBe('high')

  const failures: string[] = []
  const measured: Record<string, unknown> = {}
  for (const camera of Object.keys(RENDER_BUDGETS) as (keyof typeof RENDER_BUDGETS)[]) {
    expect(await page.evaluate((pose) => window.__tt!.setCameraPose(pose), POSES[camera])).toBe(true)
    // The frame update (LODs, culling, hero selection) runs with render off; let it see the new pose and wait until
    // hero detail (close-up faces, hero equipment) has streamed in. Then count only a settled view: two draws 10
    // frames apart must agree.
    let info = { calls: -1, triangles: -1 }
    for (let i = 0; i < 10; i++) {
      const frames = await page.evaluate(() => window.__tt!.scene()!.frames)
      await page.waitForFunction((f) => window.__tt!.scene()!.frames > f + 10, frames, { timeout: 60_000 })
      await page.waitForFunction(() => window.__tt!.heroSettled(), undefined, { timeout: 150_000 })
      const next = (await page.evaluate(() => window.__tt!.renderOnce()))!
      if (next.calls === info.calls && next.triangles === info.triangles) break
      info = next
    }
    const detail = await page.evaluate(() => ({ lods: window.__tt!.scene()!.containerLods, stats: window.__tt!.perf().stats, time: window.__tt!.clock().displayTime }))
    console.log(`render budget ${camera}: ${JSON.stringify({ info, detail })}`)
    measured[camera] = { calls: info.calls, triangles: info.triangles }
    failures.push(...renderBudgetFailures(camera, info, RENDER_BUDGETS[camera], RENDER_BUDGET_TOLERANCE, RENDER_BUDGET_FILE))
  }
  console.log(`render budget measured: ${JSON.stringify(measured)}`)
  test.info().annotations.push({ type: 'render-budget', description: JSON.stringify(measured) })
  expect(failures, failures.join('\n')).toEqual([])
  expect(errors).toEqual([])
})

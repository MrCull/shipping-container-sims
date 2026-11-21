/**
 * #331 (spec #320): the headless scene (`cli/headlessScene.ts`, Node, no WebGL) reports what the browser reports. Loads a
 * small fixture in the browser and in Node with the same seed, runs both to the same event and compares
 * `__tt.sceneState()` with the factory's `sceneState()` for the fields both report. Left out: what depends on a loaded
 * GLB (hull LOD, triangles and bay grid, the rig state of STS, SHC, ASC and truck models) and the container LOD.
 * Run with `pnpm run test:smoke --project=dev headless-parity`.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { headlessScene } from '../../cli/headlessScene'
import type { SceneState } from '../../modules/sceneState'
import { openTwin } from './openTwin'

const FIXTURE = 'rob-bays'

/** The fields the browser and the headless scene both report, in a form that compares exactly (positions to the mm). */
function comparable(state: SceneState): Record<string, unknown> {
  const mm = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mm(x)])) : v)
  return mm({
    displayTime: state.displayTime,
    containers: state.containers,
    reservations: state.reservations,
    sts: state.sts,
    shcs: state.shcs,
    ascs: state.ascs,
    trucks: state.trucks,
    vessels: state.vessels,
    hatchPanels: state.hatchPanels,
    hatchRigs: state.hatchRigs,
    colour: state.colour,
    vesselHulls: Object.fromEntries(
      Object.entries(state.vesselHulls).map(([id, h]) => [id, { sizeClass: h.sizeClass, line: h.line, liveryIndex: h.liveryIndex, name: h.name, openHatchBays: h.openHatchBays, robBoxes: h.robBoxes, robHidden: h.robHidden }]),
    ),
    liveries: Object.fromEntries(Object.entries(state.liveries).map(([id, l]) => [id, { index: l.index, size: l.size, tint: l.tint, centre: l.centre }])),
  }) as Record<string, unknown>
}

test('the headless scene reports the same scene state as the browser for the same fixture, seed and time', async ({ page }) => {
  test.setTimeout(120_000)
  await openTwin(page, { scenario: FIXTURE })
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsMoveStarted' }))
  // two more frame updates, so what is drawn is the state at the paused time
  const frames = await page.evaluate(() => window.__tt!.scene()?.frames ?? 0)
  await page.waitForFunction((n) => (window.__tt!.scene()?.frames ?? 0) >= n + 2, frames)
  const browser = (await page.evaluate(() => window.__tt!.sceneState()))!

  const node = await headlessScene(FIXTURE)
  await node.runUntil({ eventType: 'StsMoveStarted' })
  const headless = node.sceneState()
  node.dispose()

  expect(headless.displayTime).toBe(browser.displayTime)
  expect(Object.keys(headless.liveries).length).toBeGreaterThan(10)
  const a = comparable(browser)
  const b = comparable(headless)
  for (const key of Object.keys(a)) expect(b[key], key).toEqual(a[key])
})

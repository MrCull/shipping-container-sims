/**
 * Phase 2 container assets in the browser (seam 3 + seam 4):
 * the twin's instanced renderer loads the container GLBs without any external
 * request and draws the liveries (LOD by distance and livery per line in detail:
 * `tests/headless-scene-yard.test.ts`, #336), and the dev-only asset
 * viewer shows every asset (screenshots in .screenshots/assets/).
 * Run with `pnpm run test:smoke`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import atlas from '../../assets/models/containers/livery-atlas.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing
import { openTwin, twinUrl } from './openTwin'

/** Asset or decoder files (GLB/glTF, textures, wasm/JS decoders): these must never come from another host. */
const ASSET_REQUEST = /\.(glb|gltf|bin|webp|png|ktx2|basis|wasm|drc)(\?|$)|draco|meshopt|basis_transcoder/i

function watch(page: Page): { errors: string[]; external: string[] } {
  const errors: string[] = []
  const external: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('request', (req) => {
    const url = new URL(req.url())
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)
    // index.html's own analytics and web fonts are site chrome, not asset loading.
    if (!local && ASSET_REQUEST.test(url.pathname)) external.push(req.url())
  })
  return { errors, external }
}

test('the twin loads the container GLBs offline and draws every worker box with an atlas livery', { tag: '@yard' }, async ({ page }) => {
  const { errors, external } = watch(page)
  await openTwin(page, { scenario: 'liveries-mixed', quality: 'high' }) // High draws LOD0 out to the screenshot distance
  await page.evaluate(() => window.__tt!.runTo(200))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)

  // wiring only: every worker box reaches the drawn liveries as an atlas tile, untinted in the default mode (which tile a
  // box gets, line or #360 leasing variant, and size and LOD by distance: headless-scene-yard.test.ts, #336)
  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('containers'))
  const state = await page.evaluate(() => window.__tt!.sceneState())
  expect(boxes.length).toBeGreaterThan(0)
  for (const box of boxes) {
    const livery = state!.liveries[box.id]
    expect(livery, box.id).toBeDefined()
    expect(Number.isInteger(livery.index) && livery.index >= 0 && livery.index < atlas.liveries.length, `${box.id} tile ${livery.index}`).toBe(true)
    expect(livery.tint, box.id).toBe(-1)
  }
  await page.evaluate(() => window.__tt!.cameraTo('STS01', 140))
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/assets/twin-liveries.png' })
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('the asset viewer loads every container asset, switches LODs and moves the rig', { tag: '@yard' }, async ({ page }) => {
  test.slow() // shows and screenshots every asset in the pack, each on software WebGL
  const { errors, external } = watch(page)
  await page.goto(twinUrl({ params: { viewer: 'container-20' } })) // the asset viewer has no __tt to wait for
  await page.waitForFunction(() => !!window.__ttAssets)
  // render is off (#345): the frame counter still advances, nothing is drawn until renderOnce()
  const start = await page.evaluate(() => window.__ttAssets!.frames().frames)
  await page.waitForFunction((n) => window.__ttAssets!.frames().frames > n + 2, start)
  expect((await page.evaluate(() => window.__ttAssets!.frames())).render).toEqual({ calls: 0, triangles: 0 })
  const once = await page.evaluate(() => window.__ttAssets!.renderOnce())
  expect(once.calls).toBeGreaterThan(0)
  expect(once.triangles).toBeGreaterThan(0)
  expect((await page.evaluate(() => window.__ttAssets!.frames())).render).toEqual(once)
  const names = await page.evaluate(() => window.__ttAssets!.list())
  expect(names).toEqual(expect.arrayContaining(['container-20', 'container-40', 'container-40hc']))

  for (const name of names) {
    const lod0 = await page.evaluate((n) => window.__ttAssets!.show(n, { lod: 'LOD0' }), name)
    expect(lod0.asset).toBe(name)
    expect(lod0.triangles).toBe(lod0.lods.LOD0.triangles)
    expect(lod0.referenceContainer).toBe(true)
    // later groups (buildings, signs) ship a single LOD: only switch where the asset has one
    if ('LOD1' in lod0.lods) {
      const lod1 = await page.evaluate(() => window.__ttAssets!.setLod('LOD1'))
      expect(lod1.triangles).toBe(lod1.lods.LOD1.triangles)
    }
    await page.evaluate(() => window.__ttAssets!.setLod('LOD0'))
    for (const rig of lod0.rig) {
      const moved = await page.evaluate(([n, v]) => window.__ttAssets!.setRig(n as string, v as number), [rig.node, rig.max] as const)
      expect(moved.rigValues[rig.node]).toBe(rig.max)
    }
    await page.evaluate(() => window.__ttAssets!.renderOnce()) // render is off: draw the frame the screenshot keeps
    await page.screenshot({ path: `.screenshots/assets/${name}.png` })
  }
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('a TTI-size yard of instanced containers stays within the triangle and draw-call budget', { tag: '@yard' }, async ({ page }) => {
  test.slow() // 18,000 instances render at under 1 fps on software WebGL; with render off only the one measured frame is drawn
  const { errors } = watch(page)
  // High quality keeps the sun's shadow pass in the measured frame, so the budget below counts the same passes as before
  await page.goto(twinUrl({ quality: 'high', params: { viewer: 'yard' } })) // the asset viewer has no __tt to wait for
  await page.waitForFunction(() => !!window.__ttAssets)
  const yard = await page.evaluate(() => window.__ttAssets!.yard(18000))
  expect(yard.instances).toBe(18000)
  expect(yard.lod0).toBeGreaterThan(0)
  expect(yard.lod0).toBeLessThanOrEqual(yard.lod0Cap)
  expect(yard.lod1).toBe(18000 - yard.lod0)
  // Container layers alone must stay small; the viewer's total also counts the sun's shadow pass and the floor.
  expect(yard.containerDrawCalls).toBeLessThan(20)
  expect(yard.drawCalls).toBeLessThan(40)
  expect(yard.triangles).toBeLessThan(1_500_000)
  console.log(`yard: ${JSON.stringify(yard)}`)
  await page.evaluate(() => window.__ttAssets!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/assets/yard.png' })
  expect(errors).toEqual([])
})

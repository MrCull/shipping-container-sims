/**
 * Phase 2 container assets in the browser (seam 3 + seam 4):
 * the twin's instanced renderer uses the GLBs (LOD0 near, LOD1 far, livery per
 * line), assets load without any external request, and the dev-only asset
 * viewer shows every asset (screenshots in .screenshots/assets/).
 * Run with `npm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import atlas from '../../assets/models/containers/livery-atlas.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing

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

test('the twin renders containers from the GLBs with each box in its own line livery, offline', async ({ page }) => {
  const { errors, external } = watch(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('liveries-mixed'))
  await page.evaluate(() => window.__tt!.runTo(200))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)

  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string; line: string; size: string }[]>('containers'))
  const state = await page.evaluate(() => window.__tt!.sceneState())
  const scene = await page.evaluate(() => window.__tt!.scene())
  expect(new Set(boxes.map((b) => b.line)).size).toBeGreaterThanOrEqual(5)
  expect(new Set(boxes.map((b) => b.size))).toEqual(new Set(['20', '40', '40HC']))
  for (const box of boxes) {
    const rendered = state!.liveries[box.id]
    expect(rendered, box.id).toBeDefined()
    expect(atlas.liveries[rendered.index].line, box.id).toBe(box.line)
    expect(rendered.size, box.id).toBe(box.size)
  }
  expect(scene!.containerLods.lod0 + scene!.containerLods.lod1).toBe(scene!.containers)
  expect(scene!.containers).toBe(boxes.length)

  // Close up, the boxes use LOD0; from far away, LOD1 (and the liveries stay put).
  await page.evaluate(() => window.__tt!.cameraTo('STS01', 60))
  await page.waitForFunction(() => window.__tt!.scene()!.containerLods.lod0 + window.__tt!.scene()!.containerLods.culled === window.__tt!.scene()!.containers) // boxes outside the view are culled, not LOD0
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.screenshots/assets/twin-liveries-near.png' })
  await page.evaluate(() => window.__tt!.cameraTo('STS01', 600))
  await page.waitForFunction(() => window.__tt!.scene()!.containerLods.lod1 === window.__tt!.scene()!.containers)
  const far = await page.evaluate(() => window.__tt!.sceneState())
  for (const box of boxes) expect(far!.liveries[box.id].index).toBe(state!.liveries[box.id].index)
  await page.evaluate(() => window.__tt!.cameraTo('STS01', 140))
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.screenshots/assets/twin-liveries.png' })
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('the asset viewer loads every container asset, switches LODs and moves the rig', async ({ page }) => {
  test.slow() // shows and screenshots every asset in the pack, each on software WebGL
  const { errors, external } = watch(page)
  await page.goto('/sim/terminal-twin?viewer=container-20')
  await page.waitForFunction(() => !!window.__ttAssets)
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
    await page.waitForTimeout(250)
    await page.screenshot({ path: `.screenshots/assets/${name}.png` })
  }
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('a TTI-size yard of instanced containers stays within the triangle and draw-call budget', async ({ page }) => {
  test.slow() // 18,000 instances render at under 1 fps on software WebGL
  const { errors } = watch(page)
  await page.goto('/sim/terminal-twin?viewer=yard')
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
  await page.screenshot({ path: '.screenshots/assets/yard.png' })
  expect(errors).toEqual([])
})

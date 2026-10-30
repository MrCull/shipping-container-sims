/**
 * TT-24 browser smoke tests (seam 3 + seam 4): the rigged ASC model in the twin
 * (LOD switching, paired ASCs, animation from the engine's motion segments, the
 * carried box under the spreader) and in the dev asset viewer (rig sliders, 8
 * rows of reference containers under the span at a 5-high stack). Screenshots
 * go to .screenshots/assets/. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import fixture from '../../scenario/fixtures/asc-2asc-block-conflict.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing

const FIXTURE = 'asc-2asc-block-conflict'

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
    if (!local && /\.(glb|gltf|bin|webp|ktx2|wasm|drc)(\?|$)|draco|meshopt/i.test(url.pathname)) external.push(req.url())
  })
  return { errors, external }
}

async function openAsc(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscLocking' }))
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded')
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
}

test('paired ASCs use the GLB with LOD switching and are posed from the engine motion', async ({ page }) => {
  test.slow() // three camera moves, each waiting on a software-rendered frame
  const { errors, external } = watch(page)
  await openAsc(page)

  const state = await page.evaluate(() => window.__tt!.sceneState())
  const ascIds = Object.keys(state!.ascs)
  expect(ascIds).toHaveLength(2)
  expect(Object.keys(state!.ascRigs).sort()).toEqual([...ascIds].sort())

  // The rig mirrors the scene model: gantry Z, trolley offset from the block, hoist from the spreader height.
  const working = ascIds.find((id) => state!.ascs[id].status !== 'idle') ?? ascIds[0]
  const rig = state!.ascRigs[working]
  const pose = state!.ascs[working]
  expect(rig.gantryZ).toBeCloseTo(pose.z, 3)
  const blockX = fixture.yard.blocks[0].x
  expect(rig.trolleyX).toBeCloseTo(pose.x - blockX, 3)
  expect(rig.hoistM).toBeLessThanOrEqual(0)

  // LOD: near = 0, mid = 1, far = 2 (counts over the two ASCs).
  await page.evaluate((id) => window.__tt!.cameraTo(id, 60), working)
  await page.waitForTimeout(500)
  await page.waitForFunction(() => window.__tt!.scene()!.ascLods.lod0 >= 1)
  await page.screenshot({ path: '.screenshots/assets/twin-asc-near.png' })
  await page.evaluate((id) => window.__tt!.cameraTo(id, 200), working)
  await page.waitForFunction(() => window.__tt!.scene()!.ascLods.lod1 >= 1)
  await page.evaluate((id) => window.__tt!.cameraTo(id, 600), working)
  await page.waitForFunction(() => window.__tt!.scene()!.ascLods.lod2 >= 1)
  const far = await page.evaluate(() => window.__tt!.scene()!)
  expect(far.ascLods.lod0 + far.ascLods.lod1 + far.ascLods.lod2).toBe(2)

  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('while an ASC carries a box, the box hangs at the twist-lock plane and the ropes follow the hoist', async ({ page }) => {
  const { errors } = watch(page)
  await openAsc(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscRoutingToSlot' }))
  await page.waitForFunction(() => Object.values(window.__tt!.sceneState()?.ascRigs ?? {}).some((r) => r.carrying))
  const s = await page.evaluate(() => window.__tt!.sceneState()!)
  const [id, rig] = Object.entries(s.ascRigs).find(([, r]) => r.carrying)!
  const carried = Object.entries(s.containers).find(([, c]) => c?.kind === 'asc' && c.id === id)
  expect(carried).toBeTruthy()
  // Ropes: 2.2 m between the drums and the head block at rest; a lowered hoist stretches them.
  if (rig.hoistM < -0.5) expect(rig.ropeScale).toBeGreaterThan(2.2)
  expect(rig.scaleY).toBe(1) // the fixture's block is at most 5 tiers high
  await page.evaluate((i) => window.__tt!.cameraTo(i, 45), id)
  await page.waitForTimeout(500)
  await page.screenshot({ path: '.screenshots/assets/twin-asc-carrying.png' })
  expect(errors).toEqual([])
})

test('the asset viewer shows the ASC with working rig sliders and 8 rows of reference containers fitting under the span', async ({ page }) => {
  const { errors, external } = watch(page)
  await page.goto('/sim/terminal-twin?viewer=asc')
  await page.waitForFunction(() => !!window.__ttAssets)
  expect(await page.evaluate(() => window.__ttAssets!.list())).toContain('asc')

  const first = await page.evaluate(() => window.__ttAssets!.show('asc', { lod: 'LOD0' }))
  expect(first.kind).toBe('asc')
  expect(first.lods.LOD0.triangles).toBeGreaterThan(11000)
  expect(first.lods.LOD0.triangles).toBeLessThanOrEqual(15000)
  expect(first.lods.LOD1.triangles).toBeLessThanOrEqual(4000)
  expect(first.lods.LOD2.triangles).toBeLessThanOrEqual(600)
  const nodes = first.rig.map((r) => r.node)
  for (const n of ['gantry', 'trolley', 'hoist', 'spreader', 'twistlock_fl']) expect(nodes).toContain(n)

  // 8 rows of reference containers, 5 high: they fit between the legs with clearance, and a raised carried box passes over them.
  expect(first.stack).toMatchObject({ rows: 8, tiers: 5, fits: true })
  expect(first.stack!.sideClearanceM).toBeGreaterThan(0.5)
  expect(first.stack!.carryClearanceM).toBeGreaterThan(0.3)
  expect(first.stack!.rowsWidthM).toBeLessThan(first.stack!.clearSpanM)
  const tooTall = await page.evaluate(() => window.__ttAssets!.setStack(6))
  expect(tooTall.stack!.fits).toBe(false)
  const back = await page.evaluate(() => window.__ttAssets!.setStack(5))
  expect(back.stack!.fits).toBe(true)

  // Sliders drive every LOD's nodes: gantry along the rails, trolley across the rows, hoist (carried box follows), spreader.
  const limits = Object.fromEntries(first.rig.map((r) => [r.node, r]))
  const moved = await page.evaluate(() => {
    const v = window.__ttAssets!
    v.setRig('gantry', 40)
    v.setRig('trolley', 9)
    v.setRig('spreader', 0.3)
    return v.setRig('hoist', -6)
  })
  expect(moved.rigValues).toMatchObject({ gantry: 40, trolley: 9, spreader: 0.3, hoist: -6 })
  // The reference box hangs from the spreader's `container` point (top at the twist-lock plane: 18 - 6 + 0.3 float), the ropes stretch with the hoist.
  const pose = await page.evaluate(() => window.__ttAssets!.pose()!)
  expect(pose.reference.hangingFrom).toBe('spreader')
  expect(pose.reference.topCentre[1]).toBeCloseTo(18 - 6 + 0.3, 2)
  expect(pose.reference.topCentre[0]).toBeCloseTo(9, 2)
  expect(pose.reference.topCentre[2]).toBeCloseTo(40, 2)
  expect(pose.reference.size[1]).toBeCloseTo(2.896, 3)
  expect(pose.stretch.ropes).toBeCloseTo(2.2 + 6, 2)
  expect(limits.hoist.min).toBeCloseTo(2.896 - 18, 2)
  const lowest = await page.evaluate((v) => window.__ttAssets!.setRig('hoist', v), limits.hoist.min)
  expect(lowest.stack!.carriedBottomM).toBeCloseTo(0, 2) // box bottom on the ground at the lowest travel
  await page.evaluate(() => window.__ttAssets!.setRig('hoist', -6))
  await page.evaluate(() => window.__ttAssets!.setLod('LOD1'))
  const lod1 = await page.evaluate(() => window.__ttAssets!.stats()!)
  expect(lod1.triangles).toBe(lod1.lods.LOD1.triangles)
  await page.evaluate(() => window.__ttAssets!.setLod('LOD0'))
  await page.evaluate(() => {
    const v = window.__ttAssets!
    v.setRig('gantry', 0)
    v.setRig('trolley', 0)
    v.setRig('hoist', 0)
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: '.screenshots/assets/asc-viewer.png' })
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

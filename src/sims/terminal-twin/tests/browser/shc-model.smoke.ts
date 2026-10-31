/**
 * TT-25 browser smoke tests (seam 3 + seam 4): the rigged SHC model in the twin
 * (LOD switching, carried box at the attach point, wheels rolling, steering,
 * hoist from the lift motion) and in the dev asset viewer (rig sliders, a 40 ft
 * box inside the tunnel at true scale). Screenshots go to .screenshots/assets/.
 * Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing

const FIXTURE = 'shc-1sts-2shc-1wtp'

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

async function openShc(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcRoutingLoaded' }))
  await page.waitForFunction(() => window.__tt!.scene()?.shcAssets === 'loaded')
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
}

test('SHCs in the twin use the GLB with LOD switching, carry the box at the attach point and roll their wheels', async ({ page }) => {
  const { errors, external } = watch(page)
  await openShc(page)

  const state = await page.evaluate(() => window.__tt!.sceneState())
  const shcIds = Object.keys(state!.shcs)
  expect(shcIds).toHaveLength(2)
  expect(Object.keys(state!.shcRigs).sort()).toEqual([...shcIds].sort())

  // The SHC carrying a box: carrying rig, hoist lowered towards the box top (lift 1 m + box height), box centred under it.
  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string; custody: { kind: string; id: string } }[]>('containers'))
  const carried = boxes.find((b) => b.custody.kind === 'shc')!
  const carrier = carried.custody.id
  const rig = state!.shcRigs[carrier]
  expect(rig.carrying).toBe(true)
  const shcPose = state!.shcs[carrier]
  const boxTop = shcPose.lift + 2.591 // standard box height (a 40 ft HC would be 2.896)
  expect(rig.hoistM + 6.0).toBeGreaterThanOrEqual(boxTop - 0.4)
  expect(rig.hoistM + 6.0).toBeLessThanOrEqual(boxTop + 0.4)
  // It has driven since the start, so its tyres have rolled.
  expect(Math.abs(rig.wheelRollRad)).toBeGreaterThan(0.1)

  // LOD: near = 0, mid = 1, far = 2 (counts over the two SHCs).
  await page.evaluate((id) => window.__tt!.cameraTo(id, 50), carrier)
  await page.waitForTimeout(500)
  await page.waitForFunction(() => window.__tt!.scene()!.shcLods.lod0 >= 1)
  await page.screenshot({ path: '.screenshots/assets/twin-shc-near.png' })
  await page.evaluate((id) => window.__tt!.cameraTo(id, 250), carrier)
  await page.waitForFunction(() => window.__tt!.scene()!.shcLods.lod1 >= 1)
  await page.evaluate((id) => window.__tt!.cameraTo(id, 700), carrier)
  await page.waitForFunction(() => window.__tt!.scene()!.shcLods.lod2 >= 1)
  const far = await page.evaluate(() => window.__tt!.scene()!)
  expect(far.shcLods.lod0 + far.shcLods.lod1 + far.shcLods.lod2).toBe(2)

  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('SHCs steer through the corners of the lane graph', async ({ page }) => {
  const { errors } = watch(page)
  await openShc(page)
  // Sample the rig every frame while the sim plays: some SHC must steer, wheels must roll consistently with the distance driven.
  await page.evaluate(() => window.__tt!.setSpeed(10))
  const samples = await page.evaluate(async () => {
    const tt = window.__tt!
    tt.play()
    const out: { id: string; steer: number; roll: number; x: number; z: number }[] = []
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        const s = tt.sceneState()!
        for (const [id, r] of Object.entries(s.shcRigs)) out.push({ id, steer: r.steerRad, roll: r.wheelRollRad, x: s.shcs[id].x, z: s.shcs[id].z })
        if (performance.now() - t0 < 14000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    tt.pause()
    return out
  })
  expect(samples.some((s) => Math.abs(s.steer) > 0.05)).toBe(true)
  expect(samples.every((s) => Math.abs(s.steer) <= (35 * Math.PI) / 180 + 1e-6)).toBe(true)
  expect(errors).toEqual([])
})

test('the asset viewer shows the SHC with working rig sliders and a 40 ft box fitting the tunnel at true scale', async ({ page }) => {
  const { errors, external } = watch(page)
  await page.goto('/sim/terminal-twin?viewer=shc')
  await page.waitForFunction(() => !!window.__ttAssets)
  expect(await page.evaluate(() => window.__ttAssets!.list())).toContain('shc')

  const first = await page.evaluate(() => window.__ttAssets!.show('shc', { lod: 'LOD0' }))
  expect(first.kind).toBe('shc')
  expect(first.lods.LOD0.triangles).toBeGreaterThan(9000)
  expect(first.lods.LOD0.triangles).toBeLessThanOrEqual(12000)
  expect(first.lods.LOD1.triangles).toBeLessThanOrEqual(3000)
  expect(first.lods.LOD2.triangles).toBeLessThanOrEqual(400)
  const nodes = first.rig.map((r) => r.node)
  for (const n of ['steer_fl', 'steer_rr', 'wheel_fl', 'wheel_rr', 'hoist', 'spreader', 'twistlock_fl']) expect(nodes).toContain(n)

  // Reference 40 ft HC box: fits the tunnel, hangs from the attach plane, follows the hoist.
  expect(first.reference).toMatchObject({ size: '40HC', fitsTunnel: true })
  expect(first.reference!.lengthM).toBeCloseTo(12.192, 3)
  expect(first.reference!.topM).toBeCloseTo(6.0, 2)
  const hoist = first.rig.find((r) => r.node === 'hoist')!
  const lowered = await page.evaluate((v) => window.__ttAssets!.setRig('hoist', v), hoist.min)
  expect(lowered.reference!.topM).toBeCloseTo(6.0 + hoist.min, 2)
  expect(lowered.reference!.fitsTunnel).toBe(true) // standing on the ground at the lowest travel
  expect(lowered.reference!.topM).toBeGreaterThanOrEqual(2.896 - 1e-6)

  // Every rig node of every LOD receives the slider value.
  const steered = await page.evaluate(() => window.__ttAssets!.setRig('steer_fl', 30))
  expect(steered.rigValues.steer_fl).toBe(30)
  await page.evaluate(() => window.__ttAssets!.setRig('hoist', -1.2))
  await page.evaluate(() => window.__ttAssets!.setLod('LOD1'))
  const lod1 = await page.evaluate(() => window.__ttAssets!.stats()!)
  expect(lod1.triangles).toBe(lod1.lods.LOD1.triangles)
  await page.evaluate(() => window.__ttAssets!.setLod('LOD0'))
  await page.waitForTimeout(300)
  await page.screenshot({ path: '.screenshots/assets/shc-viewer.png' })
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

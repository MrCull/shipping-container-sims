/**
 * TT-26 browser smoke tests (seams 3 + 4): the truck GLBs in the twin (LOD switching, wheel roll and steering,
 * articulation through turns, boxes on the attach points, no external requests) and in the dev asset viewer
 * (rig sliders, 20 ft and 40 ft reference boxes on the chassis twist-locks). Screenshots go to .screenshots/assets/.
 * Run with `npm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing

const FIXTURE = 'truck-gate-queue'

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

async function openTrucks(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await page.evaluate(() => window.__tt!.runTo(3300))
  await page.waitForFunction(() => window.__tt!.scene()?.landside.assets === 'loaded' && Object.keys(window.__tt!.sceneState()?.truckRigs ?? {}).length > 5)
}

test('trucks in the twin use the GLB models with cab and livery variety and LOD switching', async ({ page }) => {
  const { errors, external } = watch(page)
  await openTrucks(page)
  const state = await page.evaluate(() => window.__tt!.sceneState()!)
  const rigs = Object.entries(state.truckRigs)
  expect(rigs.length).toBeGreaterThan(5)
  expect(new Set(rigs.map(([, r]) => r.shape)).size).toBeGreaterThanOrEqual(2)
  expect(new Set(rigs.map(([, r]) => r.maker)).size).toBeGreaterThanOrEqual(2)

  const id = rigs[0][0]
  await page.evaluate((i) => window.__tt!.cameraTo(i, 30), id)
  await page.waitForFunction(() => window.__tt!.scene()!.landside.lods.lod0 >= 1)
  await page.screenshot({ path: '.screenshots/assets/twin-truck-near.png' })
  await page.evaluate((i) => window.__tt!.cameraTo(i, 110), id)
  await page.waitForFunction(() => window.__tt!.scene()!.landside.lods.lod1 >= 1)
  await page.evaluate((i) => window.__tt!.cameraTo(i, 500), id)
  await page.waitForFunction(() => window.__tt!.scene()!.landside.lods.lod2 >= 1)
  const far = await page.evaluate(() => window.__tt!.scene()!.landside)
  expect(far.lods.lod0 + far.lods.lod1 + far.lods.lod2).toBe(far.trucks)
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

test('trucks roll, steer, articulate through turns and carry their box on the chassis attach point', async ({ page }) => {
  const { errors } = watch(page)
  await openTrucks(page)
  await page.evaluate(() => window.__tt!.setSpeed(60))
  const samples = await page.evaluate(async () => {
    const tt = window.__tt!
    tt.play()
    const out: { id: string; steer: number; artic: number; roll: number }[] = []
    // Load-proof (V11-07): the window is 480 sim seconds (8 s at x60 on an idle machine), not 8 wall seconds, so a
    // slow runner sees the same stretch of the run; the wall cap only stops a stalled page.
    const sim0 = tt.clock().displayTime
    const t0 = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        for (const [id, r] of Object.entries(tt.sceneState()!.truckRigs)) out.push({ id, steer: r.steerRad, artic: r.articulationRad, roll: r.wheelRollRad })
        if (tt.clock().displayTime - sim0 < 480 && performance.now() - t0 < 90_000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    tt.pause()
    return out
  })
  expect(samples.some((s) => Math.abs(s.roll) > 1)).toBe(true) // wheels rolled
  expect(samples.some((s) => Math.abs(s.steer) > 0.05)).toBe(true) // front wheels steered in a turn
  const turning = samples.filter((s) => Math.abs(s.artic) > 0.05)
  expect(turning.length).toBeGreaterThan(0) // the tractor swung about the fifth wheel
  expect(turning.every((s) => Math.sign(s.artic) === Math.sign(s.steer))).toBe(true)
  expect(samples.every((s) => Math.abs(s.artic) <= (40 * Math.PI) / 180 + 1e-6 && Math.abs(s.steer) <= (35 * Math.PI) / 180 + 1e-6)).toBe(true)

  // A box on a chassis sits on the model's twist-lock attach point (centre of the box on the pins, bottom on the deck).
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'TruckAtStall' }))
  await page.waitForFunction(() => Object.values(window.__tt!.sceneState()?.truckRigs ?? {}).length > 0)
  const check = await page.evaluate(async () => {
    const tt = window.__tt!
    const boxes = (await tt.query<{ id: string; custody: { kind: string; id: string } }[]>('containers')).filter((b) => b.custody.kind === 'truck')
    const lv = tt.sceneState()!.liveries
    const rigs = tt.sceneState()!.truckRigs
    return boxes
      .filter((b) => rigs[b.custody.id] && lv[b.id])
      .map((b) => ({ size: lv[b.id].size, box: lv[b.id].centre, attach: rigs[b.custody.id].loadCentre, offset: rigs[b.custody.id].loadOffsetM }))
  })
  expect(check.length).toBeGreaterThan(0)
  for (const c of check) {
    expect(Math.hypot(c.box.x - c.attach[0], c.box.z - c.attach[2])).toBeLessThan(0.01)
    expect(c.box.y - (c.size === '20' ? 2.591 : c.size === '40' ? 2.591 : 2.896) / 2).toBeCloseTo(1.3, 2) // bottom on the deck
  }
  expect(errors).toEqual([])
})

test('the asset viewer rolls and steers the wheels, articulates the chassis and seats 20 ft and 40 ft boxes on the twist-locks', async ({ page }) => {
  const { errors, external } = watch(page)
  await page.goto('/sim/terminal-twin?viewer=truck-cab-mid')
  await page.waitForFunction(() => !!window.__ttAssets)
  const list = await page.evaluate(() => window.__ttAssets!.list())
  for (const n of ['truck-cab-high', 'truck-cab-mid', 'truck-cab-day', 'truck-chassis']) expect(list).toContain(n)

  const first = await page.evaluate(() => window.__ttAssets!.show('truck-cab-mid', { lod: 'LOD0' }))
  expect(first.kind).toBe('truck')
  expect(first.lods.LOD0.triangles).toBeLessThanOrEqual(8000)
  expect(first.lods.LOD1.triangles).toBeLessThanOrEqual(2000)
  expect(first.lods.LOD2.triangles).toBeLessThanOrEqual(300)
  const nodes = first.rig.map((r) => r.node)
  for (const n of ['wheel_fl', 'wheel_r', 'wheel_t1', 'steer_fl', 'steer_fr', 'fifth_wheel']) expect(nodes).toContain(n)

  // Rolling and steering values reach every LOD; the fifth wheel swings the front axle round the kingpin.
  const before = (await page.evaluate(() => window.__ttAssets!.pose()))!
  const rolled = await page.evaluate(() => window.__ttAssets!.setRig('wheel_t2', 120))
  expect(rolled.rigValues.wheel_t2).toBe(120)
  const steered = await page.evaluate(() => window.__ttAssets!.setRig('steer_fl', 25))
  expect(steered.rigValues.steer_fl).toBe(25)
  await page.evaluate(() => window.__ttAssets!.setRig('fifth_wheel', 30))
  const after = (await page.evaluate(() => window.__ttAssets!.pose()))!
  const king = before.nodes.fifth_wheel
  const radius = (p: number[]) => Math.hypot(p[0] - king[0], p[2] - king[2])
  expect(Math.hypot(after.nodes.steer_fl[0] - before.nodes.steer_fl[0], after.nodes.steer_fl[2] - before.nodes.steer_fl[2])).toBeGreaterThan(1) // the cab end swung sideways
  expect(radius(after.nodes.steer_fl)).toBeCloseTo(radius(before.nodes.steer_fl), 2) // about the kingpin
  expect(after.nodes.fifth_wheel[0]).toBeCloseTo(king[0], 4)
  expect(after.nodes.wheel_t1).toEqual(before.nodes.wheel_t1) // the chassis stays put
  await page.evaluate(() => window.__ttAssets!.setRig('fifth_wheel', 0))

  // Reference boxes on the chassis: bottom on the deck, casting centres on the sidecar's pins.
  for (const [mode, count] of [['40', 1], ['20front', 1], ['20rear', 1], ['20twin', 2]] as const) {
    const s = await page.evaluate((m) => window.__ttAssets!.setLoad(m), mode)
    expect(s.load!.boxes).toHaveLength(count)
    expect(s.load!.onPins).toBe(true)
    expect(s.load!.maxPinErrorM).toBeLessThan(0.002)
    for (const b of s.load!.boxes) expect(b.bottomY).toBeCloseTo(1.3, 3)
  }
  await page.evaluate(() => window.__ttAssets!.setLoad('40'))
  await page.waitForTimeout(300)
  await page.screenshot({ path: '.screenshots/assets/truck-viewer.png' })

  // The chassis alone, every cab shape and every LOD show without errors.
  for (const name of ['truck-chassis', 'truck-cab-high', 'truck-cab-day']) {
    const s = await page.evaluate((n) => window.__ttAssets!.show(n, { lod: 'LOD0' }), name)
    expect(s.load).not.toBeNull()
    for (const lod of ['LOD1', 'LOD2'] as const) expect((await page.evaluate((l) => window.__ttAssets!.setLod(l), lod)).shownLod).toBe(lod)
  }
  expect(external).toEqual([])
  expect(errors).toEqual([])
})

/**
 * TT-23 STS model in the browser (seam 3 + seam 4): the dev asset viewer's
 * rig sliders drive the crane, a reference container hangs under the
 * spreader at true scale, and the twin draws every STS from the GLB with LOD
 * switching, animated from the engine's motion segments (twin-20 included).
 * Run with `npm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import meta from '../../assets/models/sts/sts-malaccamax.meta.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import type {} from '../../dev/assetViewerApi' // window.__ttAssets typing

const WATER_RAIL_Z = meta.sceneMounting.waterRailZ

function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

function near(actual: number[], expected: number[], tol = 0.01): void {
  expect(actual.length).toBe(expected.length)
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]), `[${i}] ${v} vs ${expected[i]}`).toBeLessThan(tol))
}

test('asset viewer: STS rig sliders drive gantry, trolley, hoist, spreader and boom; a 40 ft box hangs under the spreader', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/sim/terminal-twin?viewer=sts-malaccamax')
  await page.waitForFunction(() => !!window.__ttAssets)
  const shown = await page.evaluate(() => window.__ttAssets!.show('sts-malaccamax', { lod: 'LOD0' }))
  expect(shown.kind).toBe('sts')
  expect(Object.keys(shown.lods)).toEqual(['LOD0', 'LOD1', 'LOD2'])
  expect(shown.rig.map((r) => r.node)).toEqual(expect.arrayContaining(['gantry', 'trolley', 'hoist', 'spreader', 'boom', 'twin_locks']))

  await page.evaluate(() => {
    const a = window.__ttAssets!
    a.setRig('gantry', 10)
    a.setRig('trolley', -40)
    a.setRig('hoist', 30)
  })
  let pose = await page.evaluate(() => window.__ttAssets!.pose()!)
  // gantry → X, trolley → Z (from the waterside rail), hoist → spreader underside height above the rail.
  near(pose.nodes.spreader, [10, 30, -40])
  near(pose.nodes.trolley, [10, meta.geometry.trolleyRailHeightM.value, -40])
  expect(pose.stretch.ropes).toBeCloseTo(meta.geometry.trolleyRailHeightM.value - 30 - meta.stretch[0].offsetM, 2)
  // Reference: a 40 ft ISO box hanging from the spreader, its top centre at the attach point.
  expect(pose.reference.hangingFrom).toBe('spreader')
  near(pose.reference.size, [12.192, 2.591, 2.438], 0.001)
  near(pose.reference.topCentre, [10, 30, -40])

  // Telescopes to 40 ft: the fore twist-locks reach the 40 ft casting centres; twin-20 locks drop to the underside.
  await page.evaluate(() => {
    const a = window.__ttAssets!
    a.setRig('spreader_tele_fore', 6)
    a.setRig('spreader_tele_aft', 6)
    a.setRig('twin_locks', 1)
  })
  pose = await page.evaluate(() => window.__ttAssets!.pose()!)
  expect(pose.nodes.twistlock_fore_land[0] - 10).toBeCloseTo(12.192 / 2 - 0.089, 2)
  expect(pose.nodes.twistlock_aft_sea[0] - 10).toBeCloseTo(-(12.192 / 2 - 0.089), 2)
  expect(pose.nodes.twistlock_twin_fore_land[1]).toBeCloseTo(30, 2)

  // The same pose in LOD1 and LOD2 (each LOD has its own rig), and the box follows the shown LOD.
  for (const lod of ['LOD1', 'LOD2'] as const) {
    await page.evaluate((l) => window.__ttAssets!.setLod(l), lod)
    pose = await page.evaluate(() => window.__ttAssets!.pose()!)
    expect(pose.shownLod).toBe(lod)
    near(pose.nodes.spreader, [10, 30, -40])
    near(pose.reference.topCentre, [10, 30, -40])
  }
  await page.evaluate(() => window.__ttAssets!.setLod('LOD0'))

  // Boom up: the boom tip rises well above the apex.
  const down = (await page.evaluate(() => window.__ttAssets!.pose()!)).topY
  await page.evaluate(() => window.__ttAssets!.setRig('boom', 75))
  const up = (await page.evaluate(() => window.__ttAssets!.pose()!)).topY
  expect(down).toBeGreaterThan(meta.geometry.apexHeightM.value)
  expect(up).toBeGreaterThan(down + 20)
  await page.evaluate(() => {
    window.__ttAssets!.setRig('boom', 0)
    window.__ttAssets!.setRig('hoist', 20)
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: '.screenshots/assets/sts-viewer.png' })
  expect(errors).toEqual([])
})

test('the twin draws every STS from the GLB, switches LODs and animates it from the engine motion (twin-20 shows two boxes)', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('twin-20-lift'))
  await page.waitForFunction(() => window.__tt!.scene()?.stsAssets === 'loaded')

  // Run to the first twin-20 pick, then a few seconds into the hoist/trolley move.
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsPicked' }))
  const picked = await page.evaluate(() => window.__tt!.clock().displayTime)
  await page.evaluate((t) => window.__tt!.runTo(t + 8), picked)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
  const state = (await page.evaluate(() => window.__tt!.sceneState()))!
  const scene = (await page.evaluate(() => window.__tt!.scene()))!
  expect(scene.stsAssets).toBe('loaded')
  expect(scene.stsLods.lod0 + scene.stsLods.lod1 + scene.stsLods.lod2).toBe(scene.sts)

  for (const [id, engine] of Object.entries(state.sts)) {
    const drawn = state.stsRendered[id]
    expect(drawn, id).toBeDefined()
    // The model's spreader is where the engine's motion segments put it.
    near(drawn.spreader, [engine.gantryX, engine.hoistY, engine.trolleyZ], 0.02)
    near(drawn.trolley, [engine.gantryX, meta.geometry.trolleyRailHeightM.value, engine.trolleyZ], 0.02)
  }
  const onSpreader = Object.entries(state.containers).filter(([, owner]) => owner?.kind === 'sts')
  expect(onSpreader).toHaveLength(2)
  const craneId = onSpreader[0][1]!.id
  expect(state.stsRendered[craneId].spreaderMode).toBe('twin-20')
  expect(state.stsRendered[craneId].carrying).toBe(2)

  // LOD switching: close (at the boxes on the spreader) = LOD0, far = LOD2.
  await page.evaluate((box) => window.__tt!.cameraTo(box, 40), onSpreader[0][0])
  await page.waitForFunction((id) => window.__tt!.sceneState()!.stsRendered[id].lod === 0, craneId)
  await page.waitForTimeout(400)
  await page.screenshot({ path: '.screenshots/assets/twin-sts-twin20.png' })
  await page.evaluate((id) => window.__tt!.cameraTo(id, 2000), craneId)
  await page.waitForFunction((id) => window.__tt!.sceneState()!.stsRendered[id].lod === 2, craneId)
  expect(errors).toEqual([])
})

test('eight STS on a long quay stay within the overview triangle and draw-call budget', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('crane-split-4sts', { overrides: { stsCount: 8, quayLengthM: 850 } }))
  await page.waitForFunction(() => window.__tt!.scene()?.stsAssets === 'loaded')
  await page.evaluate(() => window.__tt!.runTo(900))
  await page.evaluate(() => window.__tt!.cameraTo('STS04', 700))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await page.waitForTimeout(500)
  const scene = (await page.evaluate(() => window.__tt!.scene()))!
  expect(scene.sts).toBe(8)
  console.log(`overview: ${JSON.stringify({ render: scene.render, stsLods: scene.stsLods })}`)
  // Spec overview budget: under ~1.5M rendered triangles and a few hundred draw calls (main + shadow pass).
  expect(scene.render.triangles).toBeLessThan(1_500_000)
  expect(scene.render.calls).toBeLessThan(400)
  await page.screenshot({ path: '.screenshots/assets/twin-sts-overview.png' })
  expect(errors).toEqual([])
  expect(WATER_RAIL_Z).toBe(3)
})

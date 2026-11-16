/**
 * Hero equipment (#273): close to a spreader the hero spreader model replaces the rig's own, never above the quality
 * level's cap (High 3), and none on Low or from the `equipment-hero-off` rung down. No hero spreader file is requested
 * before a camera is close to a spreader. Every test fails on a page error or a console error, so a shader compile or
 * WebGL program error in the dither fade fails it. The hero spreader's world bounds are compared with the rig spreader's
 * (`__tt.scene().heroSpreaders`): same place, same length (also squeezed to 20 ft), same twistlock plane.
 * The hero SHC body (#275): following an SHC with the camera within 30 m of its centre attaches one body on High
 * (`__tt.scene().heroShcBodies`, counted in `stats.heroEquipment`) and none on Low; `hero-shc.glb` is not requested before.
 * Counts and bounds only, no frame assertions. Screenshots go to `.screenshots/`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const HIGH_CAP = 3
const HERO_FILE = /hero-spreader-(sts|asc|shc)|hero-shc\./
/** The hero model adds raised flippers and corner guides at the ends; its length stays within this of the rig spreader's. */
const LENGTH_TOLERANCE_M = 0.6
const CENTRE_TOLERANCE_M = 0.15

interface Watch {
  errors: string[]
  heroRequests: string[]
}

function watch(page: Page): Watch {
  const w: Watch = { errors: [], heroRequests: [] }
  page.on('console', (msg) => {
    if (msg.type() === 'error') w.errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => w.errors.push(`pageerror: ${err.message}`))
  page.on('request', (r) => {
    if (HERO_FILE.test(r.url())) w.heroRequests.push(r.url())
  })
  return w
}

async function open(page: Page, fixture: string): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.evaluate((name) => window.__tt!.load(name), fixture)
}

/** Parks the camera (13 m away unless told otherwise) at a point and waits until the hero spreader there is attached and faded in. */
async function closeUp(page: Page, target: { x: number; y: number; z: number }, azimuth = 0.6, distance = 13, polar = 1.25): Promise<void> {
  await page.evaluate(([t, a, d, p]) => window.__tt!.setCameraPose({ target: t, distance: d, azimuth: a, polar: p }), [target, azimuth, distance, polar] as const)
  await page.waitForFunction(() => window.__tt!.heroSettled() && window.__tt!.perf().stats.heroEquipment > 0, undefined, { timeout: 150_000 })
  // a frame after the fade has hidden the rig spreader
  await page.waitForFunction(() => window.__tt!.scene()!.heroSpreaders.every((s) => !s.fading && s.rigHidden), undefined, { timeout: 60_000 })
}

type Bounds = { min: [number, number, number]; max: [number, number, number] }
const size = (b: Bounds, axis: number): number => b.max[axis] - b.min[axis]
const centre = (b: Bounds, axis: number): number => (b.max[axis] + b.min[axis]) / 2
const longAxis = (b: Bounds): number => (size(b, 0) > size(b, 2) ? 0 : 2)

/** The hero spreader sits where the rig spreader is: same long axis, length and centre, same underside (the twistlock plane). */
function expectInPlace(s: { id: string; hero: Bounds; rig: Bounds }): void {
  const long = longAxis(s.rig)
  const across = long === 0 ? 2 : 0
  console.log(`hero spreader ${s.id}: hero ${JSON.stringify(s.hero)} rig ${JSON.stringify(s.rig)}`)
  expect(longAxis(s.hero), `${s.id} long axis`).toBe(long)
  expect(size(s.hero, long), `${s.id} length`).toBeGreaterThan(size(s.rig, long) - LENGTH_TOLERANCE_M)
  expect(size(s.hero, long), `${s.id} length`).toBeLessThan(size(s.rig, long) + LENGTH_TOLERANCE_M)
  expect(Math.abs(centre(s.hero, long) - centre(s.rig, long)), `${s.id} centre along`).toBeLessThan(CENTRE_TOLERANCE_M)
  expect(Math.abs(centre(s.hero, across) - centre(s.rig, across)), `${s.id} centre across`).toBeLessThan(CENTRE_TOLERANCE_M)
  expect(Math.abs(s.hero.min[1] - s.rig.min[1]), `${s.id} underside`).toBeLessThan(CENTRE_TOLERANCE_M)
}

test('ASC close-up: hero spreaders within the High cap, none requested before, none on Low or below equipment-hero-off', async ({ page }) => {
  test.slow() // software WebGL
  const w = watch(page)
  await open(page, 'yard-no-mixed-length')
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded' && window.__tt!.scene()?.containerAssets === 'loaded')
  await page.evaluate(() => window.__tt!.runTo(300))
  await page.evaluate(() => window.__tt!.pause())
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__tt!.perf().stats.heroEquipment)).toBe(0)
  expect(w.heroRequests).toEqual([])

  const asc = await page.evaluate(() => {
    const s = window.__tt!.sceneState()!
    const ids = Object.keys(s.ascs)
    const id = ids.find((i) => s.ascRigs[i]?.carrying) ?? ids[0]
    return { id, ...s.ascs[id] }
  })
  await closeUp(page, { x: asc.x, y: asc.hoistY + 1.5, z: asc.z })
  const near = await page.evaluate(() => ({ count: window.__tt!.perf().stats.heroEquipment, spreaders: window.__tt!.scene()!.heroSpreaders }))
  expect(near.count).toBeGreaterThanOrEqual(1)
  expect(near.count).toBeLessThanOrEqual(HIGH_CAP)
  expect(near.spreaders.map((s) => s.kind)).toContain('asc')
  for (const s of near.spreaders) expectInPlace(s)
  expect(w.heroRequests.length).toBeGreaterThan(0)
  expect(w.heroRequests.every((u) => u.includes('hero-spreader-asc'))).toBe(true)
  await page.keyboard.press('p')
  await expect(page.getByTestId('tt-perf-hero-equipment')).toContainText(String(near.count))
  await page.screenshot({ path: '.screenshots/hero-equipment-asc.png' })

  // Low draws none and shows the rig spreader again
  await page.evaluate(() => window.__tt!.setQuality('low'))
  await page.waitForFunction(() => window.__tt!.perf().stats.heroEquipment === 0, undefined, { timeout: 60_000 })
  expect(await page.evaluate(() => window.__tt!.scene()!.heroSpreaders)).toEqual([])

  // Auto: the top rung draws them, the equipment-hero-off rung does not. Software WebGL is far slower than Auto's
  // thresholds: keep Auto from stepping on its own so the forced rung holds
  await page.evaluate(() => window.__tt!.setAutoRung(0))
  await page.evaluate(() => window.__tt!.setAutoThresholds({ down: 0.1, up: 1000 }))
  await page.waitForFunction(() => window.__tt!.heroSettled() && window.__tt!.perf().stats.heroEquipment > 0, undefined, { timeout: 150_000 })
  expect((await page.evaluate(() => window.__tt!.perf())).rungName).toBe('hero-full')
  await page.evaluate(() => window.__tt!.setAutoRung(1))
  await page.waitForFunction(() => window.__tt!.perf().stats.heroEquipment === 0, undefined, { timeout: 60_000 })
  expect((await page.evaluate(() => window.__tt!.perf())).rungName).toBe('equipment-hero-off')
  expect(w.errors).toEqual([])
})

test('STS close-up: the hero spreader is in place on the crane rig', async ({ page }) => {
  test.slow() // software WebGL
  const w = watch(page)
  await open(page, 'twin-20-lift')
  await page.waitForFunction(() => window.__tt!.scene()?.stsAssets === 'loaded')
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'StsPicked' }))
  const picked = await page.evaluate(() => window.__tt!.clock().displayTime)
  await page.evaluate((t) => window.__tt!.runTo(t + 8), picked)
  await page.evaluate(() => window.__tt!.pause())
  expect(w.heroRequests).toEqual([])
  const sts = await page.evaluate(() => {
    const s = window.__tt!.sceneState()!
    const id = Object.values(s.containers).find((c) => c?.kind === 'sts')?.id ?? Object.keys(s.sts)[0]
    return { id, ...s.sts[id] }
  })
  await closeUp(page, { x: sts.gantryX, y: sts.hoistY + 1, z: sts.trolleyZ }, 0.9)
  const mine = (await page.evaluate(() => window.__tt!.scene()!.heroSpreaders)).find((s) => s.id === sts.id)
  expect(mine?.kind).toBe('sts')
  expectInPlace(mine!)
  await page.screenshot({ path: '.screenshots/hero-equipment-sts.png' })
  expect(w.errors).toEqual([])
})

test('SHC and ASC carrying a 20 ft box: the hero spreader is squeezed to 20 ft like the rig spreader', async ({ page }) => {
  test.slow() // software WebGL
  const w = watch(page)
  await open(page, 'asc-1sts-10-boxes-1block') // 20 ft and 40 ft boxes mixed, STS to SHC to WTP pad to ASC
  await page.waitForFunction(() => window.__tt!.scene()?.ascAssets === 'loaded' && window.__tt!.scene()?.shcAssets === 'loaded')
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  for (const kind of ['shc', 'asc'] as const) {
    // step the sim until a carrier of this kind holds a 20 ft box (the pair of 20s comes at about 735 s)
    let found: { id: string; x: number; y: number; z: number } | null = null
    const from = await page.evaluate(() => window.__tt!.clock().displayTime)
    for (let t = Math.max(Math.floor(from) + 5, 600); t < 1500 && !found; t += 5) {
      await page.evaluate((to) => window.__tt!.runTo(to), t)
      await page.evaluate(() => window.__tt!.pause())
      const frames = (await page.evaluate(() => window.__tt!.scene()?.frames ?? 0)) + 2
      await page.waitForFunction((n) => (window.__tt!.scene()?.frames ?? 0) > n, frames)
      found = await page.evaluate((k) => {
        const s = window.__tt!.sceneState()!
        const rigs = k === 'shc' ? s.shcRigs : s.ascRigs
        const id = Object.keys(rigs).find((i) => rigs[i].carrying && rigs[i].spreaderLengthM < 7)
        if (!id) return null
        if (k === 'shc') return { id, x: s.shcs[id].x, y: s.shcs[id].lift + 3.5, z: s.shcs[id].z }
        return { id, x: s.ascs[id].x, y: s.ascs[id].hoistY + 1.5, z: s.ascs[id].z }
      }, kind)
    }
    expect(found, `${kind} carried a 20 ft box`).not.toBeNull()
    // the SHC spreader hangs inside the portal: look along the tunnel from one end, closer in
    if (kind === 'shc') await closeUp(page, found!, 1.25, 8, 1.3)
    else await closeUp(page, found!)
    const mine = (await page.evaluate(() => window.__tt!.scene()!.heroSpreaders)).find((s) => s.id === found!.id)
    expect(mine?.kind).toBe(kind)
    expectInPlace(mine!)
    expect(size(mine!.hero, longAxis(mine!.rig)), `${kind} hero spreader at 20 ft`).toBeLessThan(7)
    await page.screenshot({ path: `.screenshots/hero-equipment-${kind}-20ft.png` })
  }
  expect(w.errors).toEqual([])
})

test('SHC close-up: the hero SHC body replaces LOD0 on High, none requested before, none on Low', async ({ page }) => {
  test.slow() // software WebGL
  const w = watch(page)
  await open(page, 'shc-1sts-2shc-1wtp')
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcRoutingLoaded' }))
  await page.evaluate(() => window.__tt!.pause())
  await page.waitForFunction(() => window.__tt!.scene()?.shcAssets === 'loaded')
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__tt!.scene()!.heroShcBodies)).toEqual([])
  expect(w.heroRequests).toEqual([])

  const shc = await page.evaluate(() => {
    const s = window.__tt!.sceneState()!
    const ids = Object.keys(s.shcs).sort()
    const id = ids.find((i) => s.shcRigs[i]?.carrying) ?? ids[0]
    return { id, x: s.shcs[id].x, z: s.shcs[id].z }
  })
  await page.evaluate((id) => window.__tt!.select(id), shc.id)
  // about 18 m from the body's centre (half its 15 m height up), inside the 30 m hero distance
  await page.evaluate((t) => window.__tt!.setCameraPose({ target: t, distance: 18, azimuth: 0.7, polar: 1.2 }), { x: shc.x, y: 7, z: shc.z })
  await page.waitForFunction(() => window.__tt!.heroSettled() && window.__tt!.scene()!.heroShcBodies.length > 0, undefined, { timeout: 150_000 })
  await page.waitForFunction(() => window.__tt!.scene()!.heroShcBodies.every((b) => !b.fading && b.rigHidden), undefined, { timeout: 60_000 })
  const near = await page.evaluate(() => ({ stats: window.__tt!.perf().stats.heroEquipment, bodies: window.__tt!.scene()!.heroShcBodies }))
  console.log(`hero SHC bodies: ${JSON.stringify(near.bodies)}`)
  expect(near.bodies.length).toBeGreaterThanOrEqual(1)
  expect(near.bodies.map((b) => b.kind)).toContain('shc-body')
  expect(near.bodies.map((b) => b.id)).toContain(shc.id)
  expect(near.stats).toBeGreaterThanOrEqual(1)
  expect(w.heroRequests.some((u) => u.includes('hero-shc.'))).toBe(true)
  await page.screenshot({ path: '.screenshots/hero-equipment-shc-body.png' })

  // Low draws no body and shows LOD0 again
  await page.evaluate(() => window.__tt!.setQuality('low'))
  await page.waitForFunction(() => window.__tt!.scene()!.heroShcBodies.length === 0 && window.__tt!.perf().stats.heroEquipment === 0, undefined, { timeout: 60_000 })
  expect(w.errors).toEqual([])
})

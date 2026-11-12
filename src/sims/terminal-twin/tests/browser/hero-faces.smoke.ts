/**
 * Hero level (#258): at the overview no hero face is drawn and no hero model has been requested; at a 10 m camera on a
 * yard block the visible faces are drawn at hero level, never above the quality level's cap (3 faces per box: High 96,
 * Medium 36); Low draws none and requests none. Counts only, no frame assertions. Screenshots go to `.screenshots/`.
 * Arrival (#259): a fast fly-through at 10 m prepares no hero face; once the camera is still the faces arrive and
 * their count settles within the cap.
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

for (const [level, cap] of [
  ['high', 96],
  ['medium', 36],
  ['low', 0],
] as const) {
  test(`${level}: hero faces within the cap at 10 m, none at the overview`, async ({ page }) => {
    test.slow() // software WebGL
    const heroRequests: string[] = []
    page.on('request', (r) => {
      if (/hero-(20|40|40hc)-(side|door|front|roof)/.test(r.url())) heroRequests.push(r.url())
    })
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('/sim/terminal-twin')
    await page.waitForFunction(() => !!window.__tt)
    await page.evaluate(() => window.localStorage.clear())
    await page.evaluate((l) => window.__tt!.setQuality(l), level)
    await page.evaluate(() => window.__tt!.load('yard-no-mixed-length'))
    await page.evaluate(() => window.__tt!.runTo(60))
    await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')

    await page.evaluate(() => window.__tt!.viewPreset('overview'))
    await page.waitForTimeout(800)
    expect(await page.evaluate(() => window.__tt!.perf().stats.heroFaces)).toBe(0)
    expect(heroRequests).toEqual([])

    await page.evaluate(() => window.__tt!.cameraTo('B01', 10))
    if (cap === 0) {
      await page.waitForFunction(() => window.__tt!.perf().stats.closeupFaces > 0)
      await page.waitForTimeout(1500)
      expect(await page.evaluate(() => window.__tt!.perf().stats.heroFaces)).toBe(0)
      expect(heroRequests).toEqual([])
    } else {
      await page.waitForFunction(() => window.__tt!.perf().stats.heroFaces > 0, undefined, { timeout: 60_000 })
      await page.waitForTimeout(800)
      const near = await page.evaluate(() => window.__tt!.perf().stats)
      expect(near.heroFaces).toBeGreaterThan(0)
      expect(near.heroFaces).toBeLessThanOrEqual(cap)
      expect(heroRequests.length).toBeGreaterThan(0)
      await page.screenshot({ path: `.screenshots/hero-yard-${level}.png` })
    }
    expect(errors).toEqual([])
  })
}

test('Auto ladder (#261): hero faces drawn fall with the hero cap rungs, marks go standard, none at hero-off', async ({ page }) => {
  test.slow() // software WebGL
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.__tt!.setAutoRung(0))
  await page.evaluate(() => window.__tt!.load('yard-no-mixed-length'))
  await page.evaluate(() => window.__tt!.runTo(60))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')
  await page.evaluate(() => window.__tt!.cameraTo('B01', 10))
  await page.waitForFunction(() => window.__tt!.perf().stats.heroFaces > 0, undefined, { timeout: 60_000 })
  // wait until the count stops growing at the full cap
  let faces = await page.evaluate(() => window.__tt!.perf().stats.heroFaces)
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000)
    const next = await page.evaluate(() => window.__tt!.perf().stats.heroFaces)
    if (next === faces) break
    faces = next
  }
  const full = faces
  expect(full).toBeGreaterThan(24) // more than the quarter cap (8 boxes, 24 faces) allows
  expect(await page.evaluate(() => window.__tt!.scene()!.containerLods.heroMarkStep)).toBe('sharp')

  const at = async (rung: number) => {
    await page.evaluate((r) => window.__tt!.setAutoRung(r), rung)
    await page.waitForTimeout(3000)
    return page.evaluate(() => ({ faces: window.__tt!.perf().stats.heroFaces, step: window.__tt!.scene()!.containerLods.heroMarkStep, name: window.__tt!.perf().rungName }))
  }
  const quarter = await at(2)
  expect(quarter.name).toBe('hero-quarter')
  expect(quarter.faces).toBeGreaterThan(0)
  expect(quarter.faces).toBeLessThanOrEqual(24)
  expect(quarter.faces).toBeLessThan(full)
  expect(quarter.step).toBe('sharp')
  const marks = await at(3)
  expect(marks.step).toBe('standard')
  expect(marks.faces).toBeLessThanOrEqual(24)
  const off = await at(4)
  expect(off.faces).toBe(0)
  // and back up: the cap and the sharp markings return in reverse
  const back = await at(0)
  expect(back.step).toBe('sharp')
  expect(errors).toEqual([])
})

test('arrival: nothing is prepared during a fast fly-through, faces arrive once the camera settles', async ({ page }) => {
  test.slow() // software WebGL
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.localStorage.clear())
  await page.evaluate(() => window.__tt!.setQuality('high'))
  await page.evaluate(() => window.__tt!.load('yard-no-mixed-length'))
  await page.evaluate(() => window.__tt!.runTo(60))
  await page.waitForFunction(() => window.__tt!.scene()?.containerAssets === 'loaded')
  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  await page.waitForTimeout(800)

  // a fast fly-through: the camera swings between 10 m and 120 m every frame (software WebGL frames take a second or more, so
  // 110 m per frame is still tens of m/s, far above the speed threshold)
  const flown = await page.evaluate(
    () =>
      new Promise<{ prepared: number; faces: number }>((resolve) => {
        let frames = 0
        const step = () => {
          window.__tt!.cameraTo('B01', frames % 2 ? 10 : 120)
          if (++frames < 12) requestAnimationFrame(step)
          else {
            const c = window.__tt!.scene()!.containerLods
            resolve({ prepared: c.heroPrepared, faces: c.heroFaces })
          }
        }
        requestAnimationFrame(step)
      }),
  )
  expect(flown).toEqual({ prepared: 0, faces: 0 })

  // parked at 10 m: after the settle time the faces are prepared and drawn, within the cap, and the count stops growing
  await page.evaluate(() => window.__tt!.cameraTo('B01', 10))
  await page.waitForFunction(() => window.__tt!.scene()!.containerLods.heroFaces > 0, undefined, { timeout: 60_000 })
  // frames take seconds in software WebGL and each prepares a few faces: wait until the count stops growing
  let c1 = await page.evaluate(() => window.__tt!.scene()!.containerLods)
  let c2 = c1
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(4000)
    c2 = await page.evaluate(() => window.__tt!.scene()!.containerLods)
    if (c2.heroPrepared === c1.heroPrepared) break
    c1 = c2
  }
  expect(c2.heroFaces).toBeGreaterThan(0)
  expect(c2.heroFaces).toBeLessThanOrEqual(96)
  expect(c2.heroFaces).toBe(c1.heroFaces)
  expect(c2.heroPrepared).toBeGreaterThanOrEqual(c2.heroFaces)
  expect(c2.heroPrepared).toBe(c1.heroPrepared)
  expect(errors).toEqual([])
})

/**
 * #125 browser smoke tests: gantry alarm and amber beacons. Cranes sound the alarm and flash their beacons only while
 * they gantry, the alarm is louder near the camera, and it follows the shared volume and mute. Run with
 * `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'asc-1sts-10-boxes-1block'
/** The harbour ambience's voice (#129): always on and faint, whatever the cranes do. */
const AMBIENCE = 'harbourAmbience:harbour'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
}

/** Play until a crane is gantrying (the sim clock runs, so the display time reaches a gantry segment). */
async function playUntilGantrying(page: Page): Promise<string> {
  await page.evaluate(() => {
    window.__tt!.setSpeed(5)
    window.__tt!.play()
  })
  await page.waitForFunction(
    () => {
      const s = window.__tt!.sceneState()
      return !!s && [...Object.entries(s.sts), ...Object.entries(s.ascs)].some(([, v]) => v.gantrying)
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  )
  return page.evaluate(() => {
    const s = window.__tt!.sceneState()!
    return [...Object.entries(s.sts), ...Object.entries(s.ascs)].find(([, v]) => v.gantrying)![0]
  })
}

test('beacons flash only on cranes that are gantrying, and the alarm voice follows the camera', async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  // stopped at the start: no beacons, no machine voices (the harbour ambience may already play, faintly)
  let scene = (await page.evaluate(() => window.__tt!.scene()))!
  expect(scene.gantryBeacons).toEqual({ gantrying: [], lit: [] })
  expect((await page.evaluate(() => window.__tt!.atmosphere())).positional.voices.filter((v) => v.key !== AMBIENCE)).toEqual([])

  const id = await playUntilGantrying(page)
  await page.evaluate((e) => window.__tt!.cameraTo(e, 60), id)

  // the beacons are active for exactly the gantrying machines and flash (lit on, then off)
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lit?: { on: boolean; off: boolean } }
      const lit = (w.__lit ??= { on: false, off: false })
      const s = window.__tt!.scene()!.gantryBeacons
      if (s.gantrying.length > 0) {
        if (s.lit.length > 0) lit.on = true
        else lit.off = true
      }
      return lit.on && lit.off
    },
    undefined,
    { timeout: 15_000, polling: 50 },
  )
  scene = (await page.evaluate(() => window.__tt!.scene()))!
  const state = (await page.evaluate(() => window.__tt!.sceneState()))!
  const gantrying = [...Object.entries(state.sts), ...Object.entries(state.ascs)].filter(([, v]) => v.gantrying).map(([k]) => k)
  expect(scene.gantryBeacons.gantrying.sort()).toEqual(gantrying.sort())
  expect(scene.gantryBeacons.lit.every((l) => scene.gantryBeacons.gantrying.includes(l))).toBe(true)

  // audible near the camera
  await page.waitForFunction((e) => window.__tt!.atmosphere().positional.voices.some((v) => v.key === `gantryAlarm:${e}`), id, { timeout: 15_000 })
  const near = (await page.evaluate(() => window.__tt!.atmosphere())).positional.voices.find((v) => v.key === `gantryAlarm:${id}`)!
  expect(near.gain).toBeGreaterThan(0.2)

  // pausing stops the crane: no beacons, no machine voices (the ambience stays)
  await page.evaluate(() => window.__tt!.pause())
  await page.waitForFunction(() => window.__tt!.atmosphere().positional.voices.every((v) => v.key === 'harbourAmbience:harbour') && window.__tt!.scene()!.gantryBeacons.gantrying.length === 0, undefined, { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('the alarm is quiet when far and silent when muted', async ({ page }) => {
  await open(page)
  const id = await playUntilGantrying(page)
  await page.evaluate((e) => window.__tt!.cameraTo(e, 60), id)
  await page.waitForFunction((e) => window.__tt!.atmosphere().positional.voices.some((v) => v.key === `gantryAlarm:${e}`), id, { timeout: 15_000 })
  const near = (await page.evaluate(() => window.__tt!.atmosphere())).positional.voices.find((v) => v.key === `gantryAlarm:${id}`)!.gain

  await page.evaluate(() => window.__tt!.viewPreset('overview'))
  await page.waitForTimeout(500)
  const far = (await page.evaluate(() => window.__tt!.atmosphere())).positional.voices.find((v) => v.key === `gantryAlarm:${id}`)?.gain ?? 0
  expect(far).toBeLessThan(near)

  await page.evaluate((e) => window.__tt!.cameraTo(e, 60), id)
  await page.getByTestId('audio-button').click()
  await page.getByTestId('audio-mute').click()
  await page.waitForFunction(() => window.__tt!.atmosphere().positional.voices.length === 0, undefined, { timeout: 10_000 })
  expect((await page.evaluate(() => window.__tt!.atmosphere())).soundGain).toBe(0)
})

/**
 * #125 browser smoke tests: the gantry alarm. Cranes sound the alarm only while they gantry, it is louder near the
 * camera, and it follows the shared volume and mute. The amber beacons (on for exactly the gantrying cranes, flashing,
 * off when paused) are checked in the headless scene (`headless-scene-equipment.test.ts`, #337). Run with
 * `pnpm run test:smoke`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

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
  await openTwin(page, { scenario: FIXTURE })
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
  // Terminal Twin opens muted (#171); the alarm voices only exist once the sound is on
  const speaker = page.getByTestId('audio-button')
  if ((await speaker.getAttribute('aria-pressed')) === 'true') await speaker.click()
  await expect(speaker).toHaveAttribute('aria-pressed', 'false')
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

test('the alarm voice sounds only while a crane gantries and follows the camera', { tag: '@equipment' }, async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  // stopped at the start: no machine voices (the harbour ambience may already play, faintly)
  expect((await page.evaluate(() => window.__tt!.atmosphere())).positional.voices.filter((v) => v.key !== AMBIENCE)).toEqual([])

  const id = await playUntilGantrying(page)
  await page.evaluate((e) => window.__tt!.cameraTo(e, 60), id)

  // audible near the camera: poll, since cameraTo eases over several frames and the gain follows the camera (frame-loop read)
  await expect
    .poll(async () => (await page.evaluate(() => window.__tt!.atmosphere())).positional.voices.find((v) => v.key === `gantryAlarm:${id}`)?.gain ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0.2)

  // pausing stops the crane: no machine voices (the ambience stays)
  await page.evaluate(() => window.__tt!.pause())
  await page.waitForFunction(() => window.__tt!.atmosphere().positional.voices.every((v) => v.key === 'harbourAmbience:harbour'), undefined, { timeout: 10_000 })
  expect(errors).toEqual([])
})

test('the alarm is quiet when far and silent when muted', { tag: '@equipment' }, async ({ page }) => {
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
  await page.waitForFunction(() => window.__tt!.atmosphere().positional.voices.length === 0, undefined, { timeout: 10_000 })
  expect((await page.evaluate(() => window.__tt!.atmosphere())).soundGain).toBe(0)
})

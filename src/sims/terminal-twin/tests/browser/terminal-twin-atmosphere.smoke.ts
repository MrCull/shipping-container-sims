/**
 * Atmosphere and polish (TT-21): day/night, daylight lock, backdrops, sound, departure banner.
 * Seam: UI + dev API `window.__tt` (`__tt.atmosphere()`). Run with `npm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const TRACER = 'tracer-1sts-10-boxes'

test.use({ timezoneId: 'UTC' })

/** Count every `new Audio(...)` the page makes (the sound toggle is off by default: expect none). */
async function spyOnAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __audioCreated: number; Audio: unknown }
    w.__audioCreated = 0
    w.Audio = class {
      volume = 1
      constructor() {
        w.__audioCreated++
      }
      play() {
        return Promise.resolve()
      }
      pause() {}
    }
  })
}

async function open(page: Page, name: string, startDateTime: string): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(([n, start]) => window.__tt!.load(n, { startDateTime: start }), [name, startDateTime] as const)
  await page.waitForFunction(() => window.__tt!.atmosphere().scene !== null)
}

const atmosphere = (page: Page) => page.evaluate(() => window.__tt!.atmosphere())

test('the sun follows the sim clock: day at 13:00, cheaper night mode at 02:00', async ({ page }) => {
  await open(page, TRACER, '2026-10-26T13:00:00.000Z')
  let a = await atmosphere(page)
  expect(a.scene).toMatchObject({ mode: 'day', shadows: true, masts: 0, equipmentLights: 0 })

  await open(page, TRACER, '2026-10-26T02:00:00.000Z')
  await page.evaluate(() => window.__tt!.step())
  a = await atmosphere(page)
  expect(a.scene).toMatchObject({ mode: 'night', shadows: false })
  expect(a.scene!.masts).toBeGreaterThan(0)
  expect(a.scene!.equipmentLights).toBeGreaterThan(0)
})

test('lock to daylight holds daylight at night', async ({ page }) => {
  await open(page, TRACER, '2026-10-26T02:00:00.000Z')
  expect((await atmosphere(page)).lockDaylight).toBe(false)
  await page.getByTestId('tt-daylight-toggle').click()
  await expect.poll(async () => (await atmosphere(page)).scene?.mode).toBe('day')
  expect((await atmosphere(page)).scene).toMatchObject({ shadows: true, masts: 0 })
})

test('night mode costs no more draw calls than day', async ({ page }) => {
  const calls = async (start: string): Promise<number> => {
    await open(page, TRACER, start)
    await page.evaluate(() => window.__tt!.runTo(300))
    const f0 = (await page.evaluate(() => window.__tt!.scene()))!.frames
    await page.waitForFunction((n) => window.__tt!.scene()!.frames > n + 2, f0)
    return (await page.evaluate(() => window.__tt!.scene()))!.render.calls
  }
  const day = await calls('2026-10-26T13:00:00.000Z')
  const night = await calls('2026-10-26T01:00:00.000Z')
  // no shadow pass at night, plus two glow draws
  expect(night).toBeLessThanOrEqual(day + 2)
})

test('the Algeciras backdrop shows for the TTI preset only', async ({ page }) => {
  await open(page, 'TTI Algeciras baseline', '2026-10-26T13:00:00.000Z')
  let a = await atmosphere(page)
  expect(a.scene!.backdrop.kind).toBe('tti')
  expect(a.scene!.backdrop.parts).toEqual(expect.arrayContaining(['rock', 'hills', 'northQuay']))

  await open(page, 'Small automated', '2026-10-26T13:00:00.000Z')
  a = await atmosphere(page)
  expect(a.scene!.backdrop.kind).toBe('generic')
  expect(a.scene!.backdrop.parts).not.toContain('rock')
})

test('sound is off by default: nothing plays, no audio is created', async ({ page }) => {
  await spyOnAudio(page)
  await open(page, TRACER, '2026-10-26T13:00:00.000Z')
  await page.evaluate(() => window.__tt!.setSpeed(60))
  await page.evaluate(() => window.__tt!.play())
  await page.waitForFunction(() => window.__tt!.clock().displayTime > 400)
  expect((await atmosphere(page)).soundOn).toBe(false)
  expect((await atmosphere(page)).sound.played).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { __audioCreated: number }).__audioCreated)).toBe(0)
})

test('with sound on, effects play, and are throttled at x600', async ({ page }) => {
  await spyOnAudio(page)
  await open(page, TRACER, '2026-10-26T13:00:00.000Z')
  await page.getByTestId('tt-sound-toggle').click()
  await page.evaluate(() => window.__tt!.setSpeed(10))
  await page.evaluate(() => window.__tt!.play())
  await page.waitForFunction(() => window.__tt!.atmosphere().sound.played > 0)
  const first = (await atmosphere(page)).sound.recent.map((s) => s.kind)
  expect(first).toContain('landed')
  expect(await page.evaluate(() => (window as unknown as { __audioCreated: number }).__audioCreated)).toBeGreaterThan(0)

  // x600 on a busy preset: many landings per real second would play without the throttle
  await open(page, 'Small automated', '2026-10-26T13:00:00.000Z')
  const before = (await atmosphere(page)).sound.played
  await page.evaluate(() => window.__tt!.setSpeed(600))
  await page.evaluate(() => window.__tt!.play())
  const t0 = Date.now()
  await page.waitForTimeout(6000)
  const seconds = (Date.now() - t0) / 1000
  const a = await atmosphere(page)
  const landed = a.sound.recent.filter((s) => s.kind === 'landed').length
  expect(landed).toBeLessThanOrEqual(Math.ceil(seconds / 2.5) + 1)
  expect(a.sound.played - before).toBeLessThanOrEqual(Math.ceil(seconds / 2.5) + 3)
})

test('a departure shows a banner that does not block clicks', async ({ page }) => {
  await open(page, TRACER, '2026-10-26T13:00:00.000Z')
  await page.evaluate(() => window.__tt!.setSpeed(60))
  await page.evaluate(() => window.__tt!.play())
  const banner = page.getByTestId('tt-departure-banner')
  await expect(banner).toBeVisible({ timeout: 60_000 })
  expect(await banner.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  // clicks go through it: the element at its centre is not the banner
  const blocked = await banner.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el
  })
  expect(blocked).toBe(false)
  expect((await atmosphere(page)).banner?.kind).toBe('departure')
})

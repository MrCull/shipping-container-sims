/**
 * Yardshift smoke spec (#390): the background track is silent on the intro, loops once the shift starts, follows the
 * shared music slider and mute live, and pauses with the pause menu. The track is an `Audio` element outside the
 * DOM, so an init script records every element the page creates. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__ys typing

declare global {
  interface Window {
    __audioElements?: HTMLAudioElement[]
  }
}

/** The track's own gain (`MUSIC_GAIN` in src/sims/yardshift/modules/music.ts). */
const MUSIC_GAIN = 0.3

function music(page: Page): Promise<{ volume: number; paused: boolean; loop: boolean } | null> {
  return page.evaluate(() => {
    const el = (window.__audioElements ?? []).find((a) => a.src.includes('music-light-piano'))
    return el ? { volume: el.volume, paused: el.paused, loop: el.loop } : null
  })
}

test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.Audio
    window.__audioElements = []
    window.Audio = new Proxy(Original, {
      construct(target, args: [string?]) {
        const element = new target(...args)
        window.__audioElements!.push(element)
        return element
      },
    })
  })
})

test('the shift music loops in play, follows the music slider and mute, and pauses with the game', { tag: '@yardshift' }, async ({ page }) => {
  await page.goto('/sim/yardshift')
  await page.waitForFunction(() => window.__ys !== undefined)
  await expect(page.getByTestId('ys-screen-intro')).toBeVisible()
  await expect.poll(async () => (await music(page))?.paused).toBe(true)

  await page.getByTestId('ys-start').click()
  await expect.poll(async () => (await music(page))?.paused).toBe(false)
  expect((await music(page))?.loop).toBe(true)
  await expect.poll(async () => (await music(page))?.volume).toBeCloseTo(0.4 * MUSIC_GAIN)

  await page.getByTestId('audio-menu-button').click()
  await page.getByTestId('audio-volume').fill('100')
  await page.getByTestId('audio-music-volume').fill('50')
  await expect.poll(async () => (await music(page))?.volume).toBeCloseTo(0.5 * MUSIC_GAIN)
  await page.getByTestId('audio-mute-all').click()
  await expect.poll(async () => (await music(page))?.volume).toBe(0)
  await page.getByTestId('audio-mute-all').click()
  await expect.poll(async () => (await music(page))?.volume).toBeCloseTo(0.5 * MUSIC_GAIN)
  await page.keyboard.press('Escape') // close the popover

  await page.evaluate(() => window.__ys!.loadLevel(1))
  await expect.poll(async () => (await music(page))?.paused).toBe(false)
  await page.locator('body').press('Escape')
  await expect(page.getByTestId('ys-resume')).toBeVisible()
  await expect.poll(async () => (await music(page))?.paused).toBe(true)
  await page.getByTestId('ys-resume').click()
  await expect.poll(async () => (await music(page))?.paused).toBe(false)
})

/**
 * #155 browser smoke test: the main menu's volume slider drives the menu music level live, and at 0 the music is
 * silent and the speaker icon shows silent. The menu music is an `Audio` element outside the DOM, so an init script
 * records every element the page creates. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'

declare global {
  interface Window {
    __audioElements?: HTMLAudioElement[]
  }
}

/** The menu music's own gain at full volume (`MENU_MUSIC_GAIN` in src/composables/useMenuMusic.ts). */
const MENU_MUSIC_GAIN = 0.35

async function menuMusicVolume(page: Page): Promise<number> {
  return page.evaluate(() => {
    const music = (window.__audioElements ?? []).find(a => a.src.includes('menu-music'))
    return music ? music.volume : -1
  })
}

async function setVolume(page: Page, percent: number): Promise<void> {
  await page.getByTestId('audio-volume').fill(String(percent))
}

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

test('the volume slider on the main menu changes the menu music level live; 0 is silent', async ({ page }) => {
  await page.goto('/')
  await expect.poll(() => menuMusicVolume(page)).toBeCloseTo(0.4 * MENU_MUSIC_GAIN)

  await page.getByTestId('audio-menu-button').click()
  await setVolume(page, 100)
  await expect.poll(() => menuMusicVolume(page)).toBeCloseTo(MENU_MUSIC_GAIN)
  await setVolume(page, 50)
  await expect.poll(() => menuMusicVolume(page)).toBeCloseTo(0.5 * MENU_MUSIC_GAIN)

  await setVolume(page, 0)
  await expect.poll(() => menuMusicVolume(page)).toBe(0)
  await expect(page.getByTestId('audio-button')).toHaveText('🔇')

  // Mute gives silence too, and unmuting restores the slider level.
  await setVolume(page, 80)
  await expect.poll(() => menuMusicVolume(page)).toBeCloseTo(0.8 * MENU_MUSIC_GAIN)
  await page.getByTestId('audio-button').click()
  await expect.poll(() => menuMusicVolume(page)).toBe(0)
  await page.getByTestId('audio-button').click()
  await expect.poll(() => menuMusicVolume(page)).toBeCloseTo(0.8 * MENU_MUSIC_GAIN)
})

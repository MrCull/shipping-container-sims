/**
 * #118 browser smoke tests: the shared volume control sits top-right in Terminal Twin (the old Sound button is
 * gone), volume and mute persist across a reload and carry to another sim, and the FPS chip shows, takes
 * threshold colours, toggles the perf panel, and is hidden when WebGL fails. Run with `pnpm run test:smoke`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

async function open(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('tracer-1sts-10-boxes'))
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 3)
}

async function setVolume(page: Page, percent: number): Promise<void> {
  await page.getByTestId('audio-volume').fill(String(percent))
}

test('Terminal Twin shows the shared volume control top-right, with no Sound button of its own', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('tt-sound-toggle')).toHaveCount(0)
  const button = page.getByTestId('audio-button')
  await expect(button).toBeVisible()
  const box = (await button.boundingBox())!
  expect(box.x).toBeGreaterThan(1280 - 120)
  expect(box.y).toBeLessThan(80)
  await expect(page.getByTestId('tt-fps-chip')).toBeVisible()
})

test('volume and mute drive Terminal Twin playback level, and survive a reload and another sim', async ({ page }) => {
  await open(page)
  expect((await page.evaluate(() => window.__tt!.atmosphere())).soundGain).toBeCloseTo(0.4)
  await page.getByTestId('audio-button').click()
  await expect(page.getByTestId('audio-volume')).toHaveValue('40')
  await setVolume(page, 75)
  await expect(page.getByTestId('audio-volume-label')).toHaveText('75%')
  expect((await page.evaluate(() => window.__tt!.atmosphere())).soundGain).toBeCloseTo(0.75)
  await page.getByTestId('audio-mute').click()
  expect((await page.evaluate(() => window.__tt!.atmosphere())).soundGain).toBe(0)

  await page.reload()
  await page.waitForFunction(() => !!window.__tt)
  await page.getByTestId('audio-button').click()
  await expect(page.getByTestId('audio-volume')).toHaveValue('75')
  await expect(page.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'true')

  // carries across sims: the same setting shows in Container Stack
  await page.goto('/sim/container-stack')
  await page.getByTestId('audio-button').click()
  await expect(page.getByTestId('audio-volume')).toHaveValue('75')
  await expect(page.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'true')
  // moving the slider up from a mute unmutes
  await setVolume(page, 20)
  await expect(page.getByTestId('audio-mute')).toHaveAttribute('aria-pressed', 'false')

  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('tracer-1sts-10-boxes'))
  expect((await page.evaluate(() => window.__tt!.atmosphere())).soundGain).toBeCloseTo(0.2)
})

test('the FPS chip shows a live rate, and clicking it opens and closes the perf panel (P still works)', async ({ page }) => {
  await open(page)
  const chip = page.getByTestId('tt-fps-chip')
  await expect(chip).toContainText(/\d+\s*FPS/)
  await expect(page.getByTestId('tt-perf-overlay')).toHaveCount(0)
  await chip.click()
  await expect(page.getByTestId('tt-perf-overlay')).toBeVisible()
  await chip.click()
  await expect(page.getByTestId('tt-perf-overlay')).toHaveCount(0)
  await page.keyboard.press('p')
  await expect(page.getByTestId('tt-perf-overlay')).toBeVisible()
})

test('the FPS chip turns amber below 30 fps and red below 20 under load', async ({ page }) => {
  await open(page)
  const chip = page.getByTestId('tt-fps-chip')
  // Busy-wait every frame: the meter reports the real (low) rate.
  await page.evaluate(() => window.__tt!.setFrameLoad(80))
  await expect(chip).toHaveAttribute('data-severity', 'bad')
  await page.evaluate(() => window.__tt!.setFrameLoad(28))
  await expect(chip).toHaveAttribute('data-severity', /warn|bad/)
  await page.evaluate(() => window.__tt!.setFrameLoad(0))
})

test('the FPS chip is hidden when WebGL fails', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest)
    } as typeof original
  })
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await expect(page.getByText(/webgl/i).first()).toBeVisible()
  await expect(page.getByTestId('tt-fps-chip')).toHaveCount(0)
})

/**
 * Production-build checks (served by `vite preview`; see playwright.config.ts).
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

test('window.__tt is absent from production builds', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => typeof window.__tt)).toBe('undefined')
})

test('the dev asset viewer is absent from production builds (?viewer= is ignored)', async ({ page }) => {
  await page.goto('/sim/terminal-twin?viewer=container-40')
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => typeof (window as { __ttAssets?: unknown }).__ttAssets)).toBe('undefined')
})

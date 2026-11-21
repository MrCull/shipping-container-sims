/**
 * Production-build checks (served by `vite preview`; see playwright.config.ts).
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

test('window.__tt is absent from production builds', { tag: '@core' }, async ({ page }) => {
  await openTwin(page, { devApi: false })
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => typeof window.__tt)).toBe('undefined')
})

test('the dev asset viewer is absent from production builds (?viewer= is ignored)', { tag: '@core' }, async ({ page }) => {
  await openTwin(page, { devApi: false, params: { viewer: 'container-40' } })
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => typeof (window as { __ttAssets?: unknown }).__ttAssets)).toBe('undefined')
})

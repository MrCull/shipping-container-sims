/**
 * TT-17 browser smoke tests: one save round trip through a real reload and IndexedDB, and rewind through the top-bar
 * dialog. The dialog itself (list, save, load, file export and import, version mismatch, storage blocked) is the
 * component test `tests/components/saves-dialog.test.ts` (#338); formats, migration and replay identity are
 * `tests/{saves,persistence-host,persistence-controller}.test.ts`.
 * Run with `pnpm run test:smoke --project=dev terminal-twin-saves`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

// Fresh page (#329): saves live in IndexedDB, which the shared-page reset does not clear, and the round trip reloads the page.
test.use({ fresh: true })

const FIXTURE = 'asc-1sts-10-boxes-1block'

async function open(page: Page): Promise<void> {
  await openTwin(page)
}

async function loadFixture(page: Page): Promise<void> {
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

async function runToEnd(page: Page): Promise<string> {
  await page.evaluate(() => window.__tt!.runUntil())
  return page.evaluate(() => window.__tt!.clock().engine!.eventLogHash)
}

async function referenceHash(page: Page): Promise<string> {
  await open(page)
  await loadFixture(page)
  return runToEnd(page)
}

test('config round-trip: save, reload the page, load, run: same event-log hash', { tag: '@setup' }, async ({ page }) => {
  const hash = await referenceHash(page)
  await page.evaluate(() => window.__tt!.reset())
  const saved = await page.evaluate(() => window.__tt!.saves.saveToBrowser('config', 'Round trip'))
  expect(saved?.name).toBe('Round trip')
  await page.reload()
  await page.waitForFunction(() => !!window.__tt)
  await loadFixture(page) // a run must exist for the top bar; the saved config replaces it
  const list = await page.evaluate(() => window.__tt!.saves.list())
  expect(list.map((s) => s.name)).toContain('Round trip')
  const item = list.find((s) => s.name === 'Round trip')!
  expect(await page.evaluate((id) => window.__tt!.saves.load(id), item.id)).toBe('loaded')
  expect(await page.evaluate(() => window.__tt!.clock().displayTime)).toBe(0)
  expect(await runToEnd(page)).toBe(hash)
})

test('rewind: jumping to an automatic snapshot and running on reproduces the original run', { tag: '@setup' }, async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.saves.setRewindInterval(1))
  await loadFixture(page)
  const hash = await runToEnd(page)
  const points = await page.evaluate(() => window.__tt!.saves.rewindPoints())
  expect(points.length).toBeGreaterThan(2)
  expect(points.map((p) => p.t)).toEqual(points.map((_, i) => (i + 1) * 60))

  await page.getByTestId('tt-saves-button').click()
  await expect(page.getByTestId('tt-rewind-point')).toHaveCount(points.length)
  await page.getByTestId('tt-rewind-point').nth(1).click()
  await expect(page.getByTestId('tt-saves-dialog')).toBeHidden()
  expect(await page.evaluate(() => window.__tt!.clock().engine!.eventsTotal)).toBe(points[1].events)
  expect(await runToEnd(page)).toBe(hash)
})

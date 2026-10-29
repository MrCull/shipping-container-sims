/**
 * TT-17 browser smoke tests: saves (IndexedDB and files), snapshot resume, version mismatch,
 * rewind and storage resilience, through the top-bar dialog and the dev API `window.__tt.saves`.
 * Run with `pnpm run test:smoke`.
 */
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'asc-1sts-10-boxes-1block'

async function open(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
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

test('config round-trip: save, reload the page, load, run: same event-log hash', async ({ page }) => {
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

test('snapshot resume through the dialog continues identically to an uninterrupted run', async ({ page }) => {
  const hash = await referenceHash(page)
  await page.evaluate(() => window.__tt!.reset())
  await page.evaluate(() => window.__tt!.runUntil({ maxEvents: 60 }))
  const midT = await page.evaluate(() => window.__tt!.clock().engine!.now)

  await page.getByTestId('tt-saves-button').click()
  await page.getByTestId('tt-save-name').fill('Mid run')
  await page.getByTestId('tt-save-snapshot').click()
  await expect(page.getByTestId('tt-saves-item')).toHaveCount(1)
  await page.getByTestId('tt-saves-close').click()

  await page.evaluate(() => window.__tt!.reset())
  await page.getByTestId('tt-saves-button').click()
  await page.getByTestId('tt-save-load').click()
  await expect(page.getByTestId('tt-saves-dialog')).toBeHidden()
  const clock = await page.evaluate(() => window.__tt!.clock())
  expect(clock.displayTime).toBe(midT)
  expect(clock.engine!.eventsTotal).toBe(60)
  expect(await runToEnd(page)).toBe(hash)
})

test('exported files import in a fresh browser profile (config and snapshot)', async ({ page, browser }) => {
  const hash = await referenceHash(page)
  await page.evaluate(() => window.__tt!.reset())
  const configText = await page.evaluate(() => window.__tt!.saves.fileText('config', 'File config'))
  await page.evaluate(() => window.__tt!.runUntil({ maxEvents: 60 }))
  const snapText = await page.evaluate(() => window.__tt!.saves.fileText('snapshot', 'File snapshot'))

  const fresh = await browser.newContext()
  try {
    const other = await fresh.newPage()
    await open(other)
    await loadFixture(other)
    expect(await other.evaluate((t) => window.__tt!.saves.importText(t), configText)).toBe('loaded')
    expect(await runToEnd(other)).toBe(hash)
    expect(await other.evaluate((t) => window.__tt!.saves.importText(t), snapText)).toBe('loaded')
    expect(await other.evaluate(() => window.__tt!.clock().engine!.eventsTotal)).toBe(60)
    expect(await runToEnd(other)).toBe(hash)
  } finally {
    await fresh.close()
  }
})

test('the Import button loads a file; an old-format fixture migrates and runs', async ({ page }) => {
  await open(page)
  await loadFixture(page)
  await page.getByTestId('tt-saves-button').click()
  const fixture = new URL('../fixtures/save-v1-config.json', import.meta.url).pathname
  await page.getByTestId('tt-import-file').setInputFiles(fixture)
  await expect(page.getByTestId('tt-saves-dialog')).toBeHidden()
  const config = await page.evaluate(() => window.__tt!.config())
  expect(config?.name).toBe(JSON.parse(readFileSync(fixture, 'utf8')).config.name)
  expect(config?.display).toEqual({ locale: 'de-DE', units: 'imperial' })
  expect(await page.evaluate(() => window.__tt!.display())).toEqual({ locale: 'de-DE', units: 'imperial' })
  await runToEnd(page)
  expect((await page.evaluate(() => window.__tt!.clock().engine!.status))).toBe('ended')
})

test('a snapshot from another engine version warns and offers a restart from its config', async ({ page }) => {
  const hash = await referenceHash(page)
  await page.evaluate(() => window.__tt!.reset())
  await page.evaluate(() => window.__tt!.runUntil({ maxEvents: 60 }))
  const text = await page.evaluate(() => window.__tt!.saves.fileText('snapshot', 'Old engine'))
  const doc = JSON.parse(text)
  doc.snapshot.engineVersion = '0.0.1'
  doc.engineVersion = '0.0.1'

  await page.getByTestId('tt-saves-button').click()
  await page.getByTestId('tt-import-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  const warning = page.getByTestId('tt-version-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('0.0.1')
  // nothing was replaced yet
  expect(await page.evaluate(() => window.__tt!.clock().engine!.eventsTotal)).toBe(60)
  await page.getByTestId('tt-version-restart').click()
  await expect(page.getByTestId('tt-saves-dialog')).toBeHidden()
  expect(await page.evaluate(() => window.__tt!.clock().engine!.eventsTotal)).toBe(0)
  expect(await runToEnd(page)).toBe(hash)
})

test('rewind: jumping to an automatic snapshot and running on reproduces the original run', async ({ page }) => {
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

test.describe('IndexedDB unavailable', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
    })
  })

  test('the UI says so and file export and import still work', async ({ page }) => {
    const hash = await referenceHash(page)
    await page.evaluate(() => window.__tt!.reset())
    await page.getByTestId('tt-saves-button').click()
    await expect(page.getByTestId('tt-saves-storage-warning')).toBeVisible()
    await expect(page.getByTestId('tt-save-config')).toBeDisabled()
    expect(await page.evaluate(() => window.__tt!.saves.state().storage)).toBe('unavailable')

    const download = page.waitForEvent('download')
    await page.getByTestId('tt-export-config').click()
    const file = await download
    const text = readFileSync((await file.path())!, 'utf8')
    await page.getByTestId('tt-saves-close').click()
    expect(await page.evaluate((t) => window.__tt!.saves.importText(t), text)).toBe('loaded')
    expect(await runToEnd(page)).toBe(hash)
  })
})

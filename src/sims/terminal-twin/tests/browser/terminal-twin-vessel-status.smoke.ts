/**
 * Spec #116 / #126: vessel status popup and floating countdown label. "TTI Algeciras — peak day" (V001 arrives at
 * 08:00 and moors for 30 min; V002 arrives 767 s later; V003 at 1,284 s finds no berth and waits). Driven through
 * `window.__tt` (select, runTo, scene().vesselLabels). Run with `pnpm run test:smoke --project=dev --grep "vessel status"`.
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const PEAK = 'TTI Algeciras — peak day'

async function open(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name, { startDateTime: '2026-03-02T08:00:00' }), PEAK)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  expect(errors).toEqual([])
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((vid) => window.__tt!.select(vid), id)
  await expect(page.getByTestId('tt-vessel-status')).toBeVisible()
  await expect(page.getByTestId('tt-entity-heading')).toContainText(id)
}

const labels = (page: Page) => page.evaluate(() => window.__tt!.scene()?.vesselLabels ?? [])

test('vessel status: a mooring vessel counts down to 08:30 and a vessel at anchorage waits for a berth', async ({ page }) => {
  test.slow()
  await open(page)
  await page.evaluate(() => window.__tt!.runTo(300)) // 08:05
  await page.evaluate(() => window.__tt!.pause())

  await select(page, 'V001')
  await expect(page.getByTestId('tt-vessel-phase')).toHaveText('Mooring')
  await expect(page.getByTestId('tt-vessel-ops-start')).toContainText(/8:30/)
  await expect(page.getByTestId('tt-vessel-countdown')).toHaveText(/^2[45]:\d\d$/)
  await expect(page.getByTestId('tt-vessel-moves')).toContainText(/\d+ done, \d+ remaining/)

  // the label floats over the mooring vessel only
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await expect.poll(async () => (await labels(page)).map((l) => `${l.id}:${l.phase}`)).toEqual(['V001:mooring'])
  expect((await labels(page))[0].text).toMatch(/^V001 · Mooring · 2[45]:\d\d$/)

  // V003 arrives at 1,284 s and waits at the anchorage; V001 is by then working: its label is gone
  await page.evaluate(() => window.__tt!.runTo(1400))
  await page.evaluate(() => window.__tt!.pause())
  await select(page, 'V003')
  await expect(page.getByTestId('tt-vessel-phase')).toHaveText('Waiting for berth')
  await expect(page.getByTestId('tt-vessel-countdown')).toBeHidden()
  await expect.poll(async () => (await labels(page)).map((l) => `${l.id}:${l.phase}`)).toEqual(['V001:mooring', 'V002:mooring', 'V003:waiting'])
  await page.screenshot({ path: '.screenshots/vessel-status.png' })

  // operations start at 08:30 (1,800 s): V001's label disappears, its popup says Working
  await page.evaluate(() => window.__tt!.runTo(1900))
  await page.evaluate(() => window.__tt!.pause())
  await select(page, 'V001')
  await expect(page.getByTestId('tt-vessel-phase')).toHaveText('Working')
  await expect(page.getByTestId('tt-vessel-countdown')).toBeHidden()
  await expect.poll(async () => (await labels(page)).map((l) => l.id)).not.toContain('V001')
})

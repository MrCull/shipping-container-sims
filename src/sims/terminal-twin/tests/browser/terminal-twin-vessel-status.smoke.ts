/**
 * Spec #116 / #126: vessel status popup and floating countdown label. The `two-vessels-compete-for-berth` fixture
 * (V001 arrives at 08:00 and moors for 10 min, its first pick is at 690 s; V002 arrives at 300 s, finds no berth and
 * waits at anchorage). The smallest fixture with a mooring and a waiting vessel (#334: it was the TTI peak day).
 * Driven through `window.__tt` (select, runTo, scene().vesselLabels).
 * Run with `pnpm run test:smoke --project=dev --grep "vessel status"`.
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

const FIXTURE = 'two-vessels-compete-for-berth'

async function open(page: Page): Promise<void> {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await openTwin(page, { scenario: FIXTURE, load: { startDateTime: '2026-03-02T08:00:00' } })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  expect(errors).toEqual([])
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((vid) => window.__tt!.select(vid), id)
  await expect(page.getByTestId('tt-vessel-status')).toBeVisible()
  await expect(page.getByTestId('tt-entity-heading')).toContainText(id)
}

const labels = (page: Page) => page.evaluate(() => window.__tt!.scene()?.vesselLabels ?? [])

test('vessel status: a mooring vessel counts down to 08:10 and a vessel at anchorage waits for a berth', { tag: '@analysis' }, async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.__tt!.runTo(120)) // 08:02
  await page.evaluate(() => window.__tt!.pause())

  await select(page, 'V001')
  await expect(page.getByTestId('tt-vessel-phase')).toHaveText('Mooring')
  // ops start, countdown, moves and the later phases of the popup: tests/components/vessel-status-popup.test.ts (#338)

  // the label floats over the mooring vessel only
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  await expect.poll(async () => (await labels(page)).map((l) => `${l.id}:${l.phase}`)).toEqual(['V001:mooring'])
  expect((await labels(page))[0].text).toMatch(/^V001 · Mooring · 0[78]:\d\d$/)

  // V002 arrives at 300 s and waits at the anchorage while V001 still moors
  await page.evaluate(() => window.__tt!.runTo(400))
  await page.evaluate(() => window.__tt!.pause())
  await select(page, 'V002')
  await expect(page.getByTestId('tt-vessel-phase')).toHaveText('Waiting for berth')
  await expect.poll(async () => (await labels(page)).map((l) => `${l.id}:${l.phase}`)).toEqual(['V001:mooring', 'V002:waiting'])
  await page.evaluate(() => window.__tt!.renderOnce()) // render is off: draw the frame the screenshot keeps
  await page.screenshot({ path: '.screenshots/vessel-status.png' })

  // berthed at 08:10 (600 s), first pick at 690 s: the popup says Working and the label is gone
  // (the 'Berthed, starting soon' phase is covered by vessel-status.test.ts)
  await page.evaluate(() => window.__tt!.runTo(700))
  await page.evaluate(() => window.__tt!.pause())
  await select(page, 'V001')
  await expect(page.getByTestId('tt-vessel-phase')).toHaveText('Working')
  await expect.poll(async () => (await labels(page)).map((l) => l.id)).not.toContain('V001')
})

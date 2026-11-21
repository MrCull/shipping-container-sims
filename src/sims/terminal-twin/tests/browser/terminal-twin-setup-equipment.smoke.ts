/**
 * Setup dialog fields for yard blocks, ASCs and SHCs (TT-05, TT-06, TT-08), through the dev-only `window.__tt` API.
 * Moved out of the engine group's specs by #333 (spec #320), which keeps one browser worker test in that group.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test } from '@playwright/test'
import type { RunSummary } from '../../engine'
import shcGolden from '../../scenario/fixtures/shc-1sts-2shc-1wtp.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import { openSetupTab, pickScenario } from './scenarioPicker'
import { openTwin } from './openTwin'

test('the setup dialog edits blocks, bays, tiers, pads, stalls and ASC speeds', { tag: '@setup' }, async ({ page }) => {
  await openTwin(page)
  await page.evaluate(() => window.__tt!.newScenario())
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await pickScenario(dialog, 'asc-1sts-10-boxes-1block')
  await openSetupTab(dialog, 'yard')
  await expect(dialog.getByTestId('tt-yard-readout')).toBeVisible()
  await dialog.locator('input[name="yard-blocks"]').fill('2')
  await dialog.locator('input[name="yard-blocks"]').dispatchEvent('change')
  await dialog.getByTestId('tt-yard-per-block').locator('summary').click() // the per-block rows start closed
  await dialog.locator('input[name="yard-bays-2"]').fill('6')
  await dialog.locator('input[name="yard-tiers-2"]').fill('2')
  await dialog.locator('input[name="yard-pads-2"]').fill('3')
  await dialog.locator('input[name="yard-stalls-2"]').fill('2')
  await dialog.getByTestId('tt-yard-ascs-1').check()
  await dialog.getByRole('button', { name: /start/i }).click()
  await expect(dialog).toBeHidden()
  const cfg = await page.evaluate(() => window.__tt!.config())
  expect(cfg!.yard!.blocks.map((b) => [b.id, b.bays, b.tiers, b.wtpPads, b.transferStalls])).toEqual([
    ['B01', 8, 3, 5, 5],
    ['B02', 6, 2, 3, 2],
  ])
  const ascs = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('ascList'))
  expect(ascs.map((a) => a.id)).toEqual(['B01-ASC1', 'B02-ASC1'])
})

test('the setup dialog offers 1 or 2 ASCs per block, default 2', { tag: '@setup' }, async ({ page }) => {
  await openTwin(page)
  await page.evaluate(() => window.__tt!.newScenario())
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await pickScenario(dialog, 'asc-1sts-10-boxes-1block')
  await openSetupTab(dialog, 'yard')
  await expect(dialog.getByTestId('tt-yard-ascs-2')).toBeChecked()
  await dialog.getByTestId('tt-yard-ascs-1').check()
  await dialog.getByRole('button', { name: /start/i }).click()
  await expect(dialog).toBeHidden()
  const one = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('ascList'))
  expect(one.map((a) => a.id)).toEqual(['B01-ASC1'])
  expect((await page.evaluate(() => window.__tt!.config()))!.yard!.ascsPerBlock).toBe(1)

  // the dialog remembers the last choice for the scenario
  await page.evaluate(() => window.__tt!.newScenario())
  await pickScenario(dialog, 'asc-1sts-10-boxes-1block')
  await openSetupTab(dialog, 'yard')
  await expect(dialog.getByTestId('tt-yard-ascs-1')).toBeChecked()
  await dialog.getByTestId('tt-yard-ascs-2').check()
  await dialog.getByRole('button', { name: /start/i }).click()
  await expect(dialog).toBeHidden()
  const two = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('ascList'))
  expect(two.map((a) => a.id)).toEqual(['B01-ASC1', 'B01-ASC2'])
})

test('the setup dialog sets the SHC count and kinematics', { tag: '@setup' }, async ({ page }) => {
  await openTwin(page)
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await expect(dialog).toBeVisible()
  await pickScenario(dialog, 'shc-1sts-2shc-1wtp')
  await openSetupTab(dialog, 'yard')
  await expect(dialog.getByRole('group', { name: /shuttle carriers/i })).toBeVisible()
  const readout = dialog.getByTestId('tt-shc-readout')
  const before = await readout.textContent()
  await dialog.getByLabel('Count').fill('3')
  await dialog.getByLabel(/Empty speed/).fill('5') // well below the speeds SHCs reach between turns
  await expect(readout).not.toHaveText(before ?? '')
  await dialog.getByRole('button', { name: 'Start' }).click()
  await expect(dialog).toBeHidden()
  await page.waitForFunction(() => !!window.__tt)
  const shcs = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('shcList'))
  expect(shcs.map((s) => s.id)).toEqual(['SHC01', 'SHC02', 'SHC03'])
  await page.evaluate(() => window.__tt!.runUntil())
  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.status).toBe('ended')
  expect(summary.invariants.violations).toBe(0)
  expect(summary.eventLogHash).not.toBe(shcGolden.eventLogHash)
  expect(Object.keys(summary.kpis.horizontal!.shcs)).toHaveLength(3)
})

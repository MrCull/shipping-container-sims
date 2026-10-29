/**
 * V11-10 browser smoke test: the setup dialog's Subsystem modes fieldset.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

test('quay, berth and yard modes set in the dialog reach the config and the run ends cleanly', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.load('landside-morning-peak'))
  await page.getByRole('button', { name: /new scenario/i }).click()
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await expect(dialog).toBeVisible()
  const modes = dialog.getByTestId('tt-subsystem-modes')
  await modes.scrollIntoViewIfNeeded()
  await expect(modes.getByTestId('tt-mode-quay-real')).toBeChecked()
  await modes.getByTestId('tt-mode-quay-instant').check()
  await modes.getByTestId('tt-mode-berth-off').check()
  await modes.getByTestId('tt-mode-yard-instant').check()
  await page.screenshot({ path: '.screenshots/subsystem-modes-dialog.png' })
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden()
  const cfg = await page.evaluate(() => window.__tt!.config()!.subsystems)
  expect(cfg).toMatchObject({ quay: 'instant', berth: 'off', yard: 'instant' })
  const result = await page.evaluate(() => window.__tt!.runUntil({ vesselsCompleted: 1, maxEvents: 300_000 }))
  expect(result.reason).not.toBe('error')
  expect(errors).toEqual([])
})

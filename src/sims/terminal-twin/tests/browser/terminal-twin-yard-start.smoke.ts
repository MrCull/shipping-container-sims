/**
 * TT-14 browser smoke test: the setup dialog's yard start modes through the real dialog.
 * Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type {} from '../../dev/devApi' // window.__tt typing

const SCENARIO = 'landside-morning-peak'

async function openDialog(page: Page) {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), SCENARIO)
  await page.getByRole('button', { name: /new scenario/i }).click()
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await expect(dialog).toBeVisible()
  return dialog
}

const cellsInYards = (page: Page) =>
  page.evaluate(async () => {
    const blocks = await window.__tt!.query<{ id: string; bays: number; rows: number; tiers: number }[]>('yardBlocks')
    let n = 0
    let capacity = 0
    for (const b of blocks) {
      capacity += b.bays * b.rows * b.tiers
      for (const s of await window.__tt!.query<{ span: number }[]>('yardSlots', b.id)) n += s.span
    }
    return { cells: n, capacity }
  })

test('the dialog defaults to a pre-filled yard and the run starts with boxes in the stacks', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('tt-yard-start-prefilled')).toBeChecked()
  await expect(dialog.getByTestId('tt-yard-target')).toHaveValue('60')
  await dialog.getByTestId('tt-yard-target').fill('30')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  const { cells, capacity } = await cellsInYards(page)
  expect(Math.abs(cells / capacity - 0.3)).toBeLessThan(0.02)
  expect(errors).toEqual([])
})

test('the empty start leaves the yard empty at t = 0', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByTestId('tt-yard-start-empty').check()
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  expect((await cellsInYards(page)).cells).toBe(0)
})

test('the warm-up start shows its length and restarts the KPIs when it ends', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByTestId('tt-yard-start-warmup').check()
  await dialog.getByTestId('tt-yard-warmup').fill('1')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'WarmUpEnded' }))
  const report = await page.evaluate(() => window.__tt!.query<{ movesCompleted: number; warmUp: { ended: boolean } }>('kpis'))
  expect(report.warmUp.ended).toBe(true)
  expect(report.movesCompleted).toBe(0)
})

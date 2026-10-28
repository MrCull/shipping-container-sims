/**
 * TT-06 browser smoke tests: ASC block storage through the dev-only `window.__tt` API.
 * Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { ContainerState, RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/asc-1sts-10-boxes-1block.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'asc-1sts-10-boxes-1block'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function openAsc(page: Page, options?: Parameters<NonNullable<typeof window.__tt>['load']>[1]): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(([name, opts]) => window.__tt!.load(name as string, opts as never), [FIXTURE, options ?? {}])
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('the import fixture runs in the browser: golden hash, full custody chain, boxes in their slots', async ({ page }) => {
  const errors = collectErrors(page)
  await openAsc(page)
  expect((await page.evaluate(() => window.__tt!.runUntil())).reason).toBe('ended')

  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.kpis).toEqual(golden.kpis)
  expect(summary.invariants.violations).toBe(0)

  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('containers'))
  expect(boxes).toHaveLength(10)
  for (const { id } of boxes) {
    const box = await page.evaluate((cid) => window.__tt!.query<ContainerState>('container', cid), id)
    expect(box.custodyHistory.map((h) => h.owner.kind), id).toEqual([
      'vesselSlot',
      'sts',
      'groundPosition',
      'shc',
      'wtpPad',
      'asc',
      'yardSlot',
    ])
  }
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  expect((await page.evaluate(() => window.__tt!.scene()))!.ascs).toBe(1)
  const state = await page.evaluate(() => window.__tt!.sceneState())
  for (const { id } of boxes) expect(state!.containers[id]!.kind, id).toBe('yardSlot')
  expect(errors).toEqual([])
})

test('paused mid-cycle, the scene shows the ASC where the engine has it and the box in its spreader', async ({ page }) => {
  await openAsc(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscRoutingToSlot' }))
  const state = await page.evaluate(() => window.__tt!.sceneState())
  const ascs = await page.evaluate(() => window.__tt!.query<{ id: string; status: string; carrying: string | null }[]>('ascList'))
  expect(ascs).toHaveLength(1)
  expect(state!.ascs[ascs[0].id].status).toBe(ascs[0].status)
  expect(state!.containers[ascs[0].carrying as string]).toEqual({ kind: 'asc', id: ascs[0].id })
})

test('the spreader follows the planned hoist: it is down at the pad and raised in travel', async ({ page }) => {
  await openAsc(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscPicked' }))
  const atPad = await page.evaluate(() => window.__tt!.sceneState()!.ascs['B01-ASC1'])
  expect(atPad.hoistY).toBeCloseTo(0, 3)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscPositioningAtSlot' }))
  const atSlot = await page.evaluate(() => window.__tt!.sceneState()!.ascs['B01-ASC1'])
  expect(atSlot.hoistY).toBeGreaterThan(5) // travel height over the stacks
})

test('the setup dialog edits blocks, bays, tiers, pads, stalls and ASC speeds', async ({ page }) => {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate(() => window.__tt!.newScenario())
  const dialog = page.getByRole('dialog', { name: /new scenario/i })
  await dialog.locator('input[type=radio][value="asc-1sts-10-boxes-1block"]').check()
  await expect(dialog.getByTestId('tt-yard-readout')).toBeVisible()
  await dialog.locator('input[name="yard-blocks"]').fill('2')
  await dialog.locator('input[name="yard-blocks"]').dispatchEvent('change')
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

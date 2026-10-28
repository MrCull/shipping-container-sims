/**
 * TT-10 browser smoke tests: the export load flow through the dev-only `window.__tt` API.
 * Run with `npm run test:smoke` (not part of `npm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { ContainerState, RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/load-1sts-10-boxes-1block.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'load-1sts-10-boxes-1block'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function openLoad(page: Page): Promise<void> {
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

test('export boxes start in the stacks and end in their vessel slots, matching the golden run', async ({ page }) => {
  const errors = collectErrors(page)
  await openLoad(page)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  const boxes = await page.evaluate(() => window.__tt!.query<{ id: string }[]>('containers'))
  expect(boxes).toHaveLength(10)
  const start = await page.evaluate(() => window.__tt!.sceneState())
  for (const { id } of boxes) expect(start!.containers[id]!.kind, id).toBe('yardSlot')

  expect((await page.evaluate(() => window.__tt!.runUntil())).reason).toBe('ended')
  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.invariants.violations).toBe(0)
  for (const { id } of boxes) {
    const box = await page.evaluate((cid) => window.__tt!.query<ContainerState>('container', cid), id)
    expect(box.custodyHistory.map((h) => h.owner.kind), id).toEqual([
      'yardSlot',
      'asc',
      'wtpPad',
      'shc',
      'groundPosition',
      'sts',
      'vesselSlot',
    ])
  }
  const end = await page.evaluate(() => window.__tt!.sceneState())
  for (const { id } of boxes) expect(end!.containers[id]!.kind, id).toBe('vesselSlot')
  expect(errors).toEqual([])
})

test('paused mid-load, the scene shows an SHC carrying an export box and the engine agrees', async ({ page }) => {
  await openLoad(page)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'ShcPickedAtWtp' }))
  const shcs = await page.evaluate(() => window.__tt!.query<{ id: string; carrying: string | null }[]>('shcList'))
  const carrier = shcs.find((s) => s.carrying)
  expect(carrier).toBeDefined()
  const state = await page.evaluate(() => window.__tt!.sceneState())
  expect(state!.containers[carrier!.carrying as string]).toEqual({ kind: 'shc', id: carrier!.id })
})

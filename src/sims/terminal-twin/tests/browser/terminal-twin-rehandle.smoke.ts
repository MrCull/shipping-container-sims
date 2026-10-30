/**
 * TT-12 browser smoke test: a rehandle shows in the scene through the dev-only `window.__tt` API.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test, type Page } from '@playwright/test'
import type { RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/rehandle-random-yard.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing

const FIXTURE = 'rehandle-random-yard'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

test('a rehandle lifts a blocker out of its stack, carries it, and sets it down; the run matches its golden', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/sim/terminal-twin')
  await page.waitForFunction(() => !!window.__tt)
  await page.evaluate((name) => window.__tt!.load(name), FIXTURE)
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)

  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'RehandleRequired' }))
  // the next lift is the rehandle's (the block's ASC was idle when the decision was asked)
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscRetrieved' }))
  const asc = await page.evaluate(() => window.__tt!.query<{ id: string; carrying: string | null }[]>('ascList').then((l) => l.find((a) => a.carrying)))
  expect(asc).toBeDefined()
  const box = asc!.carrying as string
  const carried = await page.evaluate(() => window.__tt!.sceneState())
  expect(carried!.containers[box]).toEqual({ kind: 'asc', id: asc!.id })
  const from = (await page.evaluate((id) => window.__tt!.query<{ custodyHistory: { owner: { kind: string; id: string } }[] }>('container', id), box)).custodyHistory
  const oldSlot = from[from.length - 2].owner
  expect(oldSlot.kind).toBe('yardSlot')

  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'AscStacked' }))
  const set = await page.evaluate(() => window.__tt!.sceneState())
  expect(set!.containers[box]!.kind).toBe('yardSlot')
  expect(set!.containers[box]!.id).not.toBe(oldSlot.id)
  expect((await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))).kpis.yard?.rehandles.total).toBe(1)

  expect((await page.evaluate(() => window.__tt!.runUntil())).reason).toBe('ended')
  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.kpis.yard?.rehandles.total).toBe(golden.kpis.yard.rehandles.total)
  expect(summary.invariants.violations).toBe(0)
  expect(errors).toEqual([])
})

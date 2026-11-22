/**
 * The engine group's one browser test (#333, spec #320): the engine Web Worker runs the ASC import fixture to the end
 * with its golden hash, which shows the worker and host round trip works. Engine facts (custody chains, slots, KPIs)
 * are unit tests (`golden.test.ts`, `asc-yard.test.ts`) and the scene checks run in the headless scene
 * (`headless-scene-engine.test.ts`). Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { expect, test } from './twinTest'
import type { RunSummary } from '../../engine'
import golden from '../../scenario/fixtures/asc-1sts-10-boxes-1block.golden.json' with { type: 'json' }
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

test('the engine worker runs the ASC import fixture to the end with its golden hash', { tag: '@engine' }, async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  await openTwin(page, { scenario: 'asc-1sts-10-boxes-1block' })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
  expect((await page.evaluate(() => window.__tt!.runUntil())).reason).toBe('ended')

  const summary = await page.evaluate(() => window.__tt!.query<RunSummary>('summary'))
  expect(summary.eventLogHash).toBe(golden.eventLogHash)
  expect(summary.kpis).toEqual(golden.kpis)
  expect(summary.invariants.violations).toBe(0)
  await page.waitForFunction(() => (window.__tt!.scene()?.frames ?? 0) > 5)
  expect(errors).toEqual([])
})

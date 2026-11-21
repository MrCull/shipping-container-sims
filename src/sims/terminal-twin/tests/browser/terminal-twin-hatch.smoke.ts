/**
 * TT-R10 browser smoke tests: hatch panels in the 3D view, through the dev-only `window.__tt` API.
 * The hatch-cover-cycle fixture lifts the panels of a feeder bay off, stacks them in the quay laydown, and puts them back.
 * Panel positions through the cycle and the hatch-covers-off hull are checked in Node (`tests/headless-scene-vessel.test.ts`,
 * #331); this spec keeps what needs a browser: a drawn panel picked by a click, inspected, and the event feed.
 * Run with `pnpm run test:smoke` (not part of `pnpm test`).
 */
import { type Page } from '@playwright/test'
import { expect, test } from './twinTest'
import type { HatchPanelState } from '../../engine'
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'

const FIXTURE = 'hatch-cover-cycle'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function open(page: Page, fixture = FIXTURE): Promise<void> {
  await openTwin(page, { scenario: fixture })
  await expect(page.getByRole('dialog', { name: /new scenario/i })).toBeHidden()
}

/** Wait until the scene has drawn at least two more frames, so the rig state is the state at the paused time. */
async function nextFrames(page: Page): Promise<void> {
  const frames = await page.evaluate(() => window.__tt!.scene()?.frames ?? 0)
  await page.waitForFunction((n) => (window.__tt!.scene()?.frames ?? 0) >= n + 2, frames)
}

test('a panel in the laydown is drawn, can be clicked, and is inspected; hatch moves are in the event feed', { tag: '@vessel' }, async ({ page }) => {
  const errors = collectErrors(page)
  await open(page)
  await page.keyboard.press('e')
  await page.evaluate(() => window.__tt!.runUntil({ eventType: 'HatchSetInLaydown' }))
  const [panel] = (await page.evaluate(() => window.__tt!.query<HatchPanelState[]>('hatchList'))).filter((p) => p.status === 'in-laydown')
  expect(panel.siteId).not.toBeNull()
  await expect(page.getByTestId('tt-feed-rows')).toContainText('HatchLifted')
  await expect(page.getByTestId('tt-feed-rows')).toContainText('HatchSetInLaydown')

  // look at it, click it
  expect(await page.evaluate((id) => window.__tt!.cameraTo(id, 40), panel.id)).toBe(true)
  await nextFrames(page)
  const at = await page.evaluate((id) => window.__tt!.screenPoint(id), panel.id)
  expect(at).not.toBeNull()
  expect(await page.evaluate(({ x, y }) => window.__tt!.pickAt(x, y), at!)).toBe(panel.id)

  await page.evaluate((id) => window.__tt!.select(id), panel.id)
  await page.waitForFunction(() => window.__tt!.debug().entity !== null)
  const entity = (await page.evaluate(() => window.__tt!.debug()))!.entity!
  expect(entity).toMatchObject({ kind: 'hatch', id: panel.id, status: 'in-laydown' })
  expect(errors).toEqual([])
})

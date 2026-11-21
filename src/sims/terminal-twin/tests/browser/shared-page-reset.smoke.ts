/**
 * The worker's shared page (#329, `twinTest.ts`): state one test leaves behind (an open panel, a selection, a colour-by
 * mode, overlays, speed, storage, a console listener) is gone after the reset that runs before the next test, and the
 * reset reuses the page (no page load). The test runs the reset itself, so it does not depend on test order.
 * Run with `pnpm run test:smoke --project=dev shared-page-reset`.
 */
import type {} from '../../dev/devApi' // window.__tt typing
import { openTwin } from './openTwin'
import { expect, resetSharedPage, test } from './twinTest'

const FIXTURE = 'tracer-1sts-10-boxes'

test('the shared-page reset leaves no state from the previous test', { tag: '@core' }, async ({ page }) => {
  await openTwin(page, { scenario: FIXTURE })
  const before = await page.evaluate(() => ({ ui: window.__tt!.ui(), overlays: window.__tt!.overlays(), speed: window.__tt!.clock().speed }))
  const defaultMode = await page.getByTestId('tt-colour-by').click().then(() => page.getByTestId('tt-colour-by-select').inputValue())
  await page.getByTestId('tt-colour-by').click()

  // Leave state behind, as a test might: colour-by mode and its open panel, a selection, overlays, speed, storage, a listener.
  await page.getByTestId('tt-colour-by').click()
  const select = page.getByTestId('tt-colour-by-select')
  const modes = await select.locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))
  const otherMode = modes.find((m) => m !== defaultMode)!
  await select.selectOption(otherMode)
  if (!(await page.getByTestId('tt-colour-by-panel').isVisible())) await page.getByTestId('tt-colour-by').click() // leave it open
  const sts = await page.evaluate(() => Object.keys(window.__tt!.sceneState()!.sts)[0])
  await page.evaluate((id) => {
    const tt = window.__tt!
    tt.select(id)
    const overlays = tt.overlays()
    const key = Object.keys(overlays).find((k) => typeof overlays[k as keyof typeof overlays] === 'boolean')!
    tt.overlays({ [key]: !overlays[key as keyof typeof overlays] })
    tt.setSpeed(600)
    localStorage.setItem('tt-leak', '1')
    ;(window as unknown as { __marker: number }).__marker = 1
  }, sts)
  let consoleCalls = 0
  page.on('console', () => consoleCalls++)
  const dirty = await page.evaluate(() => ({ ui: window.__tt!.ui(), overlays: window.__tt!.overlays(), speed: window.__tt!.clock().speed }))
  expect(dirty.ui.selectedId).toBe(sts)
  expect(dirty.ui.colourByOpen).toBe(true)
  expect(dirty.overlays).not.toEqual(before.overlays)
  expect(dirty.speed).toBe(600)

  // What the fixture runs before the next test, then that test's openTwin.
  await resetSharedPage(page)
  await openTwin(page, { scenario: FIXTURE })

  const after = await page.evaluate(() => ({
    ui: window.__tt!.ui(),
    overlays: window.__tt!.overlays(),
    speed: window.__tt!.clock().speed,
    leak: localStorage.getItem('tt-leak'),
    marker: (window as unknown as { __marker?: number }).__marker,
  }))
  expect(after.marker, 'the reset reuses the page: no page load').toBe(1)
  expect(after.ui).toEqual(before.ui)
  expect(after.overlays).toEqual(before.overlays)
  expect(after.speed).toBe(before.speed)
  expect(after.leak).toBeNull()
  const seen = consoleCalls
  await page.evaluate(() => console.log('after the reset'))
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  expect(consoleCalls, 'the last test\'s console listener is gone').toBe(seen)
  await page.getByTestId('tt-colour-by').click()
  await expect(page.getByTestId('tt-colour-by-select')).toHaveValue(defaultMode)
})

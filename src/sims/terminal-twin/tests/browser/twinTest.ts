/**
 * The Terminal Twin smoke `test` (#329, spec #320): one booted page per Playwright worker, reset between tests.
 *
 * Specs import `test` (and `expect`) from here instead of `@playwright/test`. The `page` fixture is then the worker's
 * shared page, reset before each test:
 * - Playwright side: listeners (console, pageerror, dialog...), routes, viewport, emulated media;
 * - app side (`window.__appReset`, src/utils/smokeReset.ts): the sim unmounts (worker, scene, panels, selection,
 *   follow mode, colour-by, overlays, speed, camera, dialogs, dev API), browser storage is cleared and every Pinia
 *   store is disposed. The page then sits on an empty route, and `openTwin` routes to the twin without a page load.
 *
 * A spec that needs a real page load opts out with `test.use({ fresh: true })` and a one-line reason: reloads,
 * persistence and saves (IndexedDB and module state survive the reset), first launch, context options set with
 * `test.use` (locale, time zone, touch, mobile viewport), `addInitScript`, and the main menu.
 */
import { test as base, expect, type Page } from '@playwright/test'

export { expect }

export interface TwinTestOptions {
  /** True gives the test its own page in a new browser context (a real first load), not the worker's shared page. */
  fresh: boolean
}

interface TwinWorkerFixtures {
  /** The worker's shared page holder (recreated if a test closed or crashed it). */
  sharedTwinPage: { get(): Promise<Page> }
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

/** Node's environment (this helper is also type-checked by the app config, which has no Node types). */
function env(): Record<string, string | undefined> {
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
}

export const test = base.extend<TwinTestOptions, TwinWorkerFixtures>({
  // SMOKE_FRESH_PAGES=1 gives every test a fresh page (the pre-#329 behaviour), to compare timings or rule out a leak.
  fresh: [env().SMOKE_FRESH_PAGES === '1', { option: true }],
  sharedTwinPage: [
    async ({ browser }, use, workerInfo) => {
      const { baseURL, viewport } = workerInfo.project.use
      let page: Page | null = null
      await use({
        async get() {
          if (!page || page.isClosed()) {
            const context = await browser.newContext({ baseURL, viewport: viewport ?? DEFAULT_VIEWPORT })
            page = await context.newPage()
          }
          return page
        },
      })
      const last = page as Page | null
      if (last) await last.context().close()
    },
    { scope: 'worker' },
  ],
  page: async ({ fresh, sharedTwinPage, browser, baseURL, viewport, locale, timezoneId, hasTouch, isMobile, colorScheme }, use) => {
    if (fresh) {
      // A new browser context with the options this test's project and `test.use` set: a real first load.
      const context = await browser.newContext({ baseURL, viewport, locale, timezoneId, hasTouch, isMobile, colorScheme })
      const page = await context.newPage()
      await use(page)
      await context.close()
      return
    }
    const page = await sharedTwinPage.get()
    await resetSharedPage(page, viewport ?? DEFAULT_VIEWPORT)
    await use(page)
  },
})

/** Clears what the last test left on the shared page, then resets the app (or loads it once, on the first test). */
export async function resetSharedPage(page: Page, viewport: { width: number; height: number } = DEFAULT_VIEWPORT): Promise<void> {
  page.removeAllListeners()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.setViewportSize(viewport)
  await page.emulateMedia({ media: null, colorScheme: null, reducedMotion: null, forcedColors: null })
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) await page.keyboard.up(key)
  const booted = await page.evaluate(() => typeof window.__appReset === 'function').catch(() => false)
  if (!booted) {
    await page.goto('/') // the shared context carries the project's baseURL
    await page.waitForFunction(() => typeof window.__appReset === 'function')
  }
  await page.evaluate(() => window.__appReset!())
}

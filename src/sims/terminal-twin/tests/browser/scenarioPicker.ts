/** Smoke helpers for the setup dialog's scenario picker (TT-R04): choose a scenario or a test bench by technical name. */
import type { Locator, Page } from '@playwright/test'

type Scope = Page | Locator

/**
 * Selects a scenario (preset row) or a test bench (fixture row) by its technical name, opening the tab that holds it.
 * The start screen shows one tab's list at a time (#145); rows keep `data-scenario` and the old test ids.
 */
export async function pickScenario(scope: Scope, name: string): Promise<void> {
  const row = scope.locator(`[data-testid="tt-preset-card"][data-scenario="${name}"], [data-testid="tt-fixture-row"][data-scenario="${name}"]`)
  if ((await row.count()) === 0) await scope.getByTestId('tt-tab-scenarios').click()
  if ((await row.count()) === 0) await scope.getByTestId('tt-tab-benches').click()
  await row.click()
}

/** Expands the Advanced section (seed, start date, end conditions). */
export async function openAdvanced(scope: Scope): Promise<void> {
  const advanced = scope.getByTestId('tt-advanced')
  if (!(await advanced.evaluate((el) => (el as HTMLDetailsElement).open))) await advanced.locator('summary').click()
}

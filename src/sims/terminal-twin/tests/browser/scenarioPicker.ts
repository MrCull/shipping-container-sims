/** Smoke helpers for the setup dialog's scenario picker (TT-R04): choose a preset card or a fixture row by name. */
import type { Locator, Page } from '@playwright/test'

type Scope = Page | Locator

/** Selects a preset card, or a fixture row (expanding the fixtures table first). */
export async function pickScenario(scope: Scope, name: string): Promise<void> {
  const card = scope.locator(`[data-testid="tt-preset-card"][data-scenario="${name}"]`)
  if ((await card.count()) > 0) {
    await card.click()
    return
  }
  const fixtures = scope.getByTestId('tt-fixtures')
  if (!(await fixtures.evaluate((el) => (el as HTMLDetailsElement).open))) await fixtures.locator('summary').click()
  await scope.locator(`[data-testid="tt-fixture-row"][data-scenario="${name}"]`).click()
}

/** Expands the Advanced section (seed, start date, end conditions). */
export async function openAdvanced(scope: Scope): Promise<void> {
  const advanced = scope.getByTestId('tt-advanced')
  if (!(await advanced.evaluate((el) => (el as HTMLDetailsElement).open))) await advanced.locator('summary').click()
}

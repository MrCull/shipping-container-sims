/** Smoke helpers for the setup dialog (TT-R04, #145, #161): switch its tabs and choose a scenario or a test bench by technical name (the visible text is plain names only, #156). */
import type { Locator, Page } from '@playwright/test'

type Scope = Page | Locator

/** The setup dialog's tabs (#161); each panel carries `data-setup-tab` with the same id. */
export type SetupTabId = 'scenario' | 'vessels' | 'yard' | 'advanced'

/** Opens a tab of the setup dialog: Scenario (picker), Vessels, Yard and equipment, or Advanced. Only the open tab's fields are visible. */
export async function openSetupTab(scope: Scope, tab: SetupTabId): Promise<void> {
  const button = scope.getByTestId(`tt-setup-tab-${tab}`)
  if ((await button.getAttribute('aria-selected')) !== 'true') await button.click()
}

/**
 * Selects a scenario (preset row) or a test bench (fixture row) by its technical name, opening the Scenario tab and
 * then the picker list that holds it. The start screen shows one list at a time (#145); rows keep `data-scenario` and the old test ids.
 */
export async function pickScenario(scope: Scope, name: string): Promise<void> {
  await openSetupTab(scope, 'scenario')
  const row = scope.locator(`[data-testid="tt-preset-card"][data-scenario="${name}"], [data-testid="tt-fixture-row"][data-scenario="${name}"]`)
  if ((await row.count()) === 0) await scope.getByTestId('tt-tab-scenarios').click()
  if ((await row.count()) === 0) await scope.getByTestId('tt-tab-benches').click()
  await row.click()
}

/** Opens the Advanced tab (seed, start date, end conditions, display, decisions). */
export async function openAdvanced(scope: Scope): Promise<void> {
  await openSetupTab(scope, 'advanced')
}

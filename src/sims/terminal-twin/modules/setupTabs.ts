/**
 * Tabs of the setup dialog (#161): Scenario (picker and detail), Vessels (vessel table and flows), Yard and equipment
 * (layout, STS, landside, SHC, yard, modes) and Advanced (seed and start, end conditions, display, decisions).
 * Maps each validation problem to the tab that holds its field, so the message shows there and the tab is marked.
 */

export const SETUP_TABS = ['scenario', 'vessels', 'yard', 'advanced'] as const
export type SetupTab = (typeof SETUP_TABS)[number]

/** The tab of every scenario check (`scenario/validate.ts`, `setup.check.*` keys). A new key must be placed here. */
export const CHECK_KEY_TABS: Record<string, SetupTab> = {
  'setup.check.invalid': 'scenario',
  'setup.check.heavy': 'vessels',
  'setup.check.noVessels': 'vessels',
  'setup.check.tooManyVessels': 'vessels',
  'setup.check.duplicateId': 'vessels',
  'setup.check.counts': 'vessels',
  'setup.check.arrival': 'vessels',
  'setup.check.maxSts': 'vessels',
  'setup.check.capacity': 'vessels',
  'setup.check.tooLong': 'vessels',
  'setup.check.tsIn': 'vessels',
  'setup.check.dwell': 'vessels',
  'setup.check.pool': 'vessels',
  'setup.check.quayLength': 'yard',
  'setup.check.stsCount': 'yard',
  'setup.check.stsSpacing': 'yard',
  'setup.check.frontage': 'yard',
  'setup.check.blocks': 'yard',
  'setup.check.block': 'yard',
  'setup.check.poweredRows': 'yard',
  'setup.check.reeferShare': 'yard',
  'setup.check.containerProps': 'yard',
  'setup.check.reeferNoPower': 'yard',
  'setup.check.blockOffQuay': 'yard',
  'setup.check.shcCount': 'yard',
  'setup.check.trucks': 'yard',
  'setup.check.startNeedsLandside': 'yard',
  'setup.check.modeNoSts': 'yard',
  'setup.check.modeNoBlocks': 'yard',
  'setup.check.modeYardOff': 'yard',
}

export function tabOfCheckKey(key: string): SetupTab {
  return CHECK_KEY_TABS[key] ?? 'scenario'
}

export interface SetupIssue {
  tab: SetupTab
  message: string
}

/** The validators' results, each null when valid (`setup/*Validation.ts`, the scenario check, the end conditions). */
export interface SetupFindings {
  /** `validateLayout`: start date and seed (Advanced). */
  layout: string | null
  checkErrors: readonly { key: string; message: string }[]
  sts: string | null
  shc: string | null
  yard: string | null
  /** End conditions (Advanced), only when edited. */
  end: string | null
}

/** Every problem in the order Start checks them; the first one is the message Start reports. */
export function setupIssues(f: SetupFindings): SetupIssue[] {
  const issues: SetupIssue[] = []
  const add = (tab: SetupTab, message: string | null): void => {
    if (message) issues.push({ tab, message })
  }
  add('advanced', f.layout)
  for (const e of f.checkErrors) add(tabOfCheckKey(e.key), e.message)
  add('yard', f.sts)
  add('yard', f.shc)
  add('yard', f.yard)
  add('advanced', f.end)
  return issues
}

/** The tabs to mark, in tab order: those with an issue plus the tab holding a natively invalid input, if any. */
export function tabsWithIssues(issues: readonly SetupIssue[], invalidInputTab: SetupTab | null = null): SetupTab[] {
  const marked = new Set(issues.map((i) => i.tab))
  if (invalidInputTab) marked.add(invalidInputTab)
  return SETUP_TABS.filter((tab) => marked.has(tab))
}

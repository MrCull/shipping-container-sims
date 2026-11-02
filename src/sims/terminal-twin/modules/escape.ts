/**
 * The one ordered Esc (#169). Each press closes only the topmost open thing, in this order: the setup dialog, the saves
 * dialog, the dashboard, the Colour by popup, the Run to popup, shortcut help, the bay viewer, the right inspector, and
 * last the selection. Pure: the shortcut composable reads the store into an `EscapeState` and clears the target it names.
 */

export type EscapeTarget = 'setup' | 'saves' | 'dashboard' | 'colourBy' | 'runTo' | 'help' | 'bayViewer' | 'inspector' | 'selection'

export interface EscapeState {
  /** The UI phase: the setup dialog replaces the run view while it is `setup`. */
  phase: 'setup' | 'running'
  hasScenario: boolean
  /** A scenario is loading: the setup dialog cannot be dismissed meanwhile. */
  loading: boolean
  savesOpen: boolean
  dashboardOpen: boolean
  colourByOpen: boolean
  runToOpen: boolean
  helpOpen: boolean
  bayViewerOpen: boolean
  inspectorOpen: boolean
  selected: boolean
}

/** The thing one Esc press closes, or null when nothing is open. */
export function escapeTarget(s: EscapeState): EscapeTarget | null {
  if (s.phase === 'setup') return s.hasScenario && !s.loading ? 'setup' : null
  if (s.savesOpen) return 'saves'
  if (s.dashboardOpen && s.hasScenario) return 'dashboard'
  if (s.colourByOpen) return 'colourBy'
  if (s.runToOpen) return 'runTo'
  if (s.helpOpen) return 'help'
  if (s.bayViewerOpen) return 'bayViewer'
  if (s.inspectorOpen) return 'inspector'
  if (s.selected) return 'selection'
  return null
}

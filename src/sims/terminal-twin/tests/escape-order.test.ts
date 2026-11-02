/**
 * #169: one ordered Esc. Each press closes only the topmost open thing: setup dialog, saves dialog, dashboard, Colour by,
 * Run to, shortcut help, bay viewer, right inspector, and last the selection. The pure stack in modules/escape.ts.
 */
import { describe, expect, it } from 'vitest'
import { escapeTarget, type EscapeState, type EscapeTarget } from '../modules/escape'

const closed: EscapeState = {
  phase: 'running',
  hasScenario: true,
  loading: false,
  savesOpen: false,
  dashboardOpen: false,
  colourByOpen: false,
  runToOpen: false,
  helpOpen: false,
  bayViewerOpen: false,
  inspectorOpen: false,
  selected: false,
}

/** The flag each target clears when Esc closes it (what the shortcut handler does to the store). */
const CLEARS: Record<Exclude<EscapeTarget, 'setup'>, keyof EscapeState> = {
  saves: 'savesOpen',
  dashboard: 'dashboardOpen',
  colourBy: 'colourByOpen',
  runTo: 'runToOpen',
  help: 'helpOpen',
  bayViewer: 'bayViewerOpen',
  inspector: 'inspectorOpen',
  selection: 'selected',
}

/** Presses Esc until nothing is left to close, returning the targets in press order. */
function pressUntilClear(start: EscapeState): EscapeTarget[] {
  const order: EscapeTarget[] = []
  let state = start
  for (let i = 0; i < 20; i++) {
    const target = escapeTarget(state)
    if (!target) break
    order.push(target)
    state = target === 'setup' ? { ...state, phase: 'running' } : { ...state, [CLEARS[target]]: false }
  }
  return order
}

describe('escapeTarget', () => {
  it('does nothing when nothing is open', () => {
    expect(escapeTarget(closed)).toBeNull()
  })

  it('closes the setup dialog only when a scenario is loaded to return to', () => {
    expect(escapeTarget({ ...closed, phase: 'setup', hasScenario: true })).toBe('setup')
    expect(escapeTarget({ ...closed, phase: 'setup', hasScenario: false })).toBeNull()
  })

  it('does not close the setup dialog while a scenario is still loading', () => {
    expect(escapeTarget({ ...closed, phase: 'setup', loading: true })).toBeNull()
  })

  it('ignores the run-view layers while the setup dialog is the one on screen', () => {
    const behindSetup = { ...closed, phase: 'setup' as const, savesOpen: true, inspectorOpen: true, selected: true }
    expect(escapeTarget(behindSetup)).toBe('setup')
    expect(pressUntilClear(behindSetup)).toEqual(['setup', 'saves', 'inspector', 'selection'])
  })

  it('closes the inspector when it is open with nothing selected (the toggle or a breakpoint)', () => {
    expect(escapeTarget({ ...closed, inspectorOpen: true })).toBe('inspector')
  })

  it('closes the selection only after the inspector is closed', () => {
    expect(escapeTarget({ ...closed, inspectorOpen: true, selected: true })).toBe('inspector')
    expect(escapeTarget({ ...closed, inspectorOpen: false, selected: true })).toBe('selection')
  })

  it('needs a scenario for the dashboard', () => {
    expect(escapeTarget({ ...closed, dashboardOpen: true, hasScenario: false })).toBeNull()
  })

  it('closes every open thing one press at a time, in the spec order', () => {
    const all: EscapeState = {
      phase: 'running',
      hasScenario: true,
      loading: false,
      savesOpen: true,
      dashboardOpen: true,
      colourByOpen: true,
      runToOpen: true,
      helpOpen: true,
      bayViewerOpen: true,
      inspectorOpen: true,
      selected: true,
    }
    expect(pressUntilClear(all)).toEqual(['saves', 'dashboard', 'colourBy', 'runTo', 'help', 'bayViewer', 'inspector', 'selection'])
  })

  it('puts the popups before help and the bay viewer, and both before the inspector', () => {
    expect(escapeTarget({ ...closed, colourByOpen: true, helpOpen: true, bayViewerOpen: true, inspectorOpen: true })).toBe('colourBy')
    expect(escapeTarget({ ...closed, runToOpen: true, helpOpen: true, bayViewerOpen: true, inspectorOpen: true })).toBe('runTo')
    expect(escapeTarget({ ...closed, helpOpen: true, bayViewerOpen: true, inspectorOpen: true })).toBe('help')
    expect(escapeTarget({ ...closed, bayViewerOpen: true, inspectorOpen: true })).toBe('bayViewer')
  })

  it('puts the dialogs before the popups', () => {
    expect(escapeTarget({ ...closed, savesOpen: true, colourByOpen: true, runToOpen: true })).toBe('saves')
    expect(escapeTarget({ ...closed, dashboardOpen: true, colourByOpen: true, runToOpen: true })).toBe('dashboard')
  })
})

/**
 * Terminal Twin message catalogue: every user-visible string of the sim's UI.
 *
 * English only for now. To add a language later, add a catalogue with the
 * same keys to `catalogues` and pick it in `t()`; components never change.
 * Placeholders are `{name}`, filled from `t(key, { name })`.
 *
 * `tests/message-catalogue.test.ts` fails if a component (.vue) contains
 * hard-coded text, so new UI strings must be added here.
 */
const en = {
  // Root view
  'twin.webglUnavailable': '3D view unavailable: WebGL could not start in this browser. The simulation still runs.',
  'twin.runningFlatOut': 'Running flat out…',
  'twin.scenarioComplete': 'Scenario complete · {reason} · {moves} moves',
  'twin.runStopped': 'Run stopped: {error}',
  'twin.dashboardTitle': 'Dashboard',
  'twin.dashboardPlaceholder': 'KPI charts arrive here soon. Press D to return to the 3D view.',
  'twin.toast.overlaysOn': 'Overlays on',
  'twin.toast.overlaysOff': 'Overlays off',
  'twin.toast.followOn': 'Following {id}',
  'twin.toast.followOff': 'Follow off',
  'twin.toast.followNothing': 'Select something to follow first',

  // Top bar
  'topbar.elapsed': 'Elapsed {elapsed}',
  'topbar.speedGroup': 'Speed',
  'topbar.pause': 'Pause',
  'topbar.resume': 'Resume',
  'topbar.speed': '×{speed}',
  'topbar.runTo': 'Run to…',
  'topbar.runToTarget': 'Target sim time',
  'topbar.runToMissing': 'Enter a date and time',
  'topbar.runToPast': 'Pick a time after the current sim time',
  'topbar.run': 'Run',
  'topbar.reset': 'Reset',
  'topbar.resetHint': 'Back to t = 0 with the same seed',
  'topbar.newScenario': 'New Scenario',
  'topbar.shortcuts': 'Keyboard shortcuts (?)',
  'status.running': 'Running…',
  'status.failed': 'Failed',
  'status.complete': 'Complete',
  'status.paused': 'Paused',
  'status.live': 'Live',

  // Clock
  'clock.elapsed': 'T+{hms}',
  'clock.elapsedDays': 'T+{days}d {hms}',

  // Setup dialog
  'setup.title': 'New scenario',
  'setup.intro': 'Pick a scenario, set the seed and the start date/time. The same seed always gives the same run.',
  'setup.scenario': 'Scenario',
  'setup.kind.fixture': 'fixture',
  'setup.kind.preset': 'preset',
  'setup.presetsSoon': 'Presets (TTI Algeciras, Small automated, Stress test) are coming soon.',
  'setup.seed': 'Seed',
  'setup.reroll': '↻ Re-roll',
  'setup.rerollHint': 'Random seed',
  'setup.start': 'Start date/time',
  'setup.display': 'Display',
  'setup.locale': 'Locale',
  'setup.localeBrowser': '{name} (browser)',
  'setup.units': 'Units',
  'setup.units.metric': 'Metric (m, km/h, t)',
  'setup.units.imperial': 'Imperial (ft, mi/h, US tons)',
  'setup.preview': 'Preview: {date} {time} · {number} · week starts {weekStart}',
  'setup.summary': 'At a glance',
  'setup.summary.quay': 'Quay length',
  'setup.summary.sts': 'STS cranes',
  'setup.summary.containers': 'Containers',
  'setup.summary.gantry': 'STS gantry speed',
  'setup.summary.trolley': 'STS trolley speed',
  'setup.summary.hoist': 'STS hoist speed (loaded)',
  'setup.errorStart': 'Enter a valid start date and time',
  'setup.errorSeed': 'The seed must be a whole number ≥ 0',
  'setup.cancel': 'Cancel',
  'setup.starting': 'Starting…',
  'setup.startButton': 'Start',

  // Units (display only; the engine is SI)
  'unit.m': '{value} m',
  'unit.ft': '{value} ft',
  'unit.kmh': '{value} km/h',
  'unit.mih': '{value} mi/h',
  'unit.t': '{value} t',
  'unit.usTons': '{value} US tons',
  'unit.movesPerHour': '{value} moves/h',
  'unit.teu': '{value} TEU',

  // Keyboard shortcuts (help overlay)
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.close': 'Close',
  'shortcuts.inputsNote': 'Shortcuts are ignored while typing in a field.',
  'shortcuts.key.space': 'Space',
  'shortcuts.key.digits': '1–9',
  'shortcuts.key.zero': '0',
  'shortcuts.key.period': '.',
  'shortcuts.key.f': 'F',
  'shortcuts.key.esc': 'Esc',
  'shortcuts.key.d': 'D',
  'shortcuts.key.o': 'O',
  'shortcuts.key.help': '?',
  'shortcuts.togglePause': 'Pause / resume',
  'shortcuts.speedSteps': 'Speed steps ×1 to ×600',
  'shortcuts.pause': 'Pause',
  'shortcuts.step': 'Single-step to the next event',
  'shortcuts.follow': 'Follow the selection',
  'shortcuts.deselect': 'Deselect / close',
  'shortcuts.dashboard': 'Dashboard tab',
  'shortcuts.overlays': 'Toggle overlays',
  'shortcuts.help': 'Show this help',
} as const

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>

/** Catalogues by UI language. Only English exists (translations are out of scope). */
export const catalogues: Record<string, Messages> = { en }

const active: Messages = en

export type MessageParams = Record<string, string | number>

/** Look up a message and fill its `{placeholders}`. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = active[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

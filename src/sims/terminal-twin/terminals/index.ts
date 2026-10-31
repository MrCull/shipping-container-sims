/**
 * Terminal registry: generic modules (renderer, atmosphere, scenario picker, setup dialog) ask here which terminal a
 * scenario belongs to instead of comparing preset names. To add a terminal: a folder `terminals/<id>/` with an
 * `index.ts` exporting a `TerminalProfile`, then list it below.
 */
import { TTI_ALGECIRAS } from './tti-algeciras'
import type { TerminalPresetInfo, TerminalProfile } from './types'

export type { TerminalPresetInfo, TerminalProfile, TerminalScenery, SceneryContext } from './types'

export const TERMINALS: readonly TerminalProfile[] = [TTI_ALGECIRAS]

/** The terminal that owns a scenario (a preset by name); null for fixtures, custom and generic presets. */
export function terminalForScenario(scenarioName: string): TerminalProfile | null {
  return TERMINALS.find((t) => Object.prototype.hasOwnProperty.call(t.presets, scenarioName)) ?? null
}

/** How a terminal's preset presents (copy, derived-bays note, daylight-lock default); null when no terminal owns the scenario. */
export function terminalPresetInfo(scenarioName: string): TerminalPresetInfo | null {
  return terminalForScenario(scenarioName)?.presets[scenarioName] ?? null
}

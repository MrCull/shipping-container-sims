/**
 * Compose the scenario the setup dialog describes: a fixture or preset plus the
 * dialog's edits, in the order the store starts it. The dialog uses it for its
 * live validation and plan preview; the store uses it to start the run, so what
 * is previewed is what runs. Pure; the input is not modified.
 */
import { withShcFleet, withYard, type YardSetup } from './builder'
import { relayoutBlocks } from './layout'
import { applyOverrides, type ScenarioOverrides } from './overrides'
import type { EndConditions, ScenarioConfig, ShcKinematics } from './types'

export interface ScenarioEdits {
  overrides?: ScenarioOverrides
  /** SHC fleet (scenarios with SHCs only). */
  shc?: { count: number; kinematics: ShcKinematics }
  /** Yard blocks and ASCs (scenarios with yard blocks only). */
  yard?: YardSetup
  endConditions?: EndConditions
}

export function composeScenario(base: ScenarioConfig, edits: ScenarioEdits = {}): ScenarioConfig {
  const withOverrides = applyOverrides(base, edits.overrides ?? {})
  let config = withOverrides
  if (edits.shc && (base.shcs?.length ?? 0) > 0) config = withShcFleet(config, edits.shc.count, edits.shc.kinematics)
  if (edits.yard && (base.yard?.blocks.length ?? 0) > 0) config = withYard(config, edits.yard)
  if (edits.overrides?.derive) config = relayoutBlocks(config)
  if (edits.endConditions) config = { ...config, endConditions: { ...edits.endConditions } }
  return config
}

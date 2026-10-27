/**
 * Committed scenario fixtures, loadable by the UI, CLI and tests.
 * Add a fixture: define it in `definitions.ts`, run `npm run tt:fixtures`,
 * then import the JSON here.
 */
import type { ScenarioConfig } from '../types'
import shc1Sts2Shc1Wtp from './shc-1sts-2shc-1wtp.json'
import tracer1Sts10Boxes from './tracer-1sts-10-boxes.json'

export const fixtures: Record<string, ScenarioConfig> = {
  'tracer-1sts-10-boxes': tracer1Sts10Boxes as ScenarioConfig,
  'shc-1sts-2shc-1wtp': shc1Sts2Shc1Wtp as ScenarioConfig,
}

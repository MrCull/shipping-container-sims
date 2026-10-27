/**
 * Committed scenario fixtures, loadable by the UI, CLI and tests.
 * Add a fixture: define it in `definitions.ts`, run `npm run tt:fixtures`,
 * then import the JSON here.
 */
import type { ScenarioConfig } from '../types'
import craneSplit4Sts from './crane-split-4sts.json'
import tracer1Sts10Boxes from './tracer-1sts-10-boxes.json'
import twin20Lift from './twin-20-lift.json'
import twoVesselsCompeteForBerth from './two-vessels-compete-for-berth.json'

export const fixtures: Record<string, ScenarioConfig> = {
  'tracer-1sts-10-boxes': tracer1Sts10Boxes as ScenarioConfig,
  'two-vessels-compete-for-berth': twoVesselsCompeteForBerth as ScenarioConfig,
  'crane-split-4sts': craneSplit4Sts as ScenarioConfig,
  'twin-20-lift': twin20Lift as ScenarioConfig,
}

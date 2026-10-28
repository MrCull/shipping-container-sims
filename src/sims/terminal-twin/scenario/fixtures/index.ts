/**
 * Committed scenario fixtures, loadable by the UI, CLI and tests.
 * Add a fixture: define it in `definitions.ts`, run `npm run tt:fixtures`,
 * then import the JSON here.
 */
import type { ScenarioConfig } from '../types'
import asc1Sts10Boxes1Block from './asc-1sts-10-boxes-1block.json'
import asc2AscBlockConflict from './asc-2asc-block-conflict.json'
import craneSplit4Sts from './crane-split-4sts.json'
import loadFixture from './load-1sts-10-boxes-1block.json'
import liveriesMixed from './liveries-mixed.json'
import mixedFixture from './mixed-discharge-then-load.json'
import shc1Sts2Shc1Wtp from './shc-1sts-2shc-1wtp.json'
import tracer1Sts10Boxes from './tracer-1sts-10-boxes.json'
import twin20Lift from './twin-20-lift.json'
import twoVesselsCompeteForBerth from './two-vessels-compete-for-berth.json'

export const fixtures: Record<string, ScenarioConfig> = {
  'tracer-1sts-10-boxes': tracer1Sts10Boxes as ScenarioConfig,
  'two-vessels-compete-for-berth': twoVesselsCompeteForBerth as ScenarioConfig,
  'crane-split-4sts': craneSplit4Sts as ScenarioConfig,
  'twin-20-lift': twin20Lift as ScenarioConfig,
  'shc-1sts-2shc-1wtp': shc1Sts2Shc1Wtp as ScenarioConfig,
  'liveries-mixed': liveriesMixed as ScenarioConfig,
  'asc-1sts-10-boxes-1block': asc1Sts10Boxes1Block as ScenarioConfig,
  'asc-2asc-block-conflict': asc2AscBlockConflict as ScenarioConfig,
  'load-1sts-10-boxes-1block': loadFixture as ScenarioConfig,
  'mixed-discharge-then-load': mixedFixture as ScenarioConfig,
}

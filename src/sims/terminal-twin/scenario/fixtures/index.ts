/**
 * Committed scenario fixtures, loadable by the UI, CLI and tests.
 * Add a fixture: define it in `definitions.ts`, run `pnpm run tt:fixtures`,
 * then import the JSON here.
 */
import type { ScenarioConfig } from '../types'
import asc1Sts10Boxes1Block from './asc-1sts-10-boxes-1block.json'
import asc2AscBlockConflict from './asc-2asc-block-conflict.json'
import craneSplit4Sts from './crane-split-4sts.json'
import dualTruck from './dual-truck-transaction.json'
import truckGateQueue from './truck-gate-queue.json'
import truckAppointmentWindows from './truck-appointment-windows.json'
import truckHoldingOverflow from './truck-holding-overflow.json'
import landsideMorningPeak from './landside-morning-peak.json'
import loadFixture from './load-1sts-10-boxes-1block.json'
import liveriesMixed from './liveries-mixed.json'
import mixedFixture from './mixed-discharge-then-load.json'
import rehandleRandomYard from './rehandle-random-yard.json'
import shc1Sts2Shc1Wtp from './shc-1sts-2shc-1wtp.json'
import tracer1Sts10Boxes from './tracer-1sts-10-boxes.json'
import transshipmentAToB from './transshipment-a-to-b.json'
import emptiesLoad from './empties-load-4-of-16.json'
import yardNoMixedLength from './yard-no-mixed-length.json'
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
  'transshipment-a-to-b': transshipmentAToB as ScenarioConfig,
  'empties-load-4-of-16': emptiesLoad as ScenarioConfig,
  'rehandle-random-yard': rehandleRandomYard as ScenarioConfig,
  'dual-truck-transaction': dualTruck as ScenarioConfig,
  'truck-gate-queue': truckGateQueue as ScenarioConfig,
  'landside-morning-peak': landsideMorningPeak as ScenarioConfig,
  'truck-appointment-windows': truckAppointmentWindows as ScenarioConfig,
  'truck-holding-overflow': truckHoldingOverflow as ScenarioConfig,
  'yard-no-mixed-length': yardNoMixedLength as ScenarioConfig,
}

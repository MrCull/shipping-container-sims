/** Shared test scenario for the paired-ASC tests (TT-08): one block, three SHCs, one feeder call. */
import { ScenarioBuilder } from '../scenario/builder'
import type { ScenarioConfig } from '../scenario/types'

export function twinScenario(
  opts: { ascs?: 1 | 2; boxes?: number; allocation?: string; dispatch?: string; seed?: number } = {},
): ScenarioConfig {
  const b = new ScenarioBuilder('twin', 'two ASCs per block')
    .seed(opts.seed ?? 5)
    .moveVariation(10)
    .driverVariability(10)
    .quay(400, { mooringS: 60, unmooringS: 60 })
    .sts('STS01', { gantryX: 60, groundPositions: 3 })
    .vesselCall('V001', { name: 'Twin Trader', sizeClass: 'feeder', discharge: opts.boxes ?? 16, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
    .shcs(3)
    .block('B01', { x: 20, bays: 10, tiers: 3 })
    .endWhen({ simDurationS: 3600 })
  if (opts.ascs) b.ascsPerBlock(opts.ascs)
  const config = b.build()
  const points: NonNullable<NonNullable<ScenarioConfig['decisions']>['points']> = {}
  if (opts.allocation) points.yardAllocation = { strategy: opts.allocation }
  if (opts.dispatch) points.ascDispatch = { strategy: opts.dispatch }
  if (Object.keys(points).length) config.decisions = { points }
  return config
}

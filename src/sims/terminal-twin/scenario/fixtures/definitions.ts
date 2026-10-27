/**
 * Fixture definitions. Each entry builds one small focused scenario.
 * `npm run tt:fixtures` writes them to `<name>.json` next to this file;
 * a test fails if the committed JSON drifts from these definitions.
 */
import { ScenarioBuilder } from '../builder'
import type { ScenarioConfig } from '../types'

export const fixtureDefinitions: Record<string, () => ScenarioConfig> = {
  /**
   * TT-01 tracer: 1 STS discharges 10 boxes from a minimal vessel onto its
   * STS ground positions. There is no horizontal transport yet, so the
   * crane gets 10 ground positions (real cranes have ~3).
   */
  'tracer-1sts-10-boxes': () =>
    new ScenarioBuilder('tracer-1sts-10-boxes', '1 STS discharges 10 boxes to ground positions')
      .seed(42)
      .moveVariation(10)
      .sts('STS01', { gantryX: 60, groundPositions: 10 })
      .vessel('V001', { name: 'Tracer Express', berthAtS: 60, berthX: 50, stsIds: ['STS01'], bays: 2, rows: 5 })
      .dischargeBoxes('V001', 10)
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /**
   * TT-05: 1 STS → 2 SHC → 1 WTP strip. The STS grounds on 3 lanes; two
   * SHCs carry every box to the 4 WTP pads of block B01 (west of the crane),
   * where the instant ASC stub clears them. Ends at a fixed time, after the
   * last box has reached the yard.
   */
  'shc-1sts-2shc-1wtp': () =>
    new ScenarioBuilder('shc-1sts-2shc-1wtp', '1 STS → 2 SHC → 1 WTP strip: SHCs carry each box to a WTP pad')
      .seed(42)
      .moveVariation(10)
      .driverVariability(10)
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vessel('V001', { name: 'Shuttle Star', berthAtS: 60, berthX: 50, stsIds: ['STS01'], bays: 2, rows: 5 })
      .dischargeBoxes('V001', 10)
      .shcs(2)
      .block('B01', { x: 20, wtpPads: 4 })
      .endWhen({ simDurationS: 1800 })
      .build(),
}

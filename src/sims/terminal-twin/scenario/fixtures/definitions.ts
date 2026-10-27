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
}

/**
 * Fixture definitions. Each entry builds one small focused scenario.
 * `npm run tt:fixtures` writes them to `<name>.json` next to this file;
 * a test fails if the committed JSON drifts from these definitions.
 *
 * Nothing clears STS ground positions until SHCs arrive (TT-05), so these
 * fixtures give each crane enough ground positions for all its boxes
 * (real cranes have ~3).
 */
import { ScenarioBuilder } from '../builder'
import type { ScenarioConfig } from '../types'

export const fixtureDefinitions: Record<string, () => ScenarioConfig> = {
  /** TT-01 tracer: 1 STS discharges 10 × 40 ft boxes from a feeder onto its ground positions. */
  'tracer-1sts-10-boxes': () =>
    new ScenarioBuilder('tracer-1sts-10-boxes', '1 STS discharges 10 boxes to ground positions')
      .seed(42)
      .moveVariation(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 10 })
      .vesselCall('V001', { name: 'Tracer Express', sizeClass: 'feeder', discharge: 10, maxSts: 1, sizeMix: { '40': 1 } })
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /**
   * Two Panamax vessels on a 450 m quay: only one fits. The second waits at
   * anchorage and berths after the first departs.
   */
  'two-vessels-compete-for-berth': () =>
    new ScenarioBuilder('two-vessels-compete-for-berth', 'Two Panamax calls compete for one berth on a 450 m quay')
      .seed(7)
      .quay(450, { mooringS: 600, unmooringS: 600 })
      .sts('STS01', { gantryX: 80, groundPositions: 24 })
      .sts('STS02', { gantryX: 220, groundPositions: 24 })
      .vesselCall('V001', { name: 'HMM Tarifa', sizeClass: 'panamax', arrivalS: 0, discharge: 12, load: 10, maxSts: 2 })
      .vesselCall('V002', { name: 'Maersk Alboran', sizeClass: 'panamax', arrivalS: 300, discharge: 12, load: 10, maxSts: 2 })
      .endWhen({ vesselsCompleted: 2 })
      .build(),

  /** One Neo-Panamax worked by 4 STS: the crane split decides who works which bays. */
  'crane-split-4sts': () =>
    new ScenarioBuilder('crane-split-4sts', '4 STS share one Neo-Panamax call (crane split, rail order)')
      .seed(1)
      .quay(600, { mooringS: 600, unmooringS: 600 })
      .sts('STS01', { gantryX: 40, groundPositions: 30 })
      .sts('STS02', { gantryX: 140, groundPositions: 30 })
      .sts('STS03', { gantryX: 240, groundPositions: 30 })
      .sts('STS04', { gantryX: 340, groundPositions: 30 })
      .vesselCall('V001', { name: 'CMA CGM Gibraltar', sizeClass: 'neo-panamax', discharge: 60, transshipment: 40, maxSts: 4 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /** Twin-20: 4 × 20 ft boxes in two cells, discharged in two twin lifts. */
  'twin-20-lift': () =>
    new ScenarioBuilder('twin-20-lift', '1 STS discharges two pairs of 20 ft boxes with twin-20 lifts')
      .seed(5)
      .quay(400, { mooringS: 60, unmooringS: 60, twinLift: true })
      .sts('STS01', { gantryX: 60, groundPositions: 6 })
      .vesselCall('V001', { name: 'Twin Feeder', sizeClass: 'feeder', discharge: 4, maxSts: 1, sizeMix: { '20': 1 } })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
}

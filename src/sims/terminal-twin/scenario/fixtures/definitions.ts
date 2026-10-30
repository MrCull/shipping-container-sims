/**
 * Fixture definitions. Each entry builds one small focused scenario.
 * `pnpm run tt:fixtures` writes them to `<name>.json` next to this file;
 * a test fails if the committed JSON drifts from these definitions.
 *
 * Nothing clears STS ground positions until SHCs arrive (TT-05), so these
 * fixtures give each crane enough ground positions for all its boxes
 * (real cranes have ~3).
 */
import { ScenarioBuilder } from '../builder'
import { SHIPPING_LINES } from '../lines'
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

  /**
   * TT-05: 1 STS → 2 SHC → 1 WTP strip. The STS grounds on 3 lanes (a
   * realistic count: SHCs clear them); two SHCs carry every box to the 4 WTP
   * pads of block B01 (west of the crane), where the instant ASC clears
   * them. Ends at a fixed time, after the last box has reached the yard.
   */
  'shc-1sts-2shc-1wtp': () =>
    new ScenarioBuilder('shc-1sts-2shc-1wtp', '1 STS → 2 SHC → 1 WTP strip: SHCs carry each box to a WTP pad')
      .seed(42)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Shuttle Star', sizeClass: 'feeder', discharge: 10, maxSts: 1, sizeMix: { '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, wtpPads: 4 })
      .subsystems({ asc: 'instant' })
      .endWhen({ simDurationS: 1800 })
      .build(),

  /**
   * ASC block storage (TT-06): the import flow from vessel to stack. One STS
   * discharges 10 boxes (20 ft and 40 ft mixed) to 2 SHCs; the block (8 bays,
   * 3 tiers, 5 WTP pads) has one ASC that stacks them. Ends at a fixed time,
   * after the last box has been stacked.
   */
  'asc-1sts-10-boxes-1block': () =>
    new ScenarioBuilder('asc-1sts-10-boxes-1block', '1 STS discharges 10 boxes to 1 block: vessel → STS → SHC → WTP pad → ASC → stack')
      .seed(42)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Stack Star', sizeClass: 'feeder', discharge: 10, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 8, tiers: 3 })
      .endWhen({ simDurationS: 1800 })
      .build(),

  /**
   * TT-08 conflict fixture: one block with two ASCs, 30 boxes of 20 and 40 ft
   * spread over the whole block (random slots) and the `balanced` dispatch, so
   * both cranes want overlapping rail segments again and again: waits and
   * step-asides, never a pass or a deadlock.
   */
  'asc-2asc-block-conflict': () =>
    new ScenarioBuilder('asc-2asc-block-conflict', 'Two ASCs share one block rail: overlapping rail needs, waits and step-asides')
      .seed(3)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Twin Trader', sizeClass: 'feeder', discharge: 30, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(3)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .ascsPerBlock(2)
      .decisions({ points: { yardAllocation: { strategy: 'random' }, ascDispatch: { strategy: 'balanced' } } })
      .endWhen({ simDurationS: 4800 })
      .build(),

  /**
   * TT-10 load fixture: the export flow from stack to vessel. One STS loads 10
   * export boxes (20 and 40 ft) booked to a feeder, all standing in block B01:
   * stack → ASC → WTP pad → SHC → ground position → STS → vessel slot.
   */
  'load-1sts-10-boxes-1block': () =>
    new ScenarioBuilder('load-1sts-10-boxes-1block', '1 STS loads 10 export boxes from 1 block: stack → ASC → WTP pad → SHC → STS → vessel')
      .seed(42)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Load Star', sizeClass: 'feeder', discharge: 0, load: 10, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 8, tiers: 3 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /**
   * TT-10 mixed fixture: one vessel call discharges 8 boxes and then loads 8
   * export boxes with the same crane (discharge packages first, then load
   * packages); the vessel departs when both are done.
   */
  'mixed-discharge-then-load': () =>
    new ScenarioBuilder('mixed-discharge-then-load', '1 STS discharges 8 boxes, then loads 8 export boxes, and the vessel departs')
      .seed(7)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Mixed Star', sizeClass: 'feeder', discharge: 8, load: 8, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /**
   * TT-11 transshipment fixture: vessel A discharges 8 transshipment boxes, they
   * dwell 10 minutes in the yard, and vessel B (arriving later) loads them.
   */
  'transshipment-a-to-b': () =>
    new ScenarioBuilder('transshipment-a-to-b', 'Vessel A discharges 8 transshipment boxes; vessel B loads them after a 10 minute yard dwell')
      .seed(5)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('VA', { name: 'Feeder Alpha', sizeClass: 'feeder', arrivalS: 0, discharge: 8, dischargeTransshipment: 8, maxSts: 1, sizeMix: { '40': 1 } })
      .vesselCall('VB', { name: 'Feeder Bravo', sizeClass: 'feeder', arrivalS: 1500, transshipment: 8, maxSts: 1, sizeMix: { '40': 1 } })
      .transshipmentDwell({ kind: 'fixed', s: 600 })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 1 }) // one tier: nothing is buried (rehandles are TT-12)
      .endWhen({ vesselsCompleted: 2 })
      .build(),

  /**
   * TT-11 empties fixture: a feeder loads 4 empty 40 ft MSC containers. The yard holds a
   * pool of 16 empties (40 ft, MSC and Maersk) of varying age.
   */
  'empties-load-4-of-16': () =>
    new ScenarioBuilder('empties-load-4-of-16', 'A feeder loads 4 empty 40 ft MSC containers picked from a pool of 16 empties')
      .seed(11)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Empty Star', sizeClass: 'feeder', maxSts: 1, empties: [{ size: '40', line: 'MSC', count: 4 }] })
      .emptyPool({ count: 16, sizeMix: { '40': 1 }, lines: { MSC: 1, Maersk: 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /**
   * TT-R07: mixed 20 and 40 ft stows across hold and deck. A feeder discharges 140 mixed boxes (an odd number of 20s
   * is possible), loads 40 export boxes and 6 empty 20s: on board no 20 ft box sits on a 40 ft box and a 40 ft box
   * rests only on a 40 or on two filled 20 ft halves (`stowage.order`).
   */
  'stow-mixed-20-40': () =>
    new ScenarioBuilder('stow-mixed-20-40', 'A feeder stows mixed 20 and 40 ft boxes in hold and on deck: never a 20 on a 40')
      .seed(7)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', {
        name: 'Mixed Star',
        sizeClass: 'feeder',
        discharge: 140,
        load: 40,
        maxSts: 1,
        sizeMix: { '20': 2, '40': 1, '40HC': 1 },
        empties: [{ size: '20', line: 'MSC', count: 6 }],
      })
      .emptyPool({ count: 8, sizeMix: { '20': 1 }, lines: { MSC: 1 } })
      .shcs(3)
      .block('B01', { x: 20, bays: 20, tiers: 4 })
      .ascsPerBlock(2)
      .endWhen({ vesselsCompleted: 1 })
      .build(),

  /**
   * TT-R06: a yard stack takes the length of its bottom box. A 50% pre-filled block (mixed 20 and 40 ft boxes,
   * 8 bays x 3 tiers) receives 24 more mixed boxes through the default `nearest-wtp` allocation: no stack ever
   * holds both lengths (`yard.no-mixed-length-stack`), and 40 ft boxes keep to adjacent bay pairs.
   */
  'yard-no-mixed-length': () =>
    new ScenarioBuilder('yard-no-mixed-length', 'A pre-filled yard takes mixed 20 and 40 ft boxes: every stack keeps one length')
      .seed(6)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Length Star', sizeClass: 'feeder', discharge: 24, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 8, tiers: 3 })
      .yardStart({ mode: 'prefilled', targetPct: 50 })
      .endWhen({ simDurationS: 3600 })
      .build(),

  /**
   * TT-12 rehandle fixture: a random yard. Vessel V001 discharges 36 boxes into block B01 with
   * the `random` allocation, so imports land on the stacks where the export boxes of V002
   * (arriving later) stand. V002's retrievals then find buried boxes: every blocker is
   * rehandled (extra ASC moves) before the productive move.
   */
  'rehandle-random-yard': () =>
    new ScenarioBuilder('rehandle-random-yard', 'Random yard allocation buries export boxes: the ASC rehandles blockers before each retrieval')
      .seed(2)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 36, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V002', { name: 'Export Star', sizeClass: 'feeder', discharge: 0, load: 24, arrivalS: 5400, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(3)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .decisions({ points: { yardAllocation: { strategy: 'random' } } })
      .endWhen({ vesselsCompleted: 2 })
      .build(),

  /**
   * TT-13 dual truck transaction: a feeder discharges 8 boxes (imports, 5 min yard dwell), and one
   * scripted truck arrives later to drop an export box for the second vessel (inside its export
   * window) and pick up one import in the same visit. Two ASCs per block: the landside ASC serves the stall.
   */
  'dual-truck-transaction': () =>
    new ScenarioBuilder('dual-truck-transaction', 'One truck drops an export and picks up an import in a single visit')
      .seed(3)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 8, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V002', { name: 'Export Star', sizeClass: 'feeder', arrivalS: 20000, load: 4, maxSts: 1 })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .ascsPerBlock(2)
      .landside({
        hourlyProfile: Array.from({ length: 24 }, () => 0),
        importDwell: { kind: 'fixed', s: 300 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
        gate: { inLanes: 2, outLanes: 2 },
        scripted: [{ atS: 3000, transaction: 'dual' }],
      })
      .endWhen({ simDurationS: 4500 })
      .build(),

  /**
   * TT-13 gate queue: the same terminal with 16 imports and a burst of 14 scripted trucks (one inbound lane,
   * two outbound lanes) so a queue forms at the gate and trucks wait for transfer stalls.
   */
  'truck-gate-queue': () =>
    new ScenarioBuilder('truck-gate-queue', 'A burst of 14 trucks queues at a one-lane gate and fills the transfer stalls')
      .seed(8)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 16, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V002', { name: 'Export Star', sizeClass: 'feeder', arrivalS: 20000, load: 4, maxSts: 1 })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 3, transferStalls: 2 })
      .ascsPerBlock(2)
      .landside({
        hourlyProfile: Array.from({ length: 24 }, () => 0),
        importDwell: { kind: 'fixed', s: 300 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
        gate: { inLanes: 1, outLanes: 2, inProcessingS: 45, outProcessingS: 20 },
        scripted: [
          { atS: 3000, transaction: 'pickImport' },
          { atS: 3010, transaction: 'dropExport' },
          { atS: 3020, transaction: 'dual' },
          { atS: 3030, transaction: 'dropEmpty' },
          { atS: 3040, transaction: 'pickImport' },
          { atS: 3050, transaction: 'dropExport' },
          { atS: 3060, transaction: 'dual' },
          { atS: 3070, transaction: 'dropEmpty' },
          { atS: 3080, transaction: 'pickImport' },
          { atS: 3090, transaction: 'dropExport' },
          { atS: 3100, transaction: 'dual' },
          { atS: 3110, transaction: 'dropEmpty' },
          { atS: 3120, transaction: 'pickEmpty' },
          { atS: 3130, transaction: 'pickImport' },
        ],
      })
      .endWhen({ simDurationS: 9000 })
      .build(),

  /**
   * TT-13 morning peak: two blocks, a feeder discharging 24 boxes, and the 07:00 truck profile (Poisson,
   * 40 to 48 trucks an hour) with the default transaction mix and a 10 minute import dwell.
   */
  'landside-morning-peak': () =>
    new ScenarioBuilder('landside-morning-peak', 'Poisson truck arrivals through a 4-lane gate to two blocks with paired ASCs')
      .seed(21)
      .moveVariation(10)
      .driverVariability(10)
      .startAt('2026-01-05T07:00:00Z')
      .clockStart(7 * 3600)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 24, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V002', { name: 'Export Star', sizeClass: 'feeder', arrivalS: 30000, load: 4, maxSts: 1 })
      .shcs(3)
      .block('B01', { x: 20, bays: 12, tiers: 3 })
      .block('B02', { x: 60, bays: 12, tiers: 3 })
      .ascsPerBlock(2)
      .landside({
        importDwell: { kind: 'fixed', s: 600 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 40000 },
      })
      .endWhen({ simDurationS: 5400 })
      .build(),

  /** Livery smoke test (TT-22): 12 boxes over all ten lines (equal weights) and all three sizes. */
  'liveries-mixed': () =>
    new ScenarioBuilder('liveries-mixed', '1 STS discharges 12 boxes of mixed lines and sizes')
      .seed(7)
      .moveVariation(10)
      .quay(400, { mooringS: 30, unmooringS: 30, twinLift: false })
      .sts('STS01', { gantryX: 60, groundPositions: 12 })
      .cargo({
        lines: Object.fromEntries(SHIPPING_LINES.map((l) => [l, 1])),
        sizeMix: { '20': 1, '40': 1, '40HC': 1 },
      })
      .vesselCall('V001', { name: 'Livery Trader', sizeClass: 'feeder', discharge: 12, maxSts: 1 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
}

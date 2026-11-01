/**
 * Fixture definitions. Each entry builds one small focused scenario.
 * `pnpm run tt:fixtures` writes them to `<name>.json` next to this file;
 * a test fails if the committed JSON drifts from these definitions.
 *
 * Nothing clears STS ground positions until SHCs arrive (TT-05), so these
 * fixtures give each crane enough ground positions for all its boxes
 * (real cranes have ~3).
 *
 * Hatch covers (TT-R09) are on by default. Every fixture here except the two `hatch-*` ones turns them off
 * (`.hatch({ enabled: false })`): they test other subsystems and their goldens and tests are about those.
 */
import { ScenarioBuilder } from '../builder'
import { SHIPPING_LINES } from '../lines'
import type { ScenarioConfig } from '../types'

/** Headings of the start screen's Test benches list, in display order. */
export const FIXTURE_GROUPS = [
  { id: 'flows', title: 'Container flows' },
  { id: 'quay', title: 'Quay and ships' },
  { id: 'shuttle', title: 'Shuttle carriers' },
  { id: 'yard', title: 'Yard and cranes' },
  { id: 'gate', title: 'Gate and trucks' },
] as const

export type FixtureGroupId = (typeof FIXTURE_GROUPS)[number]['id']

/**
 * What the start screen shows for a test bench (#145). Plain English, for someone who does not know the engine.
 * It lives with the definition, so a fixture cannot be added without it; display only, it never feeds the event log.
 */
export interface FixtureCopy {
  group: FixtureGroupId
  /** Plain name shown in the list and as the detail heading. */
  name: string
  /** One line: what the bench is. */
  summary: string
  /** What it shows (a short paragraph). */
  description: string
  /** What to watch for while it runs. */
  watch: string
}

export interface FixtureDefinition extends FixtureCopy {
  build: () => ScenarioConfig
}

const fixtureEntries: Record<string, FixtureDefinition> = {
  /** TT-01 tracer: 1 STS discharges 10 × 40 ft boxes from a feeder onto its ground positions. */
  'tracer-1sts-10-boxes': {
    group: 'flows',
    name: 'Smallest working terminal',
    summary: 'One crane discharges ten boxes to the ground. The first thing to run.',
    description: 'A single ship-to-shore crane unloads ten 40 ft boxes from a small feeder ship onto ground positions on the quay. There is no yard, no shuttle carrier and no trucks, so nothing else can get in the way.',
    watch: 'Watch the crane lift each box from the ship and set it down, and the ship moor, work and leave. If this looks wrong, nothing larger will look right.',
    build: () =>
    new ScenarioBuilder('tracer-1sts-10-boxes', '1 STS discharges 10 boxes to ground positions')
      .hatch({ enabled: false })
      .seed(42)
      .moveVariation(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 10 })
      .vesselCall('V001', { name: 'Tracer Express', sizeClass: 'feeder', discharge: 10, maxSts: 1, sizeMix: { '40': 1 } })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /**
   * Two Panamax vessels on a 450 m quay: only one fits. The second waits at
   * anchorage and berths after the first departs.
   */
  'two-vessels-compete-for-berth': {
    group: 'quay',
    name: 'Two ships, one berth',
    summary: 'Two Panamax ships compete for one berth on a 450 m quay.',
    description: 'Two Panamax ships arrive five minutes apart but only one fits on the 450 m quay. The second waits at anchorage and berths after the first one has gone.',
    watch: 'Watch the second ship wait outside, then move in once the berth is free.',
    build: () =>
    new ScenarioBuilder('two-vessels-compete-for-berth', 'Two Panamax calls compete for one berth on a 450 m quay')
      .hatch({ enabled: false })
      .seed(7)
      .quay(450, { mooringS: 600, unmooringS: 600 })
      .sts('STS01', { gantryX: 80, groundPositions: 24 })
      .sts('STS02', { gantryX: 220, groundPositions: 24 })
      .vesselCall('V001', { name: 'HMM Tarifa', sizeClass: 'panamax', arrivalS: 0, discharge: 12, load: 10, maxSts: 2 })
      .vesselCall('V002', { name: 'Maersk Alboran', sizeClass: 'panamax', arrivalS: 300, discharge: 12, load: 10, maxSts: 2 })
      .endWhen({ vesselsCompleted: 2 })
      .build(),
  },

  /** One Neo-Panamax worked by 4 STS: the crane split decides who works which bays. */
  'crane-split-4sts': {
    group: 'quay',
    name: 'Four cranes on one ship',
    summary: 'Four cranes share a single large vessel call and keep to their rail order.',
    description: 'A large Neo-Panamax ship with 100 boxes to discharge or transship is worked by four ship-to-shore cranes on a 600 m quay. The cranes split the ship into sections between them.',
    watch: 'Watch which crane takes which part of the ship, and how the cranes stay in order along the rail without passing each other.',
    build: () =>
    new ScenarioBuilder('crane-split-4sts', '4 STS share one Neo-Panamax call (crane split, rail order)')
      .hatch({ enabled: false })
      .seed(1)
      .quay(600, { mooringS: 600, unmooringS: 600 })
      .sts('STS01', { gantryX: 40, groundPositions: 30 })
      .sts('STS02', { gantryX: 140, groundPositions: 30 })
      .sts('STS03', { gantryX: 240, groundPositions: 30 })
      .sts('STS04', { gantryX: 340, groundPositions: 30 })
      .vesselCall('V001', { name: 'CMA CGM Gibraltar', sizeClass: 'neo-panamax', discharge: 60, transshipment: 40, maxSts: 4 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /** Twin-20: 4 × 20 ft boxes in two cells, discharged in two twin lifts. */
  'twin-20-lift': {
    group: 'quay',
    name: 'Twin 20 ft lifts',
    summary: 'One crane lifts pairs of 20 ft boxes together.',
    description: 'A feeder carries four 20 ft boxes in two cells. The crane has twin-lift switched on, so it picks two boxes in one lift instead of four separate lifts.',
    watch: 'Count the lifts: two lifts for four boxes. Compare the cycle time with the smallest working terminal.',
    build: () =>
    new ScenarioBuilder('twin-20-lift', '1 STS discharges two pairs of 20 ft boxes with twin-20 lifts')
      .hatch({ enabled: false })
      .seed(5)
      .quay(400, { mooringS: 60, unmooringS: 60, twinLift: true })
      .sts('STS01', { gantryX: 60, groundPositions: 6 })
      .vesselCall('V001', { name: 'Twin Feeder', sizeClass: 'feeder', discharge: 4, maxSts: 1, sizeMix: { '20': 1 } })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /**
   * TT-05: 1 STS → 2 SHC → 1 WTP strip. The STS grounds on 3 lanes (a
   * realistic count: SHCs clear them); two SHCs carry every box to the 4 WTP
   * pads of block B01 (west of the crane), where the instant ASC clears
   * them. Ends at a fixed time, after the last box has reached the yard.
   */
  'shc-1sts-2shc-1wtp': {
    group: 'shuttle',
    name: 'Shuttle carriers: one crane, two carriers',
    summary: 'Two carriers take each box from the crane to a transfer pad.',
    description: 'One crane unloads ten boxes and sets them on three ground positions. Two shuttle carriers lift each box from the ground and drive it to a transfer pad at the yard block, where the stacking crane takes it.',
    watch: 'Watch the carriers clear the ground positions so the crane never has to wait, then return to the quay. The run ends at a fixed time.',
    build: () =>
    new ScenarioBuilder('shc-1sts-2shc-1wtp', '1 STS → 2 SHC → 1 WTP strip: SHCs carry each box to a WTP pad')
      .hatch({ enabled: false })
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
  },

  /**
   * SHC queue areas and chained dispatch (TT-R12): 2 STS discharge 24 boxes with 4 SHCs to a block with
   * 1 WTP pad and a real ASC, so pads are scarce: SHCs carrying a box wait at the block queue area for a pad,
   * and with `chained-nearest` idle SHCs wait at the STS queue area instead of driving back to parking.
   */
  'shc-queue-chained': {
    group: 'shuttle',
    name: 'Shuttle carriers: queues and chaining',
    summary: 'Four carriers share one pad, with waiting areas and nearest-job dispatch.',
    description: 'Two cranes unload 24 boxes with four carriers to a block that has only one transfer pad. Carriers wait in queue areas at the crane and at the block, and idle carriers wait near the crane instead of driving home.',
    watch: 'Watch the queue build at the pad and the carriers line up in the waiting areas.',
    build: () =>
    new ScenarioBuilder('shc-queue-chained', '2 STS → 4 SHC → 1 WTP pad: queue areas and chained-nearest dispatch')
      .hatch({ enabled: false })
      .seed(42)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .sts('STS02', { gantryX: 110, groundPositions: 3 })
      .vesselCall('V001', { name: 'Queue Star', sizeClass: 'feeder', discharge: 24, maxSts: 2, sizeMix: { '40': 1 } })
      .shcs(4)
      .block('B01', { x: 20, bays: 8, tiers: 3, wtpPads: 1 })
      .queueAreas({ stsCapacity: 2, blockCapacity: 2 })
      .decisions({ points: { shcDispatch: { strategy: 'chained-nearest' }, yardAllocation: { strategy: 'nearest-wtp' } } }) // SHC fixtures isolate dispatch from yard decking (#114)
      .build(),
  },

  /**
   * SHC pre-dispatch (TT-R13): 2 STS with one ground position each (so a box left waiting blocks the crane), 4 SHCs
   * and a 3-pad block. With the `predispatch` strategy idle SHCs are sent to the STS queue area when a box is
   * predicted ready within their travel time plus `predispatchMarginS`, so they are there when it lands; the
   * `chained-nearest` baseline (same scenario) leaves the cranes waiting for SHCs.
   */
  'shc-prepositioning': {
    group: 'shuttle',
    name: 'Shuttle carriers: moving early',
    summary: 'Carriers set off before the box is ready, based on the predicted ready time.',
    description: 'Two cranes with one ground position each, four carriers and a three-pad block. Idle carriers are sent to the crane waiting area early, based on when the next box is predicted to be ready.',
    watch: 'Watch carriers already waiting when a box lands, so the crane does not stand idle.',
    build: () =>
    new ScenarioBuilder('shc-prepositioning', '2 STS (1 ground position) → 4 SHC → 3 pads: pre-dispatch on predicted ready time')
      .hatch({ enabled: false })
      .seed(42)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 1 })
      .sts('STS02', { gantryX: 110, groundPositions: 1 })
      .vesselCall('V001', { name: 'Pre Star', sizeClass: 'feeder', discharge: 24, maxSts: 2, sizeMix: { '40': 1 } })
      .shcs(4)
      .block('B01', { x: 20, bays: 8, tiers: 3, wtpPads: 3 })
      .queueAreas({ stsCapacity: 3, blockCapacity: 3, predispatchMarginS: 15 })
      .decisions({ points: { shcDispatch: { strategy: 'predispatch' }, yardAllocation: { strategy: 'nearest-wtp' } } }) // SHC fixtures isolate dispatch from yard decking (#114)
      .build(),
  },

  /**
   * Paired dispatch (TT-R14): one feeder discharges at STS01 while another loads at STS02 (so discharge and load jobs
   * are open together), 3 SHCs and a 2-pad block 150 m from the quay start. With `paired-dual-cycle` an SHC that just
   * set a box down on a pad takes a nearby load pickup (and after a load drop at the quay a discharge box), so it
   * drives loaded more often; the `chained-nearest` baseline (same scenario) drives more empty.
   */
  'shc-paired-dual-cycle': {
    group: 'shuttle',
    name: 'Shuttle carriers: paired dual cycling',
    summary: 'One crane discharges while another loads, and carriers pair the two jobs.',
    description: 'One feeder is unloaded at the first crane while another is loaded at the second. Three carriers use the paired dispatch: after dropping a box at a pad a carrier takes a nearby export box back to the quay.',
    watch: 'Watch carriers drive loaded in both directions more often than with the plain nearest-job rule.',
    build: () =>
    new ScenarioBuilder('shc-paired-dual-cycle', '2 STS (one discharges, one loads) → 3 SHC → 2 pads: paired discharge/load dispatch')
      .hatch({ enabled: false })
      .seed(48) // the pairing advantage is plan-dependent: seed 48 shows it with the V-shaped holds (#131), as 42 did before
      .moveVariation(10)
      .driverVariability(10)
      .quay(500, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 4 })
      .sts('STS02', { gantryX: 110, groundPositions: 4 })
      .vesselCall('V001', { name: 'Dis Star', sizeClass: 'feeder', arrivalS: 0, discharge: 16, maxSts: 1, sizeMix: { '40': 1 } })
      .vesselCall('V002', { name: 'Load Star', sizeClass: 'feeder', arrivalS: 0, load: 16, maxSts: 1, sizeMix: { '40': 1 } })
      .shcs(3)
      .block('B01', { x: 150, bays: 10, tiers: 3, wtpPads: 2 })
      .queueAreas({ stsCapacity: 2, blockCapacity: 2 })
      .decisions({ points: { shcDispatch: { strategy: 'paired-dual-cycle' }, yardAllocation: { strategy: 'nearest-wtp' } } }) // SHC fixtures isolate dispatch from yard decking (#114)
      .endWhen({ vesselsCompleted: 2 })
      .build(),
  },

  /**
   * ASC block storage (TT-06): the import flow from vessel to stack. One STS
   * discharges 10 boxes (20 ft and 40 ft mixed) to 2 SHCs; the block (8 bays,
   * 3 tiers, 5 WTP pads) has one ASC that stacks them. Ends at a fixed time,
   * after the last box has been stacked.
   */
  'asc-1sts-10-boxes-1block': {
    group: 'flows',
    name: 'Discharge to the yard',
    summary: 'One crane sends ten boxes through the whole chain into a yard stack.',
    description: 'One crane unloads ten boxes of mixed 20 ft and 40 ft length. Two shuttle carriers take them to a transfer pad, and an automated stacking crane lifts each one onto a stack in a single yard block.',
    watch: 'Follow one box from ship to crane, carrier, pad and stack. The run ends at a fixed time, once the last box is stacked.',
    build: () =>
    new ScenarioBuilder('asc-1sts-10-boxes-1block', '1 STS discharges 10 boxes to 1 block: vessel → STS → SHC → WTP pad → ASC → stack')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-08 conflict fixture: one block with two ASCs, 30 boxes of 20 and 40 ft
   * spread over the whole block (random slots) and the `balanced` dispatch, so
   * both cranes want overlapping rail segments again and again: waits and
   * step-asides, never a pass or a deadlock.
   */
  'asc-2asc-block-conflict': {
    group: 'yard',
    name: 'Yard cranes: sharing one rail',
    summary: 'Two automated stacking cranes on one block wait and step aside for each other.',
    description: 'One yard block with two stacking cranes and 30 boxes spread over the whole block. Both cranes keep needing the same stretch of rail.',
    watch: 'Watch one crane wait or step aside for the other. The cranes never pass each other and never deadlock.',
    build: () =>
    new ScenarioBuilder('asc-2asc-block-conflict', 'Two ASCs share one block rail: overlapping rail needs, waits and step-asides')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-10 load fixture: the export flow from stack to vessel. One STS loads 10
   * export boxes (20 and 40 ft) booked to a feeder, all standing in block B01:
   * stack → ASC → WTP pad → SHC → ground position → STS → vessel slot.
   */
  'load-1sts-10-boxes-1block': {
    group: 'flows',
    name: 'Load from the yard',
    summary: 'Ten export boxes travel from the stack to the vessel, the chain in reverse.',
    description: 'Ten export boxes already stand in a yard block. The stacking crane fetches each one to a transfer pad, a shuttle carrier brings it to the quay and the ship-to-shore crane loads it into its slot on the ship.',
    watch: 'Watch the boxes leave the stack in order and arrive at the ship. The run ends when the vessel has finished loading.',
    build: () =>
    new ScenarioBuilder('load-1sts-10-boxes-1block', '1 STS loads 10 export boxes from 1 block: stack → ASC → WTP pad → SHC → STS → vessel')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-10 mixed fixture: one vessel call discharges 8 boxes and then loads 8
   * export boxes with the same crane (discharge packages first, then load
   * packages); the vessel departs when both are done.
   */
  'mixed-discharge-then-load': {
    group: 'flows',
    name: 'Discharge, then load',
    summary: 'One crane unloads eight boxes, loads eight, and the ship departs.',
    description: 'One ship call has both jobs: the crane first unloads eight boxes, then loads eight export boxes from the yard. The ship leaves only when both are done.',
    watch: 'Watch the crane switch from unloading to loading, and the departure that waits for the last box.',
    build: () =>
    new ScenarioBuilder('mixed-discharge-then-load', '1 STS discharges 8 boxes, then loads 8 export boxes, and the vessel departs')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-11 transshipment fixture: vessel A discharges 8 transshipment boxes, they
   * dwell 10 minutes in the yard, and vessel B (arriving later) loads them.
   */
  'transshipment-a-to-b': {
    group: 'flows',
    name: 'Transshipment between two ships',
    summary: 'Ship A discharges eight boxes and ship B loads them after a 10 minute yard stay.',
    description: 'Boxes that change ships at this terminal: ship A unloads eight transshipment boxes, they wait ten minutes in the yard, and ship B, arriving later, loads them.',
    watch: 'Watch the boxes sit in the yard between the two calls, and ship B start loading only when they are ready.',
    build: () =>
    new ScenarioBuilder('transshipment-a-to-b', 'Vessel A discharges 8 transshipment boxes; vessel B loads them after a 10 minute yard dwell')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-11 empties fixture: a feeder loads 4 empty 40 ft MSC containers. The yard holds a
   * pool of 16 empties (40 ft, MSC and Maersk) of varying age.
   */
  'empties-load-4-of-16': {
    group: 'yard',
    name: 'Loading empties from a pool',
    summary: 'A feeder loads 4 empty 40 ft MSC boxes picked from 16.',
    description: 'The yard holds a pool of 16 empty 40 ft boxes of MSC and Maersk, of different ages. A feeder asks for four empty MSC boxes.',
    watch: 'Watch which four are picked and that only MSC boxes leave.',
    build: () =>
    new ScenarioBuilder('empties-load-4-of-16', 'A feeder loads 4 empty 40 ft MSC containers picked from a pool of 16 empties')
      .hatch({ enabled: false })
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
  },

  /**
   * Spec #106 (#112): the opt-in `iso-type-best-position` empty allocation. A feeder loads 18 empty 40 ft boxes (ISO 42G1)
   * for MSC; the yard holds 24 empty 40s of MSC and Maersk stacked up to 2 high, plus 6 empty 20s that never match. The line
   * is ignored, so Maersk empties go too, and the boxes with the fewest boxes on top are picked first; the buried ones
   * picked last are dug out by the ASC (rehandles).
   */
  'empty-allocation-iso': {
    group: 'yard',
    name: 'Choosing empties by type',
    summary: 'Eighteen empty 40 ft boxes picked by ISO type and best yard position.',
    description: 'A feeder loads 18 empty 40 ft boxes. The yard holds 24 empty 40s of two lines, stacked up to two high, and six empty 20s that never match. The line is ignored; the boxes with the fewest boxes on top go first.',
    watch: 'Watch the easy boxes go first and the buried ones come last, after the crane digs them out.',
    build: () =>
    new ScenarioBuilder('empty-allocation-iso', 'A feeder loads 18 empty 40 ft boxes picked by ISO type and best yard position (any line)')
      .hatch({ enabled: false })
      .seed(12)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Iso Star', sizeClass: 'feeder', maxSts: 1, empties: [{ size: '40', line: 'MSC', count: 18 }] })
      .emptyPool({ count: 30, sizeMix: { '40': 4, '20': 1 }, lines: { MSC: 1, Maersk: 1 } })
      .decisions({ points: { emptyAllocation: { strategy: 'iso-type-best-position' } } })
      .shcs(2)
      .block('B01', { x: 20, bays: 4, tiers: 2 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /**
   * TT-R07: mixed 20 and 40 ft stows across hold and deck. A feeder discharges 140 mixed boxes (an odd number of 20s
   * is possible), loads 40 export boxes and 6 empty 20s: on board no 20 ft box sits on a 40 ft box and a 40 ft box
   * rests only on a 40 or on two filled 20 ft halves (`stowage.order`).
   */
  'stow-mixed-20-40': {
    group: 'quay',
    name: 'Stowing 20 ft and 40 ft boxes',
    summary: 'Mixed sizes in hold and on deck, and never a 20 ft box on top of a 40.',
    description: 'A feeder discharges 140 mixed boxes and loads 40 export boxes plus six empty 20 ft boxes. The stowage rules are on: no 20 ft box sits on a 40 ft box.',
    watch: 'Look at the loaded ship in the bay viewer. A 40 ft box may rest only on a 40 ft box or on two filled 20 ft halves.',
    build: () =>
    new ScenarioBuilder('stow-mixed-20-40', 'A feeder stows mixed 20 and 40 ft boxes in hold and on deck: never a 20 on a 40')
      .hatch({ enabled: false })
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
  },

  /**
   * Spec #106 (#113): `vesselPlanning.ordering = 'pod-weight'` on a feeder that discharges 60 mixed boxes and loads 40
   * (hold and deck, hatch covers on, empties included): stack-by-stack discharge in yard-group order, bottom-up
   * POD- and weight-aware load. Zero invariant violations; the KPI report counts the broken preferences.
   */
  'vessel-ordering-pod-weight': {
    group: 'quay',
    name: 'Stowage by destination and weight',
    summary: 'Later ports and heavy boxes go low in each stack.',
    description: 'A feeder discharges 60 boxes stack by stack in yard-group order and loads 40, using the work order that puts boxes for later ports and heavier boxes lower in a stack.',
    watch: 'Check the loaded stacks in the bay viewer, and the final report, which counts how many preferences were broken.',
    build: () =>
    new ScenarioBuilder('vessel-ordering-pod-weight', 'A feeder discharges and loads with the pod-weight work order: stacks by yard group, later PODs and heavy boxes low')
      .seed(7)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', {
        name: 'Ordering Star',
        sizeClass: 'feeder',
        discharge: 60,
        load: 40,
        maxSts: 1,
        sizeMix: { '20': 2, '40': 1, '40HC': 1 },
        empties: [{ size: '20', line: 'MSC', count: 4 }],
      })
      .emptyPool({ count: 8, sizeMix: { '20': 1 }, lines: { MSC: 1 } })
      .vesselPlanning({ ordering: 'pod-weight' })
      .shcs(3)
      .block('B01', { x: 20, bays: 20, tiers: 4 })
      .ascsPerBlock(2)
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /**
   * TT-R06: a yard stack takes the length of its bottom box. A 50% pre-filled block (mixed 20 and 40 ft boxes,
   * 8 bays x 3 tiers) receives 24 more mixed boxes through the default `nearest-wtp` allocation: no stack ever
   * holds both lengths (`yard.no-mixed-length-stack`), and 40 ft boxes keep to adjacent bay pairs.
   */
  'yard-no-mixed-length': {
    group: 'yard',
    name: 'Yard stacks keep one length',
    summary: 'A pre-filled yard takes 20 ft and 40 ft boxes without mixing lengths in a stack.',
    description: 'A half-full block of mixed boxes receives 24 more through the normal nearest-pad rule. A stack takes the length of its bottom box.',
    watch: 'Check that no stack ever holds both lengths and that 40 ft boxes keep to pairs of neighbouring bays.',
    build: () =>
    new ScenarioBuilder('yard-no-mixed-length', 'A pre-filled yard takes mixed 20 and 40 ft boxes: every stack keeps one length')
      .hatch({ enabled: false })
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
  },

  /**
   * Spec #106 (#111): grouped yard decking. V001 discharges 40 boxes of three lines (10 of them transshipment boxes
   * for V002), trucks bring export boxes for V002 and storage empties wait in the yard, all decked by the opt-in
   * `grouped` strategy (imports by line, exports by vessel and POD with heavy at the bottom, transshipment by onward
   * vessel and POD, empties by line, size and type). Zero invariant violations; the KPI report counts the grouping
   * preferences the placements broke.
   */
  'yard-grouped': {
    group: 'yard',
    name: 'Yard stacking by group',
    summary: 'Imports by line, exports by ship and port, transshipment and empties apart.',
    description: 'Two ships, trucks bringing exports and empties already in the yard, all stacked with the grouped strategy: imports by shipping line, exports by ship and port, transshipment by onward ship, empties by line and size.',
    watch: 'Look at the yard and its colours. The final report counts how many grouping preferences were broken.',
    build: () =>
    new ScenarioBuilder('yard-grouped', 'Grouped yard decking: imports by line, exports by vessel and POD, transshipment and empties in their own groups')
      .hatch({ enabled: false })
      .seed(31)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .cargo({ lines: { HMM: 3, MSC: 2, Maersk: 2 }, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V001', { name: 'Group Star', sizeClass: 'feeder', discharge: 40, dischargeTransshipment: 10, maxSts: 1 })
      .vesselCall('V002', { name: 'Deck Star', sizeClass: 'feeder', arrivalS: 9000, discharge: 0, load: 16, transshipment: 10, maxSts: 1 })
      .transshipmentDwell({ kind: 'fixed', s: 600 })
      .emptyPool({ count: 12, sizeMix: { '20': 1, '40': 1 }, lines: { HMM: 1, MSC: 1 } })
      .decisions({ points: { yardAllocation: { strategy: 'grouped' } } })
      .shcs(3)
      .block('B01', { x: 20, bays: 14, tiers: 4 })
      .ascsPerBlock(2)
      .landside({
        hourlyProfile: new Array<number>(24).fill(15),
        importDwell: { kind: 'fixed', s: 1800 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 8000 },
      })
      .endWhen({ vesselsCompleted: 2 })
      .build(),
  },

  /**
   * TT-R19: 30% of the full boxes are reefers. The block has plugs in rows 1 and 2 only (an unverified, TTI-like
   * layout), so every reefer, discharged or pre-filled, stands in those rows at most 4 tiers high
   * (`yard.reefer-powered`) while plain boxes avoid the powered rows when anything else fits.
   */
  'reefer-powered-rows': {
    group: 'yard',
    name: 'Reefers in powered rows',
    summary: 'A third of the boxes are reefers: powered rows only, at most 4 high.',
    description: 'Thirty percent of the boxes are refrigerated. The block has power plugs in rows 1 and 2 only, so every reefer goes there and stacks at most four high.',
    watch: 'Switch the colour mode to reefers and check that none stands outside a powered row.',
    build: () =>
    new ScenarioBuilder('reefer-powered-rows', 'A third of the boxes are reefers: they stack only in the powered rows, at most 4 high')
      .hatch({ enabled: false })
      .seed(19)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Cold Star', sizeClass: 'feeder', discharge: 24, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .cargo({ reeferShare: 0.3 })
      .block('B01', { x: 20, bays: 8, tiers: 5, poweredRows: [1, 2] })
      .yardStart({ mode: 'prefilled', targetPct: 40 })
      .endWhen({ simDurationS: 3600 })
      .build(),
  },

  /**
   * TT-12 rehandle fixture: a random yard. Vessel V001 discharges 36 boxes into block B01 with
   * the `random` allocation, so imports land on the stacks where the export boxes of V002
   * (arriving later) stand. V002's retrievals then find buried boxes: every blocker is
   * rehandled (extra ASC moves) before the productive move.
   */
  'rehandle-random-yard': {
    group: 'yard',
    name: 'Yard cranes: digging out buried boxes',
    summary: 'Random stacking buries exports, so the crane moves blockers first.',
    description: 'Ship 1 unloads 36 boxes into a block at random positions, on top of where the export boxes for ship 2 stand. When ship 2 loads, many of its boxes are buried.',
    watch: 'Watch the crane lift each blocker aside before the box it wants. These extra moves are rehandles, and they show up in the KPIs.',
    build: () =>
    new ScenarioBuilder('rehandle-random-yard', 'Random yard allocation buries export boxes: the ASC rehandles blockers before each retrieval')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-13 dual truck transaction: a feeder discharges 8 boxes (imports, 5 min yard dwell), and one
   * scripted truck arrives later to drop an export box for the second vessel (inside its export
   * window) and pick up one import in the same visit. Two ASCs per block: the landside ASC serves the stall.
   */
  'dual-truck-transaction': {
    group: 'gate',
    name: 'Trucks: drop and pick in one visit',
    summary: 'One truck leaves an export and collects an import.',
    description: 'A feeder unloads eight import boxes. Later a single truck arrives to drop an export box for the second ship and collect one import, all in one visit to a stall.',
    watch: 'Follow the truck through the gate to the stall and out again. The stacking crane on the landside end serves it.',
    build: () =>
    new ScenarioBuilder('dual-truck-transaction', 'One truck drops an export and picks up an import in a single visit')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-13 gate queue: the same terminal with 16 imports and a burst of 14 scripted trucks (one inbound lane,
   * two outbound lanes) so a queue forms at the gate and trucks wait for transfer stalls.
   */
  'truck-gate-queue': {
    group: 'gate',
    name: 'Trucks: queue at a one-lane gate',
    summary: 'A burst of 14 trucks fills the gate queue and the transfer stalls.',
    description: 'Sixteen import boxes and a burst of 14 scheduled trucks come through a gate with one inbound lane. The trucks wait for a free transfer stall.',
    watch: 'Watch the queue grow at the gate and shrink as stalls free up.',
    build: () =>
    new ScenarioBuilder('truck-gate-queue', 'A burst of 14 trucks queues at a one-lane gate and fills the transfer stalls')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-R15 appointment windows: the gate-queue terminal (2 transfer stalls, 2 inbound lanes) with trucks booked in
   * 30 minute windows. Demand is 16 trucks/h, bunched x3 in the second window, so that window hits its cap
   * (2 stalls x 1800 s / 300 s = 12) and the surplus bookings are rejected. The numbers are not TTI values.
   */
  'truck-appointment-windows': {
    group: 'gate',
    name: 'Trucks: appointment windows',
    summary: 'Trucks book 30 minute windows, and a bunched window hits its cap.',
    description: 'Trucks book 30 minute windows. Demand is 16 trucks an hour, bunched three times over in the second window, which can take at most 12 bookings.',
    watch: 'Look at the final report for the bookings that were rejected when the window was full.',
    build: () =>
    new ScenarioBuilder('truck-appointment-windows', 'Trucks book 30-minute windows; a bunched window hits its booking cap')
      .hatch({ enabled: false })
      .seed(12)
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
        hourlyProfile: Array.from({ length: 24 }, () => 16),
        importDwell: { kind: 'fixed', s: 300 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
        gate: { inLanes: 2, outLanes: 2, inProcessingS: 45, outProcessingS: 20 },
        appointments: { windowS: 1800, bunching: [{ fromS: 1800, toS: 3600, factor: 3 }] },
      })
      .endWhen({ simDurationS: 7200 })
      .build(),
  },

  /**
   * TT-R16 stall admission and holding: the gate-queue terminal (2 transfer stalls) with 2 holding positions. A burst
   * of 10 trucks 5 s apart: the first two are admitted with a reserved stall, the next two wait in the holding
   * positions, and the rest wait outside the gate (overflow) until holding frees up. The numbers are not TTI values.
   */
  'truck-holding-overflow': {
    group: 'gate',
    name: 'Trucks: holding area overflow',
    summary: 'Ten trucks arrive at once. Two fit in holding, the rest wait outside.',
    description: 'Ten trucks arrive five seconds apart. The first two are admitted with a stall reserved, the next two wait in the two holding positions, and the rest wait outside the gate.',
    watch: 'Watch the overflow outside the gate clear as holding positions free up.',
    build: () =>
    new ScenarioBuilder('truck-holding-overflow', 'A burst of 10 trucks: stalls reserved at the gate, 2 holding positions, the rest wait outside')
      .hatch({ enabled: false })
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
        gate: { inLanes: 2, outLanes: 2, inProcessingS: 30, outProcessingS: 20 },
        holding: { positions: 2 },
        scripted: (['pickImport', 'dropExport', 'dual', 'dropEmpty', 'pickImport', 'dropExport', 'dual', 'dropEmpty', 'pickEmpty', 'pickImport'] as const).map(
          (transaction, i) => ({ atS: 3000 + i * 5, transaction }),
        ),
      })
      .endWhen({ simDurationS: 9000 })
      .build(),
  },

  /**
   * TT-R17 ASC pre-retrieval: one block with paired ASCs and 2 stalls, 16 imports discharged, then 6 import pickups 100 s
   * apart. The `pre-retrieval` ascDispatch strategy fetches each box to its stall while the truck is still driving in, so
   * the stall service time drops (the same scenario with the default strategy is the comparison in the test). The numbers
   * are not TTI values.
   */
  'asc-pre-retrieval': {
    group: 'yard',
    name: 'Yard cranes: fetch before the truck',
    summary: 'The box is already at the stall when the truck arrives.',
    description: 'A block with a pair of stacking cranes and two stalls. Sixteen import boxes are unloaded, then six trucks collect one each, 100 s apart. The crane fetches each box while the truck is still driving in.',
    watch: 'Watch the box waiting at the stall when the truck pulls up. The stall service time is shorter than with the default strategy.',
    build: () =>
    new ScenarioBuilder('asc-pre-retrieval', 'Import pickups with the pre-retrieval ASC strategy: the box waits at the stall for the truck')
      .hatch({ enabled: false })
      .seed(8)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Import Star', sizeClass: 'feeder', discharge: 8, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 1, transferStalls: 2 })
      .ascsPerBlock(2)
      .decisions({ points: { ascDispatch: { strategy: 'pre-retrieval' } } })
      .landside({
        hourlyProfile: Array.from({ length: 24 }, () => 0),
        importDwell: { kind: 'fixed', s: 300 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
        gate: { inLanes: 2, outLanes: 2, inProcessingS: 30, outProcessingS: 20 },
        holding: { positions: 2 },
        scripted: Array.from({ length: 6 }, (_, i) => ({ atS: 3000 + i * 250, transaction: 'pickImport' as const })),
      })
      .endWhen({ simDurationS: 6500 })
      .build(),
  },

  /**
   * TT-13 morning peak: two blocks, a feeder discharging 24 boxes, and the 07:00 truck profile (Poisson,
   * 40 to 48 trucks an hour) with the default transaction mix and a 10 minute import dwell.
   */
  'landside-morning-peak': {
    group: 'gate',
    name: 'Trucks: morning peak',
    summary: 'Random arrivals through a 4-lane gate to two blocks with paired cranes.',
    description: 'The 07:00 truck profile: trucks arrive at random, about 40 to 48 an hour, through a four-lane gate to two blocks with paired cranes, while a feeder unloads 24 boxes.',
    watch: 'Watch the gate lanes and the stalls. Queues come and go as arrivals bunch up.',
    build: () =>
    new ScenarioBuilder('landside-morning-peak', 'Poisson truck arrivals through a 4-lane gate to two blocks with paired ASCs')
      .hatch({ enabled: false })
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
  },

  /** Livery smoke test (TT-22): 12 boxes over all ten lines (equal weights) and all three sizes. */
  'liveries-mixed': {
    group: 'yard',
    name: 'Shipping line colours',
    summary: 'Twelve boxes of mixed lines and sizes, to check the liveries.',
    description: 'One crane unloads twelve boxes spread over all ten shipping lines and all three sizes.',
    watch: 'Look at the box colours and markings in the 3D view and the close-up. It is a visual check, not an operations test.',
    build: () =>
    new ScenarioBuilder('liveries-mixed', '1 STS discharges 12 boxes of mixed lines and sizes')
      .hatch({ enabled: false })
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
  },

  /**
   * TT-R09 hatch cover cycle: a feeder discharges 8 boxes and loads 28 empty 40 ft boxes. Bay 0 has all four sections
   * (deck discharge, hold discharge, hold load, deck load): its panels are lashed off, lifted by the STS to the quay laydown
   * once the deck boxes are gone, the hold is worked, the panels go back and are secured before the deck boxes are loaded.
   * The empties are what fills a bay's hold and then its deck (export boxes spread over the bays, one cell each).
   */
  'hatch-cover-cycle': {
    group: 'quay',
    name: 'Hatch covers: full cycle',
    summary: 'Deck work, covers off, hold work, covers back on, then deck loading in one bay.',
    description: 'In one bay of a feeder the crane works the deck boxes first, then lifts the hatch cover panels to the quay, works the hold, puts the panels back and secures them, and finally loads boxes on deck.',
    watch: 'Watch the panels come off and go back, and the time they take. A hatch cover cannot be opened until the deck boxes above it are gone.',
    build: () =>
    new ScenarioBuilder('hatch-cover-cycle', 'Hatch covers: deck discharge, panels off, hold discharge and load, panels on, deck load in one bay')
      .seed(8)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', {
        name: 'Hatch Star',
        sizeClass: 'feeder',
        discharge: 8,
        maxSts: 1,
        sizeMix: { '40': 1 },
        empties: [{ size: '40', line: 'MSC', count: 28 }],
      })
      .emptyPool({ count: 40, sizeMix: { '40': 1 }, lines: { MSC: 1 } })
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 3 })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /** TT-R09: a feeder with 6 boxes on deck and nothing in the hold opens no hatch: no hatch moves, no hatch time. */
  'hatch-deck-only-no-open': {
    group: 'quay',
    name: 'Hatch covers: deck work only',
    summary: 'Only deck boxes are worked, so no hatch cover is ever lifted.',
    description: 'A feeder has six boxes on deck and nothing in the hold, so the covers stay closed for the whole call.',
    watch: 'Check that there are no hatch moves and no hatch time. This is the control case for the full cycle bench.',
    build: () =>
    new ScenarioBuilder('hatch-deck-only-no-open', 'Deck-only discharge: no hold work, so no hatch cover is ever lifted')
      .seed(42)
      .moveVariation(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 10 })
      .vesselCall('V001', { name: 'Deck Runner', sizeClass: 'feeder', discharge: 6, maxSts: 1, sizeMix: { '40': 1 }, deckOnly: true })
      .endWhen({ vesselsCompleted: 1 })
      .build(),
  },

  /**
   * Spec #106 ROB bays: 3 of a feeder's 7 bays are held back as remain-on-board. They hold display-only boxes for later
   * ports (70% full, hold and deck) but are never worked: no discharge, no reserved load slot, no truck export, and
   * their hatch covers stay closed. Hatch covers are on, so the working bays run the full cover cycle beside them.
   */
  'rob-bays': {
    group: 'quay',
    name: 'Bays that stay on board',
    summary: 'A feeder keeps 3 of 7 bays untouched, with hatch covers closed.',
    description: 'Three of the ship\'s seven bays are held back as remain-on-board: they hold boxes for later ports and are never worked. The other four bays run the full hatch cover cycle beside them.',
    watch: 'Watch the crane skip the held bays, and check that their hatch covers stay shut and no truck takes an export from them.',
    build: () =>
    new ScenarioBuilder('rob-bays', 'A feeder keeps 3 of 7 bays as remain-on-board: never worked, hatch covers closed')
      .seed(31)
      .moveVariation(10)
      .driverVariability(10)
      .quay(400, { mooringS: 60, unmooringS: 60 })
      .sts('STS01', { gantryX: 60, groundPositions: 3 })
      .vesselCall('V001', { name: 'Remain Star', sizeClass: 'feeder', discharge: 16, load: 6, maxSts: 1, sizeMix: { '20': 1, '40': 1 } })
      .vesselCall('V002', { name: 'Export Star', sizeClass: 'feeder', arrivalS: 20000, load: 4, maxSts: 1 })
      .robBays(0.43, 0.7)
      .shcs(2)
      .block('B01', { x: 20, bays: 10, tiers: 3, transferStalls: 2 })
      .ascsPerBlock(2)
      .landside({
        hourlyProfile: Array.from({ length: 24 }, () => 16),
        importDwell: { kind: 'fixed', s: 300 },
        exportWindow: { minBeforeEtaS: 3600, maxBeforeEtaS: 36000 },
        gate: { inLanes: 2, outLanes: 2, inProcessingS: 45, outProcessingS: 20 },
      })
      .endWhen({ vesselsCompleted: 2 })
      .build(),
  },
}

/** Builders by technical id (the name in the CLI, the goldens and the JSON files). */
export const fixtureDefinitions: Record<string, () => ScenarioConfig> = Object.fromEntries(
  Object.entries(fixtureEntries).map(([id, def]) => [id, def.build]),
)

/** Display copy by technical id. */
export const fixtureCopy: Record<string, FixtureCopy> = Object.fromEntries(
  Object.entries(fixtureEntries).map(([id, { build: _build, ...copy }]) => [id, copy]),
)

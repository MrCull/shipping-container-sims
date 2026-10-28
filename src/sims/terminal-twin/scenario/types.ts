/**
 * Scenario config: the small, serialisable, reproducible description of a
 * run. Fixtures are JSON files of this shape, produced by the typed
 * `ScenarioBuilder`. All values are SI (metres, seconds, m/s, m/s²).
 *
 * Vessel bay plans and their containers are NOT stored here: they are
 * generated from the vessel table and the seed (`scenario/bayPlan.ts`).
 *
 * Bump SCENARIO_SCHEMA_VERSION on breaking changes and add a migration
 * (persistence ticket TT-17).
 */
import type { DecisionsConfig } from '../engine/decisions/types'
import type { AxisProfile } from '../engine/kinematics'

export const SCENARIO_SCHEMA_VERSION = 1

export type ContainerSize = '20' | '40' | '40HC'

export interface StsKinematics {
  gantry: AxisProfile
  trolley: AxisProfile
  hoistLoaded: AxisProfile
  hoistEmpty: AxisProfile
  /** Spreader twist-lock lock time (s). */
  lockS: number
  /** Spreader twist-lock unlock time (s). */
  unlockS: number
}

/** SHC (shuttle carrier) kinematics. Drive axes are along X or Z; `lift` raises the box. */
export interface ShcKinematics {
  driveEmpty: AxisProfile
  driveLoaded: AxisProfile
  lift: AxisProfile
  /** Height the box is lifted to for travel (m, box bottom above ground). */
  liftHeightM: number
  /** Spreader twist-lock lock time (s). */
  lockS: number
  /** Spreader twist-lock unlock time (s). */
  unlockS: number
}

export interface ShcConfig {
  id: string
}

/** ASC (automated stacking crane) kinematics: gantry along the block (Z), trolley across the rows (X), hoist (Y). */
export interface AscKinematics {
  gantry: AxisProfile
  trolley: AxisProfile
  hoistLoaded: AxisProfile
  hoistEmpty: AxisProfile
  /** Spreader twist-lock lock time (s). */
  lockS: number
  /** Spreader twist-lock unlock time (s). */
  unlockS: number
}

/**
 * A yard block, perpendicular to the quay: 8 rows across X (fixed by the
 * 25.4 m ASC span), `bays` 20 ft bays along Z, `tiers` high. WTP pads sit at
 * the waterside end, transfer stalls (truck handover, TT-13) at the landside end.
 */
export interface BlockConfig {
  id: string
  /** Centre of the block along the quay (m, X axis). */
  x: number
  /** WTP pads at the block's waterside end (builder default 5). */
  wtpPads: number
  /** 20 ft bays along the block (default 20). */
  bays?: number
  /** Maximum stack height (default 5). */
  tiers?: number
  /** Transfer stalls at the landside end (default 5; used by TT-13). */
  transferStalls?: number
}

export interface YardConfig {
  blocks: BlockConfig[]
  /**
   * ASCs per block (TT-08): 1 (default) or 2 sharing the block's rails
   * (waterside `<block>-ASC1`, landside `<block>-ASC2`).
   */
  ascsPerBlock?: 1 | 2
}

/**
 * Waterside lane-graph geometry (m). All optional; defaults in
 * `DEFAULT_APRON_LAYOUT` (engine/laneGraph.ts).
 */
export interface ApronLayout {
  /** Z of the westbound (-X) apron lane, landside of the STS backreach legs. */
  westboundZ: number
  /** Z of the eastbound (+X) apron lane. */
  eastboundZ: number
  /** Z of the clear position an SHC reverses to after a WTP drop. */
  padClearZ: number
  /** Z of the SHC parking spots. */
  parkingZ: number
  /** Z of the WTP pad centres (boxes lie along Z). */
  wtpZ: number
  /** Spacing of WTP pads across a block (m). */
  padPitchM: number
  /** Spacing along X of the spine stations where SHCs enter and leave the STS lanes. */
  stationSpacingM: number
  /** Spacing of parking spots along X. */
  parkingPitchM: number
  /** Distance either side of a conflict point that a passing vehicle reserves. */
  zoneClearanceM: number
}

/** Subsystem modes: real behaviour, an "instant" stub raising the same events, or off. */
export type SubsystemMode = 'real' | 'instant' | 'off'

export interface SubsystemModes {
  /** SHC horizontal transport (default real when SHCs are configured). */
  shc?: SubsystemMode
  /** ASC yard cranes (default real when SHCs and blocks exist). */
  asc?: SubsystemMode
}

/** STS cranes are listed in rail order (ascending `gantryX`); they never pass each other. */
export interface StsConfig {
  id: string
  /** Initial gantry position along the quay (m, X axis). */
  gantryX: number
  /** Number of STS ground positions (lanes) under the crane. */
  groundPositions: number
}

/** Vessel size classes, smallest first (dimensions in `VESSEL_CLASSES`, `vesselClasses.ts`). */
export type VesselSizeClass = 'feeder' | 'feedermax' | 'panamax' | 'neo-panamax' | 'ulcv'

/** Relative weights (any non-negative numbers; normalised when drawn). */
export type Weights<K extends string> = Partial<Record<K, number>>

/**
 * One vessel call (a row of the setup dialog's vessel table). Its bay plan
 * (slots and discharge boxes) is generated from it and the scenario seed when
 * the simulation starts. The berth position and the STS cranes are chosen by
 * the berth-allocation and crane-split decision points.
 */
export interface VesselConfig {
  id: string
  name: string
  /**
   * Operator (a key of `LINE_OWNER_PREFIX`): picks the hull livery. Optional;
   * without it the line is read from the name's style (`vesselLine`). The engine ignores it.
   */
  line?: string
  /** Arrival at the port (s from scenario start). The vessel berths, or waits at anchorage. */
  arrivalS: number
  sizeClass: VesselSizeClass
  /** Boxes discharged here (real boxes in the bay plan). */
  discharge: number
  /** Export boxes to load here (slots reserved in the bay plan; loading comes in TT-10). */
  load: number
  /** Transshipment boxes to load here (slots reserved in the bay plan). */
  transshipment: number
  /** Maximum number of STS cranes working this vessel at once. */
  maxSts: number
  /** Size mix of this vessel's discharge boxes (default: `cargo.sizeMix`). */
  sizeMix?: Weights<ContainerSize>
}

/** The continuous quay and its berth/crane rules. */
export interface QuayConfig {
  lengthM: number
  /** Minimum clear distance between two berthed vessels (m). */
  berthGapM: number
  /** From berth allocation to all-fast: pilotage, approach and mooring (s). */
  mooringS: number
  /** From the last move to departure: unmooring (s). */
  unmooringS: number
  /** Minimum distance between the gantry centres of two neighbouring STS (m). */
  stsMinSpacingM: number
  /** STS lift two 20 ft boxes of the same vessel cell together (twin-20). */
  twinLift: boolean
}

/** How discharge boxes are generated. */
export interface CargoConfig {
  /** Shipping lines and their weights (owner prefixes from `LINE_OWNER_PREFIX`). */
  lines: Weights<string>
  sizeMix: Weights<ContainerSize>
  /** Share of empty boxes (0–1). */
  emptyShare: number
}

export interface EndConditions {
  /** End when this many vessels have departed. */
  vesselsCompleted?: number
  /** End at this sim time (s). */
  simDurationS?: number
  /** End when this many productive moves are done. */
  moves?: number
}

export interface LayoutConfig {
  /** Z of the first STS ground lane (m, yard side positive). */
  stsGroundLaneZ0M: number
  stsGroundLaneSpacingM: number
  /** Spreader travel height for trolley moves (m). */
  stsSafeHoistM: number
}

export interface ScenarioConfig {
  schemaVersion: typeof SCENARIO_SCHEMA_VERSION
  name: string
  description: string
  seed: number
  /** ISO date-time of sim t = 0. */
  startDateTime: string
  quay: QuayConfig
  layout: LayoutConfig
  kinematics: { sts: StsKinematics; shc?: ShcKinematics; asc?: AscKinematics }
  /** ± % random variation applied to each move's duration (0 = none). */
  moveVariationPct: number
  /** STS cranes in rail order. */
  sts: StsConfig[]
  /** Vessel calls (the vessel table). */
  vessels: VesselConfig[]
  cargo: CargoConfig
  endConditions: EndConditions
  /** SHC fleet (TT-05). Absent or empty = no horizontal transport. */
  shcs?: ShcConfig[]
  /** Yard blocks: WTP pads, stacks and an ASC each (TT-05, TT-06). */
  yard?: YardConfig
  /** Waterside lane-graph geometry overrides. */
  apron?: Partial<ApronLayout>
  /** ± % random variation of each SHC trip (driver variability; 0 = none). */
  driverVariabilityPct?: number
  /** Subsystem modes (overridable with `SimulationOptions.subsystems`). */
  subsystems?: SubsystemModes
  /** Decision points: async mode, strategy per decision point, latency injection (optional; defaults apply). */
  decisions?: DecisionsConfig
  /**
   * How the UI displays this scenario (optional; the engine ignores it). Units
   * are display-only: every value in this config stays SI whatever is chosen.
   */
  display?: DisplaySettings
  /** Work packages (TT-10); optional. */
  workPackages?: { releaseAhead?: number }
  /** KPI bucket clock (optional; defaults come from `startDateTime`, see `engine/kpi/clock.ts`). */
  kpi?: KpiClockConfig
}

/** Where the scenario clock sits, so hour and shift buckets line up with the clock the user sees. */
export interface KpiClockConfig {
  /** Seconds since clock midnight at sim t = 0 (default: `startDateTime`'s UTC time of day). */
  startTimeOfDayS?: number
  /** Clock hour (0-23) at which shift 1 of 3 starts (default 6: 06-14, 14-22, 22-06). */
  shiftStartHour?: number
}

export type UnitSystem = 'metric' | 'imperial'

/** Locale (Intl formatting) and unit system for the UI. */
export interface DisplaySettings {
  /** BCP 47 locale tag, e.g. "en-GB". */
  locale: string
  units: UnitSystem
}

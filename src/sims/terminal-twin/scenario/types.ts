/**
 * Scenario config: the small, serialisable, reproducible description of a
 * run. Fixtures are JSON files of this shape, produced by the typed
 * `ScenarioBuilder`. All values are SI (metres, seconds, m/s, m/s²).
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

export interface BlockConfig {
  id: string
  /** Centre of the block along the quay (m, X axis). */
  x: number
  /** WTP pads at the block's waterside end. */
  wtpPads: number
}

export interface YardConfig {
  blocks: BlockConfig[]
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
  /** Half length of an STS lane either side of the crane's home gantry X. */
  stsLaneHalfSpanM: number
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
  /** ASC yard cranes (default instant; real arrives with TT-06). */
  asc?: SubsystemMode
}

export interface StsConfig {
  id: string
  /** Initial gantry position along the quay (m, X axis). */
  gantryX: number
  /** Number of STS ground positions (lanes) under the crane. */
  groundPositions: number
}

export interface VesselConfig {
  id: string
  name: string
  /** Sim time (s from scenario start) at which the vessel is berthed. */
  berthAtS: number
  /** X of the vessel's bay 0 aft edge along the quay (m). */
  berthX: number
  /** STS cranes that work this vessel. */
  stsIds: string[]
  bays: number
  rows: number
  tiersOnDeck: number
  bayPitchM: number
  rowPitchM: number
  /** Height of the hatch cover / deck stack base above quay level (m). */
  deckHeightM: number
  /** Gap between the quay edge (Z = 0) and the vessel side (m). */
  fenderGapM: number
}

export interface VesselSlotRef {
  vesselId: string
  bay: number
  row: number
  tier: number
}

export interface ContainerConfig {
  /** ISO 6346 id with check digit, e.g. "HDMU1000016". */
  id: string
  size: ContainerSize
  full: boolean
  line: string
  /** Where the container starts. Only vessel slots exist in v1. */
  initial: { kind: 'vesselSlot' } & VesselSlotRef
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
  quay: { lengthM: number }
  layout: LayoutConfig
  kinematics: { sts: StsKinematics; shc?: ShcKinematics }
  /** ± % random variation applied to each move's duration (0 = none). */
  moveVariationPct: number
  sts: StsConfig[]
  vessels: VesselConfig[]
  containers: ContainerConfig[]
  endConditions: EndConditions
  /** SHC fleet (TT-05). Absent or empty = no horizontal transport. */
  shcs?: ShcConfig[]
  /** Yard blocks with their WTP pads (TT-05; TT-06 adds stacks and ASCs). */
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
}

export type UnitSystem = 'metric' | 'imperial'

/** Locale (Intl formatting) and unit system for the UI. */
export interface DisplaySettings {
  /** BCP 47 locale tag, e.g. "en-GB". */
  locale: string
  units: UnitSystem
}

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
  kinematics: { sts: StsKinematics }
  /** ± % random variation applied to each move's duration (0 = none). */
  moveVariationPct: number
  sts: StsConfig[]
  vessels: VesselConfig[]
  containers: ContainerConfig[]
  endConditions: EndConditions
  /** Decision points: async mode, strategy per decision point, latency injection (optional; defaults apply). */
  decisions?: DecisionsConfig
}

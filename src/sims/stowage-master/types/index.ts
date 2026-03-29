export type GamePhase = 'start' | 'briefing' | 'discharge_selecting' | 'discharge_animating' | 'restow_selecting' | 'restow_animating' | 'selecting' | 'animating' | 'disaster' | 'complete' | 'failed'
export type DisasterType = 'capsize' | 'founder' | 'collapse' | 'explosion'
export type WeightCategory = 'light' | 'medium' | 'heavy'
export type EventType = 'info' | 'warning' | 'danger' | 'success'

export interface Container {
  id: string
  weight: number
  weightCategory: WeightCategory
  port: string
  portColor: number
  portHex: string
  portOrder: number
  isHazmat: boolean
  isImport: boolean
  /** Transit container — remains on board, destined for a future port. */
  isTransit?: boolean
  /** Set to true while this transit container has been lifted for restow. */
  isBeingRestowed?: boolean
}

export interface Slot {
  id: string
  bay: number
  row: number
  tier: number
  bayIndex: number
  rowIndex: number
  tierIndex: number
  xOffset: number
  yOffset: number
  zOffset: number
  container: Container | null
}

export interface ShipPreset {
  name: string
  bays: number
  rows: number
  tiers: number
  length: number
  width: number
  height: number
  emptyWeight: number
  emptyVCG: number
  maxStackWeight: number
  /** Fraction of ship length used as cargo deck area */
  cargoLengthFraction: number
  /** Centre offset of cargo area along X as fraction of length (bow-positive) */
  cargoXOffsetFraction: number
  /** Fraction of ship width available for container rows */
  cargoWidthFraction: number
  /** Number of stern bays blocked by superstructure/deck structures */
  sternBlockedBays: number
  /** Identifier key used to look up a GLB model URL in shipRenderer. If absent, use procedural geometry. */
  glbPath?: string
  /**
   * Y position (in ship-group local space) of the cargo deck surface.
   * Containers and slot indicators are placed above this level.
   * Defaults to height * 0.3 for procedural ships.
   */
  deckOffsetY?: number
  /**
   * Vertical offset applied to the loaded GLB group to align its deck with deckOffsetY.
   * Determined empirically after measuring the scaled model's bounding box.
   */
  glbYOffset?: number
  /**
   * Multiplier applied on top of the length-derived scale when loading the GLB.
   * Use to shrink or grow the model relative to its nominal game length.
   * e.g. 0.1 = 10% of the derived scale.
   */
  glbScaleMultiplier?: number
  /**
   * Y-axis rotation (radians) applied to the loaded GLB root.
   * Overrides the default Math.PI / 2 used for most ships.
   */
  glbRotationY?: number
  /**
   * Z offset applied to the ship group after loading (positive = away from quay / sea side).
   * Use to nudge a specific vessel away from or toward the crane dock.
   */
  glbZOffset?: number
  /**
   * Per-bay X position overrides (game units from ship centre, length axis).
   * When provided, replaces the uniform bay spacing for that bay index.
   * Length must equal the number of active bays.
   */
  bayXOffsets?: number[]
  /**
   * Per-bay Y base offset (game units above deckOffsetY).
   * Used for raised cargo areas (e.g. forecastle holds).
   * Length must equal the number of active bays.
   */
  bayYBaseOffsets?: number[]
  /**
   * Scales the list and trim physics sensitivity for this vessel.
   * Values < 1.0 make larger ships less reactive to individual container placements.
   * Defaults to 1.0 if absent.
   */
  physicsMultiplier?: number
}

export interface GameEvent {
  message: string
  type: EventType
  time: number
}

export interface PlacementReason {
  text: string
  points: number
  good?: boolean
}

export interface PlacementResult {
  score: number
  reasons: PlacementReason[]
}

export interface PhysicsState {
  list: number
  trim: number
  vcg: number
}

export interface StarRatingResult {
  stars: number
  title: string
}

export interface BriefingLegendItem {
  /** CSS colour string for the swatch (e.g. '#ffd700') */
  color: string
  text: string
}

export interface BriefingPage {
  icon: string
  title: string
  /** Each string is rendered as a separate paragraph. */
  body: string[]
  legend?: BriefingLegendItem[]
  /** Bullet-point steps rendered as an ordered list. */
  steps?: string[]
  warn?: string
}

export interface LevelConfig {
  id: number
  name: string
  description: string
  preset: ShipPreset
  hazmatRate: number
  containerCount?: number
  /** Number of pre-loaded Import containers to discharge before loading begins. */
  dischargeContainerCount?: number
  /** Number of pre-loaded Transit containers that may overstow imports and need restowing. */
  transitContainerCount?: number
  /** Countdown timer in seconds. 0 = no timer. */
  timerSeconds: number
  /**
   * Controls how spread out pre-loaded containers are across tiers and rows.
   * 0 = bottom tiers / centre rows first (default, easy).
   * 1 = fully random — any tier, any row.
   */
  placementSpread?: number
  /** Instructional pages shown before gameplay starts. */
  briefingPages: BriefingPage[]
}

export interface CraneObject {
  group: import('three').Group
  trolley: import('three').Mesh
  spreader: import('three').Mesh
  cables: import('three').Mesh[]
  dockZ: number
  towerHeight: number
}

export interface DisasterAnimation {
  update: (deltaTime: number) => boolean
  cleanup: () => void
}

export type GamePhase = 'start' | 'selecting' | 'animating' | 'disaster' | 'complete' | 'failed'
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

export interface LevelConfig {
  id: number
  name: string
  description: string
  preset: ShipPreset
  hazmatRate: number
  containerCount?: number
  /** Countdown timer in seconds. 0 = no timer. */
  timerSeconds: number
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

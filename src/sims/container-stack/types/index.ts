import type { Vector3 } from 'three'

export type GamePhase =
  | 'start'
  | 'playing'
  | 'removing'
  | 'placing'
  | 'wobbling'
  | 'collapsing'
  | 'gameOver'
  | 'levelComplete'
  | 'levelFailed'
  | 'paused'

export type LevelFailReason = 'timeoutMove' | 'timeoutLevel' | 'collapse' | null

export interface JengaContainer {
  id: string
  color: string
  layerIndex: number
  slotIndex: number
}

export type LayerOrientation = 'alongX' | 'alongZ'

export interface TowerLayer {
  index: number
  orientation: LayerOrientation
  /** Three slots; null = removed from tower (in hand or gone) */
  slots: (JengaContainer | null)[]
}

export interface WobbleState {
  angle: number
  angularVelocity: number
  damping: number
  maxAngle: number
}

export interface TowerState {
  layers: TowerLayer[]
  centerOfMass: Vector3
  stabilityScore: number
  wobble: WobbleState
}

export interface ScoringResult {
  points: number
  basePoints: number
  speedMultiplier: number
  steadinessMultiplier: number
  comboMultiplier: number
  heightBonus: number
  streakAfter: number
}

export interface MoveRecord {
  containerId: string
  atMs: number
  scoreDelta: number
}

export interface CollapsePiece {
  /** Stable unique key for Three.js maps (container ids can repeat across games). */
  meshKey: string
  id: string
  position: Vector3
  velocity: Vector3
  angularVelocity: Vector3
  color: string
  orientation: LayerOrientation
}

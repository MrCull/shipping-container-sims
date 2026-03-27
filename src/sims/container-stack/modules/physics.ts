import { Vector3 } from 'three'
import type { CollapsePiece, TowerLayer, WobbleState } from '../types'
import { BLOCK, PHYSICS } from './config'
import { layerCompleteness, slotWorldPosition } from './towerBuilder'

const _com = new Vector3()

export function computeCenterOfMass(layers: TowerLayer[]): Vector3 {
  _com.set(0, 0, 0)
  let mass = 0
  const m = 1
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]!
    for (let si = 0; si < layer.slots.length; si++) {
      const c = layer.slots[si]
      if (!c) continue
      const p = slotWorldPosition(li, si, layers)
      _com.addScaledVector(p, m)
      mass += m
    }
  }
  if (mass > 0) _com.multiplyScalar(1 / mass)
  else _com.set(0, 0, 0)
  return _com.clone()
}

function baseFootprintHalfExtents(): { hx: number; hz: number } {
  const spanX = 3 * BLOCK.width + 2 * BLOCK.gap
  const spanZ = BLOCK.length
  return { hx: spanX / 2, hz: spanZ / 2 }
}

export function computeStabilityScore(layers: TowerLayer[], centerOfMass: Vector3): number {
  const { hx, hz } = baseFootprintHalfExtents()
  const baseCenter = new Vector3(0, 0, 0)
  const dx = Math.abs(centerOfMass.x - baseCenter.x) / Math.max(hx, 0.01)
  const dz = Math.abs(centerOfMass.z - baseCenter.z) / Math.max(hz, 0.01)
  const comDist = Math.sqrt(dx * dx + dz * dz)
  const comPenalty = Math.min(0.85, comDist * PHYSICS.comPenaltyScale)

  const height = layers.length * BLOCK.height
  const baseW = Math.max(spanWorldX(), spanWorldZ())
  const heightPenalty = Math.min(0.5, (height / Math.max(baseW, 0.01)) * PHYSICS.heightPenaltyScale)

  let gapPenalty = 0
  let prevIncomplete = false
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]!
    const comp = layerCompleteness(L)
    if (comp < 1) {
      gapPenalty += PHYSICS.incompleteLayerPenalty * (1 - comp)
      if (prevIncomplete) gapPenalty += PHYSICS.incompleteLayerPenalty * 0.5
      prevIncomplete = true
    } else {
      if (prevIncomplete) {
        gapPenalty += PHYSICS.fullLayerOverIncompleteExtra
      }
      prevIncomplete = false
    }
  }

  const s =
    PHYSICS.baseStability - comPenalty - heightPenalty - Math.min(0.55, gapPenalty)
  return Math.max(0, Math.min(1, s))
}

function spanWorldX(): number {
  return 3 * BLOCK.width + 2 * BLOCK.gap
}

function spanWorldZ(): number {
  return BLOCK.length
}

export function createInitialWobble(): WobbleState {
  return {
    angle: 0,
    angularVelocity: 0,
    damping: PHYSICS.wobbleBaseDamping,
    maxAngle: PHYSICS.maxAngle,
  }
}

export function updateWobble(
  wobble: WobbleState,
  stabilityScore: number,
  dt: number
): { collapsed: boolean } {
  const damping =
    PHYSICS.wobbleBaseDamping +
    (1 - stabilityScore) * PHYSICS.wobbleDampingStabilityFactor

  wobble.angle += wobble.angularVelocity * dt
  wobble.angularVelocity -=
    wobble.angle * PHYSICS.wobbleSpringK * dt + wobble.angularVelocity * damping * dt

  if (Math.abs(wobble.angle) > wobble.maxAngle) {
    return { collapsed: true }
  }
  return { collapsed: false }
}

/** Impulse from structural risk only (call once when extraction completes). */
export function injectCriticalRemovalImpulse(
  wobble: WobbleState,
  stabilityBeforeRemoval: number,
  wasCriticalSupport: boolean
): void {
  const criticalPart = wasCriticalSupport
    ? (1 - stabilityBeforeRemoval) * PHYSICS.criticalRemovalImpulseScale * 0.08
    : (1 - stabilityBeforeRemoval) * 0.03
  wobble.angularVelocity += criticalPart
}

/** Extra impulse from unsteady mouse during drag. */
export function injectJitterImpulse(wobble: WobbleState, jitterMagnitude: number): void {
  wobble.angularVelocity += jitterMagnitude * PHYSICS.jitterToImpulseScale * 0.001
}

export function stabilityAtRemoval(
  layers: TowerLayer[],
  layerIndex: number,
  slotIndex: number
): number {
  const clone = cloneLayersForSim(layers)
  const L = clone[layerIndex]
  if (!L || !L.slots[slotIndex]) return 0
  L.slots[slotIndex] = null
  const com = computeCenterOfMass(clone)
  return computeStabilityScore(clone, com)
}

function cloneLayersForSim(layers: TowerLayer[]): TowerLayer[] {
  return layers.map(l => ({
    ...l,
    slots: [...l.slots],
  }))
}

export function isRemovalCritical(
  layers: TowerLayer[],
  layerIndex: number,
  slotIndex: number,
  currentStability: number
): boolean {
  const after = stabilityAtRemoval(layers, layerIndex, slotIndex)
  return after < currentStability - 0.08
}

export function spawnCollapsePieces(layers: TowerLayer[], failureLayerFromTop = 0): CollapsePiece[] {
  const startLayer = Math.max(0, layers.length - 1 - failureLayerFromTop)
  const pieces: CollapsePiece[] = []
  for (let li = startLayer; li < layers.length; li++) {
    const layer = layers[li]!
    for (let si = 0; si < layer.slots.length; si++) {
      const c = layer.slots[si]
      if (!c) continue
      const p = slotWorldPosition(li, si, layers)
      pieces.push({
        id: c.id,
        position: p.clone(),
        velocity: new Vector3(
          (Math.random() - 0.5) * 6,
          Math.random() * 4 + 2,
          (Math.random() - 0.5) * 6
        ),
        angularVelocity: new Vector3(
          (Math.random() - 0.5) * PHYSICS.collapseAngularScatter,
          (Math.random() - 0.5) * PHYSICS.collapseAngularScatter,
          (Math.random() - 0.5) * PHYSICS.collapseAngularScatter
        ),
        color: c.color,
        orientation: layer.orientation,
      })
    }
  }
  return pieces
}

export function integrateCollapsePiece(
  piece: CollapsePiece,
  dt: number,
  groundY: number
): void {
  piece.velocity.y -= PHYSICS.collapseGravity * dt
  piece.position.addScaledVector(piece.velocity, dt)
  if (piece.position.y < groundY + BLOCK.height * 0.5) {
    piece.position.y = groundY + BLOCK.height * 0.5
    piece.velocity.y *= -0.35
    piece.velocity.x *= 0.92
    piece.velocity.z *= 0.92
  }
}

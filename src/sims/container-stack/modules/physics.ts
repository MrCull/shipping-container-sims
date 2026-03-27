import { Vector3 } from 'three'
import type {
  CollapsePiece,
  JengaContainer,
  LayerOrientation,
  TowerLayer,
  WobbleState,
} from '../types'
import { BLOCK, PHYSICS } from './config'
import { isTowerFullyStacked, layerCompleteness, slotWorldPosition } from './towerBuilder'

const _com = new Vector3()

interface XZRect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** World-space footprint (XZ) of one occupied slot on a layer. */
function slotFootprintWorldXZ(
  layerIndex: number,
  slotIndex: number,
  orientation: LayerOrientation,
  layers: TowerLayer[]
): XZRect {
  const p = slotWorldPosition(layerIndex, slotIndex, layers)
  const { width, length } = BLOCK
  if (orientation === 'alongX') {
    const hx = width / 2
    const hz = length / 2
    return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz }
  }
  const hx = length / 2
  const hz = width / 2
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz }
}

function layerSupportRects(layerIndex: number, layers: TowerLayer[]): XZRect[] {
  if (layerIndex < 0) return []
  const L = layers[layerIndex]
  if (!L) return []
  const rects: XZRect[] = []
  for (let si = 0; si < L.slots.length; si++) {
    if (L.slots[si] !== null) {
      rects.push(slotFootprintWorldXZ(layerIndex, si, L.orientation, layers))
    }
  }
  return rects
}

function pointSupportedByRects(x: number, z: number, rects: XZRect[]): boolean {
  for (const r of rects) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true
  }
  return false
}

/**
 * For each container on layer L>=1, fraction of footprint sample points that lie on the union
 * of containers on layer L-1. Returns the minimum across all such blocks (weakest link).
 * Empty tower or only ground layer → 1.
 */
export function computeStructuralSupportScore(layers: TowerLayer[]): number {
  const n = PHYSICS.structuralSampleGrid
  if (layers.length <= 1) return 1

  let globalMin = 1

  for (let li = 1; li < layers.length; li++) {
    const supportRects = layerSupportRects(li - 1, layers)
    if (supportRects.length === 0) {
      return 0
    }

    const layer = layers[li]!
    for (let si = 0; si < layer.slots.length; si++) {
      if (layer.slots[si] === null) continue

      const foot = slotFootprintWorldXZ(li, si, layer.orientation, layers)
      let inside = 0
      const total = n * n
      for (let iu = 0; iu < n; iu++) {
        for (let iv = 0; iv < n; iv++) {
          const u = (iu + 0.5) / n
          const v = (iv + 0.5) / n
          const x = foot.x0 + u * (foot.x1 - foot.x0)
          const z = foot.z0 + v * (foot.z1 - foot.z0)
          if (pointSupportedByRects(x, z, supportRects)) inside++
        }
      }
      const frac = inside / total
      if (frac < globalMin) globalMin = frac
    }
  }

  return globalMin
}

export function isStructurallySound(layers: TowerLayer[]): boolean {
  return computeStructuralSupportScore(layers) >= PHYSICS.structuralMinSupportFraction
}

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
  if (isTowerFullyStacked(layers)) {
    return 1
  }

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

  const structural = computeStructuralSupportScore(layers)
  const structuralFactor = Math.pow(
    structural,
    PHYSICS.structuralStabilityExponent
  )

  let s =
    PHYSICS.baseStability - comPenalty - heightPenalty - Math.min(0.55, gapPenalty)
  s = Math.max(0, Math.min(1, s)) * structuralFactor
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

/** Per-frame mouse jitter while extracting — scales up when the tower is already unstable. */
export function injectDragFrameWobble(
  wobble: WobbleState,
  frameJitterPx: number,
  stabilityScore: number
): void {
  if (frameJitterPx <= 0.25) return
  const t = Math.max(0, Math.min(1, 1 - stabilityScore))
  const stress = 1 + t * t * 2.8
  wobble.angularVelocity += frameJitterPx * PHYSICS.dragWobblePerPixel * stress
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

function randomCollapseVelocity(): Vector3 {
  return new Vector3(
    (Math.random() - 0.5) * 6,
    Math.random() * 4 + 2,
    (Math.random() - 0.5) * 6
  )
}

function randomCollapseSpin(): Vector3 {
  return new Vector3(
    (Math.random() - 0.5) * PHYSICS.collapseAngularScatter,
    (Math.random() - 0.5) * PHYSICS.collapseAngularScatter,
    (Math.random() - 0.5) * PHYSICS.collapseAngularScatter
  )
}

export function collapsePieceFromContainer(
  meshKey: string,
  c: JengaContainer,
  orientation: LayerOrientation,
  position: Vector3
): CollapsePiece {
  return {
    meshKey,
    id: c.id,
    position: position.clone(),
    velocity: randomCollapseVelocity(),
    angularVelocity: randomCollapseSpin(),
    color: c.color,
    orientation,
  }
}

export function spawnCollapsePieces(
  layers: TowerLayer[],
  failureLayerFromTop = 0,
  keyPrefix = ''
): CollapsePiece[] {
  const startLayer = Math.max(0, layers.length - 1 - failureLayerFromTop)
  const pieces: CollapsePiece[] = []
  for (let li = startLayer; li < layers.length; li++) {
    const layer = layers[li]!
    for (let si = 0; si < layer.slots.length; si++) {
      const c = layer.slots[si]
      if (!c) continue
      const p = slotWorldPosition(li, si, layers)
      const meshKey = `${keyPrefix}L${li}-S${si}-${c.id}`
      pieces.push(collapsePieceFromContainer(meshKey, c, layer.orientation, p))
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

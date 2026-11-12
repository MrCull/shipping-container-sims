/**
 * Hero face selection (#258), pure: which faces of the boxes near the camera get hero detail. A box is offered with
 * its exposed faces (`exposedFaces.ts`: a buried box has none); a face is a candidate only when it is turned towards
 * the camera, and the candidates compete for a face cap (`closeupFaceBudget.ts`: nearest first, with hysteresis).
 * The frustum test is the instancer's cull (only boxes in view are offered). There is no line-of-sight test against
 * other stacks or equipment: the cap bounds that cost.
 */
import type { ContainerSize } from '../scenario/types'
import { selectFaces, type FaceCandidate } from './closeupFaceBudget'
import { faceFrame } from './containerCloseups'
import { FACES, visibleFaceList, type ExposedFaces, type Face } from './exposedFaces'

/** The four hero models of a size (`hero-<size>-<kind>`). */
export type HeroKind = 'side' | 'door' | 'front' | 'roof'

/** A box shows at most three faces to a camera (a side, an end and the roof). */
export const HERO_FACES_PER_BOX = 3
/** Beyond this camera distance (m) a face never gets hero detail. */
export const HERO_DISTANCE_M = 15
export const HERO_HYSTERESIS = 1.15

/** Hero model of a box face. `turn` is true when the model is the same one rotated 180 degrees about the vertical (the -Z side). */
export function heroKindOf(face: Face): { kind: HeroKind; turn: boolean } | null {
  switch (face) {
    case 'sideP':
      return { kind: 'side', turn: false }
    case 'sideN':
      return { kind: 'side', turn: true }
    case 'door':
      return { kind: 'door', turn: false }
    case 'front':
      return { kind: 'front', turn: false }
    case 'top':
      return { kind: 'roof', turn: false }
    default:
      return null
  }
}

export const heroFaceId = (key: number, face: Face): number => key * 8 + FACES.indexOf(face)
export const heroFaceOf = (id: number): { key: number; face: Face } => ({ key: Math.floor(id / 8), face: FACES[id % 8] })

export interface HeroBox {
  size: ContainerSize
  /** Bottom centre of the box. */
  x: number
  y: number
  z: number
  yaw: number
}

/** Appends the exposed faces of `box` that are turned towards the camera, with their squared distance. */
export function facingCandidates(key: number, box: HeroBox, faces: ExposedFaces, cam: { x: number; y: number; z: number }, out: FaceCandidate[]): void {
  const cos = Math.cos(box.yaw)
  const sin = Math.sin(box.yaw)
  for (const face of visibleFaceList(faces)) {
    if (!heroKindOf(face)) continue
    const f = faceFrame(face as Exclude<Face, 'bottom'>, box.size)
    const wx = box.x + f.c[0] * cos + f.c[2] * sin
    const wy = box.y + f.c[1]
    const wz = box.z - f.c[0] * sin + f.c[2] * cos
    const dx = cam.x - wx
    const dy = cam.y - wy
    const dz = cam.z - wz
    const nx = f.n[0] * cos + f.n[2] * sin
    const nz = -f.n[0] * sin + f.n[2] * cos
    if (nx * dx + f.n[1] * dy + nz * dz <= 0) continue
    out.push({ id: heroFaceId(key, face), d2: dx * dx + dy * dy + dz * dz })
  }
}

export interface HeroLimits {
  /** Quality level's cap in boxes' worth of faces (`heroCaps` in budgets.json); 0 draws none. */
  boxes: number
  distanceM: number
  hysteresis: number
}

/** The hero faces to draw: nearest first within the distance, at most `boxes x 3` faces. */
export function selectHeroFaces(candidates: readonly FaceCandidate[], limits: HeroLimits, previous: ReadonlySet<number>): number[] {
  return selectFaces(candidates, { budget: limits.boxes * HERO_FACES_PER_BOX, maxDistM: limits.distanceM, hysteresis: limits.hysteresis }, previous)
}

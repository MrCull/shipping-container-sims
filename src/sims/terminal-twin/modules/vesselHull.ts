/**
 * Vessel hull assets (TT-27): sidecar types and the pure mapping between a
 * hull's asset frame and the twin's world frame. No Three.js here, so the
 * renderer and the Node-side asset tests share it.
 *
 * Asset frame (glTF, metres): stern (aft end of LOA) at x = 0, bow at +X;
 * y = 0 on the waterline, +Y up; z = 0 on the centreline, +Z is the quay side
 * (row 0), rows run towards -Z. The bay grid's `origin` is the aft edge of
 * bay 0, the quay-side edge of row 0, at the deck-stack base (hatch-cover top).
 * Hold tiers stack down from `holdTopY`.
 */
import type { ContainerSize, VesselSizeClass } from '../scenario/types'
import { CONTAINER_HEIGHT_M, FENDER_GAP_M, type SlotPosition } from '../scenario/vesselClasses'

export interface HullBayGrid {
  /** [x, y, z] in the asset frame: aft edge of bay 0, quay-side edge of row 0, deck-stack base. */
  origin: [number, number, number]
  /** Top of the hold stacks (underside of the hatch covers), asset y. */
  holdTopY: number
  bays: number
  rows: number
  holdTiers: number
  deckTiers: number
  bayPitchM: number
  rowPitchM: number
  tierPitchM: number
  /** Distance from a 40 ft cell centre to each 20 ft half's centre. */
  halfOffsetM: number
}

export interface HullAttachPoint {
  name: string
  position: [number, number, number]
  /** Outward normal (name boards). */
  normal?: [number, number, number]
  widthM?: number
  heightM?: number
  tag?: string
}

/** The part of a hull's `.meta.json` sidecar the twin reads. */
export interface HullMeta {
  asset: string
  kind: 'vessel'
  sizeClass: VesselSizeClass
  dimensions: { loaM: number; beamM: number; draftM: number; airDraftM: number }
  waterline: { y: number; quayLevelAboveWaterlineM: number }
  bayGrid: HullBayGrid
  attachPoints: HullAttachPoint[]
  lods: Record<string, { triangles: number }>
}

/** GLB / sidecar base names per class (`assets/models/vessels/<name>.glb`). */
export const HULL_ASSET_FILES: Record<VesselSizeClass, string> = {
  feeder: 'vessel-feeder',
  feedermax: 'vessel-feedermax',
  panamax: 'vessel-panamax',
  'neo-panamax': 'vessel-neo-panamax',
  ulcv: 'vessel-ulcv',
}

/** Centre of a container of `size` in a slot, in the hull's asset frame. */
export function hullSlotCentre(meta: HullMeta, slot: SlotPosition, size: ContainerSize): { x: number; y: number; z: number } {
  const g = meta.bayGrid
  const [ox, oy, oz] = g.origin
  const half = slot.half === 'aft' ? -g.halfOffsetM : slot.half === 'fore' ? g.halfOffsetM : 0
  const base = slot.tier < g.holdTiers ? g.holdTopY - (g.holdTiers - slot.tier) * g.tierPitchM : oy + (slot.tier - g.holdTiers) * g.tierPitchM
  return {
    x: ox + (slot.bay + 0.5) * g.bayPitchM + half,
    y: base + CONTAINER_HEIGHT_M[size] / 2,
    z: oz - (slot.row + 0.5) * g.rowPitchM,
  }
}

/**
 * Translation from the asset frame to the world for a vessel berthed with its
 * stern at `berthX` (no rotation): the waterline sits `quayLevelAboveWaterlineM`
 * below quay level (y = 0) and the quay-side hull face `FENDER_GAP_M` off the quay edge.
 */
export function hullPlacement(meta: HullMeta, berthX: number): { x: number; y: number; z: number } {
  return {
    x: berthX,
    y: meta.waterline.y - meta.waterline.quayLevelAboveWaterlineM,
    z: -(FENDER_GAP_M + meta.dimensions.beamM / 2),
  }
}

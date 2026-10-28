/**
 * Vessel size classes and bay-plan geometry. Shared by the engine (STS work
 * positions), the bay-plan generator and the renderer, so a slot is in the
 * same place for all of them. Pure, SI units.
 *
 * Vessel frame: `berthX` is the stern (aft end of LOA) along the quay. Bays
 * are 40 ft bays numbered from aft (bay 0) forward; rows from the quay side
 * (row 0) seaward; tiers from the bottom of the hold (tier 0) up. Tiers below
 * `holdTiers` are in the hold; the rest are on deck (on the hatch covers).
 * A cell holds one 40 ft box or two 20 ft boxes (aft and fore half).
 *
 * All dimensions are approximations [A] of typical ships of each class.
 */
import type { ContainerSize, VesselSizeClass } from './types'

export interface VesselClassSpec {
  label: string
  /** Length over all (m). */
  loaM: number
  beamM: number
  /** 40 ft bays. */
  bays: number
  rows: number
  holdTiers: number
  deckTiers: number
  /** Top of the hatch covers (deck stack base) above quay level (m). */
  deckHeightM: number
}

/** [A] Size classes, smallest first. */
export const VESSEL_CLASSES: Record<VesselSizeClass, VesselClassSpec> = {
  feeder: { label: 'Feeder', loaM: 140, beamM: 23, bays: 7, rows: 8, holdTiers: 4, deckTiers: 3, deckHeightM: 12 },
  feedermax: { label: 'Feedermax', loaM: 180, beamM: 28, bays: 10, rows: 10, holdTiers: 5, deckTiers: 4, deckHeightM: 14 },
  panamax: { label: 'Panamax', loaM: 294, beamM: 32.3, bays: 17, rows: 12, holdTiers: 7, deckTiers: 5, deckHeightM: 18 },
  'neo-panamax': { label: 'Neo-Panamax', loaM: 366, beamM: 48.2, bays: 20, rows: 18, holdTiers: 8, deckTiers: 7, deckHeightM: 20 },
  ulcv: { label: 'ULCV', loaM: 400, beamM: 61.5, bays: 24, rows: 23, holdTiers: 10, deckTiers: 9, deckHeightM: 22 },
}

export const VESSEL_SIZE_CLASSES = Object.keys(VESSEL_CLASSES) as VesselSizeClass[]

/** [A] Bay-plan pitches (m). Tier pitch fits a high-cube box. */
export const BAY_PITCH_M = 14
export const ROW_PITCH_M = 2.55
export const TIER_PITCH_M = 2.896
/** Hull length forward of the last bay (m). */
export const BOW_M = 20
/** Gap between the quay edge (Z = 0) and the vessel side (m). */
export const FENDER_GAP_M = 2
/** [A] Quay level above the waterline (m): the renderer's water plane and the hull assets' waterline (TT-27). */
export const QUAY_ABOVE_WATER_M = 2.5
/** Distance from a 40 ft cell centre to the centre of each 20 ft half (m). */
export const HALF_OFFSET_M = 3.067

/** [A] Container heights (m). */
export const CONTAINER_HEIGHT_M: Record<ContainerSize, number> = { '20': 2.591, '40': 2.591, '40HC': 2.896 }

export type CellHalf = 'aft' | 'fore' | null

export interface SlotPosition {
  bay: number
  row: number
  tier: number
  half: CellHalf
}

export function vesselClass(sizeClass: VesselSizeClass): VesselClassSpec {
  const spec = VESSEL_CLASSES[sizeClass]
  if (!spec) throw new Error(`Unknown vessel size class ${sizeClass}`)
  return spec
}

/** Cells per class: bays × rows × (hold + deck tiers). One cell = one 40 ft or two 20 ft boxes. */
export function cellCapacity(spec: VesselClassSpec): number {
  return spec.bays * spec.rows * (spec.holdTiers + spec.deckTiers)
}

/** Distance from the stern to the aft edge of bay 0 (engine room / accommodation). */
export function aftOffsetM(spec: VesselClassSpec): number {
  return spec.loaM - spec.bays * BAY_PITCH_M - BOW_M
}

/** X of a bay's centre (or of a 20 ft half) for a vessel berthed at `berthX`. */
export function slotX(spec: VesselClassSpec, berthX: number, bay: number, half: CellHalf = null): number {
  const centre = berthX + aftOffsetM(spec) + (bay + 0.5) * BAY_PITCH_M
  return half === 'aft' ? centre - HALF_OFFSET_M : half === 'fore' ? centre + HALF_OFFSET_M : centre
}

/** Z of a row's centre (rows are centred in the beam; the sea is at -Z). */
export function slotZ(spec: VesselClassSpec, row: number): number {
  const margin = (spec.beamM - spec.rows * ROW_PITCH_M) / 2
  return -(FENDER_GAP_M + margin + (row + 0.5) * ROW_PITCH_M)
}

/** Y of the bottom of a tier above quay level. */
export function tierBaseY(spec: VesselClassSpec, tier: number): number {
  return tier < spec.holdTiers
    ? spec.deckHeightM - (spec.holdTiers - tier) * TIER_PITCH_M - 0.5
    : spec.deckHeightM + (tier - spec.holdTiers) * TIER_PITCH_M
}

export function isDeckTier(spec: VesselClassSpec, tier: number): boolean {
  return tier >= spec.holdTiers
}

/** Centre of a container of `size` in a slot. */
export function slotCentre(
  spec: VesselClassSpec,
  berthX: number,
  slot: SlotPosition,
  size: ContainerSize,
): { x: number; y: number; z: number } {
  return {
    x: slotX(spec, berthX, slot.bay, slot.half),
    y: tierBaseY(spec, slot.tier) + CONTAINER_HEIGHT_M[size] / 2,
    z: slotZ(spec, slot.row),
  }
}

/** Vessel slot id: `<vesselId>:<bay>-<row>-<tier>` (two digits each), plus `a`/`f` for a 20 ft half. */
export function vesselSlotId(vesselId: string, bay: number, row: number, tier: number, half: CellHalf = null): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const suffix = half === 'aft' ? 'a' : half === 'fore' ? 'f' : ''
  return `${vesselId}:${p(bay)}-${p(row)}-${p(tier)}${suffix}`
}

/** Inverse of `vesselSlotId`. */
export function parseVesselSlotId(id: string): { vesselId: string } & SlotPosition {
  const i = id.lastIndexOf(':')
  const m = /^(\d+)-(\d+)-(\d+)([af]?)$/.exec(id.slice(i + 1))
  if (i < 0 || !m) throw new Error(`Not a vessel slot id: ${id}`)
  return {
    vesselId: id.slice(0, i),
    bay: Number(m[1]),
    row: Number(m[2]),
    tier: Number(m[3]),
    half: m[4] === 'a' ? 'aft' : m[4] === 'f' ? 'fore' : null,
  }
}

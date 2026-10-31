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
 * Hull profile (spec #116, ticket #131): below deck the holds narrow towards the keel, so the lower hold tiers lose
 * their outer rows (`holdRows`, centred on the beam). Deck tiers keep every row. Every enumeration of vessel cells goes
 * through {@link isCellUsable} / {@link rowRange}, so planning, ROB fill, capacity, stack rules, the viewers and the
 * invariant agree on which cells exist.
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
  /**
   * Hull profile [A]: usable rows per hold tier, bottom (tier 0) first. Centred on the beam (same parity as `rows`),
   * never narrower than the tier below, and `rows` in the top hold tier. Source quality [A]: typical hold cross
   * sections, the keel tier about 40 to 50 % of the beam, widening to the full beam under the hatch coamings.
   */
  holdRows: readonly number[]
  holdTiers: number
  deckTiers: number
  /** Top of the hatch covers (deck stack base) above quay level (m). */
  deckHeightM: number
  /** Hatch covers over each 40 ft bay (TT-R09). */
  hatch: HatchClassSpec
}

/**
 * Hatch covers of a vessel class (TT-R09, all [A]). Each 40 ft bay has one hatch of `panels` lift-away panels
 * across the beam; a panel covers a share of the rows. Panel width follows from its rows (row pitch less a coaming
 * gap), length from the bay pitch. A panel must fit the quay laydown bay between two SHC spines (about 14.3 m
 * along the quay) and between the last ground lane and the landside STS rail (about 15 m across), which is why the
 * feeder classes have 2 panels and the ULCV 4 (the spec's example counts 1 and 3 give panels up to 20 m wide).
 */
export interface HatchClassSpec {
  /** Panels across the beam. */
  panels: number
  /** Length of a panel along the ship (m). */
  panelLengthM: number
  /** Weight of one panel (t). */
  panelWeightT: number
  /** Lashing crew time to release a hatch's cleats once the deck boxes above it are gone (s). */
  lashingReleaseS: number
  /** Time to secure a replaced panel before deck boxes may be loaded on it (s). */
  lashingSecureS: number
  /** STS cycle time of one hatch move: hook up, lift, carry, set down, release (s). */
  cycleS: number
  /** Panels stacked on one another in laydown. */
  laydownStackLimit: number
}

/** [A] Default hatch values shared by every class (override per class below or with `ScenarioConfig.hatch`). */
const HATCH_DEFAULTS = {
  panelLengthM: 13.5,
  lashingReleaseS: 300,
  lashingSecureS: 180,
  cycleS: 240,
  laydownStackLimit: 3,
}

/** [A] Size classes, smallest first. */
export const VESSEL_CLASSES: Record<VesselSizeClass, VesselClassSpec> = {
  feeder: { label: 'Feeder', loaM: 140, beamM: 23, bays: 7, rows: 8, holdRows: [4, 6, 6, 8], holdTiers: 4, deckTiers: 3, deckHeightM: 12, hatch: { ...HATCH_DEFAULTS, panels: 2, panelWeightT: 12 } },
  feedermax: { label: 'Feedermax', loaM: 180, beamM: 28, bays: 10, rows: 10, holdRows: [4, 6, 8, 8, 10], holdTiers: 5, deckTiers: 4, deckHeightM: 14, hatch: { ...HATCH_DEFAULTS, panels: 2, panelWeightT: 16 } },
  panamax: { label: 'Panamax', loaM: 294, beamM: 32.3, bays: 17, rows: 12, holdRows: [6, 8, 8, 10, 10, 12, 12], holdTiers: 7, deckTiers: 5, deckHeightM: 18, hatch: { ...HATCH_DEFAULTS, panels: 2, panelWeightT: 24 } },
  'neo-panamax': { label: 'Neo-Panamax', loaM: 366, beamM: 48.2, bays: 20, rows: 18, holdRows: [8, 10, 12, 14, 14, 16, 18, 18], holdTiers: 8, deckTiers: 7, deckHeightM: 20, hatch: { ...HATCH_DEFAULTS, panels: 3, panelWeightT: 28 } },
  ulcv: { label: 'ULCV', loaM: 400, beamM: 61.5, bays: 24, rows: 23, holdRows: [11, 13, 15, 17, 17, 19, 21, 21, 23, 23], holdTiers: 10, deckTiers: 9, deckHeightM: 22, hatch: { ...HATCH_DEFAULTS, panels: 4, panelWeightT: 32 } },
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

/** Gap between neighbouring hatch panels and between a panel and the coaming (m). */
export const HATCH_GAP_M = 0.3
/** [A] Thickness of a hatch panel (m): the stack height in laydown. */
export const HATCH_THICKNESS_M = 0.45

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

/** First row (inclusive) and end row (exclusive) usable in a tier: the hull profile below deck, every row on deck. */
export function rowRange(spec: VesselClassSpec, tier: number): { from: number; to: number } {
  if (tier < 0 || tier >= spec.holdTiers + spec.deckTiers) return { from: 0, to: 0 }
  const n = tier >= spec.holdTiers ? spec.rows : spec.holdRows[tier]
  const from = (spec.rows - n) / 2
  return { from, to: from + n }
}

/** True when the cell exists: the tier is on the vessel and the row is inside the hull profile of that tier. */
export function isCellUsable(spec: VesselClassSpec, row: number, tier: number): boolean {
  const { from, to } = rowRange(spec, tier)
  return row >= from && row < to
}

/** Lowest tier of the stack at `row` in a section (the hull profile lifts it above the keel; deck stacks start at the hatch cover). */
export function stackBaseTier(spec: VesselClassSpec, row: number, deck: boolean): number {
  if (deck) return spec.holdTiers
  for (let tier = 0; tier < spec.holdTiers; tier++) if (isCellUsable(spec, row, tier)) return tier
  return spec.holdTiers
}

/** True when a box at `tier` of the `row` stack stands on the hull floor or the hatch cover, not on a box below. */
export function isStackBase(spec: VesselClassSpec, row: number, tier: number): boolean {
  return tier === spec.holdTiers || !isCellUsable(spec, row, tier - 1)
}

/** Hold cells per bay: the hull profile summed over the hold tiers. */
export function holdCellsPerBay(spec: VesselClassSpec): number {
  return spec.holdRows.reduce((n, r) => n + r, 0)
}

/** Cells per bay: hold (hull profile) plus deck. */
export function cellsPerBay(spec: VesselClassSpec): number {
  return holdCellsPerBay(spec) + spec.rows * spec.deckTiers
}

/** Cells per class: bays × (hold cells under the hull profile + rows × deck tiers). One cell = one 40 ft or two 20 ft boxes. */
export function cellCapacity(spec: VesselClassSpec): number {
  return spec.bays * cellsPerBay(spec)
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

/** Panel index (0 = quay side) of a row: rows are shared out evenly across the beam. */
export function hatchPanelOfRow(spec: VesselClassSpec, row: number): number {
  return Math.min(spec.hatch.panels - 1, Math.floor((row * spec.hatch.panels) / spec.rows))
}

/** First row (inclusive) and end row (exclusive) a hatch panel covers. */
export function hatchPanelRows(spec: VesselClassSpec, index: number): { from: number; to: number } {
  let from = -1
  let to = -1
  for (let r = 0; r < spec.rows; r++)
    if (hatchPanelOfRow(spec, r) === index) {
      if (from < 0) from = r
      to = r + 1
    }
  return { from, to }
}

/** Hatch panel id: `<vesselId>:H<bay>-<index>` (bay two digits, index across the beam from the quay side). */
export function hatchPanelId(vesselId: string, bay: number, index: number): string {
  return `${vesselId}:H${String(bay).padStart(2, '0')}-${index}`
}

/** Width of a hatch panel across the beam (m): its rows less the coaming gap. */
export function hatchPanelWidthM(spec: VesselClassSpec, index: number): number {
  const { from, to } = hatchPanelRows(spec, index)
  return (to - from) * ROW_PITCH_M - HATCH_GAP_M
}

/** Z of the centre of a hatch panel. */
export function hatchPanelZ(spec: VesselClassSpec, index: number): number {
  const { from, to } = hatchPanelRows(spec, index)
  return (slotZ(spec, from) + slotZ(spec, to - 1)) / 2
}

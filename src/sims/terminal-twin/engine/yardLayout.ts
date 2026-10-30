/**
 * Yard block geometry and slot ids (TT-06). Pure.
 *
 * A block lies perpendicular to the quay. Plan view (Z grows landside):
 *
 *   WTP pads (z = wtpZ)  →  stack bays 1…N along Z  →  transfer stalls (TT-13)
 *   8 rows across X, centred on the block's X. The ASC gantry runs along Z on
 *   rails either side, its trolley spans the rows (and the WTP pads), its hoist
 *   lowers the spreader into a stack.
 *
 * Slots are 20 ft cells `<block>:<bay>-<row>-<tier>` (bay, row and tier 1-based,
 * bay zero-padded to 2). A 40 ft box occupies two bays and is named by its
 * lower-numbered one (its anchor).
 */
import type { BlockConfig, ContainerSize, ScenarioConfig } from '../scenario/types'
import { apronLayout } from './laneGraph'

/** Rows across the block, fixed by the 25.4 m ASC span. */
export const BLOCK_ROWS = 8
export const ROW_PITCH_M = 2.9
/** [A] One 20 ft bay (box 6.06 m + gap). */
export const BAY_PITCH_M = 6.7
/** [A] Tier height: high-cube box. */
export const TIER_PITCH_M = 2.896
/** Gap between the WTP strip and the first bay (m). */
export const FIRST_BAY_GAP_M = 8
export const DEFAULT_BLOCK_BAYS = 20
export const DEFAULT_BLOCK_TIERS = 5
export const DEFAULT_WTP_PADS = 5
export const DEFAULT_TRANSFER_STALLS = 5
/** Travel clearance of the spreader above the top tier (m). */
const TRAVEL_CLEARANCE_M = 0.6

/** [A] ASC portal length along the rail (m). */
export const ASC_LENGTH_M = 8
/** [A] Safe clearance kept between two ASCs on one rail (m). */
export const ASC_SAFE_GAP_M = 4
/** Minimum distance between two ASC centres (m): length + safe gap. */
export const ASC_MIN_SEPARATION_M = ASC_LENGTH_M + ASC_SAFE_GAP_M
/** Rail reservation granularity along Z (m): half a bay. */
export const RAIL_SEGMENT_M = BAY_PITCH_M / 2
/** The rail extends this far past the WTP pads and the last bay (m): room for a crane to stand clear. */
export const RAIL_MARGIN_M = 16
/** Reservation end of a parked crane (s): effectively never. */
export const PARK_UNTIL_S = 1e9

export interface BlockSpec {
  id: string
  x: number
  bays: number
  rows: number
  tiers: number
  wtpPads: number
  transferStalls: number
  /** Z of the WTP pad centres. */
  wtpZ: number
  /** Z of the centre of bay 1. */
  firstBayZ: number
}

export function blockSpec(config: ScenarioConfig, block: BlockConfig): BlockSpec {
  const wtpZ = apronLayout(config).wtpZ
  return {
    id: block.id,
    x: block.x,
    bays: block.bays ?? DEFAULT_BLOCK_BAYS,
    rows: BLOCK_ROWS,
    tiers: block.tiers ?? DEFAULT_BLOCK_TIERS,
    wtpPads: block.wtpPads,
    transferStalls: block.transferStalls ?? DEFAULT_TRANSFER_STALLS,
    wtpZ,
    firstBayZ: wtpZ + FIRST_BAY_GAP_M + BAY_PITCH_M / 2,
  }
}

export function blockSpecs(config: ScenarioConfig): BlockSpec[] {
  return (config.yard?.blocks ?? []).map((b) => blockSpec(config, b))
}

export const boxSpan = (size: ContainerSize): 1 | 2 => (size === '20' ? 1 : 2)

export function yardSlotId(blockId: string, bay: number, row: number, tier: number): string {
  return `${blockId}:${String(bay).padStart(2, '0')}-${row}-${tier}`
}

export interface YardCell {
  blockId: string
  bay: number
  row: number
  tier: number
}

export function parseYardSlotId(id: string): YardCell {
  const m = /^(.+):(\d+)-(\d+)-(\d+)$/.exec(id)
  if (!m) throw new Error(`Malformed yard slot id "${id}" (expected <block>:<bay>-<row>-<tier>)`)
  return { blockId: m[1], bay: Number(m[2]), row: Number(m[3]), tier: Number(m[4]) }
}

/** X of a row's centre line. */
export const rowX = (block: Pick<BlockSpec, 'x'>, row: number): number => block.x + (row - (BLOCK_ROWS + 1) / 2) * ROW_PITCH_M
/** Z of a bay's centre. */
export const bayZ = (block: Pick<BlockSpec, 'firstBayZ'>, bay: number): number => block.firstBayZ + (bay - 1) * BAY_PITCH_M
/** Z of the centre of a box spanning `span` bays from `bay`. */
export const slotZ = (block: Pick<BlockSpec, 'firstBayZ'>, bay: number, span: 1 | 2): number =>
  bayZ(block, bay) + ((span - 1) * BAY_PITCH_M) / 2
/** Height of the bottom of a box on `tier`. */
export const tierBaseY = (tier: number): number => (tier - 1) * TIER_PITCH_M
/** Spreader (box bottom) height for travel over the stacks. */
export const travelHoistM = (block: Pick<BlockSpec, 'tiers'>): number => block.tiers * TIER_PITCH_M + TRAVEL_CLEARANCE_M

/** Index into a block's flat per-stack arrays. */
export const stackIndex = (block: Pick<BlockSpec, 'rows'>, bay: number, row: number): number => (bay - 1) * block.rows + (row - 1)

/** Cells a box occupies: its anchor and, for a 40 ft box, the next bay. */
export function cellsOf(anchor: YardCell, span: 1 | 2): YardCell[] {
  return span === 1 ? [anchor] : [anchor, { ...anchor, bay: anchor.bay + 1 }]
}

export interface YardCandidate {
  slotId: string
  bay: number
  row: number
  tier: number
  span: 1 | 2
  x: number
  z: number
  /** Plan distance from the WTP pad (m). */
  distanceM: number
  /** Vessel of the box directly below (null on tier 1). */
  belowVesselId: string | null
  /** Vessels of the top boxes in this candidate's bay(s). */
  bayVesselIds: string[]
}

/** The block as a strategy sees it (the stack part of `YardAllocationRequest`). */
export interface YardStacks {
  blockId: string
  bays: number
  rows: number
  tiers: number
  size: ContainerSize
  blockX: number
  firstBayZ: number
  wtpX: number
  wtpZ: number
  /** Stack heights (claimed boxes included), bay-major: index (bay-1)*rows + (row-1). */
  heights: number[]
  /** Vessel of each stack's top box (null if empty), same indexing. */
  topVessels: (string | null)[]
  /**
   * Length of each stack, same indexing: the span of its bottom box (1 = 20 ft, 2 = a 40 ft box, which locks both
   * of its stacks), 0 = empty. Derived from the stack contents (`stackSpansOf`), never stored: a stack takes the
   * length of its bottom box until it is empty again.
   */
  stackSpans: number[]
}

/**
 * Every slot a box of `stacks.size` can legally take: on top of a stack below the tier limit that holds boxes of
 * the same length or nothing; a 40 ft box needs two neighbouring stacks that are both empty or both 40-locked, of
 * equal height.
 */
export function candidateSlots(stacks: YardStacks): YardCandidate[] {
  const span = boxSpan(stacks.size)
  const out: YardCandidate[] = []
  const bayVessels = (bay: number): string[] => {
    const set = new Set<string>()
    for (let r = 1; r <= stacks.rows; r++) {
      const v = stacks.topVessels[(bay - 1) * stacks.rows + (r - 1)]
      if (v) set.add(v)
    }
    return [...set]
  }
  for (let bay = 1; bay + span - 1 <= stacks.bays; bay++) {
    const vessels = span === 1 ? bayVessels(bay) : [...new Set([...bayVessels(bay), ...bayVessels(bay + 1)])]
    vessels.sort()
    for (let row = 1; row <= stacks.rows; row++) {
      const i = (bay - 1) * stacks.rows + (row - 1)
      const h = stacks.heights[i]
      if (h >= stacks.tiers) continue
      if (span === 2 && stacks.heights[i + stacks.rows] !== h) continue
      // a stack takes the length of its bottom box: only that length goes on it until it is empty
      if (stacks.stackSpans[i] !== 0 && stacks.stackSpans[i] !== span) continue
      if (span === 2 && stacks.stackSpans[i + stacks.rows] !== stacks.stackSpans[i]) continue
      const x = rowX({ x: stacks.blockX }, row)
      const z = slotZ({ firstBayZ: stacks.firstBayZ }, bay, span)
      out.push({
        slotId: yardSlotId(stacks.blockId, bay, row, h + 1),
        bay,
        row,
        tier: h + 1,
        span,
        x,
        z,
        distanceM: Math.round((Math.abs(x - stacks.wtpX) + Math.abs(z - stacks.wtpZ)) * 1000) / 1000,
        belowVesselId: h > 0 ? stacks.topVessels[i] : null,
        bayVesselIds: vessels,
      })
    }
  }
  return out
}

/** Z where the block's ASC rail starts / ends (waterside / landside limit of a crane centre). */
export const railStartZ = (block: Pick<BlockSpec, 'wtpZ'>): number => block.wtpZ - RAIL_MARGIN_M
export const railEndZ = (block: Pick<BlockSpec, 'firstBayZ' | 'bays'>): number =>
  block.firstBayZ + (block.bays - 1) * BAY_PITCH_M + RAIL_MARGIN_M

/** Rail segment (zone) ids covering the Z interval [lo, hi] (a crane footprint is inflated by half the minimum separation). */
export function railSegmentIds(block: Pick<BlockSpec, 'id' | 'wtpZ'>, lo: number, hi: number): string[] {
  const origin = block.wtpZ - RAIL_MARGIN_M - ASC_MIN_SEPARATION_M
  const first = Math.max(0, Math.floor((lo - ASC_MIN_SEPARATION_M / 2 - origin) / RAIL_SEGMENT_M + 1e-9))
  const last = Math.max(first, Math.ceil((hi + ASC_MIN_SEPARATION_M / 2 - origin) / RAIL_SEGMENT_M - 1e-9) - 1)
  const ids: string[] = []
  for (let k = first; k <= last; k++) ids.push(`${block.id}:R${k}`)
  return ids
}

/** Z interval [from, to) of the rail segment with index `k`. */
export function railSegmentSpan(block: Pick<BlockSpec, 'wtpZ'>, k: number): [number, number] {
  const origin = block.wtpZ - RAIL_MARGIN_M - ASC_MIN_SEPARATION_M
  return [origin + k * RAIL_SEGMENT_M, origin + (k + 1) * RAIL_SEGMENT_M]
}

/** Z where ASC number `index` of a twin block stands at the start (1 = at the WTP pads, 2 = at the landside end). */
export function ascStartZ(block: BlockSpec, index: number): number {
  return index === 1 ? block.wtpZ : Math.max(block.firstBayZ + (block.bays - 1) * BAY_PITCH_M, block.wtpZ + ASC_MIN_SEPARATION_M + RAIL_SEGMENT_M + 1)
}

/** [A] Pitch of the transfer stalls across a block (m). */
export const STALL_PITCH_M = 5.5
/** [A] Length of a transfer stall along Z (m): a 40 ft box on a chassis. */
export const STALL_LENGTH_M = 13
/** Z of the transfer stall centres: the box on the chassis stands within the rail margin past the last bay. */
export const transferStallZ = (block: Pick<BlockSpec, 'firstBayZ' | 'bays'>): number => block.firstBayZ + (block.bays - 1) * BAY_PITCH_M + 15

export function transferStallId(blockId: string, index: number): string {
  return `${blockId}-TS${index + 1}`
}

export interface TransferStallLayout {
  id: string
  blockId: string
  index: number
  x: number
  z: number
}

/** Transfer stalls of a block, centred across it (trucks stand along Z, cab towards the stacks). */
export function transferStallLayout(block: BlockSpec): TransferStallLayout[] {
  return Array.from({ length: block.transferStalls }, (_, k) => ({
    id: transferStallId(block.id, k),
    blockId: block.id,
    index: k,
    x: Math.round((block.x + (k - (block.transferStalls - 1) / 2) * STALL_PITCH_M) * 1000) / 1000,
    z: Math.round(transferStallZ(block) * 1000) / 1000,
  }))
}

/** [A] Height of the box bottom on a truck chassis (m). */
export const TRUCK_DECK_M = 1.3

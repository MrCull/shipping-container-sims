/**
 * The shared ASC rail of a twin-ASC block (TT-08), pure helpers.
 *
 * Both cranes run on the same rails along Z and may never pass or touch each
 * other. The rail is cut into segments of `RAIL_SEGMENT_M`; a crane's
 * footprint (its position inflated by half the minimum separation) occupies
 * the segments it overlaps. A trip reserves, per segment, the time window in
 * which the crane is in it (resting or moving through), and once the trip is
 * over the crane *parks*: it holds the segments around it until `PARK_UNTIL_S`
 * or until its next trip starts. Two cranes never hold a segment at the same
 * time, so their centres stay at least `ASC_MIN_SEPARATION_M` apart and the
 * waterside crane (ASC1) stays waterside of the landside crane (ASC2).
 *
 * A trip that conflicts with the other crane's trip starts later (rail wait);
 * one that conflicts with the other crane's *parked* position cannot start
 * until that crane steps aside (`planYield`) or, if it is busy, finishes.
 */
import type { MotionSegment } from '../kinematics'
import { mergeWindows, type Reservation, type WindowSpec } from '../reservations'
import {
  ASC_MIN_SEPARATION_M,
  PARK_UNTIL_S,
  RAIL_SEGMENT_M,
  railEndZ,
  railSegmentIds,
  railStartZ,
  type BlockSpec,
} from '../yardLayout'

/** The crane covers `[lo, hi]` of the rail during `[from, to)` (relative to the trip start). */
export interface Piece {
  lo: number
  hi: number
  from: number
  to: number
}

/** Where a crane is over time: resting pieces between and moving pieces during its gantry segments. */
export function occupancyPieces(startZ: number, segments: MotionSegment[], endT: number): Piece[] {
  const gantry = segments.filter((s) => s.axis === 'gantry').sort((a, b) => a.t0 - b.t0)
  const pieces: Piece[] = []
  let z = startZ
  let cursor = 0
  for (const s of gantry) {
    if (s.t0 > cursor) pieces.push({ lo: z, hi: z, from: cursor, to: s.t0 })
    pieces.push({ lo: Math.min(s.from, s.to), hi: Math.max(s.from, s.to), from: s.t0, to: s.t1 })
    cursor = s.t1
    z = s.to
  }
  if (endT > cursor) pieces.push({ lo: z, hi: z, from: cursor, to: endT })
  if (pieces.length === 0) pieces.push({ lo: z, hi: z, from: 0, to: endT })
  return pieces
}

/** Rail-segment windows of the pieces (merged per segment; zero-length pieces drop out). */
export function pieceWindows(block: BlockSpec, pieces: Piece[]): WindowSpec[] {
  const windows: WindowSpec[] = []
  for (const p of pieces) {
    if (p.to - p.from <= 0) continue
    for (const zone of railSegmentIds(block, p.lo, p.hi)) windows.push({ zone, from: p.from, to: p.to })
  }
  return mergeWindows(windows)
}

/** Windows of a crane parked at `z` from `from` on (relative to the trip start; open-ended). */
export function parkWindows(block: BlockSpec, z: number, from: number): WindowSpec[] {
  return railSegmentIds(block, z, z).map((zone) => ({ zone, from, to: PARK_UNTIL_S }))
}

/** A start this late means the plan can never start: the other crane is parked in the way. */
export const isBlockedStart = (start: number): boolean => start >= PARK_UNTIL_S / 2

export const isParkHold = (r: Reservation): boolean => r.to >= PARK_UNTIL_S

/** The Z range a plan sweeps. */
export function sweepOf(pieces: Piece[]): { lo: number; hi: number } {
  return { lo: Math.min(...pieces.map((p) => p.lo)), hi: Math.max(...pieces.map((p) => p.hi)) }
}

/**
 * Where the idle `partner` must stand so the crane sweeping `[lo, hi]` has
 * room: landside of the sweep for a landside partner, waterside of it for a
 * waterside one. null if the rail is too short.
 */
export function yieldTarget(block: BlockSpec, partnerIsLandside: boolean, sweep: { lo: number; hi: number }): number | null {
  const gap = ASC_MIN_SEPARATION_M + RAIL_SEGMENT_M
  const z = partnerIsLandside ? sweep.hi + gap : sweep.lo - gap
  return z <= railEndZ(block) && z >= railStartZ(block) ? z : null
}

/** Park holds of `holder` end when its next trip starts at `start` (a hold that never began is dropped). */
export function truncateParkHolds(list: Reservation[], holder: string, start: number): Reservation[] {
  return list.filter((r) => {
    if (r.holder !== holder || !isParkHold(r)) return true
    r.to = Math.max(r.from, Math.min(r.to, start))
    return r.to > r.from
  })
}

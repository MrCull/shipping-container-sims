/**
 * Geometry of the 2D yard drawing (owner decision on spec #374: a flat illustrated yard, not 3D). Pure: every shape
 * the canvas renderer draws is placed here from the layout (`layoutFor`) and the capacity, so the tests can prove that
 * what is drawn lines up with the hit regions. Containers are side-on 20 ft boxes (art pass 2): a long side face about
 * 2.1 to 2.4 times as wide as it is tall, with a thin top face and door end offset up and to the right by (`dx`, `dy`).
 */
import type { Layout, Rect } from '../types/presentation'

/** An oblique box: the front face rect, with the top and right side faces offset by `dx` (right) and `dy` (up). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
  dx: number
  dy: number
}

export interface Gantry {
  /** Outer x of the left and right legs. */
  left: number
  right: number
  legW: number
  /** Top of the beam and its height; legs run from the beam down to `footY`. */
  beamY: number
  beamH: number
  footY: number
}

export interface YardGeometry {
  /** Quiet harbour backdrop (sky, faint distant cranes, quay band) across the top of the yard. */
  backdrop: Rect
  /** The concrete yard floor below the backdrop. */
  floor: Rect
  /** Ground line: the bottom of every tier-0 container. */
  groundY: number
  /** Container front size and face offsets (same for every container in the yard). */
  boxW: number
  boxH: number
  dx: number
  dy: number
  /** How far a selected container lifts. */
  lift: number
  gantry: Gantry
  /** Where the crane hook carries a box: the front face top while travelling. */
  carryY: number
}

/** Room under the ground line for the stack numbers. */
export const LABEL_PX = 18
/** Share of the column a container side takes; the door end takes `DEPTH` more (0.92 of the column in all). */
const FRONT = 0.86
const DEPTH = 0.06
const RISE = 0.08
/** Length to height of a container side on screen: a 20 ft box, about 2.25:1, kept within 2.1 to 2.4. */
export const ASPECT = 2.25
export const ASPECT_MIN = 2.1
export const ASPECT_MAX = 2.4
/** Lift of the selected container, as a share of its height. */
export const LIFT = 0.3
/** Share of the play surface (yard top to bay bottom) the harbour backdrop band takes: the target's quarter. */
export const BACKDROP = 0.25

/**
 * The yard height full stacks of `capacity` side-on containers need in a column `colW` wide, on a play surface
 * `surfaceH` tall: the backdrop band, the stacks with the lift, the stack labels and some air under the hook.
 */
export function yardHeightFor(colW: number, surfaceH: number, capacity: number): number {
  const boxH = (colW * FRONT) / ASPECT
  return Math.ceil(surfaceH * BACKDROP + colW * RISE + (Math.max(1, capacity) + LIFT + 0.9) * boxH + LABEL_PX + 12)
}

export function yardGeometry(layout: Layout, capacity: number): YardGeometry {
  const { yard } = layout
  const colW = layout.columns[0]?.w ?? yard.w
  const fullW = colW * FRONT
  const dx = colW * DEPTH
  const dy = colW * RISE
  const groundY = Math.round(yard.y + yard.h - LABEL_PX)
  const surfaceH = Math.max(layout.collection.y + layout.collection.h, yard.y + yard.h) - yard.y
  const backdropBottom = Math.round(yard.y + Math.min(yard.h * 0.45, surfaceH * BACKDROP))
  const beamH = Math.max(10, Math.min(18, yard.h * 0.045))
  // The gantry beam runs across the backdrop band, so the band sits behind it.
  const beamY = Math.round(yard.y + (backdropBottom - yard.y) * 0.3)
  const hookRoom = beamH + 10
  const cap = Math.max(1, capacity)
  // The stacks (top face and lift included) rise from the ground to the backdrop band, under the beam and hook.
  const room = groundY - Math.max(beamY + hookRoom, backdropBottom) - dy
  // Whole pixels, so neighbouring tiers share an edge exactly.
  const boxH = Math.floor(Math.max(6, Math.min(fullW / ASPECT, room / (cap + LIFT))))
  // A short room keeps the box container shaped: it narrows instead of flattening.
  const boxW = Math.min(fullW, boxH * ASPECT_MAX)
  const backdrop = { x: yard.x, y: yard.y, w: yard.w, h: backdropBottom - yard.y }
  const floor = { x: yard.x, y: backdropBottom, w: yard.w, h: yard.y + yard.h - backdropBottom }
  const legW = Math.max(6, Math.min(12, yard.x - 4))
  const gantry: Gantry = {
    left: Math.max(0, yard.x - legW - 2),
    right: yard.x + yard.w + legW + 2,
    legW,
    beamY,
    beamH,
    footY: yard.y + yard.h - 4,
  }
  return { backdrop, floor, groundY, boxW, boxH, dx, dy, lift: boxH * LIFT, gantry, carryY: beamY + hookRoom + dy }
}

/** The box of the container at `tier` (0 = bottom) of stack `stack`, raised by `lift` px. */
export function boxAt(g: YardGeometry, layout: Layout, stack: number, tier: number, lift = 0): Box {
  const col = layout.columns[stack]!
  const x = col.x + (col.w - g.boxW - g.dx) / 2
  return { x, y: g.groundY - (tier + 1) * g.boxH - lift, w: g.boxW, h: g.boxH, dx: g.dx, dy: g.dy }
}

/** The whole drawn area of a box: front, top and side faces. */
export function boxBounds(b: Box): Rect {
  return { x: b.x, y: b.y - b.dy, w: b.w + b.dx, h: b.h + b.dy }
}

/** The dashed slot outlines of a column: one box per tier up to the capacity. */
export function slotsFor(g: YardGeometry, layout: Layout, stack: number, capacity: number): Box[] {
  return Array.from({ length: capacity }, (_, t) => boxAt(g, layout, stack, t))
}

export interface Truck {
  /** Which way the cab faces: the collection truck faces left, the receipt truck right. */
  facing: 'left' | 'right'
  /** Cab body (roof, windscreen, grille end), and the skeletal trailer chassis beam it pulls. */
  cab: Rect
  trailer: Rect
  /** Wheel centres: the cab axle first, then the two trailer axles. */
  wheels: { x: number; y: number }[]
  wheelR: number
  /** The road under the wheels (the soft shadow sits on it). */
  groundY: number
  /** Where a container rides on the trailer: the same 20 ft shape as a yard container. */
  cargo: Box
}

/** Rows kept clear at the top (bay title) and bottom (bay status) of a truck bay. */
export const BAY_TITLE_PX = 24
export const BAY_STATUS_PX = 20
/** A truck's container may be drawn up to this much larger than a yard container. */
export const MAX_CARGO_SCALE = 1.35

/**
 * The truck drawn in a bay: a tractor cab at one end (the right end when facing right, where the receipt arrow,
 * `arrowBox`, sits over it) pulling a skeletal trailer, and the container slot on the trailer, sized like a yard
 * container but never longer than the trailer.
 */
export function truckIn(bay: Rect, g: YardGeometry, facing: 'left' | 'right' = 'right'): Truck {
  const pad = 8
  const top = bay.y + BAY_TITLE_PX
  const bottom = bay.y + bay.h - BAY_STATUS_PX
  const h = Math.max(12, bottom - top)
  const groundY = bottom - 1
  // The truck grows with a tall bay (art pass 2 gives the bays the yard's spare height), led by the cab.
  const cabW = Math.max(20, Math.min(70, bay.w * 0.26, h * 0.6))
  const cabH = Math.max(14, Math.min(h * 0.85, cabW * 1.15))
  const wheelR = Math.max(3.5, Math.min(12, cabW * 0.17))
  const axleY = groundY - wheelR
  const beamH = Math.max(3, wheelR * 0.7)
  const deckY = axleY - wheelR * 0.55 - beamH
  const cabBottom = axleY + wheelR * 0.2
  const cabX = facing === 'right' ? bay.x + bay.w - pad - cabW : bay.x + pad
  const cab: Rect = { x: cabX, y: cabBottom - cabH, w: cabW, h: cabH }
  // The trailer runs back from the cab, at most about four cabs long on a wide desktop bay.
  const trailerW = Math.min(bay.w - 2 * pad - cabW - 3, cabW * 4.2)
  const trailerX = facing === 'right' ? cab.x - 3 - trailerW : cab.x + cabW + 3
  const trailer: Rect = { x: trailerX, y: deckY, w: trailerW, h: beamH }
  const rear = facing === 'right' ? trailer.x + wheelR * 1.4 : trailer.x + trailer.w - wheelR * 1.4
  const forward = facing === 'right' ? 1 : -1
  const cabAxle = cab.x + cabW * (facing === 'right' ? 0.62 : 0.38)
  const wheels = [cabAxle, rear, rear + forward * wheelR * 2.3].map((x) => ({ x, y: axleY }))
  // The cargo: as long as a yard container where the trailer allows, as tall as the room above the deck allows.
  const scale = Math.min(MAX_CARGO_SCALE, (trailer.w - 4) / (g.boxW + g.dx), (deckY - top - 2) / (g.boxH + g.dy))
  const w = g.boxW * scale
  const ch = g.boxH * scale
  const cdx = g.dx * scale
  const cdy = g.dy * scale
  const cargo: Box = { x: trailer.x + (trailer.w - w - cdx) / 2, y: deckY - ch, w, h: ch, dx: cdx, dy: cdy }
  return { facing, cab, trailer, wheels, wheelR, groundY, cargo }
}

/** Free slots in the yard: capacity times stacks, less the containers in it. */
export function freeSlots(capacity: number, stacks: number, containers: number): number {
  return Math.max(0, capacity * stacks - containers)
}

/**
 * Geometry of the 2D yard drawing (owner decision on spec #374: a flat illustrated yard, not 3D). Pure: every shape
 * the canvas renderer draws is placed here from the layout (`layoutFor`) and the capacity, so the tests can prove that
 * what is drawn lines up with the hit regions. Containers are chunky boxes (owner, art pass 3 of the 2D yard, back to
 * the v1 look): a front face 1.3 to 1.45 times as wide as it is tall, with a light top face and a darker end face
 * offset up and to the right by (`dx`, `dy`).
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
  /** Top of the beam (the top of the concrete, just under the sky band) and its height; legs run down to `footY`. */
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
/** Share of the column a container front takes; the end face takes `DEPTH` more (0.91 of the column in all). */
const FRONT = 0.74
const DEPTH = 0.17
const RISE = 0.12
/**
 * Width to height of a container front on screen (owner, art pass 3: chunky near-square boxes): boxes are sized from
 * the column width first, as tall as `ASPECT_MIN` (1.3:1) allows; a short room narrows a box rather than flattening it
 * past `ASPECT_MAX` (1.45:1).
 */
export const ASPECT_MIN = 1.3
export const ASPECT_MAX = 1.45
/** The big number's height as a share of the box height (owner: big bold numbers, 55 to 60 %). */
export const NUMBER_SHARE = 0.58
/** Lift of the selected container, as a share of its height. */
export const LIFT = 0.3
/** The sky strip kept above the gantry beam. */
export const SKY_MIN = 22
/** Most of the yard height the sky band takes (art pass 4). */
export const SKY_SHARE = 0.22
/** Room between the beam and the top of a carried box, for the spreader. */
const SPREADER = 8

/** Gantry beam height for a column width. */
export function beamHFor(colW: number): number {
  return Math.max(10, Math.min(16, Math.round(colW * 0.16)))
}

/** Yard height besides the stacks: sky, beam, spreader, top face, a clearance pixel pair and the stack labels. */
function fixedFor(colW: number): number {
  return SKY_MIN + beamHFor(colW) + SPREADER + colW * RISE + 2 + LABEL_PX
}

/**
 * Box height in a column `colW` wide with `room` px for the stacks: full stacks of `capacity` plus one box of crane
 * headroom (a carried box clears a full stack), never taller than `ASPECT_MIN` allows. Whole pixels.
 */
export function boxHFor(colW: number, capacity: number, room: number): number {
  return Math.floor(Math.max(6, Math.min((colW * FRONT) / ASPECT_MIN, room / (Math.max(1, capacity) + 1))))
}

/**
 * The yard height full stacks of `capacity` need in a column `colW` wide when the yard may be at most `maxH` tall:
 * the box height (`boxHFor`) and the yard that fits it exactly (sky strip, beam, headroom, stacks, labels).
 */
export function yardFit(colW: number, capacity: number, maxH: number): { boxH: number; h: number } {
  const fixed = fixedFor(colW)
  const boxH = boxHFor(colW, capacity, maxH - fixed)
  return { boxH, h: Math.ceil(fixed + (Math.max(1, capacity) + 1) * boxH) }
}

export function yardGeometry(layout: Layout, capacity: number): YardGeometry {
  const { yard } = layout
  const colW = layout.columns[0]?.w ?? yard.w
  const fullW = colW * FRONT
  const dx = colW * DEPTH
  const dy = colW * RISE
  const cap = Math.max(1, capacity)
  const groundY = Math.round(yard.y + yard.h - LABEL_PX)
  const beamH = beamHFor(colW)
  const boxH = boxHFor(colW, cap, groundY - yard.y - (fixedFor(colW) - LABEL_PX))
  // A short room keeps the box container shaped: it narrows instead of flattening.
  const boxW = Math.min(fullW, boxH * ASPECT_MAX)
  // The crane carries a box one box above a full stack (the crane headroom); at rest the spreader hangs there.
  const carryY = groundY - (cap + 1) * boxH - 2
  // The beam sits at the top of the concrete, just under the sky band, and the hoist cables span the gap down to the
  // spreader. The sky band is at most `SKY_SHARE` of the yard; on a short yard it ends where the beam still clears a
  // carried box, so the beam never sinks into the headroom.
  const lowestBeam = Math.floor(carryY - dy - SPREADER - beamH)
  const floorY = Math.round(Math.min(lowestBeam, Math.max(yard.y + SKY_MIN, yard.y + yard.h * SKY_SHARE)))
  const beamY = floorY
  const backdrop = { x: yard.x, y: yard.y, w: yard.w, h: floorY - yard.y }
  const floor = { x: yard.x, y: floorY, w: yard.w, h: yard.y + yard.h - floorY }
  const legW = Math.max(6, Math.min(12, yard.x - 4))
  const gantry: Gantry = {
    left: Math.max(0, yard.x - legW - 2),
    right: yard.x + yard.w + legW + 2,
    legW,
    beamY,
    beamH,
    footY: yard.y + yard.h - 4,
  }
  return { backdrop, floor, groundY, boxW, boxH, dx, dy, lift: boxH * LIFT, gantry, carryY }
}

/** The box of the container at `tier` (0 = bottom) of stack `stack`, raised by `lift` px. */
export function boxAt(g: YardGeometry, layout: Layout, stack: number, tier: number, lift = 0): Box {
  const col = layout.columns[stack]!
  const x = col.x + (col.w - g.boxW - g.dx) / 2
  return { x, y: g.groundY - (tier + 1) * g.boxH - lift, w: g.boxW, h: g.boxH, dx: g.dx, dy: g.dy }
}

/** Font size (px) of a box's big number: `NUMBER_SHARE` of its height. */
export function numberSize(b: Box): number {
  return Math.round(b.h * NUMBER_SHARE)
}

/** Most the NEXT chevron bounces up or down from its rest (px); the renderer's bounce stays inside it. */
export const CHEVRON_BOUNCE = 3

/**
 * The bouncing NEXT chevron over stack `stack` holding `height` boxes: centred on the boxes' front, just above the
 * stack top (a buried next container's stack top too, so the player sees where to dig), never up into the beam. The
 * hit regions stay the columns; this is paint only.
 */
export function chevronAt(g: YardGeometry, layout: Layout, stack: number, height: number): Rect {
  const col = layout.columns[stack]!
  const top = height > 0 ? boxBounds(boxAt(g, layout, stack, height - 1)).y : g.groundY
  const bottom = top - CHEVRON_BOUNCE - 2
  const ceiling = g.gantry.beamY + g.gantry.beamH + CHEVRON_BOUNCE
  const h = Math.max(6, Math.min(g.boxH * 0.6, col.w * 0.32, bottom - ceiling))
  const w = Math.min(col.w - 4, h * 1.5)
  const cx = boxAt(g, layout, stack, 0).x + g.boxW / 2
  const x = Math.min(col.x + col.w - 2 - w, Math.max(col.x + 2, cx - w / 2))
  return { x, y: bottom - h, w, h }
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
export const MAX_CARGO_SCALE = 1.6

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
  // The truck fills most of the bay width (art pass 3), led by the cab; its height follows from the cab and cargo.
  const cabW = Math.max(20, Math.min(72, bay.w * 0.28, h * 0.8))
  const cabH = Math.max(14, Math.min(h * 0.92, cabW * 1.12))
  const wheelR = Math.max(3.5, Math.min(12, cabW * 0.16))
  const beamH = Math.max(4, wheelR * 0.95)
  const under = wheelR * 1.55 + beamH
  const trailerMax = bay.w - 2 * pad - cabW - 3
  const scale = Math.min(MAX_CARGO_SCALE, (trailerMax - 6) / (g.boxW + g.dx), (h - under - 2) / (g.boxH + g.dy))
  // The trailer carries its box with a little deck to spare; on a wide bay it stays a believable length.
  const trailerW = Math.min(trailerMax, Math.max(cabW * 2.2, (g.boxW + g.dx) * scale + 14, Math.min(bay.w * 0.62, cabW * 4)))
  const cargoH = (g.boxH + g.dy) * scale
  const truckH = Math.max(cabH + wheelR * 0.8, under + cargoH)
  // Centred in the room between the bay title and its status line.
  const groundY = bottom - Math.max(0, (h - truckH) / 2)
  const axleY = groundY - wheelR
  const deckY = axleY - wheelR * 0.55 - beamH
  const cabBottom = axleY + wheelR * 0.2
  const cabX = facing === 'right' ? bay.x + bay.w - pad - cabW : bay.x + pad
  const cab: Rect = { x: cabX, y: cabBottom - cabH, w: cabW, h: cabH }
  const trailerX = facing === 'right' ? cab.x - 3 - trailerW : cab.x + cabW + 3
  const trailer: Rect = { x: trailerX, y: deckY, w: trailerW, h: beamH }
  const rear = facing === 'right' ? trailer.x + wheelR * 1.4 : trailer.x + trailer.w - wheelR * 1.4
  const forward = facing === 'right' ? 1 : -1
  const cabAxle = cab.x + cabW * (facing === 'right' ? 0.62 : 0.38)
  const wheels = [cabAxle, rear, rear + forward * wheelR * 2.3].map((x) => ({ x, y: axleY }))
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

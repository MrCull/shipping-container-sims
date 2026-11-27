/**
 * Geometry of the 2D yard drawing (owner decision on spec #374: a flat illustrated yard, not 3D). Pure: every shape
 * the canvas renderer draws is placed here from the layout (`layoutFor`) and the capacity, so the tests can prove that
 * what is drawn lines up with the hit regions. Containers are oblique boxes: a front face plus a top face and a right
 * side face offset up and to the right by (`dx`, `dy`).
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
  /** Harbour backdrop (sky, water, ship, distant cranes) across the top of the yard. */
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
/** Share of the column a container front face takes; the side face takes `DEPTH` more. */
const FRONT = 0.64
const DEPTH = 0.16
const RISE = 0.12
/** Lift of the selected container, as a share of its height. */
export const LIFT = 0.3
/** Least share of the yard height the harbour backdrop keeps. */
const MIN_BACKDROP = 0.3

export function yardGeometry(layout: Layout, capacity: number): YardGeometry {
  const { yard } = layout
  const colW = layout.columns[0]?.w ?? yard.w
  const boxW = colW * FRONT
  const dx = colW * DEPTH
  const dy = colW * RISE
  const groundY = Math.round(yard.y + yard.h - LABEL_PX)
  const beamH = Math.max(10, Math.min(18, yard.h * 0.045))
  const beamY = yard.y + 4
  const hookRoom = beamH + 10
  const cap = Math.max(1, capacity)
  // The harbour backdrop keeps at least a third of the yard; the stacks (top face and lift included) fit under it.
  const room = groundY - Math.max(beamY + hookRoom, yard.y + yard.h * MIN_BACKDROP) - dy
  // Whole pixels, so neighbouring tiers share an edge exactly.
  const boxH = Math.floor(Math.max(8, Math.min(boxW * 0.72, room / (cap + LIFT + 0.3))))
  const stackTop = groundY - cap * boxH - dy - boxH * LIFT
  // The backdrop fills what the stacks leave, between a third and a half of the yard.
  const backdropBottom = Math.min(yard.y + yard.h * 0.5, Math.max(yard.y + yard.h * MIN_BACKDROP, stackTop - boxH * 0.3))
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
  /** Flatbed (chassis) and cab, wheel centres and radius. */
  bed: Rect
  cab: Rect
  wheels: { x: number; y: number }[]
  wheelR: number
  /** Where a container rides on the bed. */
  cargo: Box
}

/** Rows kept clear at the top (bay title) and bottom (bay status) of a truck bay. */
export const BAY_TITLE_PX = 24
export const BAY_STATUS_PX = 20

/**
 * The truck drawn in a bay: a flatbed with its cab at the bay's right end (the arrow box, `arrowBox`, sits over the
 * cab), and the container slot on the bed, sized like a yard container but never wider than the bed.
 */
export function truckIn(bay: Rect, g: YardGeometry): Truck {
  const pad = 10
  const top = bay.y + BAY_TITLE_PX
  const bottom = bay.y + bay.h - BAY_STATUS_PX
  const h = Math.max(10, bottom - top)
  const wheelR = Math.max(3, Math.min(7, h * 0.09))
  const bedH = Math.max(3, wheelR * 0.9)
  const bedY = bottom - wheelR * 1.6 - bedH
  const cabW = Math.max(18, Math.min(46, bay.w * 0.2))
  const cabH = Math.max(12, Math.min(h * 0.55, cabW * 1.05))
  const cab: Rect = { x: bay.x + bay.w - pad - cabW, y: bedY + bedH - cabH, w: cabW, h: cabH }
  // The flatbed runs left from the cab, at most about four cabs long on a wide desktop bay.
  const bedW = Math.min(cab.x - 2 - (bay.x + pad), cabW * 4.2)
  const bed: Rect = { x: cab.x - 2 - bedW, y: bedY, w: bedW, h: bedH }
  const wheels = [bed.x + wheelR * 2, bed.x + bed.w * 0.62, cab.x + cabW * 0.55].map((x) => ({ x, y: bedY + bedH + wheelR * 0.6 }))
  // The cargo: as wide as a yard container where the bed allows, as tall as the room above the bed allows.
  const scale = Math.min(1, (bed.w - 6) / (g.boxW + g.dx), (bedY - top - 2) / (g.boxH + g.dy))
  const w = g.boxW * scale
  const ch = g.boxH * scale
  const cdx = g.dx * scale
  const cdy = g.dy * scale
  const cargo: Box = { x: bed.x + (bed.w - w - cdx) / 2, y: bedY - ch, w, h: ch, dx: cdx, dy: cdy }
  return { bed, cab, wheels, wheelR, cargo }
}

/** Free slots in the yard: capacity times stacks, less the containers in it. */
export function freeSlots(capacity: number, stacks: number, containers: number): number {
  return Math.max(0, capacity * stacks - containers)
}

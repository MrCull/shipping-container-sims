/**
 * Shared drawing helpers of the two top-down terminal pictures in the setup dialog (`components/setup/LayoutSketch.vue`
 * on the Scenario tab and `PlanPreview.vue` on the Yard and equipment tab). Scene metres: X along the quay, Z landside
 * (the quay edge is Z = 0, the sea is negative Z).
 */

/** Water drawn seaward of the quay edge (m): room for the vessel and the crane booms. */
export const SEA_DEPTH_M = 120
/** How far a quay crane's boom reaches over the water and back over the apron (m). */
export const BOOM_SEA_M = 62
export const BOOM_LAND_M = 30
/** The water and the land run this far past the plan on both sides, so they fill the picture whatever its shape. */
export const BLEED_M = 4000

const SHIP_BEAM_M = 46

export interface PictureRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ShipPicture {
  /** SVG path of the hull, bow to the right. */
  hull: string
  /** Container bays on deck. */
  stacks: PictureRect[]
  /** The accommodation block at the stern. */
  house: PictureRect
}

/** An illustrative vessel alongside: about half the quay, never longer than a big container ship. */
export function shipAtQuay(quayX0: number, quayX1: number): ShipPicture {
  const length = Math.min((quayX1 - quayX0) * 0.55, 330)
  const x0 = quayX0 + (quayX1 - quayX0 - length) * 0.3
  const y0 = -10 - SHIP_BEAM_M
  const y1 = y0 + SHIP_BEAM_M
  const bow = Math.min(34, length * 0.16)
  const hull = `M${x0 + 6} ${y0} H${x0 + length - bow} Q${x0 + length} ${y0 + SHIP_BEAM_M / 2} ${x0 + length - bow} ${y1} H${x0 + 6} Q${x0} ${y1} ${x0} ${y1 - 6} V${y0 + 6} Q${x0} ${y0} ${x0 + 6} ${y0} Z`
  const bays = Math.max(3, Math.floor((length - bow - 34) / 22))
  const stacks = Array.from({ length: bays }, (_, i) => ({ x: x0 + 26 + i * 22, y: y0 + 7, w: 17, h: SHIP_BEAM_M - 14 }))
  return { hull, stacks, house: { x: x0 + 8, y: y0 + 9, w: 12, h: SHIP_BEAM_M - 18 } }
}

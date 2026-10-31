/**
 * Close-up container marking layout (#119, #143): `paintContainer` (containerTextures.ts) paints one box's markings
 * into a canvas laid out as `TEXTURE_LAYOUT`, and the close-up level copies the region of each visible face into an
 * atlas tile (`containerCloseups.ts`). The regions are authored for 40 ft boxes and stretch to the box's face.
 */

export const TEXTURE_SIZE = { w: 1024, h: 512 } as const

/** A rectangle of the per-box canvas, in pixels (origin top-left). */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export const TEXTURE_LAYOUT = {
  /** Long sides: both use it (the -Z side is drawn by a quad turned about Y, so text is upright from outside). */
  side: { x: 0, y: 0, w: 1024, h: 160 },
  roof: { x: 0, y: 160, w: 1024, h: 64 },
  /** Door end (+X), seen from behind the box: u runs to the viewer's right. */
  door: { x: 0, y: 224, w: 288, h: 288 },
  front: { x: 320, y: 224, w: 288, h: 288 },
  /** Plain swatches of weathered dark steel and galvanised light (kept in the painted canvas, unused by the faces). */
  steel: { x: 640, y: 224, w: 128, h: 128 },
  zinc: { x: 800, y: 224, w: 128, h: 128 },
} satisfies Record<string, Region>

/** Metres per corrugation ridge (the shared normal map is authored for it). */
export const CORRUGATION_PITCH_M = 0.25

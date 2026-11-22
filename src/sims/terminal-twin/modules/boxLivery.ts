/**
 * Livery tile drawn for a box in the default colour mode (#360). About half the yard shows a generic leasing or
 * old-stock box (rust, oxblood, brown, dull blue, faded green, grey, off-white; no line wordmark), like real lessor
 * boxes. Render-only: the engine line (`ContainerState.line`) is untouched, and Colour by line and the other colour-by
 * modes keep using it. The choice hashes the box id only, so a box looks the same every frame and every reload.
 */
import atlas from '../assets/models/containers/livery-atlas.json' with { type: 'json' } // the attribute lets Playwright's Node import it
import { boxUnit } from './boxHash'

/** Share of boxes with a known line drawn as a leasing variant. */
export const LEASING_SHARE = 0.5

const LEASING = atlas.leasing
const LEASING_WEIGHT = LEASING.reduce((s, l) => s + l.weight, 0)
const LEASING_INDICES = new Set(LEASING.map((l) => l.index))

/** Atlas tile index for a shipping line (unknown or missing lines get the generic grey tile). */
export function liveryIndexForLine(line: string | null | undefined): number {
  const hit = line == null ? undefined : atlas.liveries.find((l) => l.line === line)
  return hit ? hit.index : atlas.genericIndex
}

/** Whether a tile index is one of the leasing variants. */
export function isLeasingTile(index: number): boolean {
  return LEASING_INDICES.has(index)
}

/** Atlas tile for box `id` of `line` in the default colour mode: a weighted leasing variant for about LEASING_SHARE of the boxes, else its line's tile. */
export function liveryIndexForBox(id: string, line: string | null | undefined): number {
  const own = liveryIndexForLine(line)
  if (own === atlas.genericIndex || boxUnit(id, 'leasing') >= LEASING_SHARE) return own
  let pick = boxUnit(id, 'leasing-variant') * LEASING_WEIGHT
  for (const l of LEASING) {
    pick -= l.weight
    if (pick < 0) return l.index
  }
  return LEASING[LEASING.length - 1].index
}

/** Largest brightness shift of a box's tone (#361): its colour is scaled by 1 plus or minus up to this. */
export const TONE_BRIGHTNESS_RANGE = 0.12
/** Largest saturation shift of a box's tone (#361): its colour is pushed from or towards its grey by up to this. */
export const TONE_SATURATION_RANGE = 0.15
/** Steps each tone part takes from minus to plus its range (odd, so the middle step is no shift). */
export const TONE_LEVELS = 15

/** A box's tone shift (#361), each part a signed fraction: 0 is the livery as authored. */
export interface BoxTone {
  brightness: number
  saturation: number
}

const HALF = (TONE_LEVELS - 1) / 2
const step = (u: number) => Math.min(TONE_LEVELS - 1, Math.floor(u * TONE_LEVELS)) - HALF // -HALF..HALF

/** Small, stable tone shift of box `id` in the default colour mode (slightly faded or dirty), a pure function of the id, in TONE_LEVELS steps. */
export function boxTone(id: string): BoxTone {
  return {
    brightness: (step(boxUnit(id, 'tone-brightness')) / HALF) * TONE_BRIGHTNESS_RANGE,
    saturation: (step(boxUnit(id, 'tone-saturation')) / HALF) * TONE_SATURATION_RANGE,
  }
}

/**
 * The tone packed into the fractional part of the `liveryIndex` instance attribute (#361), so it costs no extra
 * per-instance data: `(b * 16 + s) / 256` with each step stored as 1 to 15 (8 = no shift), and 0 meaning no tone
 * (a tinted box, a plain mesh). `containerAssets#liveryMaterial` decodes it.
 */
export function toneFraction(tone: BoxTone | null): number {
  if (!tone) return 0
  const b = Math.round((tone.brightness / TONE_BRIGHTNESS_RANGE) * HALF) + 8
  const s = Math.round((tone.saturation / TONE_SATURATION_RANGE) * HALF) + 8
  return (b * 16 + s) / 256
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/**
 * CSS colour `css` (`#rrggbb`) with box tone `tone` applied as the livery shader applies it (linear space: saturation
 * about the luminance grey, then brightness), for the close-up and hero faces drawn over a near box (#362), so a box
 * keeps its colour as it changes level of detail. `null` (a colour-by tint) returns `css` unchanged.
 */
export function tonedColour(css: string, tone: BoxTone | null): string {
  if (!tone || (tone.brightness === 0 && tone.saturation === 0)) return css
  const n = parseInt(css.slice(1, 7), 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255))
  const grey = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  const out = rgb.map((v) => Math.round(toSrgb(Math.min(Math.max(grey + (v - grey) * (1 + tone.saturation), 0) * (1 + tone.brightness), 1)) * 255))
  return `#${((out[0] << 16) | (out[1] << 8) | out[2]).toString(16).padStart(6, '0')}`
}

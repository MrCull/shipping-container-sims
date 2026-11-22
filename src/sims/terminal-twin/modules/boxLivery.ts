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

/**
 * Opening a hull's hatches (TT-R10), pure maths on vertex arrays (no Three.js, so the Node tests share it).
 *
 * The hull GLB has its hatch covers and a solid main deck baked in. The twin draws the cover panels itself from the
 * engine's hatch state, so for a bay that has panels the covers must go and the deck must have a hole under them
 * (otherwise a lifted panel reveals a flat deck, not the hold). `hullWithOpenHatches` returns the hull LOD without the
 * baked covers of those bays and with the deck clipped open inside their coamings; the renderer adds a liner inside.
 * Asset frame: see `vesselHull.ts`.
 */
import { rowRange, vesselClass } from '../scenario/vesselClasses'
import type { HullMeta } from './vesselHull'

/** [A] Gap between the hatches of neighbouring bays (m): `HATCH_GAP` in `assets/generators/tt_assets/vessels.py`. */
export const HULL_HATCH_GAP_M = 1.4
/** [A] Height of the coaming above the main deck, below the cover (m): `COAMING_M` in `vessels.py`. */
export const HULL_COAMING_M = 1.7
/** [A] The coaming box is inset this far from the hatch edge (m): `build_hatches` in `vessels.py`. */
const COAMING_INSET_M = 0.1
/** [A] The coaming stands this far outside the outermost rows (m): the generator's `rows_half + 0.25` less the inset. */
const COAMING_OUTSIDE_M = 0.15
/** Slack when matching the generator's box faces (m). */
const EPS_M = 0.03

/** One bay's opening in the asset frame: the plan view inside the coaming, and the heights. */
export interface HullHatchOpening {
  x0: number
  x1: number
  /** Quay-side (+z) and seaward (-z) edges. */
  zQuay: number
  zSea: number
  /** Main deck, coaming top and hold floor (asset y). */
  deckY: number
  coamingTopY: number
  floorY: number
}

/** The openings of `bays` for a hull sidecar. */
export function hullHatchOpenings(meta: HullMeta, bays: Iterable<number>): HullHatchOpening[] {
  const g = meta.bayGrid
  const [ox, , oz] = g.origin
  const width = g.rows * g.rowPitchM
  return [...bays].map((bay) => ({
    x0: ox + bay * g.bayPitchM + HULL_HATCH_GAP_M / 2 + COAMING_INSET_M,
    x1: ox + (bay + 1) * g.bayPitchM - HULL_HATCH_GAP_M / 2 - COAMING_INSET_M,
    // `oz` is the quay-side edge of row 0; the rows run towards -z and the coaming stands just outside them
    zQuay: oz + COAMING_OUTSIDE_M,
    zSea: oz - width - COAMING_OUTSIDE_M,
    deckY: g.holdTopY - HULL_COAMING_M,
    coamingTopY: g.holdTopY,
    floorY: g.holdTopY - g.holdTiers * g.tierPitchM,
  }))
}

/**
 * The bays of a hull whose baked covers are cut (#173): every bay of the class when hatch covers are off, so no cover
 * stands over any hold; with hatch covers on, the bays that have panels (the twin draws those panels itself, TT-R10).
 */
export function openHatchBays(hatchCovers: boolean, bayCount: number, panelBays: ReadonlySet<number>): Set<number> {
  return hatchCovers ? new Set(panelBays) : new Set(Array.from({ length: bayCount }, (_, bay) => bay))
}

/**
 * Cross-section of a hold under an opening (hull profile, #131), as (z, y) points in the asset frame: the stepped V the
 * lower tiers make when they lose their outer rows. Starts on the quay-side wall at the floor, goes up that wall, across
 * the top and down the seaward wall; the renderer extrudes it along the bay. `inset` pulls the walls in so they do not
 * fight with the hull's own coaming faces.
 */
export function holdLinerOutline(meta: HullMeta, o: HullHatchOpening, inset = 0.02): [number, number][] {
  const g = meta.bayGrid
  const spec = vesselClass(meta.sizeClass)
  const oz = g.origin[2]
  const quay: [number, number][] = []
  const sea: [number, number][] = []
  for (let t = 0; t < g.holdTiers; t++) {
    const { from, to } = rowRange(spec, t)
    const yb = g.holdTopY - (g.holdTiers - t) * g.tierPitchM
    const yt = g.holdTopY - (g.holdTiers - t - 1) * g.tierPitchM
    const zq = (from === 0 ? o.zQuay : oz - from * g.rowPitchM) - inset
    const zs = (to === spec.rows ? o.zSea : oz - to * g.rowPitchM) + inset
    quay.push([zq, yb], [zq, yt])
    sea.push([zs, yb], [zs, yt])
  }
  return [...quay, ...sea.reverse()]
}

/** Vertex data of a hull LOD: attribute arrays by name (`position` is required, 3 floats per vertex), triangles by `index` or in order. */
export interface HullMeshData {
  index: ArrayLike<number> | null
  attributes: Record<string, { array: ArrayLike<number>; itemSize: number }>
}

type Vertex = number[]
type Polygon = Vertex[]

const lerp = (a: Vertex, b: Vertex, t: number): Vertex => a.map((x, i) => x + (b[i] - x) * t)

/** The part of a convex polygon where `side(v) >= 0` (Sutherland-Hodgman); keeps the winding, interpolates every attribute. */
function clip(poly: Polygon, side: (v: Vertex) => number): Polygon {
  const out: Polygon = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const da = side(a)
    const db = side(b)
    if (da >= 0) out.push(a)
    if (da >= 0 !== db >= 0) out.push(lerp(a, b, da / (da - db)))
  }
  return out
}

/** The parts of a triangle outside the rectangle of an opening, as triangles. */
function outsideOpening(tri: Polygon, o: HullHatchOpening): Polygon[] {
  const xs = tri.map((v) => v[0])
  const zs = tri.map((v) => v[2])
  if (Math.max(...xs) <= o.x0 || Math.min(...xs) >= o.x1 || Math.max(...zs) <= o.zSea || Math.min(...zs) >= o.zQuay) return [tri]
  const strip = clip(
    clip(tri, (v) => v[0] - o.x0),
    (v) => o.x1 - v[0],
  )
  const parts = [clip(tri, (v) => o.x0 - v[0]), clip(tri, (v) => v[0] - o.x1), clip(strip, (v) => o.zSea - v[2]), clip(strip, (v) => v[2] - o.zQuay)]
  const out: Polygon[] = []
  for (const poly of parts) for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]])
  return out
}

/**
 * The hull LOD with the hatches of `bays` open, as a non-indexed triangle list per attribute.
 * Triangles of the covers go: all corners inside the bay's hatch footprint (plan view, with the gap to the neighbour) and
 * at or above the panel bottom (LOD0 panels start at the hold top, so the coaming walls below stay; LOD1 panels are boxes
 * from the main deck up). Flat main-deck triangles are clipped to the outside of the opening.
 * LOD2 is one box across all bays (its top is two triangles over the whole span, at the cover top): that top is clipped to
 * the outside of every open bay, and its walls stay, as the coamings they stand for. Its gaps keep a strip of top.
 */
export function hullWithOpenHatches(meta: HullMeta, lod: 0 | 1 | 2, mesh: HullMeshData, bays: ReadonlySet<number>): Record<string, Float32Array> {
  const openings = hullHatchOpenings(meta, bays)
  const names = Object.keys(mesh.attributes)
  const offsets: number[] = []
  let width = 0
  for (const n of names) {
    offsets.push(width)
    width += mesh.attributes[n].itemSize
  }
  const count = mesh.index ? mesh.index.length : mesh.attributes.position.array.length / 3
  const vertexAt = (i: number): Vertex => {
    const v = mesh.index ? mesh.index[i] : i
    const out: Vertex = new Array<number>(width)
    names.forEach((n, k) => {
      const { array, itemSize } = mesh.attributes[n]
      for (let c = 0; c < itemSize; c++) out[offsets[k] + c] = array[v * itemSize + c]
    })
    return out
  }
  const deckY = meta.bayGrid.holdTopY - HULL_COAMING_M
  // the hatch-cover top is the sidecar origin's height (the deck-stack base)
  const coverTopY = meta.bayGrid.origin[1]
  const panelYMin = lod === 0 ? meta.bayGrid.holdTopY - EPS_M : deckY - EPS_M
  // the panel boxes reach the coaming inset (0.1 m) beyond the opening on every side; the lashing bridges in the gaps stay
  const slack = COAMING_INSET_M + EPS_M
  const outsideAll = (tri: Polygon): Polygon[] => {
    let pieces: Polygon[] = [tri]
    for (const o of openings) pieces = pieces.flatMap((piece) => outsideOpening(piece, o))
    return pieces
  }
  const kept: Polygon[] = []
  for (let t = 0; t + 2 < count; t += 3) {
    const tri = [vertexAt(t), vertexAt(t + 1), vertexAt(t + 2)]
    const xs = tri.map((v) => v[0])
    const ys = tri.map((v) => v[1])
    const zs = tri.map((v) => v[2])
    const [minX, maxX, minY, maxY, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)]
    const isCover =
      minY >= panelYMin &&
      (lod === 0 || maxY > deckY + EPS_M) &&
      openings.some((o) => minX >= o.x0 - slack && maxX <= o.x1 + slack && minZ >= o.zSea - slack && maxZ <= o.zQuay + slack)
    if (isCover) continue
    if (minY >= coverTopY - EPS_M && maxY <= coverTopY + EPS_M) {
      // a flat piece of cover top (LOD2's one box): what is over an open bay goes, the rest stays
      kept.push(...outsideAll(tri))
      continue
    }
    if (minY < deckY - EPS_M || maxY > deckY + EPS_M) {
      kept.push(tri)
      continue
    }
    kept.push(...outsideAll(tri))
  }
  const result: Record<string, Float32Array> = {}
  names.forEach((n, k) => {
    const size = mesh.attributes[n].itemSize
    const array = new Float32Array(kept.length * 3 * size)
    kept.forEach((tri, i) => tri.forEach((v, j) => array.set(v.slice(offsets[k], offsets[k] + size), (i * 3 + j) * size)))
    result[n] = array
  })
  return result
}

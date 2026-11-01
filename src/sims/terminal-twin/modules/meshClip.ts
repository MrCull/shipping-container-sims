/**
 * Cutting a mesh at a plane, pure maths on vertex arrays (no Three.js, so the Node tests share it). A load-time clip
 * for a baked GLB that stands over water somewhere it should not (ticket #172: the Isla Verde road north of the TTI
 * terminal). The hatch clip (`hullHatchOpening.ts`) uses the same polygon clip for the deck around its openings.
 */

/** One vertex: every attribute's components, in attribute order. */
export type Vertex = number[]
/** A convex polygon of vertices (a triangle, or a piece of one). */
export type Polygon = Vertex[]

const lerp = (a: Vertex, b: Vertex, t: number): Vertex => a.map((x, i) => x + (b[i] - x) * t)

/** The part of a convex polygon where `side(v) >= 0` (Sutherland-Hodgman); keeps the winding, interpolates every attribute. */
export function clipPolygon(poly: Polygon, side: (v: Vertex) => number): Polygon {
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

/** Vertex data of a mesh: attribute arrays by name (`position` is required, 3 floats per vertex), triangles by `index` or in order. */
export interface HullMeshData {
  index: ArrayLike<number> | null
  attributes: Record<string, { array: ArrayLike<number>; itemSize: number }>
}

/** The same mesh cut to the side of `coordinate[axis] >= min`: a non-indexed triangle list per attribute (straddling triangles are cut on the plane). */
export interface ClippedMeshData {
  position: Float32Array
  [attribute: string]: Float32Array
}

/**
 * Keeps the part of every triangle with `coordinate[axis] >= min` (axis 0 = x, 1 = y, 2 = z). Triangles wholly beyond the
 * plane go, triangles wholly inside stay as they are, and a triangle the plane crosses is cut and its new corners get
 * every attribute interpolated along the cut edge. Output is non-indexed, in the attribute order of the input.
 */
export function clipMeshToHalfSpace(mesh: HullMeshData, axis: 0 | 1 | 2, min: number): ClippedMeshData {
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
  const side = (v: Vertex) => v[axis] - min
  const kept: Polygon[] = []
  for (let t = 0; t + 2 < count; t += 3) {
    const tri = [vertexAt(t), vertexAt(t + 1), vertexAt(t + 2)]
    const cut = clipPolygon(tri, side)
    if (cut.length >= 3) kept.push(cut)
  }
  const result: ClippedMeshData = { position: new Float32Array(0) }
  names.forEach((n, k) => {
    const size = mesh.attributes[n].itemSize
    const triangles = kept.flatMap((poly) => {
      const corners: Vertex[] = []
      for (let i = 1; i + 1 < poly.length; i++) corners.push(poly[0], poly[i], poly[i + 1])
      return corners
    })
    const array = new Float32Array(triangles.length * size)
    triangles.forEach((v, i) => array.set(v.slice(offsets[k], offsets[k] + size), i * size))
    result[n] = array
  })
  return result
}

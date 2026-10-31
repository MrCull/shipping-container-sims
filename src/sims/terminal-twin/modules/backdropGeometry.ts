/** Small geometry helpers for the distant scenery (backdrop and terminal scenery). */
import * as THREE from 'three'

/** Tiny deterministic generator: the backdrop looks the same every run. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** A silhouette (x along the ridge, height y) extruded `depth` metres along z, centred on z. */
export function ridge(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], 0)
  for (const [x, y] of points) shape.lineTo(x, y)
  shape.lineTo(points[points.length - 1][0], 0)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  g.translate(0, 0, -depth / 2)
  return g
}

/** A jagged ridge of the given length with heights between `lo` and `hi`. */
export function jaggedRidge(length: number, step: number, lo: number, hi: number, seed: number): [number, number][] {
  const rnd = lcg(seed)
  const pts: [number, number][] = []
  let h = (lo + hi) / 2
  for (let x = -length / 2; x <= length / 2; x += step) {
    h = Math.min(hi, Math.max(lo, h + (rnd() - 0.5) * (hi - lo) * 0.7))
    pts.push([x, h])
  }
  return pts
}

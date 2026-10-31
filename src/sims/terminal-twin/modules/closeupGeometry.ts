/**
 * Close-up container geometry (#119): one merged geometry per size, origin at the bottom centre, length along X,
 * door end at +X (the same frame as the GLB containers). Unlike the GLB LODs it is textured by one per-box canvas
 * (`containerTextures.ts`), so the faces carry UVs into that canvas's regions (`TEXTURE_LAYOUT`), and a second UV
 * set (`uv1`, in metres) tiles the shared corrugation normal map and roughness map.
 *
 * On top of the box it adds what only shows up close: door locking rods, lever handles and cam keepers, and the
 * eight corner castings. Rods, handles and castings sample a plain swatch of the canvas, not a face region.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ContainerSize } from '../scenario/types'

export const TEXTURE_SIZE = { w: 1024, h: 512 } as const

/** A rectangle of the per-box canvas, in pixels (origin top-left). */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export const TEXTURE_LAYOUT = {
  /** Long sides: both use it (the -Z side reads mirrored in u, so text is upright from outside). */
  side: { x: 0, y: 0, w: 1024, h: 160 },
  roof: { x: 0, y: 160, w: 1024, h: 64 },
  /** Door end (+X), seen from behind the box: u runs to the viewer's right. */
  door: { x: 0, y: 224, w: 288, h: 288 },
  front: { x: 320, y: 224, w: 288, h: 288 },
  /** Plain swatches for the hardware: weathered dark steel, galvanised light. */
  steel: { x: 640, y: 224, w: 128, h: 128 },
  zinc: { x: 800, y: 224, w: 128, h: 128 },
} satisfies Record<string, Region>

/** Metres per corrugation ridge on the second UV set. */
export const CORRUGATION_PITCH_M = 0.25

/** [A] ISO dimensions in metres. */
const DIMS: Record<ContainerSize, { length: number; height: number; width: number }> = {
  '20': { length: 6.058, height: 2.591, width: 2.438 },
  '40': { length: 12.192, height: 2.591, width: 2.438 },
  '40HC': { length: 12.192, height: 2.896, width: 2.438 },
}

/** Canvas UV of a point (a, b in 0..1, b = 0 at the bottom) of a region. */
export function regionUv(r: Region, a: number, b: number): [number, number] {
  return [(r.x + a * r.w) / TEXTURE_SIZE.w, 1 - (r.y + (1 - b) * r.h) / TEXTURE_SIZE.h]
}

class Builder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  uv1: number[] = []

  /** A quad p0..p3 (counter-clockwise seen from outside); per-corner region coords and uv1. */
  quad(p: THREE.Vector3[], n: THREE.Vector3, region: Region, ab: [number, number][], uv1: [number, number][]): void {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(p[k].x, p[k].y, p[k].z)
      this.nor.push(n.x, n.y, n.z)
      const [u, v] = regionUv(region, ab[k][0], ab[k][1])
      this.uv.push(u, v)
      this.uv1.push(uv1[k][0], uv1[k][1])
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2))
    return g
  }
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function body(size: ContainerSize): THREE.BufferGeometry {
  const { length: L, height: H, width: W } = DIMS[size]
  const hx = L / 2
  const hz = W / 2
  const P = CORRUGATION_PITCH_M
  const b = new Builder()
  const abQuad: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  // +Z side (u along +X)
  b.quad([v3(-hx, 0, hz), v3(hx, 0, hz), v3(hx, H, hz), v3(-hx, H, hz)], v3(0, 0, 1), TEXTURE_LAYOUT.side, abQuad, [
    [-hx / P, 0],
    [hx / P, 0],
    [hx / P, H],
    [-hx / P, H],
  ])
  // -Z side (u along -X)
  b.quad([v3(hx, 0, -hz), v3(-hx, 0, -hz), v3(-hx, H, -hz), v3(hx, H, -hz)], v3(0, 0, -1), TEXTURE_LAYOUT.side, abQuad, [
    [hx / P, 0],
    [-hx / P, 0],
    [-hx / P, H],
    [hx / P, H],
  ])
  // roof: u along +X, b = 1 at the -Z edge
  b.quad([v3(-hx, H, hz), v3(hx, H, hz), v3(hx, H, -hz), v3(-hx, H, -hz)], v3(0, 1, 0), TEXTURE_LAYOUT.roof, abQuad, [
    [-hx / P, hz],
    [hx / P, hz],
    [hx / P, -hz],
    [-hx / P, -hz],
  ])
  // door end (+X): u runs towards -Z
  b.quad([v3(hx, 0, hz), v3(hx, 0, -hz), v3(hx, H, -hz), v3(hx, H, hz)], v3(1, 0, 0), TEXTURE_LAYOUT.door, abQuad, [
    [hz / P, 0],
    [-hz / P, 0],
    [-hz / P, H],
    [hz / P, H],
  ])
  // front end (-X): u runs towards +Z
  b.quad([v3(-hx, 0, -hz), v3(-hx, 0, hz), v3(-hx, H, hz), v3(-hx, H, -hz)], v3(-1, 0, 0), TEXTURE_LAYOUT.front, abQuad, [
    [-hz / P, 0],
    [hz / P, 0],
    [hz / P, H],
    [-hz / P, H],
  ])
  // underside, so the box is closed
  b.quad([v3(-hx, 0, -hz), v3(hx, 0, -hz), v3(hx, 0, hz), v3(-hx, 0, hz)], v3(0, -1, 0), TEXTURE_LAYOUT.steel, abQuad, [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ])
  return b.geometry()
}

/** A hardware part (box or cylinder) sampling the centre of a swatch. */
function part(src: THREE.BufferGeometry, swatch: Region): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src
  const [u, v] = regionUv(swatch, 0.5, 0.5)
  const n = g.getAttribute('position').count
  const uv = new Float32Array(n * 2)
  const uv1 = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2)) // all zero: one flat texel of the maps
  return g
}

function hardware(size: ContainerSize): THREE.BufferGeometry[] {
  const { length: L, height: H, width: W } = DIMS[size]
  const hx = L / 2
  const hz = W / 2
  const out: THREE.BufferGeometry[] = []
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, swatch: Region) =>
    out.push(part(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), swatch))
  // Corner castings: eight blocks proud of the box.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0.08, H - 0.08]) box(0.162, 0.118, 0.15, sx * (hx - 0.08), y, sz * (hz - 0.075), TEXTURE_LAYOUT.steel)
    }
  }
  // Door locking rods (two per leaf), cam keepers top and bottom, a lever handle near mid height.
  const rodH = H - 0.34
  for (const f of [-0.38, -0.12, 0.12, 0.38]) {
    const z = f * W
    out.push(part(new THREE.CylinderGeometry(0.019, 0.019, rodH, 6).translate(hx + 0.034, H / 2, z), TEXTURE_LAYOUT.zinc))
    box(0.05, 0.08, 0.06, hx + 0.025, 0.14, z, TEXTURE_LAYOUT.steel)
    box(0.05, 0.08, 0.06, hx + 0.025, H - 0.14, z, TEXTURE_LAYOUT.steel)
    box(0.035, 0.035, 0.17, hx + 0.058, 0.9, z + (f < 0 ? -0.07 : 0.07), TEXTURE_LAYOUT.zinc)
  }
  return out
}

const cache = new Map<ContainerSize, THREE.BufferGeometry>()

/** The merged close-up geometry of a size (shared by every close-up box of that size; never dispose it per box). */
export function closeupGeometry(size: ContainerSize): THREE.BufferGeometry {
  let g = cache.get(size)
  if (!g) {
    const parts = [body(size), ...hardware(size)].map((p) => (p.index ? p.toNonIndexed() : p))
    g = mergeGeometries(parts)
    if (!g) throw new Error(`could not merge close-up geometry for ${size}`)
    g.computeBoundingSphere()
    cache.set(size, g)
  }
  return g
}

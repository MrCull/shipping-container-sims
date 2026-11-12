/**
 * Far tier of the infrastructure (#249, spec #243): beyond a distance, yard fences, ASC rails and high masts are drawn
 * as 12-triangle stand-ins instead of their GLB geometry (264, 48 and 284 triangles). They were about 680k triangles
 * of the TTI overview. The stand-in is generated in code from the real geometry: its bounding box, with the UV of the
 * source's largest upward-facing triangle, so it samples the same atlas swatch (same colour, same shared material, no extra texture).
 * The switch is per instance, with a hysteresis band, so a near instance never flickers at the boundary and nothing
 * near the camera changes. No cross-fade: at the switch distances (250 to 400 m) the box covers the same footprint as
 * the source to within a few pixels, so the swap is not visible as a pop (screenshots in docs/prototypes/249).
 */
import * as THREE from 'three'
import type { InfraKey } from './infrastructureAssets'

export interface FarTierSpec {
  key: InfraKey
  /** Instances further than this from the camera (m, 3D) draw as stand-ins. */
  farM: number
  /** An instance returns to full detail only inside `farM - hysteresisM`. */
  hysteresisM: number
}

/** The keys that have a far tier. */
export const FAR_TIER: readonly FarTierSpec[] = [
  { key: 'yard-fence', farM: 220, hysteresisM: 30 },
  { key: 'yard-asc-rail', farM: 220, hysteresisM: 30 },
  { key: 'yard-mast', farM: 350, hysteresisM: 40 },
]

/** A camera that moved less than this (m) since the last selection cannot flip an instance worth redrawing. */
const MOVE_EPSILON_M = 2

/** The stand-in's footprint is that of the source below this share of its height. */
const SHAFT_FRACTION = 0.6

/** A 12-triangle box as tall as `source` with the footprint of its lower part, UVs from its largest upward-facing triangle. */
export function standInGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  source.computeBoundingBox()
  const b = source.boundingBox!
  // Footprint from the lower part only: a mast's lamp head would otherwise fatten the whole pole into a block.
  const shaft = new THREE.Box3()
  const pos = source.getAttribute('position')
  const pt = new THREE.Vector3()
  const cutY = b.min.y + (b.max.y - b.min.y) * SHAFT_FRACTION
  for (let i = 0; i < pos.count; i++) {
    pt.fromBufferAttribute(pos, i)
    if (pt.y <= cutY) shaft.expandByPoint(pt)
  }
  const size = new THREE.Vector3(shaft.max.x - shaft.min.x, b.max.y - b.min.y, shaft.max.z - shaft.min.z)
  const centre = new THREE.Vector3((shaft.min.x + shaft.max.x) / 2, (b.min.y + b.max.y) / 2, (shaft.min.z + shaft.max.z) / 2)
  const box = new THREE.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01))
  box.translate(centre.x, centre.y, centre.z)
  const [u, v] = dominantUv(source)
  const uv = box.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v)
  box.computeBoundingBox()
  box.computeBoundingSphere()
  return box
}

function dominantUv(g: THREE.BufferGeometry): [number, number] {
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  if (!uv) return [0.5, 0.5]
  const index = g.index
  const n = index ? index.count : pos.count
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let best = -1
  let bu = 0.5
  let bv = 0.5
  for (let i = 0; i + 2 < n; i += 3) {
    const i0 = index ? index.getX(i) : i
    const i1 = index ? index.getX(i + 1) : i + 1
    const i2 = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1).sub(a)
    c.fromBufferAttribute(pos, i2).sub(a)
    const n = b.cross(c)
    // seen from above at overview: only upward faces count (a rail's dark sides must not colour its top)
    const area = n.y > 0 ? n.length() : 0
    if (area > best) {
      best = area
      bu = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3
      bv = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3
    }
  }
  return [bu, bv]
}

/** Which instances of one key are far, with hysteresis. Positions are ground (x, z); the camera is 3D. */
export class FarTierSelector {
  /** 1 where the instance draws as a stand-in. */
  readonly far: Uint8Array
  private readonly xs: Float32Array
  private readonly zs: Float32Array
  private seeded = false
  private lastX = 0
  private lastY = 0
  private lastZ = 0

  constructor(
    positions: readonly (readonly [number, number])[],
    private readonly farM: number,
    private readonly hysteresisM: number,
  ) {
    this.far = new Uint8Array(positions.length)
    this.xs = Float32Array.from(positions, (p) => p[0])
    this.zs = Float32Array.from(positions, (p) => p[1])
  }

  /** Re-selects for a camera position; true when any instance changed tier. */
  update(cx: number, cy: number, cz: number): boolean {
    if (this.seeded && Math.hypot(cx - this.lastX, cy - this.lastY, cz - this.lastZ) < MOVE_EPSILON_M) return false
    this.seeded = true
    this.lastX = cx
    this.lastY = cy
    this.lastZ = cz
    const enter = this.farM * this.farM
    const exitM = this.farM - this.hysteresisM
    const exit = exitM * exitM
    const c2 = cy * cy
    let changed = false
    for (let i = 0; i < this.far.length; i++) {
      const dx = this.xs[i] - cx
      const dz = this.zs[i] - cz
      const d2 = dx * dx + dz * dz + c2
      const was = this.far[i]
      const now = was ? (d2 < exit ? 0 : 1) : d2 > enter ? 1 : 0
      if (now !== was) {
        this.far[i] = now
        changed = true
      }
    }
    return changed
  }
}

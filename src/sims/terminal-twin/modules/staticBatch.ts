/**
 * Static geometry batching (TT-19): scenery that never moves (yard slabs, rails, bay ticks, stall and
 * pad markings, road surfaces) is collected here and merged into one mesh per material and shadow
 * flags, instead of one mesh (= one draw call, in the shadow pass too) per piece. At TTI scale that is
 * the difference between ~1,300 and a handful of draw calls for the ground alone.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

interface Batch {
  material: THREE.Material
  receiveShadow: boolean
  castShadow: boolean
  geometries: THREE.BufferGeometry[]
}

export class StaticBatch {
  private batches = new Map<string, Batch>()
  private ids = new WeakMap<THREE.Material, number>()
  private nextId = 0
  private readonly matrix = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly unit = new THREE.Vector3(1, 1, 1)
  private readonly pos = new THREE.Vector3()

  /** Pieces added so far. */
  get pieces(): number {
    let n = 0
    for (const b of this.batches.values()) n += b.geometries.length
    return n
  }

  /** Adds a copy of `geometry` placed at `position`, rotated `rotationX` about X then nothing else (enough for flat ground pieces). */
  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: { x: number; y: number; z: number },
    options: { rotationX?: number; receiveShadow?: boolean; castShadow?: boolean } = {},
  ): void {
    const receiveShadow = options.receiveShadow ?? false
    const castShadow = options.castShadow ?? false
    let id = this.ids.get(material)
    if (id === undefined) this.ids.set(material, (id = this.nextId++))
    const key = `${id}:${receiveShadow ? 1 : 0}${castShadow ? 1 : 0}`
    let batch = this.batches.get(key)
    if (!batch) this.batches.set(key, (batch = { material, receiveShadow, castShadow, geometries: [] }))
    this.matrix.compose(this.pos.set(position.x, position.y, position.z), this.quat.setFromEuler(this.euler.set(options.rotationX ?? 0, 0, 0)), this.unit)
    batch.geometries.push(geometry.clone().applyMatrix4(this.matrix))
  }

  /** Merged meshes, one per batch; the pieces' geometry is released. `track` registers each merged geometry for disposal. */
  build(track: <T extends { dispose(): void }>(thing: T) => T): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    for (const b of this.batches.values()) {
      const merged = mergeGeometries(b.geometries, false)
      for (const g of b.geometries) g.dispose()
      if (!merged) continue
      const mesh = new THREE.Mesh(track(merged), b.material)
      mesh.receiveShadow = b.receiveShadow
      mesh.castShadow = b.castShadow
      meshes.push(mesh)
    }
    this.batches.clear()
    return meshes
  }
}

/** A flat ground piece: a plane lying in XZ. */
export const GROUND_ROTATION_X = -Math.PI / 2

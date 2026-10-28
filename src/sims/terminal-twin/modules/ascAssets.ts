/**
 * The phase 2 stacking-crane model (TT-24): loads `assets/models/asc/asc.glb`
 * once per page and builds one rigged instance per ASC (cloned LOD subtrees
 * sharing geometry and the atlas material). `AscRig.pose()` drives the rig from
 * a scene-model pose through the pure maths in `ascRig.ts`: `gantry` along the
 * block rails, `trolley` across the rows, `hoist` and the scaled `ropes`, and
 * the twist-locks. Every LOD repeats the rig node names, so each name maps to
 * one node per LOD.
 *
 * Offline: the GLB URL is bundled by Vite and the meshopt decoder ships with Three.js.
 */
import * as THREE from 'three'
import { loadGltf } from './containerAssets'
import { ascRigValues, ascScaleY } from './ascRig'

/** GLTFLoader renames duplicate node names (`hoist_1`); the file's own name is kept in `userData.name`. */
const nodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

export const ASC_ASSET_URL = new URL('../assets/models/asc/asc.glb', import.meta.url).href

/** [A] LOD switch distances (m) from the camera, with 15% hysteresis. An ASC is 25 m wide, so these are wider than the SHC's. */
export const ASC_LOD_DISTANCES = { lod0: 90, lod1: 300, hysteresis: 1.15 }

export interface AscRigPose {
  /** Block centre line (world X). */
  blockX: number
  /** Trolley offset across the rows from the block centre line. */
  trolleyX: number
  gantryZ: number
  /** Twist-lock plane height above the ground (box top while carrying). */
  attachY: number
  carrying: boolean
  /** Number of tiers the block was configured with (decides the vertical stretch). */
  tiers: number
}

/** What the rig was last told (dev API / smoke tests). */
export interface AscRigState {
  lod: 0 | 1 | 2
  gantryZ: number
  trolleyX: number
  hoistM: number
  ropeScale: number
  scaleY: number
  carrying: boolean
}

export interface AscModel {
  /** The loaded scene (root node `asc` with LOD0..LOD2). */
  source: THREE.Object3D
}

let cached: Promise<AscModel> | null = null

export function loadAscModel(): Promise<AscModel> {
  if (!cached) {
    cached = (async () => {
      const gltf = await loadGltf(ASC_ASSET_URL)
      const source = gltf.scene.children[0] ?? gltf.scene
      source.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.map) mat.map.anisotropy = 4
        mat.roughness = Math.min(1, Math.max(mat.roughness, 0.55))
      })
      return { source }
    })()
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

interface Rest {
  o: THREE.Object3D
  x: number
  y: number
  z: number
}

/** One ASC instance: three LOD clones, a pose method and the LOD choice. */
export class AscRig {
  readonly root = new THREE.Group()
  private readonly lods: THREE.Object3D[] = []
  private readonly gantry: Rest[] = []
  private readonly trolley: Rest[] = []
  private readonly hoist: Rest[] = []
  private readonly ropes: THREE.Object3D[] = []
  private readonly twistlocks: THREE.Object3D[] = []
  private lod: 0 | 1 | 2 = 0
  private state: AscRigState = { lod: 0, gantryZ: 0, trolleyX: 0, hoistM: 0, ropeScale: 1, scaleY: 1, carrying: false }

  constructor(model: AscModel, id: string) {
    this.root.name = id
    const clone = model.source.clone(true)
    for (const n of ['LOD0', 'LOD1', 'LOD2']) {
      const lod = clone.getObjectByName(n)
      if (!lod) throw new Error('asc.glb has no ' + n)
      this.lods.push(lod)
      lod.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.castShadow = n !== 'LOD2'
        const name = nodeName(o)
        const rest = { o, x: o.position.x, y: o.position.y, z: o.position.z }
        if (name === 'gantry') this.gantry.push(rest)
        else if (name === 'trolley') this.trolley.push(rest)
        else if (name === 'hoist') this.hoist.push(rest)
        else if (name === 'ropes') this.ropes.push(o)
        else if (name.startsWith('twistlock_')) this.twistlocks.push(o)
      })
      this.root.add(lod)
    }
    this.setLod(0)
  }

  /** Picks the LOD for a camera distance (with hysteresis) and shows only that subtree. */
  chooseLod(distance: number): 0 | 1 | 2 {
    const h = this.lod === 0 ? ASC_LOD_DISTANCES.hysteresis : 1
    const h1 = this.lod <= 1 ? ASC_LOD_DISTANCES.hysteresis : 1
    const next = distance <= ASC_LOD_DISTANCES.lod0 * h ? 0 : distance <= ASC_LOD_DISTANCES.lod1 * h1 ? 1 : 2
    this.setLod(next)
    return next
  }

  setLod(level: 0 | 1 | 2): void {
    this.lod = level
    this.lods.forEach((n, i) => (n.visible = i === level))
    this.state.lod = level
  }

  /** Poses the whole crane. */
  pose(p: AscRigPose): void {
    const scaleY = ascScaleY(p.tiers)
    const v = ascRigValues({ trolleyX: p.trolleyX, gantryZ: p.gantryZ, attachY: p.attachY, carrying: p.carrying, scaleY })
    this.root.position.set(p.blockX, 0, 0)
    this.root.scale.set(1, scaleY, 1)
    for (const r of this.gantry) r.o.position.z = r.z + v.gantryZ
    for (const r of this.trolley) r.o.position.x = r.x + v.trolleyX
    for (const r of this.hoist) r.o.position.y = r.y + v.hoistM
    for (const o of this.ropes) o.scale.y = v.ropeScale
    for (const o of this.twistlocks) o.rotation.y = v.twistRad
    this.state = { lod: this.lod, gantryZ: v.gantryZ, trolleyX: v.trolleyX, hoistM: v.hoistM, ropeScale: v.ropeScale, scaleY, carrying: p.carrying }
  }

  get rigState(): AscRigState {
    return this.state
  }
}

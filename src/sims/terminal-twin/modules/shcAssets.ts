/**
 * The phase 2 shuttle-carrier model (TT-25): loads `assets/models/shc/shc.glb`
 * once per page and builds one rigged instance per SHC (cloned LOD subtrees
 * sharing geometry and the atlas material). `ShcRig.pose()` drives the rig from
 * a scene-model pose: wheel roll from the odometer, steering from the path
 * curvature, hoist from the spreader lift. Every LOD repeats the rig node
 * names, so each name maps to one node per LOD.
 *
 * Offline: the GLB URL is bundled by Vite and the meshopt decoder ships with Three.js.
 */
import * as THREE from 'three'
import { loadGltf } from './containerAssets'
import meta from '../assets/models/shc/shc.meta.json'

/** GLTFLoader renames duplicate node names (`wheel_fl_1`); the file's own name is kept in `userData.name`. */
const nodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

export const SHC_ASSET_URL = new URL('../assets/models/shc/shc.glb', import.meta.url).href

/** Sidecar facts the renderer needs (all read from `shc.meta.json`, not hard-coded). */
export const SHC_RIG = {
  tyreRadiusM: meta.wheel.radiusM,
  /** Height of the twist-lock plane above the ground with the hoist raised (hoist = 0). */
  attachRestY: meta.attachPoints.find((a) => a.name === 'container_attach')!.position[1],
  hoistMinM: meta.travelLimits.hoist.minM,
  hoistMaxM: meta.travelLimits.hoist.maxM,
  steerMaxRad: THREE.MathUtils.degToRad(meta.travelLimits.steer_fl.maxDeg),
  twistLockedRad: THREE.MathUtils.degToRad(meta.travelLimits.twistlock_fl.maxDeg),
  lengthM: meta.dimensions.lengthM,
  widthM: meta.dimensions.widthM,
  heightM: meta.dimensions.heightM,
}

/** [A] LOD switch distances (m) from the camera, with 15% hysteresis. */
export const SHC_LOD_DISTANCES = { lod0: 110, lod1: 380, hysteresis: 1.15 }

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const

export interface ShcRigPose {
  x: number
  z: number
  yaw: number
  steerRad: number
  odometerM: number
  /** Twist-lock plane height above the ground (box top while carrying). */
  attachY: number
  /** True while a box hangs from the spreader. */
  carrying: boolean
}

/** What the rig was last told (dev API / smoke tests). */
export interface ShcRigState {
  lod: 0 | 1 | 2
  steerRad: number
  wheelRollRad: number
  hoistM: number
  carrying: boolean
}

export interface ShcModel {
  /** The loaded scene (root node `shc` with LOD0..LOD2). */
  source: THREE.Object3D
}

let cached: Promise<ShcModel> | null = null

export function loadShcModel(): Promise<ShcModel> {
  if (!cached) {
    cached = (async () => {
      const gltf = await loadGltf(SHC_ASSET_URL)
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

/** One SHC instance: three LOD clones, a pose method and the LOD choice. */
export class ShcRig {
  readonly root = new THREE.Group()
  private readonly lods: THREE.Object3D[] = []
  private readonly steer: Record<(typeof CORNERS)[number], THREE.Object3D[]>
  private readonly wheel: Record<(typeof CORNERS)[number], THREE.Object3D[]>
  private readonly hoist: THREE.Object3D[] = []
  private readonly hoistRestY: number[] = []
  private readonly twistlocks: THREE.Object3D[] = []
  private lod: 0 | 1 | 2 = 0
  private state: ShcRigState = { lod: 0, steerRad: 0, wheelRollRad: 0, hoistM: 0, carrying: false }

  constructor(model: ShcModel, id: string) {
    this.root.name = id
    const clone = model.source.clone(true)
    this.steer = { fl: [], fr: [], rl: [], rr: [] }
    this.wheel = { fl: [], fr: [], rl: [], rr: [] }
    for (const n of ['LOD0', 'LOD1', 'LOD2']) {
      const lod = clone.getObjectByName(n)
      if (!lod) throw new Error('shc.glb has no ' + n)
      this.lods.push(lod)
      lod.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) mesh.castShadow = n !== 'LOD2'
        const name = nodeName(o)
        for (const c of CORNERS) {
          if (name === 'steer_' + c) this.steer[c].push(o)
          else if (name === 'wheel_' + c) this.wheel[c].push(o)
        }
        if (name === 'hoist') {
          this.hoist.push(o)
          this.hoistRestY.push(o.position.y)
        } else if (name.startsWith('twistlock_')) this.twistlocks.push(o)
      })
      this.root.add(lod)
    }
    this.setLod(0)
  }

  /** Picks the LOD for a camera distance (with hysteresis) and shows only that subtree. */
  chooseLod(distance: number): 0 | 1 | 2 {
    const h = this.lod === 0 ? SHC_LOD_DISTANCES.hysteresis : 1
    const h1 = this.lod <= 1 ? SHC_LOD_DISTANCES.hysteresis : 1
    const next = distance <= SHC_LOD_DISTANCES.lod0 * h ? 0 : distance <= SHC_LOD_DISTANCES.lod1 * h1 ? 1 : 2
    this.setLod(next)
    return next
  }

  setLod(level: 0 | 1 | 2): void {
    this.lod = level
    this.lods.forEach((n, i) => (n.visible = i === level))
    this.state.lod = level
  }

  /** Poses the whole vehicle. */
  pose(p: ShcRigPose): void {
    this.root.position.set(p.x, 0, p.z)
    this.root.rotation.y = p.yaw
    const roll = -p.odometerM / SHC_RIG.tyreRadiusM
    for (const c of CORNERS) {
      const front = c[0] === 'f'
      const steer = (front ? 1 : -1) * p.steerRad
      for (const n of this.steer[c]) n.rotation.y = steer
      for (const n of this.wheel[c]) n.rotation.z = roll
    }
    const hoistM = Math.min(SHC_RIG.hoistMaxM, Math.max(SHC_RIG.hoistMinM, p.attachY - SHC_RIG.attachRestY))
    this.hoist.forEach((n, i) => (n.position.y = this.hoistRestY[i] + hoistM))
    for (const n of this.twistlocks) n.rotation.y = p.carrying ? SHC_RIG.twistLockedRad : 0
    this.state = { lod: this.lod, steerRad: p.steerRad, wheelRollRad: roll, hoistM, carrying: p.carrying }
  }

  get rigState(): ShcRigState {
    return this.state
  }
}

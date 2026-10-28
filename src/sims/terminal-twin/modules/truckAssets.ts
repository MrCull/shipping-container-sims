/**
 * The phase 2 truck models (TT-26): three tractor cab shapes, each GLB holding the tractor and the skeletal chassis
 * (`assets/models/trucks/truck-cab-{high,mid,day}.glb`). Loaded once per page; one rigged instance per truck (cloned LOD
 * subtrees sharing geometry; materials are shared per cab shape and livery tile). `TruckRig.pose()` drives the rig from a
 * scene-model truck pose: wheel roll from the odometer, front steering, the tractor swinging about the fifth wheel, and
 * the model's offset along its heading so the box rests on the right twist-locks.
 *
 * Livery: TEXCOORD_0 is authored for atlas tile 0 of a 4 x 2 tile atlas (cab colour + maker wordmark); a livery is a
 * texture clone whose offset shifts the UVs to its tile (clones share the image).
 */
import * as THREE from 'three'
import { loadGltf } from './containerAssets'
import high from '../assets/models/trucks/truck-cab-high.meta.json'
import mid from '../assets/models/trucks/truck-cab-mid.meta.json'
import day from '../assets/models/trucks/truck-cab-day.meta.json'

/** GLTFLoader renames duplicate node names (`wheel_fl_1`); the file's own name is kept in `userData.name`. */
const nodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

export const TRUCK_SHAPES = ['high', 'mid', 'day'] as const
export type TruckShape = (typeof TRUCK_SHAPES)[number]

export const TRUCK_ASSET_URLS: Record<TruckShape, string> = {
  high: new URL('../assets/models/trucks/truck-cab-high.glb', import.meta.url).href,
  mid: new URL('../assets/models/trucks/truck-cab-mid.glb', import.meta.url).href,
  day: new URL('../assets/models/trucks/truck-cab-day.glb', import.meta.url).href,
}
const META = { high, mid, day }

/** Sidecar facts the renderer needs (read from the sidecars, not hard-coded). */
export const TRUCK_RIG = {
  tyreRadiusM: high.wheel.radiusM,
  steerMaxRad: THREE.MathUtils.degToRad(high.travelLimits.steer_fl.maxDeg),
  articulationMaxRad: THREE.MathUtils.degToRad(high.travelLimits.fifth_wheel.maxDeg),
  deckY: high.chassis.deckY,
  tileCols: high.atlas.tileCols,
  tileRows: high.atlas.tileRows,
  liveries: high.liveries.length,
  /** Where the twist-locks of each load sit along the truck (m ahead of the 40 ft centre), from the sidecar. */
  loads: Object.fromEntries(high.attachPoints.filter((a) => a.name.startsWith('load_')).map((a) => [a.name, a.position[0]])) as Record<string, number>,
}

/** [A] LOD switch distances (m) from the camera, with 15% hysteresis. */
export const TRUCK_LOD_DISTANCES = { lod0: 60, lod1: 200, hysteresis: 1.15 }

/** Cab shape and livery tile for a truck id (`T17`): deterministic, spread evenly. */
export function truckVariant(id: string): { shape: TruckShape; livery: number } {
  const n = Number(id.replace(/\D/g, '')) || 0
  const h = Math.imul(n + 1, 2654435761) >>> 0 // Knuth multiplicative hash: neighbouring ids get unrelated variants
  return { shape: TRUCK_SHAPES[n % TRUCK_SHAPES.length], livery: (h >>> 16) % TRUCK_RIG.liveries }
}

/** Maker wordmark of a livery tile (sidecar `liveries`). */
export function truckMaker(livery: number): string {
  return high.liveries[livery]?.maker ?? ''
}

export interface TruckRigPose {
  x: number
  z: number
  yaw: number
  steerRad: number
  odometerM: number
  articulationRad: number
  loadOffsetM: number
}

/** What the rig was last told (dev API / smoke tests). */
export interface TruckRigState {
  lod: 0 | 1 | 2
  shape: TruckShape
  livery: number
  maker: string
  steerRad: number
  articulationRad: number
  wheelRollRad: number
  loadOffsetM: number
  /** World position of the box's bottom centre on the chassis twist-locks (a 20 ft box on the front pins, else the 40 ft centre). */
  loadCentre: [number, number, number]
}

export interface TruckModels {
  sources: Record<TruckShape, THREE.Object3D>
  /** Materials per shape and livery tile (shared by every truck of that variant). */
  materialFor(shape: TruckShape, livery: number): THREE.Material
}

let cached: Promise<TruckModels> | null = null

export function loadTruckModels(): Promise<TruckModels> {
  if (!cached) {
    cached = (async () => {
      const entries = await Promise.all(TRUCK_SHAPES.map(async (s) => [s, await loadGltf(TRUCK_ASSET_URLS[s])] as const))
      const sources = {} as Record<TruckShape, THREE.Object3D>
      const base = {} as Record<TruckShape, THREE.MeshStandardMaterial>
      for (const [shape, gltf] of entries) {
        const source = gltf.scene.children[0] ?? gltf.scene
        sources[shape] = source
        source.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          const mat = mesh.material as THREE.MeshStandardMaterial
          if (mat.map) mat.map.anisotropy = 4
          mat.roughness = Math.min(1, Math.max(mat.roughness, 0.55))
          base[shape] = mat
        })
      }
      const cache = new Map<string, THREE.Material>()
      const materialFor = (shape: TruckShape, livery: number): THREE.Material => {
        const key = `${shape}:${livery}`
        let m = cache.get(key)
        if (!m) {
          const mat = base[shape].clone()
          if (base[shape].map) {
            mat.map = base[shape].map.clone()
            mat.map.offset.set((livery % TRUCK_RIG.tileCols) / TRUCK_RIG.tileCols, Math.floor(livery / TRUCK_RIG.tileCols) / TRUCK_RIG.tileRows)
            mat.map.needsUpdate = true
          }
          m = mat
          cache.set(key, m)
        }
        return m
      }
      return { sources, materialFor }
    })()
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

/** One truck instance: three LOD clones, a pose method and the LOD choice. */
export class TruckRig {
  readonly root = new THREE.Group()
  readonly shape: TruckShape
  readonly livery: number
  /** Holds the model; slid along the heading so the box sits on its twist-locks. */
  private readonly body = new THREE.Group()
  private readonly lods: THREE.Object3D[] = []
  private readonly fifthWheel: THREE.Object3D[] = []
  private readonly steer: Record<'fl' | 'fr', THREE.Object3D[]> = { fl: [], fr: [] }
  private readonly wheels: THREE.Object3D[] = []
  private lod: 0 | 1 | 2 = 0
  private state: TruckRigState

  constructor(models: TruckModels, id: string) {
    this.root.name = id
    const { shape, livery } = truckVariant(id)
    this.shape = shape
    this.livery = livery
    const clone = models.sources[shape].clone(true)
    const material = models.materialFor(shape, livery)
    for (const n of ['LOD0', 'LOD1', 'LOD2']) {
      const lod = clone.getObjectByName(n)
      if (!lod) throw new Error(`truck-cab-${shape}.glb has no ${n}`)
      this.lods.push(lod)
      lod.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.castShadow = n !== 'LOD2'
          mesh.material = material
        }
        const name = nodeName(o)
        if (name === 'fifth_wheel') this.fifthWheel.push(o)
        else if (name === 'steer_fl') this.steer.fl.push(o)
        else if (name === 'steer_fr') this.steer.fr.push(o)
        else if (name.startsWith('wheel_')) this.wheels.push(o)
      })
      this.body.add(lod)
    }
    this.root.add(this.body)
    this.state = { lod: 0, shape, livery, maker: truckMaker(livery), steerRad: 0, articulationRad: 0, wheelRollRad: 0, loadOffsetM: 0, loadCentre: [0, TRUCK_RIG.deckY, 0] }
    this.setLod(0)
  }

  /** Picks the LOD for a camera distance (with hysteresis) and shows only that subtree. */
  chooseLod(distance: number): 0 | 1 | 2 {
    const h = this.lod === 0 ? TRUCK_LOD_DISTANCES.hysteresis : 1
    const h1 = this.lod <= 1 ? TRUCK_LOD_DISTANCES.hysteresis : 1
    const next = distance <= TRUCK_LOD_DISTANCES.lod0 * h ? 0 : distance <= TRUCK_LOD_DISTANCES.lod1 * h1 ? 1 : 2
    this.setLod(next)
    return next
  }

  setLod(level: 0 | 1 | 2): void {
    this.lod = level
    this.lods.forEach((n, i) => (n.visible = i === level))
    this.state.lod = level
  }

  /** Poses the whole vehicle. */
  pose(p: TruckRigPose): void {
    this.root.position.set(p.x, 0, p.z)
    this.root.rotation.y = p.yaw
    this.body.position.x = p.loadOffsetM
    const roll = -p.odometerM / TRUCK_RIG.tyreRadiusM
    for (const n of this.wheels) n.rotation.z = roll
    for (const n of this.steer.fl) n.rotation.y = p.steerRad
    for (const n of this.steer.fr) n.rotation.y = p.steerRad
    for (const n of this.fifthWheel) n.rotation.y = p.articulationRad
    // where the chassis twist-locks are in the world: the sidecar's attach point for the load this truck carries
    const attachX = p.loadOffsetM < 0 ? TRUCK_RIG.loads.load_20_front : TRUCK_RIG.loads.load_40
    this.body.updateWorldMatrix(true, false)
    const c = this.body.localToWorld(new THREE.Vector3(attachX, TRUCK_RIG.deckY, 0))
    this.state = { ...this.state, lod: this.lod, steerRad: p.steerRad, articulationRad: p.articulationRad, wheelRollRad: roll, loadOffsetM: p.loadOffsetM, loadCentre: [c.x, c.y, c.z] }
  }

  get rigState(): TruckRigState {
    return this.state
  }
}

export { META as TRUCK_META }

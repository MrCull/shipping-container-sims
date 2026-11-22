/**
 * Phase 2 STS model (TT-23): loads `sts-malaccamax.glb` once per page and
 * gives each crane its own clone (`StsModel`), posed from the scene model's
 * engine motion segments through the generic rig in the sidecar. #303: each
 * crane class has its own GLB (`STS_CLASS_ASSETS`, same rig and LODs); the
 * Super Post-Panamax one is fetched only when a crane of that class exists.
 *
 * Mounting: the asset origin is the waterside rail centreline at rail level,
 * so the clone sits at (0, 0, waterRailZ) and the rig gets
 * gantry = gantryX, trolley = trolleyZ − waterRailZ, hoist = hoistY (spreader
 * underside = container top), as `sceneMounting` in the sidecar says.
 *
 * Crane numbers: the `sts_plate` material's UVs point at plate tile 0 (101);
 * each clone gets a patched copy that shifts them to its own tile.
 */
import * as THREE from 'three'
import meta from '../assets/models/sts/sts-malaccamax.meta.json'
import sppMeta from '../assets/models/sts/sts-super-post-panamax.meta.json'
import { DEFAULT_STS_CRANE_CLASS, type StsCraneClass } from '../scenario/types'
import { AssetRig, type RigMeta } from './assetRig'
import { loadGltf } from './containerAssets'
import { heroSpreaderMount, type HeroMount } from './heroEquipmentMount'

export const STS_ASSET_URL = new URL('../assets/models/sts/sts-malaccamax.glb', import.meta.url).href
export const STS_META = meta
export const STS_WATER_RAIL_Z = meta.sceneMounting.waterRailZ
export const STS_RAIL_GAUGE = meta.geometry.railGaugeM.value
export const STS_TROLLEY_RAIL_Y = meta.geometry.trolleyRailHeightM.value

type StsMeta = typeof meta

/** #303: the GLB and sidecar of each STS class (same rig node names, LOD structure and livery). */
export const STS_CLASS_ASSETS: Record<StsCraneClass, { url: string; meta: StsMeta }> = {
  malaccamax: { url: STS_ASSET_URL, meta },
  'super-post-panamax': {
    url: new URL('../assets/models/sts/sts-super-post-panamax.glb', import.meta.url).href,
    meta: sppMeta as unknown as StsMeta,
  },
}


export type SpreaderMode = keyof typeof meta.spreaderModes
export type StsLod = 0 | 1 | 2

/** [A] Hysteresis on the LOD switch distances (a crane keeps its finer LOD out to ×1.15). */
export const STS_LOD_HYSTERESIS = 1.15
const LOD_DISTANCES = [meta.lods.LOD0.maxDistanceM, meta.lods.LOD1.maxDistanceM]

export interface StsRigPose {
  gantryX: number
  /** Scene Z of the trolley (and spreader centre). */
  trolleyZ: number
  /** Spreader underside height above the rail. */
  hoistY: number
  spreader: SpreaderMode
  /** Twist-locks turned (carrying a box). */
  locked: boolean
  /** Boom angle (degrees above horizontal, #298; the scene model's `boomAngleDeg`, which knows the configured working angle). Absent = horizontal (the rig's rest, 0). */
  boomDeg?: number
}

/** What one crane looks like right now (dev API). */
export interface StsRenderState {
  lod: StsLod
  spreaderMode: SpreaderMode
  carrying: number
  /** World positions in the drawn LOD. */
  spreader: [number, number, number]
  trolley: [number, number, number]
  /** Boom angle drawn (degrees, the `boom` rig node, #298). */
  boomAngleDeg: number
  /** Largest gap (m) between an aimed stay's far end and its anchor, over every LOD: near 0 while forestays and boom-hoist ropes stay attached (#304). */
  stayGapM: number
}

const cache = new Map<StsCraneClass, Promise<THREE.Object3D>>()

/** The GLB scene of a crane class, loaded once per page; clone it per crane. */
export function loadStsTemplate(craneClass: StsCraneClass = DEFAULT_STS_CRANE_CLASS): Promise<THREE.Object3D> {
  let cached = cache.get(craneClass)
  if (!cached) {
    cached = loadGltf(STS_CLASS_ASSETS[craneClass].url).then((gltf) => {
      const root = gltf.scene
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true
        mesh.receiveShadow = true
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.map) mat.map.anisotropy = 4
      })
      return root
    })
    cached.catch(() => cache.delete(craneClass))
    cache.set(craneClass, cached)
  }
  return cached
}

/** A copy of the plate material whose UVs point at crane-number tile `index` (0 = 101). */
export function plateMaterial(source: THREE.MeshStandardMaterial, index: number): THREE.MeshStandardMaterial {
  const p = meta.branding.craneNumbers
  const mat = source.clone()
  const i = ((index % p.count) + p.count) % p.count
  const offset = new THREE.Vector2((i % p.cols) * p.tileSizeUv[0], Math.floor(i / p.cols) * p.tileSizeUv[1])
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.plateOffset = { value: offset }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 plateOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv += plateOffset;\n#endif')
  }
  mat.customProgramCacheKey = () => 'tt-sts-plate'
  mat.userData.plateIndex = i
  return mat
}

export class StsModel {
  readonly root: THREE.Object3D
  readonly plateIndex: number
  lod: StsLod = 0
  spreaderMode: SpreaderMode = '40'
  carrying = 0
  /** Where the hero spreader goes (#273): the LOD0 `spreader` node and its rest pose. */
  readonly heroMount: HeroMount | null
  private readonly rig: AssetRig
  private readonly lods: THREE.Object3D[]
  private readonly spreaders: THREE.Object3D[]
  private readonly trolleys: THREE.Object3D[]
  private readonly plates: THREE.Material[] = []
  private readonly centre = new THREE.Vector3()

  constructor(template: THREE.Object3D, plateIndex: number, craneMeta: StsMeta = meta) {
    this.root = template.clone(true)
    this.root.position.set(0, 0, STS_WATER_RAIL_Z)
    this.plateIndex = plateIndex
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const patched = mats.map((m) => {
        if (m.name !== 'sts_plate') return m
        const p = plateMaterial(m as THREE.MeshStandardMaterial, plateIndex)
        this.plates.push(p)
        return p
      })
      mesh.material = Array.isArray(mesh.material) ? patched : patched[0]
    })
    this.lods = ['LOD0', 'LOD1', 'LOD2'].map((n) => this.root.getObjectByName(n)!)
    this.heroMount = heroSpreaderMount(this.lods[0]) // before the rig first moves a node
    this.rig = new AssetRig(this.root, craneMeta as unknown as RigMeta)
    this.spreaders = this.rig.objects('spreader')
    this.trolleys = this.rig.objects('trolley')
    this.setLod(0)
  }

  setPose(p: StsRigPose): void {
    const rig = this.rig
    rig.set('gantry', p.gantryX, false)
    rig.set('trolley', p.trolleyZ - STS_WATER_RAIL_Z, false)
    rig.set('hoist', p.hoistY, false)
    rig.set('boom', p.boomDeg ?? 0, false)
    this.spreaderMode = p.spreader
    for (const [node, value] of Object.entries(meta.spreaderModes[this.spreaderMode])) rig.set(node, value)
    const lock = p.locked ? 90 : 0
    for (const node of rig.nodes) if (node.startsWith('twistlock_')) rig.set(node, lock)
    rig.applyStretch()
  }

  setLod(lod: StsLod): void {
    this.lod = lod
    this.lods.forEach((n, i) => (n.visible = i === lod))
  }

  /** Picks the LOD by camera distance to the crane's centre (with hysteresis towards finer LODs). */
  updateLod(camera: THREE.Vector3, lodScale = 1): StsLod {
    const gantryX = this.rig.values.gantry ?? 0
    this.centre.set(gantryX, 30, STS_WATER_RAIL_Z + STS_RAIL_GAUGE / 2)
    const d = camera.distanceTo(this.centre) / lodScale
    let lod: StsLod = d <= LOD_DISTANCES[0] ? 0 : d <= LOD_DISTANCES[1] ? 1 : 2
    if (lod > this.lod && d <= LOD_DISTANCES[this.lod] * STS_LOD_HYSTERESIS) lod = this.lod
    if (lod !== this.lod) this.setLod(lod)
    return lod
  }

  renderState(): StsRenderState {
    this.root.updateMatrixWorld(true)
    const at = (o: THREE.Object3D | undefined): [number, number, number] => {
      const v = o ? o.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(NaN, NaN, NaN)
      return [v.x, v.y, v.z]
    }
    return {
      lod: this.lod,
      spreaderMode: this.spreaderMode,
      carrying: this.carrying,
      spreader: at(this.spreaders[this.lod]),
      trolley: at(this.trolleys[this.lod]),
      boomAngleDeg: this.rig.values.boom ?? 0,
      stayGapM: Math.max(0, ...Object.values(this.rig.aimGapsM())),
    }
  }

  dispose(): void {
    for (const m of this.plates) m.dispose()
  }
}

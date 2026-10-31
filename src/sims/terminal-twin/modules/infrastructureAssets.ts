/**
 * The phase 2 infrastructure models (TT-28): gate modules, quay furniture, yard infrastructure, buildings and the
 * backdrop meshes (`assets/models/infrastructure/*.glb`). Every asset is root > LOD0 > mesh nodes on one shared swatch
 * atlas, so this loader bakes each asset into one geometry (the barrier boom in its renderer pose) and hands every
 * mesh the SAME material and texture: one atlas upload serves every file. Loaded lazily by name, once per page.
 */
import * as THREE from 'three'
import { bakeLod, loadGltf } from './containerAssets'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gateLane from '../assets/models/infrastructure/gate-lane.meta.json'
import gateLaneOog from '../assets/models/infrastructure/gate-lane-oog.meta.json'
import gateIsland from '../assets/models/infrastructure/gate-island.meta.json'
import gateOffice from '../assets/models/infrastructure/gate-office.meta.json'
import quayEdge from '../assets/models/infrastructure/quay-edge.meta.json'
import yardMarkings from '../assets/models/infrastructure/yard-markings.meta.json'
import yardAscRail from '../assets/models/infrastructure/yard-asc-rail.meta.json'
import yardFence from '../assets/models/infrastructure/yard-fence.meta.json'

export const INFRA_ASSET_NAMES = [
  'gate-lane',
  'gate-lane-oog',
  'gate-island',
  'gate-office',
  'quay-edge',
  'quay-rail',
  'quay-bollard',
  'quay-fender',
  'yard-mast',
  'yard-fence',
  'yard-asc-rail',
  'yard-markings',
  'building-control',
  'building-workshop',
  'building-substation',
  'backdrop-rock',
  'backdrop-hills',
  'backdrop-coast',
  'scenery-shore',
  'scenery-anchorage',
  'scenery-tanks',
  'scenery-landside',
  'scenery-town',
] as const
export type InfraAssetName = (typeof INFRA_ASSET_NAMES)[number]

export const INFRA_ASSET_URLS: Record<InfraAssetName, string> = {
  'gate-lane': new URL('../assets/models/infrastructure/gate-lane.glb', import.meta.url).href,
  'gate-lane-oog': new URL('../assets/models/infrastructure/gate-lane-oog.glb', import.meta.url).href,
  'gate-island': new URL('../assets/models/infrastructure/gate-island.glb', import.meta.url).href,
  'gate-office': new URL('../assets/models/infrastructure/gate-office.glb', import.meta.url).href,
  'quay-edge': new URL('../assets/models/infrastructure/quay-edge.glb', import.meta.url).href,
  'quay-rail': new URL('../assets/models/infrastructure/quay-rail.glb', import.meta.url).href,
  'quay-bollard': new URL('../assets/models/infrastructure/quay-bollard.glb', import.meta.url).href,
  'quay-fender': new URL('../assets/models/infrastructure/quay-fender.glb', import.meta.url).href,
  'yard-mast': new URL('../assets/models/infrastructure/yard-mast.glb', import.meta.url).href,
  'yard-fence': new URL('../assets/models/infrastructure/yard-fence.glb', import.meta.url).href,
  'yard-asc-rail': new URL('../assets/models/infrastructure/yard-asc-rail.glb', import.meta.url).href,
  'yard-markings': new URL('../assets/models/infrastructure/yard-markings.glb', import.meta.url).href,
  'building-control': new URL('../assets/models/infrastructure/building-control.glb', import.meta.url).href,
  'building-workshop': new URL('../assets/models/infrastructure/building-workshop.glb', import.meta.url).href,
  'building-substation': new URL('../assets/models/infrastructure/building-substation.glb', import.meta.url).href,
  'backdrop-rock': new URL('../assets/models/infrastructure/backdrop-rock.glb', import.meta.url).href,
  'backdrop-hills': new URL('../assets/models/infrastructure/backdrop-hills.glb', import.meta.url).href,
  'backdrop-coast': new URL('../assets/models/infrastructure/backdrop-coast.glb', import.meta.url).href,
  'scenery-shore': new URL('../assets/models/infrastructure/scenery-shore.glb', import.meta.url).href,
  'scenery-anchorage': new URL('../assets/models/infrastructure/scenery-anchorage.glb', import.meta.url).href,
  'scenery-tanks': new URL('../assets/models/infrastructure/scenery-tanks.glb', import.meta.url).href,
  'scenery-landside': new URL('../assets/models/infrastructure/scenery-landside.glb', import.meta.url).href,
  'scenery-town': new URL('../assets/models/infrastructure/scenery-town.glb', import.meta.url).href,
}

/** Sidecar facts the layout and renderer need (read from the sidecars, not hard-coded). */
export const INFRA = {
  /** Truck lane width (m) [V] and out-of-gauge lane width (m) [V]. */
  laneWidthM: gateLane.module.laneWidthM,
  oogLaneWidthM: gateLaneOog.module.laneWidthM,
  islandWidthM: gateIsland.module.islandWidthM,
  /** Length along the lane of a gate module (m). */
  gateModuleLengthM: gateLane.module.lengthM,
  gateOffice: { lengthM: gateOffice.dimensions.lengthM, widthM: gateOffice.dimensions.widthM },
  /** Instanced segment lengths (m); the last segment of a run is scaled to fit. */
  quaySegmentM: quayEdge.segment.lengthM,
  ascRailSegmentM: yardAscRail.segment.lengthM,
  fenceSegmentM: yardFence.segment.lengthM,
  /** The yard-markings asset holds both markings side by side; each part is re-centred (offset recorded here). */
  markingOffsetX: Math.abs(yardMarkings.attachPoints[0].position[0]),
}

/** Boom pose baked into the instanced gate-lane geometry (rad about +Z): raised on open lanes, closed on the unused OOG lane. */
export const BOOM_RAISED_RAD = -THREE.MathUtils.degToRad(80)
const BOOM_POSE: Partial<Record<InfraAssetName, number>> = { 'gate-lane': BOOM_RAISED_RAD, 'gate-lane-oog': 0 }

/** Geometry key: the asset name, or `asset:part` for assets whose meshes are placed separately. */
export type InfraKey = InfraAssetName | 'yard-markings:wtp_pad' | 'yard-markings:transfer_stall'

export interface InfraAssets {
  /** One material and one atlas texture for everything. */
  material: THREE.MeshStandardMaterial
  geometries: Partial<Record<InfraKey, THREE.BufferGeometry>>
}

const SHARED: InfraAssets = { material: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), geometries: {} }
let sharedMaterialSet = false
const loading = new Map<InfraAssetName, Promise<void>>()

function nodeNamed(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined
  root.traverse((o) => {
    if (!found && ((o.userData.name as string | undefined) ?? o.name) === name) found = o
  })
  return found
}

function adoptMaterial(gltf: GLTF): void {
  if (sharedMaterialSet) return
  let source: THREE.MeshStandardMaterial | undefined
  gltf.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (!source && m && 'map' in m) source = m
  })
  if (!source) return
  SHARED.material.map = source.map
  SHARED.material.roughness = Math.max(0.85, source.roughness)
  SHARED.material.metalness = 0
  SHARED.material.needsUpdate = true
  sharedMaterialSet = true
}

async function loadOne(name: InfraAssetName): Promise<void> {
  const gltf = await loadGltf(INFRA_ASSET_URLS[name])
  adoptMaterial(gltf)
  const scene = gltf.scene
  const boom = nodeNamed(scene, 'boom')
  if (boom) boom.rotation.z = BOOM_POSE[name] ?? 0
  const lod0 = nodeNamed(scene, 'LOD0')
  if (!lod0) throw new Error(`${name}: no LOD0 node`)
  if (name === 'yard-markings') {
    for (const part of ['wtp_pad', 'transfer_stall'] as const) {
      const node = nodeNamed(scene, part)
      if (!node) throw new Error(`yard-markings: no ${part} node`)
      const g = bakeLod(scene, node)
      g.translate(part === 'wtp_pad' ? INFRA.markingOffsetX : -INFRA.markingOffsetX, 0, 0)
      g.computeBoundingBox()
      g.computeBoundingSphere()
      SHARED.geometries[`yard-markings:${part}`] = g
    }
  } else {
    SHARED.geometries[name] = bakeLod(scene, lod0)
  }
  // The per-file atlas copies are never drawn: only the first file's texture is kept.
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (m && m.map && m.map !== SHARED.material.map) m.map.dispose()
  })
}

/** Loads (once) the named infrastructure assets; resolves with the shared material and baked geometries. */
export function loadInfrastructureAssets(names: readonly InfraAssetName[]): Promise<InfraAssets> {
  const tasks = names.map((n) => {
    let p = loading.get(n)
    if (!p) {
      p = loadOne(n)
      loading.set(n, p)
      p.catch(() => loading.delete(n))
    }
    return p
  })
  return Promise.all(tasks).then(() => SHARED)
}

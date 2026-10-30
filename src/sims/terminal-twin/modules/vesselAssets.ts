/**
 * Loads the TT-27 vessel hull GLBs (one per size class, LOD0/1/2) once per
 * page, only for the classes a scenario uses. Each LOD is baked into one
 * geometry (one draw call). The material is the vessel livery atlas; the
 * renderer clones it per vessel and shifts the UVs to the vessel's line tile
 * (`liveryMaterial` with the vessel atlas layout).
 *
 * Offline: GLB URLs are bundled by Vite; sidecars and the atlas manifest are
 * bundled JSON. Meshopt decoding uses the copy shipped with Three.js.
 */
import * as THREE from 'three'
import type { VesselSizeClass } from '../scenario/types'
import vesselAtlas from '../assets/models/vessels/vessel-livery-atlas.json'
import feederMeta from '../assets/models/vessels/vessel-feeder.meta.json'
import feedermaxMeta from '../assets/models/vessels/vessel-feedermax.meta.json'
import panamaxMeta from '../assets/models/vessels/vessel-panamax.meta.json'
import neoPanamaxMeta from '../assets/models/vessels/vessel-neo-panamax.meta.json'
import ulcvMeta from '../assets/models/vessels/vessel-ulcv.meta.json'
import { bakeLod, loadGltf } from './containerAssets'
import type { HullMeta } from './vesselHull'

/** Hull GLBs per class (literal URLs so Vite bundles them; see HULL_ASSET_FILES). */
const GLB_URLS: Record<VesselSizeClass, string> = {
  feeder: new URL('../assets/models/vessels/vessel-feeder.glb', import.meta.url).href,
  feedermax: new URL('../assets/models/vessels/vessel-feedermax.glb', import.meta.url).href,
  panamax: new URL('../assets/models/vessels/vessel-panamax.glb', import.meta.url).href,
  'neo-panamax': new URL('../assets/models/vessels/vessel-neo-panamax.glb', import.meta.url).href,
  ulcv: new URL('../assets/models/vessels/vessel-ulcv.glb', import.meta.url).href,
}
const METAS = {
  feeder: feederMeta,
  feedermax: feedermaxMeta,
  panamax: panamaxMeta,
  'neo-panamax': neoPanamaxMeta,
  ulcv: ulcvMeta,
} as unknown as Record<VesselSizeClass, HullMeta>

export const VESSEL_LIVERY_ATLAS = vesselAtlas

/** Vessel atlas tile for a line (no line or an unknown one: the generic tile). */
export function vesselLiveryIndex(line: string | undefined | null): number {
  const hit = vesselAtlas.liveries.find((l) => l.line !== null && l.line === line)
  return hit ? hit.index : vesselAtlas.genericIndex
}

/** Hull colour of a vessel livery (procedural placeholder before the GLB loads). */
export function vesselHullColour(index: number): string {
  return (vesselAtlas.liveries[index] ?? vesselAtlas.liveries[vesselAtlas.genericIndex]).hull
}

export function hullMeta(sizeClass: VesselSizeClass): HullMeta {
  const meta = METAS[sizeClass]
  if (!meta) throw new Error(`No hull sidecar for ${sizeClass}`)
  return meta
}

export function hullUrl(sizeClass: VesselSizeClass): string {
  const url = GLB_URLS[sizeClass]
  if (!url) throw new Error(`No hull GLB for ${sizeClass}`)
  return url
}

export interface HullModel {
  meta: HullMeta
  /** LOD0, LOD1, LOD2, each merged, in the asset frame. */
  lods: [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry]
  /** The GLB's material (not patched; clone it with `liveryMaterial`). */
  material: THREE.MeshStandardMaterial
  /** The `bay_grid` marker's position in the asset frame, as the GLB has it. */
  bayGrid: THREE.Vector3
}

const cache = new Map<VesselSizeClass, Promise<HullModel>>()

export function loadHullModel(sizeClass: VesselSizeClass): Promise<HullModel> {
  let hit = cache.get(sizeClass)
  if (!hit) {
    hit = (async () => {
      const gltf = await loadGltf(hullUrl(sizeClass))
      const root = gltf.scene.children[0] ?? gltf.scene
      root.updateMatrixWorld(true)
      const node = (name: string) => {
        const found = root.getObjectByName(name)
        if (!found) throw new Error(`hull ${sizeClass} has no node ${name}`)
        return found
      }
      const lods = ['LOD0', 'LOD1', 'LOD2'].map((n) => bakeLod(root, node(n))) as HullModel['lods']
      let material: THREE.MeshStandardMaterial | null = null
      node('LOD0').traverse((o) => {
        if (!material && (o as THREE.Mesh).isMesh) material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
      })
      if (!material) throw new Error(`hull ${sizeClass} has no material`)
      const inverseRoot = root.matrixWorld.clone().invert()
      const bayGrid = node('bay_grid').getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot)
      return { meta: hullMeta(sizeClass), lods, material, bayGrid }
    })()
    hit.catch(() => cache.delete(sizeClass))
    cache.set(sizeClass, hit)
  }
  return hit
}

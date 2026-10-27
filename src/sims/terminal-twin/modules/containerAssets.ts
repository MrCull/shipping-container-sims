/**
 * Loads the phase 2 container GLBs (20 ft, 40 ft, 40 ft HC) once per page and
 * turns them into instancing-ready geometry: LOD0 (body + both door leaves,
 * doors closed) merged into one geometry, and LOD1 (12-triangle box).
 *
 * Offline: GLB URLs are bundled by Vite, and the meshopt decoder is the copy
 * that ships with Three.js (no CDN). Textures are WebP (EXT_texture_webp).
 *
 * Livery: TEXCOORD_0 in the GLBs is authored for atlas tile 0. `liveryMaterial`
 * patches a material so each instance's `liveryIndex` attribute (or the
 * `liveryBase` uniform for a plain mesh) shifts the UVs to its line's tile.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ContainerSize } from '../scenario/types'
import atlas from '../assets/models/containers/livery-atlas.json'

export const CONTAINER_ASSET_URLS: Record<ContainerSize, string> = {
  '20': new URL('../assets/models/containers/container-20.glb', import.meta.url).href,
  '40': new URL('../assets/models/containers/container-40.glb', import.meta.url).href,
  '40HC': new URL('../assets/models/containers/container-40hc.glb', import.meta.url).href,
}

export const LIVERY_ATLAS = atlas

/** Atlas tile index for a shipping line (unknown lines get the generic grey tile). */
export function liveryIndexForLine(line: string | undefined): number {
  const hit = atlas.liveries.find((l) => l.line === line)
  return hit ? hit.index : atlas.genericIndex
}

/** Body colour of a livery (for the procedural placeholders before the GLBs load). */
export function liveryBodyColour(index: number): string {
  return atlas.liveries[index]?.body ?? atlas.liveries[atlas.genericIndex].body
}

export interface ContainerModel {
  /** LOD0 merged (body + closed doors), origin at the bottom centre, length along X. */
  lod0: THREE.BufferGeometry
  lod1: THREE.BufferGeometry
}

export interface ContainerAssets {
  sizes: Record<ContainerSize, ContainerModel>
  lod0Material: THREE.MeshStandardMaterial
  lod1Material: THREE.MeshStandardMaterial
}

let loader: GLTFLoader | null = null
export function gltfLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
  }
  return loader
}

export function loadGltf(url: string): Promise<GLTF> {
  return gltfLoader().loadAsync(url)
}

/** Float32, non-quantised copy of the attributes we render with. */
function toFloatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv', 'uv1']) {
    const a = src.getAttribute(name)
    if (!a) continue
    const arr = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c)
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
  }
  if (src.index) out.setIndex(Array.from(src.index.array as ArrayLike<number>))
  return out
}

function meshesUnder(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  return meshes
}

/** Merges every mesh under `node` into one geometry in the asset root's space. */
export function bakeLod(root: THREE.Object3D, node: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true)
  const inverseRoot = root.matrixWorld.clone().invert()
  const parts = meshesUnder(node).map((m) => {
    const g = toFloatGeometry(m.geometry)
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot, m.matrixWorld))
    return g
  })
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts)
  if (!merged) throw new Error(`could not merge ${node.name}`)
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/**
 * Patches a (cloned) material for per-instance livery tiles. Works for
 * InstancedMesh (attribute `liveryIndex`) and plain meshes (attribute absent
 * = 0, so the `liveryBase` uniform picks the tile).
 */
export function liveryMaterial<T extends THREE.MeshStandardMaterial>(source: T): T & { userData: { liveryBase: { value: number } } } {
  const mat = source.clone() as T & { userData: { liveryBase: { value: number } } }
  const liveryBase = { value: 0 }
  mat.userData.liveryBase = liveryBase
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.liveryBase = liveryBase
    shader.uniforms.liveryTile = { value: new THREE.Vector2(atlas.tileSizeUv[0], atlas.tileSizeUv[1]) }
    shader.uniforms.liveryCols = { value: atlas.tileCols }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float liveryIndex;\nuniform float liveryBase;\nuniform vec2 liveryTile;\nuniform float liveryCols;',
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  float liveryI = liveryIndex + liveryBase;
  vMapUv += vec2(mod(liveryI, liveryCols), floor(liveryI / liveryCols)) * liveryTile;
#endif`,
      )
  }
  mat.customProgramCacheKey = () => 'tt-livery'
  return mat
}

function findByName(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = root.getObjectByName(name)
  if (!found) throw new Error(`asset ${root.name} has no node ${name}`)
  return found
}

function materialOf(node: THREE.Object3D): THREE.MeshStandardMaterial {
  const mesh = meshesUnder(node)[0]
  return mesh.material as THREE.MeshStandardMaterial
}

let cached: Promise<ContainerAssets> | null = null

/** Loads all container sizes once (shared by every renderer on the page). */
export function loadContainerAssets(): Promise<ContainerAssets> {
  if (!cached) {
    cached = (async () => {
      const entries = await Promise.all(
        (Object.keys(CONTAINER_ASSET_URLS) as ContainerSize[]).map(async (size) => [size, await loadGltf(CONTAINER_ASSET_URLS[size])] as const),
      )
      const sizes = {} as Record<ContainerSize, ContainerModel>
      let lod0Src: THREE.MeshStandardMaterial | null = null
      let lod1Src: THREE.MeshStandardMaterial | null = null
      for (const [size, gltf] of entries) {
        const root = gltf.scene.children[0] ?? gltf.scene
        const lod0 = findByName(root, 'LOD0')
        const lod1 = findByName(root, 'LOD1')
        sizes[size] = { lod0: bakeLod(root, lod0), lod1: bakeLod(root, lod1) }
        lod0Src ??= materialOf(lod0)
        lod1Src ??= materialOf(lod1)
      }
      const lod0Material = liveryMaterial(lod0Src!)
      const lod1Material = liveryMaterial(lod1Src!)
      // One atlas texture for every size and LOD (each GLB embeds the same image).
      lod1Material.map = lod0Material.map
      for (const m of [lod0Material, lod1Material]) if (m.map) m.map.anisotropy = 4
      return { sizes, lod0Material, lod1Material }
    })()
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

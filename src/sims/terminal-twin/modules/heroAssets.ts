/**
 * Hero container face models (#255, #258), fetched on demand. The twelve GLBs (`hero-<size>-<kind>`, about 25 KB each)
 * are never imported at page load: each file has a URL that is requested the first time a face of that
 * size and kind is drawn, so first-load size and requests are unchanged. This is the only non-dev module that names
 * the hero models (`tests/hero-container-asset.test.ts` checks it).
 */
import * as THREE from 'three'
import type { ContainerSize } from '../scenario/types'
import { loadGltf, toFloatGeometry } from './containerAssets'
import type { HeroKind } from './heroFaceSelection'

/** One mesh of a hero face: baked into the box frame; `tinted` is the paint (white, multiplied by livery or tint). */
export interface HeroPart {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  tinted: boolean
  triangles: number
}

export type HeroFaceLoader = (size: ContainerSize, kind: HeroKind) => Promise<HeroPart[]>

/** A URL per file (a static `new URL` Vite bundles as an asset, as `containerAssets.ts` does): nothing is fetched until it is loaded. */
const URLS: Record<string, string> = {
  '20-side': new URL('../assets/models/hero/hero-20-side.glb', import.meta.url).href,
  '20-door': new URL('../assets/models/hero/hero-20-door.glb', import.meta.url).href,
  '20-front': new URL('../assets/models/hero/hero-20-front.glb', import.meta.url).href,
  '20-roof': new URL('../assets/models/hero/hero-20-roof.glb', import.meta.url).href,
  '40-side': new URL('../assets/models/hero/hero-40-side.glb', import.meta.url).href,
  '40-door': new URL('../assets/models/hero/hero-40-door.glb', import.meta.url).href,
  '40-front': new URL('../assets/models/hero/hero-40-front.glb', import.meta.url).href,
  '40-roof': new URL('../assets/models/hero/hero-40-roof.glb', import.meta.url).href,
  '40hc-side': new URL('../assets/models/hero/hero-40hc-side.glb', import.meta.url).href,
  '40hc-door': new URL('../assets/models/hero/hero-40hc-door.glb', import.meta.url).href,
  '40hc-front': new URL('../assets/models/hero/hero-40hc-front.glb', import.meta.url).href,
  '40hc-roof': new URL('../assets/models/hero/hero-40hc-roof.glb', import.meta.url).href,
}

const keyOf = (size: ContainerSize, kind: HeroKind): string => `${size === '40HC' ? '40hc' : size}-${kind}`

export const loadHeroFace: HeroFaceLoader = async (size, kind) => {
  const gltf = await loadGltf(URLS[keyOf(size, kind)])
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert()
  const parts: HeroPart[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geometry = toFloatGeometry(mesh.geometry)
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
    const material = mesh.material as THREE.MeshStandardMaterial
    const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count
    parts.push({ geometry, material, tinted: material.name === 'hero_paint', triangles: count / 3 })
  })
  return parts
}

/**
 * Hero equipment models (#273, #275), fetched on demand. The GLBs (`hero-spreader-<kind>`, about 60 KB each, and
 * `hero-shc`, the SHC body) are never imported at page load: each file has a URL that is requested the first time a
 * piece of that kind is drawn at the hero level. This is the only non-dev module that names the files (`tests/hero-equipment-asset.test.ts` checks it).
 *
 * A file's `LOD0` node is the source rig's `spreader` frame: add the returned subtree as a child of that rig's
 * `spreader` node with an identity transform. Its rig nodes keep the source names (`twistlock_*`, and for the STS
 * `spreader_tele_fore`, `spreader_tele_aft`, `twin_locks`), each an empty with its mesh in a `<name>_geo` child.
 */
import type * as THREE from 'three'
import { loadGltf } from './containerAssets'

/** A hero piece's file: the spreader of a rig (`sts`, `asc`, `shc`, #273) or the SHC body without its spreader (`shc-body`, #275). */
export type HeroEquipmentKind = 'sts' | 'asc' | 'shc' | 'shc-body'

/** A URL per file (a static `new URL` Vite bundles as an asset): nothing is fetched until it is loaded. */
const URLS: Record<HeroEquipmentKind, string> = {
  sts: new URL('../assets/models/hero-equipment/hero-spreader-sts.glb', import.meta.url).href,
  asc: new URL('../assets/models/hero-equipment/hero-spreader-asc.glb', import.meta.url).href,
  shc: new URL('../assets/models/hero-equipment/hero-spreader-shc.glb', import.meta.url).href,
  'shc-body': new URL('../assets/models/hero-equipment/hero-shc.glb', import.meta.url).href,
}

type Fetch = (url: string) => Promise<{ scene: THREE.Object3D }>

/**
 * A loader with its own cache: one fetch per kind, on the first call for that kind; every call resolves to a new clone
 * of the file's `LOD0` subtree. Clones share geometry and materials (never dispose them from a renderer).
 */
export function createHeroSpreaderLoader(fetchGltf: Fetch = loadGltf, urls: Record<HeroEquipmentKind, string> = URLS): (kind: HeroEquipmentKind) => Promise<THREE.Object3D> {
  const cache = new Map<HeroEquipmentKind, Promise<THREE.Object3D>>()
  return async (kind) => {
    let pending = cache.get(kind)
    if (!pending) {
      pending = fetchGltf(urls[kind]).then((gltf) => {
        const lod0 = gltf.scene.getObjectByName('LOD0')
        if (!lod0) throw new Error(`${urls[kind]}: no LOD0 node`)
        return lod0
      })
      cache.set(kind, pending)
      pending.catch(() => cache.delete(kind)) // a failed fetch may be retried
    }
    return (await pending).clone(true)
  }
}

/** The cloned `LOD0` subtree of the hero piece for `kind`; the file is fetched on the first call for that kind. */
export const loadHeroSpreader = createHeroSpreaderLoader()
/** The same loader under the general name (#275): every hero piece kind, spreaders and the SHC body. */
export const loadHeroEquipment = loadHeroSpreader

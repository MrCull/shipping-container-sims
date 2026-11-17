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

/**
 * A hero piece's files: the spreader of a rig (`sts`, `asc`, `shc`, #273), the SHC body without its spreader
 * (`shc-body`, #275), or a truck of one cab shape (`truck-<shape>`, #276: the hero chassis and that shape's hero cab).
 */
export type HeroEquipmentKind = 'sts' | 'asc' | 'shc' | 'shc-body' | 'truck-day' | 'truck-mid' | 'truck-high'

const HERO_TRUCK_CHASSIS = new URL('../assets/models/hero-equipment/hero-truck-chassis.glb', import.meta.url).href

/**
 * The file (or files, merged into one `LOD0`) per kind, each a static `new URL` Vite bundles as an asset: nothing is
 * fetched until it is loaded. A truck is two files, the chassis (shared by the three shapes) and its cab.
 */
const URLS: Record<HeroEquipmentKind, string | readonly string[]> = {
  sts: new URL('../assets/models/hero-equipment/hero-spreader-sts.glb', import.meta.url).href,
  asc: new URL('../assets/models/hero-equipment/hero-spreader-asc.glb', import.meta.url).href,
  shc: new URL('../assets/models/hero-equipment/hero-spreader-shc.glb', import.meta.url).href,
  'shc-body': new URL('../assets/models/hero-equipment/hero-shc.glb', import.meta.url).href,
  'truck-day': [HERO_TRUCK_CHASSIS, new URL('../assets/models/hero-equipment/hero-truck-cab-day.glb', import.meta.url).href],
  'truck-mid': [HERO_TRUCK_CHASSIS, new URL('../assets/models/hero-equipment/hero-truck-cab-mid.glb', import.meta.url).href],
  'truck-high': [HERO_TRUCK_CHASSIS, new URL('../assets/models/hero-equipment/hero-truck-cab-high.glb', import.meta.url).href],
}

type Fetch = (url: string) => Promise<{ scene: THREE.Object3D }>

/**
 * A loader with its own cache: one fetch per file, on the first call that needs it; every call resolves to a new clone
 * of the kind's `LOD0` subtree. A kind of several files gets one `LOD0` group holding each file's `LOD0` children (a
 * truck: the chassis nodes and the cab's `fifth_wheel` subtree side by side, as in the rig's LOD0). Clones share
 * geometry and materials (never dispose them from a renderer).
 */
export function createHeroEquipmentLoader(fetchGltf: Fetch = loadGltf, urls: Record<HeroEquipmentKind, string | readonly string[]> = URLS): (kind: HeroEquipmentKind) => Promise<THREE.Object3D> {
  const cache = new Map<string, Promise<THREE.Object3D>>()
  const file = (url: string): Promise<THREE.Object3D> => {
    let pending = cache.get(url)
    if (!pending) {
      pending = fetchGltf(url).then((gltf) => {
        const lod0 = gltf.scene.getObjectByName('LOD0')
        if (!lod0) throw new Error(`${url}: no LOD0 node`)
        return lod0
      })
      cache.set(url, pending)
      pending.catch(() => cache.delete(url)) // a failed fetch may be retried
    }
    return pending
  }
  return async (kind) => {
    const list = urls[kind]
    if (typeof list === 'string') return (await file(list)).clone(true)
    const parts = await Promise.all(list.map(file))
    const merged = parts[0].clone(false)
    for (const part of parts) for (const child of part.children) merged.add(child.clone(true))
    return merged
  }
}

/** The cloned `LOD0` subtree of the hero piece for `kind`; its files are fetched on the first call that needs them. */
export const loadHeroEquipment = createHeroEquipmentLoader()

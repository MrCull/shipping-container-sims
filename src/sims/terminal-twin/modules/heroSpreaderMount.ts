/**
 * The rig side of the hero equipment level (#273): where a hero spreader goes on a rig, and the one call a kind makes
 * to offer a rig. The rig models (`stsAssets.ts`, `ascAssets.ts`, `shcAssets.ts`) and the kinds import this module, not
 * the level (`heroEquipment.ts`), which consumes the offers.
 */
import type * as THREE from 'three'
import type { HeroEquipmentKind } from './heroEquipmentAssets'

/** GLTFLoader renames duplicate node names (`spreader_1`); the file's own name is kept in `userData.name`. */
export const gltfNodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

/** Where a hero spreader goes on a rig: the rig's LOD0 `spreader` node, and a copy of that subtree as loaded (unposed). */
export interface HeroSpreaderMount {
  node: THREE.Object3D
  rest: THREE.Object3D
}

/**
 * The mount of a rig's LOD0 subtree, or null when it has no `spreader` node. Call it before the rig is first posed:
 * the copy taken here is the rest pose that later motion is measured against.
 */
export function heroSpreaderMount(lod0: THREE.Object3D): HeroSpreaderMount | null {
  let node: THREE.Object3D | null = null
  lod0.traverse((o) => {
    if (!node && gltfNodeName(o) === 'spreader') node = o
  })
  if (!node) return null
  return { node, rest: (node as THREE.Object3D).clone(true) }
}

export interface HeroEquipmentOffer {
  /** Stable equipment id. */
  id: string
  kind: HeroEquipmentKind
  mount: HeroSpreaderMount
}

/** A kind's per-rig call, after posing the rig: offers it for the hero spreader when it is drawn at LOD0 and has a mount. */
export function offerHeroSpreaderAtLod0(frame: { offerHeroSpreader(offer: HeroEquipmentOffer): void }, id: string, kind: HeroEquipmentKind, lod: number, mount: HeroSpreaderMount | null): void {
  if (lod === 0 && mount) frame.offerHeroSpreader({ id, kind, mount })
}

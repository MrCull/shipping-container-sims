/**
 * The rig side of the hero equipment level (#273, #275): where a hero piece goes on a rig, and the one call a kind
 * makes to offer a rig. The rig models (`stsAssets.ts`, `ascAssets.ts`, `shcAssets.ts`) and the kinds import this
 * module, not the level (`heroEquipment.ts`), which consumes the offers.
 */
import type * as THREE from 'three'
import type { HeroEquipmentKind } from './heroEquipmentAssets'

/** GLTFLoader renames duplicate node names (`spreader_1`); the file's own name is kept in `userData.name`. */
export const gltfNodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

/**
 * Where a hero piece goes on a rig: the rig node its `LOD0` is added under (identity transform), and a copy of that
 * subtree as loaded (unposed). The piece replaces the rig's meshes under `node`, except those under a child subtree
 * named `skip` (the SHC body leaves the rig's `spreader` to the hero spreader).
 */
export interface HeroMount {
  node: THREE.Object3D
  rest: THREE.Object3D
  /** A subtree under `node` (by glTF node name) that is not part of this piece: its meshes are neither faded nor hidden. */
  skip?: string
  /** The point (in `node`'s frame) the camera distance is measured to; the node's origin when absent. */
  centre?: THREE.Vector3
  /** Rig materials a hero mesh takes by material name (the SHC's fleet-number plate). */
  materials?: ReadonlyMap<string, THREE.Material>
}

/** The first node named `name` under `root`, or null. */
function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let node: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!node && gltfNodeName(o) === name) node = o
  })
  return node
}

/**
 * The mount of a rig's LOD0 subtree, or null when it has no `spreader` node. Call it before the rig is first posed:
 * the copy taken here is the rest pose that later motion is measured against.
 */
export function heroSpreaderMount(lod0: THREE.Object3D): HeroMount | null {
  const node = findNode(lod0, 'spreader')
  if (!node) return null
  return { node, rest: node.clone(true) }
}

/**
 * The mount of a whole-body hero piece (#275): the rig's LOD0 node itself, minus its `spreader` subtree (that is the
 * hero spreader's), with the camera distance measured to `centre`. Call it before the rig is first posed. `materials`
 * are the LOD0 rig materials a hero mesh adopts by material name.
 */
export function heroBodyMount(lod0: THREE.Object3D, centre: THREE.Vector3, materials?: ReadonlyMap<string, THREE.Material>): HeroMount {
  return { node: lod0, rest: lod0.clone(true), skip: 'spreader', centre, materials }
}

export interface HeroEquipmentOffer {
  /** Stable equipment id. */
  id: string
  kind: HeroEquipmentKind
  mount: HeroMount
}

/** A kind's per-rig call, after posing the rig: offers it for the hero piece `kind` when it is drawn at LOD0 and has a mount. */
export function offerHeroEquipmentAtLod0(frame: { offerHeroEquipment(offer: HeroEquipmentOffer): void }, id: string, kind: HeroEquipmentKind, lod: number, mount: HeroMount | null): void {
  if (lod === 0 && mount) frame.offerHeroEquipment({ id, kind, mount })
}

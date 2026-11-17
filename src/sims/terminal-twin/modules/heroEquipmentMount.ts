/**
 * The rig side of the hero equipment level (#273, #275, #276): where a hero piece goes on a rig, and the one call a kind
 * makes to offer a rig. The rig models (`stsAssets.ts`, `ascAssets.ts`, `shcAssets.ts`, `truckAssets.ts`) and the kinds import this
 * module, not the level (`heroEquipment.ts`), which consumes the offers.
 */
import type * as THREE from 'three'
import type { HeroEquipmentKind } from './heroEquipmentAssets'

/** GLTFLoader renames duplicate node names (`spreader_1`); the file's own name is kept in `userData.name`. */
export const gltfNodeName = (o: THREE.Object3D): string => (o.userData.name as string | undefined) ?? o.name

/**
 * Where a hero piece goes on a rig: the rig node its `LOD0` is added under (identity transform), and the rest pose of
 * that subtree as loaded (unposed). The piece replaces the rig's meshes under `node`, except those under a child subtree
 * named `skip` (the SHC body leaves the rig's `spreader` to the hero spreader).
 */
export interface HeroMount {
  node: THREE.Object3D
  /**
   * The rest pose: each node's local matrix under `node` (not `node` itself, nor the `skip` subtree) by glTF node name.
   * Built on the first call (the level calls it when it attaches a piece), so a rig never offered builds none.
   */
  rest: () => RestPose
  /** A subtree under `node` (by glTF node name) that is not part of this piece: its meshes are neither faded nor hidden. */
  skip?: string
  /** The point (in `node`'s frame) the camera distance is measured to; the node's origin when absent. */
  centre?: THREE.Vector3
  /** Rig materials a hero mesh takes by material name (the SHC's fleet-number plate, the truck livery). */
  materials?: ReadonlyMap<string, THREE.Material>
}

/** A rest pose: local matrix by glTF node name (the last node of a name wins, as in the level's rig lookup). */
export type RestPose = ReadonlyMap<string, THREE.Matrix4>

/** Counts rest poses built (tests: a rig never offered builds none, rigs of one model share one). */
export const restPoseStats = { built: 0 }

/** The rest pose of the subtree under `root` (leaving out `root` and the subtrees named `skip`), from each node's TRS. */
function buildRestPose(root: THREE.Object3D, skip: string | undefined): RestPose {
  restPoseStats.built++
  const pose = new Map<string, THREE.Matrix4>()
  const visit = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (skip !== undefined && gltfNodeName(c) === skip) continue
      pose.set(gltfNodeName(c), c.matrix.clone().compose(c.position, c.quaternion, c.scale))
      visit(c)
    }
  }
  visit(root)
  return pose
}

const sharedRestPoses = new WeakMap<THREE.Object3D, Map<string, RestPose>>()

/**
 * A lazy rest pose read from `template`, a subtree that is never posed (the rig's loaded GLB node, which every rig of
 * that model clones), built on the first call and shared by every mount with the same template and `skip`.
 */
export function sharedRestPose(template: THREE.Object3D, skip?: string): () => RestPose {
  return () => {
    let bySkip = sharedRestPoses.get(template)
    if (!bySkip) sharedRestPoses.set(template, (bySkip = new Map()))
    const key = skip ?? ''
    let pose = bySkip.get(key)
    if (!pose) bySkip.set(key, (pose = buildRestPose(template, skip)))
    return pose
  }
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
 * the rest pose taken here (local matrices only, a small subtree) is what later motion is measured against.
 */
export function heroSpreaderMount(lod0: THREE.Object3D): HeroMount | null {
  const node = findNode(lod0, 'spreader')
  if (!node) return null
  const rest = buildRestPose(node, undefined)
  return { node, rest: () => rest }
}

/**
 * The mount of a whole-body hero piece: the rig's LOD0 node itself, with the camera distance measured to `centre`.
 * `template` is the unposed LOD0 the rig cloned (shared per model): its rest pose is read on the first attach and
 * shared. `skip` leaves a subtree to another piece (the SHC body, #275, skips `spreader`; the truck, #276, skips none);
 * `materials` are the rig materials a hero mesh adopts by material name.
 */
export function heroBodyMount(lod0: THREE.Object3D, template: THREE.Object3D, centre: THREE.Vector3, opts: { skip?: string; materials?: ReadonlyMap<string, THREE.Material> } = {}): HeroMount {
  return { node: lod0, rest: sharedRestPose(template, opts.skip), skip: opts.skip, centre, materials: opts.materials }
}

export interface HeroEquipmentOffer {
  /** Stable equipment id. */
  id: string
  kind: HeroEquipmentKind
  mount: HeroMount
}

/** What a kind offers rigs to: the kind's frame (`KindFrame`), which hands them to the hero equipment level. */
export interface HeroOfferSink {
  offerHeroEquipment(offer: HeroEquipmentOffer): void
}

/** A kind's per-rig call, after posing the rig: offers it for the hero piece `kind` when it is drawn at LOD0 and has a mount. */
export function offerHeroEquipmentAtLod0(frame: HeroOfferSink, id: string, kind: HeroEquipmentKind, lod: number, mount: HeroMount | null): void {
  if (lod === 0 && mount) frame.offerHeroEquipment({ id, kind, mount })
}

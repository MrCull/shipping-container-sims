/**
 * Generic rig driver for phase 2 assets, from the `.meta.json` sidecar:
 * `travelLimits` (translation along / rotation about an axis, relative to the
 * GLB rest pose), `lodNaming` (every LOD has its own copy of a rig node, e.g.
 * `trolley`, `trolley_lod1`, `trolley_lod2`) and `stretch` (a node scaled so it
 * spans to another: `axis: 'Y'` rules scale a node down to a sibling, e.g. hoist
 * ropes down to the headblock; `mode: 'aim'` rules turn a node's local `axis`
 * towards a target node anywhere in the tree and scale it along that axis to the
 * distance, e.g. STS forestays from the apex to an anchor on the moving boom).
 *
 * `setRig(node, value)` moves that node in every LOD at once, so switching LOD
 * never changes the pose. Used by the dev asset viewer and the twin's renderer.
 */
import * as THREE from 'three'

export interface TravelLimit {
  type: 'rotation' | 'translation'
  axis: string
  minDeg?: number
  maxDeg?: number
  minM?: number
  maxM?: number
}

export interface StretchRule {
  node: string
  to: string
  /** 'Y' (default mode): `scale.y = node.y - (to.y + offsetM)`; aim mode: the node's local axis that points at `to`. */
  axis: string
  /** 'aim': rotate the node so `axis` points at `to` and scale it along `axis` to the distance (no offset). */
  mode?: 'aim'
  offsetM?: number
  unitLengthM: number
}

export interface RigMeta {
  travelLimits?: Record<string, TravelLimit>
  lodNaming?: Record<string, string>
  stretch?: StretchRule[]
}

export function axisVector(axis: string): THREE.Vector3 {
  const v = new THREE.Vector3()
  const sign = axis.startsWith('-') ? -1 : 1
  const c = axis.replace(/^[+-]/, '').toLowerCase() as 'x' | 'y' | 'z'
  v[c] = sign
  return v
}

interface Bound {
  obj: THREE.Object3D
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export class AssetRig {
  /** LOD suffixes in LOD order ('' only for assets without per-LOD rigs). */
  readonly suffixes: string[]
  readonly limits: Record<string, TravelLimit>
  readonly values: Record<string, number> = {}
  private bound = new Map<string, Bound[]>()
  private stretch: { node: Bound; to: Bound; rule: StretchRule }[] = []
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()

  constructor(root: THREE.Object3D, meta: RigMeta) {
    this.limits = meta.travelLimits ?? {}
    this.suffixes = meta.lodNaming ? Object.entries(meta.lodNaming).filter(([k]) => /^LOD\d$/.test(k)).map(([, s]) => s) : ['']
    // Rig nodes are repeated per LOD, either with a suffix (`trolley`, `trolley_lod1`) or under the same name
    // (GLTFLoader then renames the duplicates and keeps the file's name in userData.name).
    const byName = new Map<string, THREE.Object3D[]>()
    root.traverse((o) => {
      const name = (o.userData.name as string | undefined) ?? o.name
      const list = byName.get(name)
      if (list) list.push(o)
      else byName.set(name, [o])
    })
    const bind = (name: string): Bound[] => {
      const found = new Set<THREE.Object3D>()
      for (const s of this.suffixes) for (const o of byName.get(name + s) ?? []) found.add(o)
      return [...found].map((obj) => ({ obj, position: obj.position.clone(), quaternion: obj.quaternion.clone() }))
    }
    for (const node of Object.keys(this.limits)) {
      this.bound.set(node, bind(node))
      this.values[node] = 0
    }
    for (const rule of meta.stretch ?? []) {
      const nodes = bind(rule.node)
      const targets = bind(rule.to)
      nodes.forEach((n, i) => {
        if (targets[i]) this.stretch.push({ node: n, to: targets[i], rule })
      })
    }
    this.applyStretch()
  }

  /** Rig node names (travel-limit keys). */
  get nodes(): string[] {
    return Object.keys(this.limits)
  }

  /** The node's objects, one per LOD (LOD order). */
  objects(node: string): THREE.Object3D[] {
    return (this.bound.get(node) ?? []).map((b) => b.obj)
  }

  /** Sets a rig value (m or degrees from rest), clamped to its travel limits; returns the value used. */
  set(node: string, value: number, clamp = true): number {
    const limit = this.limits[node]
    const bound = this.bound.get(node)
    if (!limit || !bound) throw new Error(`no rig node ${node}`)
    const min = limit.type === 'rotation' ? (limit.minDeg ?? 0) : (limit.minM ?? 0)
    const max = limit.type === 'rotation' ? (limit.maxDeg ?? 0) : (limit.maxM ?? 0)
    const v = clamp ? Math.min(max, Math.max(min, value)) : value
    if (this.values[node] === v) return v
    const axis = axisVector(limit.axis)
    for (const b of bound) {
      if (limit.type === 'rotation') b.obj.quaternion.copy(b.quaternion).multiply(this.q.setFromAxisAngle(axis, THREE.MathUtils.degToRad(v)))
      else b.obj.position.copy(b.position).addScaledVector(axis, v)
    }
    this.values[node] = v
    return v
  }

  /** Re-scales stretch nodes (e.g. ropes) to reach their targets; call after moving rig nodes. */
  applyStretch(): void {
    for (const { node, to, rule } of this.stretch) {
      if (rule.mode === 'aim') {
        this.aim(node, to.obj, rule)
        continue
      }
      const length = node.obj.position.y - (to.obj.position.y + (rule.offsetM ?? 0))
      node.obj.scale.y = Math.max(0.01, length / rule.unitLengthM)
    }
  }

  /**
   * Per `aim` stretch node (every LOD copy, by node name), the world distance (m) from its far end to its target:
   * near zero when attached, metres when the rig moved without `applyStretch` (#304; read by `__tt` rig state).
   */
  aimGapsM(): Record<string, number> {
    const out: Record<string, number> = {}
    const end = new THREE.Vector3()
    const target = new THREE.Vector3()
    for (const { node, to, rule } of this.stretch) {
      if (rule.mode !== 'aim') continue
      node.obj.updateWorldMatrix(true, false)
      to.obj.updateWorldMatrix(true, false)
      node.obj.localToWorld(end.copy(axisVector(rule.axis)).multiplyScalar(rule.unitLengthM))
      out[node.obj.name] = end.distanceTo(to.obj.getWorldPosition(target))
    }
    return out
  }

  /** Points the node's local `axis` at the target's origin and scales it along that axis to the distance. */
  private aim(node: Bound, target: THREE.Object3D, rule: StretchRule): void {
    // Target origin in the node's parent frame: walk up from the target through local transforms (no world matrices).
    const p = this.v.set(0, 0, 0)
    const parent = node.obj.parent
    let o: THREE.Object3D | null = target
    while (o && o !== parent) {
      p.applyMatrix4(this.m.compose(o.position, o.quaternion, o.scale))
      o = o.parent
    }
    if (o !== parent) {
      // Not a descendant of the node's parent: fall back to world matrices.
      target.getWorldPosition(p)
      if (parent) parent.worldToLocal(p)
    }
    p.sub(node.obj.position).applyQuaternion(this.q.copy(node.quaternion).invert())
    const length = p.length()
    const axis = axisVector(rule.axis)
    const c = rule.axis.replace(/^[+-]/, '').toLowerCase() as 'x' | 'y' | 'z'
    node.obj.quaternion.copy(node.quaternion).multiply(this.q.setFromUnitVectors(axis, p.divideScalar(length || 1)))
    node.obj.scale.set(1, 1, 1)
    node.obj.scale[c] = Math.max(0.01, length / rule.unitLengthM)
  }
}

/**
 * Generic rig driver for phase 2 assets, from the `.meta.json` sidecar:
 * `travelLimits` (translation along / rotation about an axis, relative to the
 * GLB rest pose), `lodNaming` (every LOD has its own copy of a rig node, e.g.
 * `trolley`, `trolley_lod1`, `trolley_lod2`) and `stretch` (a node scaled so it
 * spans to another, e.g. hoist ropes down to the headblock).
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
  axis: 'Y'
  offsetM: number
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

  constructor(root: THREE.Object3D, meta: RigMeta) {
    this.limits = meta.travelLimits ?? {}
    this.suffixes = meta.lodNaming ? Object.entries(meta.lodNaming).filter(([k]) => /^LOD\d$/.test(k)).map(([, s]) => s) : ['']
    const bind = (name: string): Bound[] =>
      this.suffixes
        .map((s) => root.getObjectByName(name + s))
        .filter((o): o is THREE.Object3D => !!o)
        .map((obj) => ({ obj, position: obj.position.clone(), quaternion: obj.quaternion.clone() }))
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
      const length = node.obj.position.y - (to.obj.position.y + rule.offsetM)
      node.obj.scale.y = Math.max(0.01, length / rule.unitLengthM)
    }
  }
}

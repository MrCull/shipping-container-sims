/**
 * 3D picking (TT-18): pure maths over the SceneModel, no Three.js.
 *
 * Every selectable thing has an oriented bounding box (`entityBounds`; also
 * what the selection outline draws). A click ray picks the nearest container
 * it hits; if it hits none, the nearest equipment or vessel box. Containers
 * win because crane and hull boxes enclose the boxes they carry.
 */
import { FENDER_GAP_M } from '../scenario/vesselClasses'
import { ASC, ascHeightM, SHC, STS } from './equipmentDims'
import { CONTAINER_DIMS, type SceneModel, type Vec3 } from './sceneModel'

export interface Ray {
  origin: Vec3
  dir: Vec3
}

/** Centre, full extents (X, Y, Z before yaw) and yaw about Y of a pickable thing. */
export interface EntityBounds extends Vec3 {
  sx: number
  sy: number
  sz: number
  yaw: number
}

const SELECT_MARGIN_M = 0.6

/** The bounding box of a container, SHC, STS or vessel at `time`; null if it is not in the scene. */
export function entityBounds(model: SceneModel, id: string, time: number): EntityBounds | null {
  const size = model.containerSize[id]
  if (size) {
    const pose = model.containerPose(id, time)
    if (!pose) return null
    const d = CONTAINER_DIMS[size]
    return { x: pose.x, y: pose.y, z: pose.z, sx: d.length + SELECT_MARGIN_M, sy: d.height + SELECT_MARGIN_M, sz: d.width + SELECT_MARGIN_M, yaw: pose.yaw }
  }
  if (model.shcIds.includes(id)) {
    const p = model.shcPose(id, time)
    const height = SHC.height + 3
    return { x: p.x, y: height / 2, z: p.z, sx: SHC.length + 1, sy: height, sz: SHC.width + 1, yaw: p.heading === 'z' ? Math.PI / 2 : 0 }
  }
  if (model.ascIds.includes(id)) {
    const height = ascHeightM(model.blockOfAsc(id)) + ASC.girderHeight + 2
    return { x: model.blockOfAsc(id).x, y: height / 2, z: model.ascPose(id, time).z, sx: ASC.span + 6, sy: height, sz: ASC.legLength + 2, yaw: 0 }
  }
  if (model.stsIds.includes(id)) {
    const p = model.stsPose(id, time)
    const height = STS.apexY + 2
    return { x: p.gantryX, y: height / 2, z: STS.waterRailZ + STS.gauge / 2, sx: STS.legSpacingX + 4, sy: height, sz: STS.gauge + 6, yaw: 0 }
  }
  if (model.vesselIds.includes(id)) {
    const centre = model.entityCentre(id, time)
    if (!centre) return null
    const spec = model.vesselSpec(id)
    return { x: centre.x, y: spec.deckHeightM / 2, z: centre.z - FENDER_GAP_M, sx: spec.loaM + 2, sy: spec.deckHeightM + 14, sz: spec.beamM + 2, yaw: 0 }
  }
  return null
}

/** Distance along the ray to the box, or null on a miss (slab test in the box's own frame). */
function rayBox(ray: Ray, b: EntityBounds): number | null {
  const cos = Math.cos(b.yaw)
  const sin = Math.sin(b.yaw)
  // World → box frame: translate, then rotate by -yaw about Y.
  const local = (x: number, z: number): [number, number] => [x * cos - z * sin, x * sin + z * cos]
  const [ox, oz] = local(ray.origin.x - b.x, ray.origin.z - b.z)
  const [dx, dz] = local(ray.dir.x, ray.dir.z)
  const o = [ox, ray.origin.y - b.y, oz]
  const d = [dx, ray.dir.y, dz]
  const half = [b.sx / 2, b.sy / 2, b.sz / 2]
  let near = 0
  let far = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (Math.abs(o[i]) > half[i]) return null
      continue
    }
    let t0 = (-half[i] - o[i]) / d[i]
    let t1 = (half[i] - o[i]) / d[i]
    if (t0 > t1) [t0, t1] = [t1, t0]
    near = Math.max(near, t0)
    far = Math.min(far, t1)
    if (near > far) return null
  }
  return near
}

/** The id under the ray at `time`, or null. */
export function pickEntity(model: SceneModel, time: number, ray: Ray): string | null {
  let best: { id: string; dist: number } | null = null
  for (const id of model.containerIds) {
    const b = entityBounds(model, id, time)
    const dist = b && rayBox(ray, b)
    if (dist !== null && dist !== undefined && (!best || dist < best.dist)) best = { id, dist }
  }
  if (best) return best.id
  for (const id of [...model.shcIds, ...model.ascIds, ...model.stsIds, ...model.vesselIds]) {
    const b = entityBounds(model, id, time)
    const dist = b && rayBox(ray, b)
    if (dist !== null && dist !== undefined && (!best || dist < best.dist)) best = { id, dist }
  }
  return best?.id ?? null
}

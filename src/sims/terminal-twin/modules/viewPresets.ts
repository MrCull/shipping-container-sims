/**
 * V11-05: view presets (Quay, Yard, Landside/Gate, Overview). A preset is a camera pose computed from the layout
 * (quay extent, the yard's bounding box, the gate and stalls, the whole terminal), never fixed coordinates, so it fits
 * every preset and fixture. Pure TS: the scene host turns a pose into camera and orbit-target positions.
 */
import { BAY_PITCH_M, BLOCK_ROWS, ROW_PITCH_M } from '../engine'
import type { SceneModel, Vec3 } from './sceneModel'

export const VIEW_PRESETS = ['quay', 'yard', 'gate', 'overview'] as const
export type ViewPresetName = (typeof VIEW_PRESETS)[number]

export const isViewPreset = (name: string): name is ViewPresetName => (VIEW_PRESETS as readonly string[]).includes(name)

/** A rectangle on the ground (X along the quay, Z away from the water). */
export interface ViewRegion {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface ViewPose {
  /** The layout region the preset names; `target` lies inside it. */
  region: ViewRegion
  /** Where the orbit camera looks. */
  target: Vec3
  /** Camera distance from `target`, chosen so the whole region fits a window of the given aspect. */
  distanceM: number
  /** Unit vector from the target towards the camera. */
  direction: Vec3
}

/** Vertical field of view of the twin's camera (degrees). */
export const CAMERA_FOV_DEG = 45
/** Water side of the quay shown by the Quay view (m). */
const SEA_MARGIN_M = 60
const STS_MARGIN_M = 60
const BLOCK_HALF_WIDTH_M = (BLOCK_ROWS * ROW_PITCH_M) / 2 + 6
const GATE_MARGIN_M = 25
/** Camera direction: from the landward side, 45-ish degrees up. */
const DIRECTION = normalise({ x: 0.3, y: 0.75, z: 0.6 })

function normalise(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

function union(a: ViewRegion | null, b: ViewRegion | null): ViewRegion | null {
  if (!a || !b) return a ?? b
  return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }
}

function quayRegion(model: SceneModel): ViewRegion {
  const length = model.config.quay.lengthM
  const xs = model.config.sts.map((s) => s.gantryX)
  const minX = xs.length ? Math.max(0, Math.min(...xs) - STS_MARGIN_M) : 0
  const maxX = xs.length ? Math.min(length, Math.max(...xs) + STS_MARGIN_M) : length
  const blocks = model.blockList
  const apronZ = blocks.length ? Math.min(...blocks.map((b) => b.wtpZ)) : 40
  return { minX, maxX: Math.max(maxX, minX + 1), minZ: -SEA_MARGIN_M, maxZ: Math.max(apronZ, 20) }
}

function yardRegion(model: SceneModel): ViewRegion | null {
  const blocks = model.blockList
  if (blocks.length === 0) return null
  return {
    minX: Math.min(...blocks.map((b) => b.x)) - BLOCK_HALF_WIDTH_M,
    maxX: Math.max(...blocks.map((b) => b.x)) + BLOCK_HALF_WIDTH_M,
    minZ: Math.min(...blocks.map((b) => b.wtpZ)),
    maxZ: Math.max(...blocks.map((b) => b.firstBayZ + (b.bays - 0.5) * BAY_PITCH_M)),
  }
}

function gateRegion(model: SceneModel): ViewRegion | null {
  const ls = model.landside
  if (!ls) return null
  const xs = [ls.gate.westX, ls.gate.eastX, ls.gate.queueX + 20, ...ls.stalls.map((s) => s.x)]
  const zs = [ls.gate.kioskZ, ls.gate.entryZ, ls.gate.roadInZ, ls.gate.roadOutZ, ...ls.stalls.map((s) => s.z)]
  return {
    minX: Math.min(...xs) - GATE_MARGIN_M,
    maxX: Math.max(...xs) + GATE_MARGIN_M,
    minZ: Math.min(...zs) - GATE_MARGIN_M,
    maxZ: Math.max(...zs) + GATE_MARGIN_M,
  }
}

function poseFor(region: ViewRegion, aspect: number): ViewPose {
  const target = { x: (region.minX + region.maxX) / 2, y: 3, z: (region.minZ + region.maxZ) / 2 }
  const halfW = (region.maxX - region.minX) / 2
  const halfD = (region.maxZ - region.minZ) / 2
  const tan = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360)
  // The width must fit the window's width; the depth, foreshortened by the elevation, its height.
  const fit = Math.max(halfW / (tan * Math.max(aspect, 0.2)), (halfD * DIRECTION.y) / tan, (halfD * 0.5) / tan)
  return { region, target, distanceM: Math.min(3400, Math.max(90, fit * 1.4 + 30)), direction: DIRECTION }
}

/** The pose of a view preset for a scene, or null when its region does not exist (the gate view needs a landside). */
export function viewPresetPose(model: SceneModel, preset: ViewPresetName, aspect = 16 / 9): ViewPose | null {
  const quay = quayRegion(model)
  const yard = yardRegion(model)
  const gate = gateRegion(model)
  const region = preset === 'quay' ? quay : preset === 'yard' ? yard : preset === 'gate' ? gate : union(union(quay, yard), gate)
  return region ? poseFor(region, aspect) : null
}

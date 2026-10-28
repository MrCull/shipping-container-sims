/**
 * Pure rig maths for the ASC GLB (TT-24), no Three.js: sidecar facts, the
 * vertical stretch for blocks taller than the model's design stack, and the
 * conversion from a scene-model pose (gantry Z, trolley X, hoist height) to the
 * values of the rig nodes (`gantry`, `trolley`, `ropes`, `hoist`, `twistlock_*`).
 * Everything is read from `assets/models/asc/asc.meta.json`, nothing is hard-coded.
 */
import { travelHoistM } from '../engine'
import meta from '../assets/models/asc/asc.meta.json'

const node = (name: string) => meta.nodes.find((n) => n.name === name)!
const ropes = node('ropes') as { derived: { topY: number; restLengthM: number; headblockTopAboveAttachM: number } }

/** Sidecar facts the renderer, picking and the viewer need. */
export const ASC_MODEL = {
  spanM: meta.dimensions.spanM,
  lengthM: meta.dimensions.lengthM,
  widthM: meta.dimensions.widthM,
  heightM: meta.dimensions.heightM,
  /** Height of the twist-lock plane above the ground with the hoist raised (hoist = 0). */
  restAttachY: meta.hoist.restAttachM,
  /** Lowest plane: the top of a 40 ft high-cube box standing on the ground. */
  lowestAttachY: meta.hoist.lowestAttachM,
  hoistMinM: meta.travelLimits.hoist.minM,
  hoistMaxM: meta.travelLimits.hoist.maxM,
  trolleyMinM: meta.travelLimits.trolley.minM,
  trolleyMaxM: meta.travelLimits.trolley.maxM,
  spreaderFloatM: meta.travelLimits.spreader.maxM,
  twistLockedRad: (meta.travelLimits.twistlock_fl.maxDeg * Math.PI) / 180,
  ropeTopY: ropes.derived.topY,
  ropeRestLengthM: ropes.derived.restLengthM,
  headblockTopAboveAttachM: ropes.derived.headblockTopAboveAttachM,
  designTiers: meta.stack.designTiers,
  bridgeUnderY: meta.stack.underBridgeM,
  rows: meta.stack.rows,
  rowPitchM: meta.stack.rowPitchM,
  clearSpanM: meta.stack.clearSpanM,
}

/** Standard high-cube height: the engine plans the hoist for a box of at most this height. */
export const HC_HEIGHT_M = 2.896

/**
 * Vertical stretch of the whole model so its raised plane covers the engine's top of travel for a block
 * (`travelHoistM(tiers)` is the box bottom; the plane is a box above it). 1 up to the design stack height (5 tiers).
 */
export function ascScaleY(tiers: number): number {
  return Math.max(1, (travelHoistM({ tiers }) + HC_HEIGHT_M) / ASC_MODEL.restAttachY)
}

export interface AscRigInput {
  /** Trolley offset across the rows from the block centre line (m). */
  trolleyX: number
  /** Gantry position along the block rails (m, engine Z). */
  gantryZ: number
  /** Height of the twist-lock plane above the ground (the top of the carried box, or of where one would be) in world metres. */
  attachY: number
  carrying: boolean
  /** The model's vertical stretch (`ascScaleY`). */
  scaleY: number
}

export interface AscRigValues {
  gantryZ: number
  trolleyX: number
  /** Hoist translation along +Y in model metres (0 raised, negative lowered). */
  hoistM: number
  /** Scale along +Y of the `ropes` node. */
  ropeScale: number
  /** Twist-lock rotation about +Y (0 unlocked, π/2 locked). */
  twistRad: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Rope node scale for a hoist value (model metres). */
export function ropeScaleFor(hoistM: number): number {
  const plane = ASC_MODEL.restAttachY + hoistM
  const length = ASC_MODEL.ropeTopY - (plane + ASC_MODEL.headblockTopAboveAttachM)
  return Math.max(0.01, length / ASC_MODEL.ropeRestLengthM)
}

export function ascRigValues(p: AscRigInput): AscRigValues {
  const hoistM = clamp(p.attachY / p.scaleY - ASC_MODEL.restAttachY, ASC_MODEL.hoistMinM, ASC_MODEL.hoistMaxM)
  return {
    gantryZ: p.gantryZ,
    trolleyX: clamp(p.trolleyX, ASC_MODEL.trolleyMinM, ASC_MODEL.trolleyMaxM),
    hoistM,
    ropeScale: ropeScaleFor(hoistM),
    twistRad: p.carrying ? ASC_MODEL.twistLockedRad : 0,
  }
}

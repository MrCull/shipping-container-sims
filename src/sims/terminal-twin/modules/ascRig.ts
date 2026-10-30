/**
 * Pure rig maths for the ASC GLB (TT-24), no Three.js: sidecar facts, the
 * vertical stretch for blocks taller than the model's design stack, and the
 * conversion from a scene-model pose (gantry Z, trolley X, hoist height) to the
 * values of the rig nodes (`gantry`, `trolley`, `ropes`, `hoist`, `twistlock_*`).
 * Everything is read from `assets/models/asc/asc.meta.json`, nothing is hard-coded.
 */
import { travelHoistM } from '../engine'
import meta from '../assets/models/asc/asc.meta.json'

const ropesNode = meta.nodes.find((n) => n.name === 'ropes') as { pivot: number[] }
/** The sidecar's `stretch` rule for the ropes: they span from the drum pivot down to the head block top (`offsetM` above the attach plane). */
const ropeRule = meta.stretch.find((r) => r.node === 'ropes')!

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
  ropeTopY: ropesNode.pivot[1],
  /** The rope mesh is this long at scale 1 (1 m); the rope node's Y scale is its length in metres. */
  ropeUnitM: ropeRule.unitLengthM,
  headblockTopAboveAttachM: ropeRule.offsetM,
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

/** Rope length (m) from the drums down to the head block top for a hoist value (model metres). */
export function ropeLengthFor(hoistM: number): number {
  const plane = ASC_MODEL.restAttachY + hoistM
  return ASC_MODEL.ropeTopY - (plane + ASC_MODEL.headblockTopAboveAttachM)
}

/** Rope node scale for a hoist value (model metres). */
export function ropeScaleFor(hoistM: number): number {
  return Math.max(0.01, ropeLengthFor(hoistM) / ASC_MODEL.ropeUnitM)
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

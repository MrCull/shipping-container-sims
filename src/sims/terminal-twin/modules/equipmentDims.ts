/** Equipment proportions shared by the renderer and 3D picking (m). */
import { travelHoistM, type BlockSpec } from '../engine'
import { CONTAINER_DIMS } from './sceneModel'

/** [A] Malaccamax-style STS proportions (m); keep apexY in sync with the TT-23 model (sts-malaccamax.meta.json: apex 82 m, over buffers 27 m). */
export const STS = {
  waterRailZ: 3,
  gauge: 30.48,
  legSpacingX: 18,
  legSize: 1.6,
  portalY: 48,
  boomOutreachZ: -72,
  boomBackreachZ: 22,
  apexY: 82,
  /** Boom hinge pin (sts-malaccamax.meta.json `boom` pivot: y 55.6, z -3.2 from the waterside rail). */
  boomHingeY: 55.6,
  boomHingeZ: -0.2,
}

/**
 * The STS box for picking and the selection outline (#301), in the crane's frame (z across the quay, y up): the portal
 * up to just above the apex, grown to the boom tip once the boom is off its working angle (the tip of a boom at 80
 * degrees is about 126 m up and 12.5 m seaward of the hinge). A boom down stays out of the box so the vessel and the
 * boxes under it stay pickable.
 */
export function stsBoundsYZ(boomDeg: number): { y0: number; y1: number; z0: number; z1: number } {
  const y1 = STS.apexY + 1.3
  const z0 = STS.waterRailZ - 3
  const z1 = STS.waterRailZ + STS.gauge + 3
  if (boomDeg <= 0) return { y0: 0, y1, z0, z1 }
  const a = (boomDeg * Math.PI) / 180
  const length = STS.boomHingeZ - STS.boomOutreachZ
  const margin = 2
  const tipY = STS.boomHingeY + length * Math.sin(a) + margin
  const tipZ = STS.boomHingeZ - length * Math.cos(a) - margin
  return { y0: 0, y1: Math.max(y1, tipY), z0: Math.min(z0, tipZ), z1 }
}

/** [A] Shuttle-carrier proportions (m): length along travel, width across, height. */
export const SHC = { length: 9.2, width: 4.9, height: 6.2, leg: 0.6, beam: 0.7 }

/** [A] Procedural-placeholder ASC proportions (m): span between the rails (25.4 m), leg and girder sizes. The GLB's real size is `ASC_MODEL` (ascRig.ts). */
export const ASC = { span: 25.4, legLength: 5, legWidth: 1, girderDepth: 4, girderHeight: 1.4 }

/** Height of an ASC's portal (legs, excluding the girder) for a block. */
export function ascHeightM(block: BlockSpec): number {
  return travelHoistM(block) + CONTAINER_DIMS['40HC'].height + 3
}

/**
 * [A] Haulier truck with a 40 ft skeletal chassis (m). The origin is the centre of the box on the chassis; the cab is ahead
 * (+X in the truck's frame). Length from the trailer's rear to the cab front.
 */
export const TRUCK = {
  rearX: -6.6,
  frontX: 11.2,
  width: 2.55,
  height: 4,
  /** Fifth wheel X (tractor / trailer coupling). */
  couplingX: 5.6,
  wheelRadius: 0.5,
  /** Cab-over tractor: cab box. */
  cabX0: 8.6,
  cabX1: 11.2,
  cabHeight: 3.1,
}

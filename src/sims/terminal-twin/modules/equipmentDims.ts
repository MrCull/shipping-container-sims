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

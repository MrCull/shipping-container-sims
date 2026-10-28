/** Equipment proportions shared by the renderer and 3D picking (m). */
import { travelHoistM, type BlockSpec } from '../engine'
import { CONTAINER_DIMS } from './sceneModel'

/** [A] Malaccamax-style STS proportions (m). */
export const STS = {
  waterRailZ: 3,
  gauge: 30.48,
  legSpacingX: 18,
  legSize: 1.6,
  portalY: 48,
  boomOutreachZ: -72,
  boomBackreachZ: 22,
  apexY: 72,
}

/** [A] Shuttle-carrier proportions (m): length along travel, width across, height. */
export const SHC = { length: 9.2, width: 4.9, height: 6.2, leg: 0.6, beam: 0.7 }

/** [A] ASC proportions (m): span between the rails (25.4 m), leg and girder sizes. */
export const ASC = { span: 25.4, legLength: 5, legWidth: 1, girderDepth: 4, girderHeight: 1.4 }

/** Height of an ASC's portal (legs, excluding the girder) for a block. */
export function ascHeightM(block: BlockSpec): number {
  return travelHoistM(block) + CONTAINER_DIMS['40HC'].height + 3
}

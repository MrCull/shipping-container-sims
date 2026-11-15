/**
 * Hero equipment selection (#273), pure: which spreaders near the camera get the hero model. A kind offers each rig
 * at LOD0 with the distance from the camera to its spreader; at most `cap` are chosen (`QualityProfile.heroEquipment`),
 * nearest first, within `HERO_EQUIPMENT_DISTANCE_M`. Hysteresis (spec #273 step 5): a spreader chosen last frame keeps
 * its place out to 1.15 x that distance, also against a nearer newcomer when the cap is full, so a model does not swap
 * back and forth at the edge or when two spreaders are about equally near. Newcomers get only the free places.
 */
import { HERO_HYSTERESIS } from './heroFaceSelection'

/** Beyond this camera distance (m) to the spreader centre a spreader never gets the hero model (a spreader is 12 m long). */
export const HERO_EQUIPMENT_DISTANCE_M = 25
/** A chosen spreader keeps its place out to the distance times this factor (the hero faces' factor). */
export const HERO_EQUIPMENT_HYSTERESIS = HERO_HYSTERESIS

export interface HeroEquipmentCandidate {
  /** Stable equipment id. */
  id: string
  /** Distance (m) from the camera to the spreader centre. */
  distanceM: number
}

/** The ids to draw with the hero model this frame, nearest first; `previous` is last frame's result. */
export function selectHeroEquipment(candidates: readonly HeroEquipmentCandidate[], cap: number, previous: ReadonlySet<string>): string[] {
  if (cap <= 0) return []
  const byDistance = (a: HeroEquipmentCandidate, b: HeroEquipmentCandidate): number => a.distanceM - b.distanceM
  const sticky = HERO_EQUIPMENT_DISTANCE_M * HERO_EQUIPMENT_HYSTERESIS
  const chosen = candidates.filter((c) => previous.has(c.id) && c.distanceM <= sticky).sort(byDistance)
  if (chosen.length > cap) chosen.length = cap
  if (chosen.length < cap) {
    const fresh = candidates.filter((c) => !previous.has(c.id) && c.distanceM <= HERO_EQUIPMENT_DISTANCE_M).sort(byDistance)
    for (let i = 0; i < fresh.length && chosen.length < cap; i++) chosen.push(fresh[i])
  }
  return chosen.sort(byDistance).map((c) => c.id)
}

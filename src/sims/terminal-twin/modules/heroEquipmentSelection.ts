/**
 * Hero equipment selection (#273), pure: which spreaders near the camera get the hero model. A kind offers each rig
 * at LOD0 with the distance from the camera to its spreader; at most `cap` are chosen (`QualityProfile.heroEquipment`),
 * nearest first, within `HERO_EQUIPMENT_DISTANCE_M`. Hysteresis as for hero faces (`closeupFaceBudget.ts`): a spreader
 * chosen last frame keeps its place out to 1.15 x the cut (the cap-th nearest distance, at most the distance limit),
 * so a model does not swap back and forth at the edge or when two spreaders are about equally near.
 */
import { HERO_HYSTERESIS } from './heroFaceSelection'

/** Beyond this camera distance (m) to the spreader centre a spreader never gets the hero model (a spreader is 12 m long). */
export const HERO_EQUIPMENT_DISTANCE_M = 25
/** A chosen spreader stays out to the cut times this factor (the hero faces' factor). */
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
  const max = HERO_EQUIPMENT_DISTANCE_M
  const fresh = candidates.filter((c) => c.distanceM <= max).sort((a, b) => a.distanceM - b.distanceM)
  // The cut: the cap-th nearest spreader inside the distance, else the distance itself.
  const cut = fresh.length >= cap ? fresh[cap - 1].distanceM : max
  const sticky = cut * HERO_EQUIPMENT_HYSTERESIS
  const kept = candidates.filter((c) => previous.has(c.id) && c.distanceM <= sticky).sort((a, b) => a.distanceM - b.distanceM)
  const chosen = kept.slice(0, cap)
  const taken = new Set(chosen.map((c) => c.id))
  for (const c of fresh) {
    if (chosen.length >= cap) break
    if (!taken.has(c.id)) chosen.push(c)
  }
  return chosen.sort((a, b) => a.distanceM - b.distanceM).map((c) => c.id)
}

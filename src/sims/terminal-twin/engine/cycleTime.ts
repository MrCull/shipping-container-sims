/**
 * Nominal cycle times (TT-15): the setup dialog's live kinematics readout.
 * Pure, from the kinematics profiles and a nominal geometry, with no variation
 * and no waiting. Moves per hour = 3600 / cycle. The STS figure is checked
 * against the engine's measured average in a single-crane fixture
 * (`tests/cycle-readout.test.ts`).
 */
import type { AscKinematics, ScenarioConfig, ShcKinematics, StsKinematics } from '../scenario/types'
import { CONTAINER_HEIGHT_M, slotZ, tierBaseY, vesselClass } from '../scenario/vesselClasses'
import { travelTime } from './kinematics'

export interface CycleReadout {
  /** Seconds for one nominal cycle. */
  cycleS: number
  /** Cycles per hour at that rate. */
  perHour: number
}

const readout = (cycleS: number): CycleReadout => ({ cycleS, perHour: cycleS > 0 ? 3600 / cycleS : 0 })

/** Where an STS cycle picks: trolley travel between the vessel slot and the ground lane, and the slot's height. */
export interface StsCycleGeometry {
  trolleyM: number
  /** Hoist coordinate when the spreader holds a box in the slot (m). */
  pickHeightM: number
}

/** Nominal geometry: the middle row of the first vessel's class, at a tier midway between the hold's bottom and the deck's top. */
export function stsCycleGeometry(config: ScenarioConfig): StsCycleGeometry {
  const spec = vesselClass(config.vessels[0]?.sizeClass ?? 'panamax')
  const row = Math.floor(spec.rows / 2)
  const tier = Math.floor((spec.holdTiers + spec.deckTiers) / 2)
  return {
    trolleyM: Math.abs(config.layout.stsGroundLaneZ0M - slotZ(spec, row)),
    pickHeightM: tierBaseY(spec, tier) + CONTAINER_HEIGHT_M['40HC'],
  }
}

/**
 * A discharge cycle of one box in the same bay: lock, lift to the safe height, carry to the ground lane,
 * lower, unlock, raise empty, travel back and lower onto the next box.
 */
export function stsNominalCycle(k: StsKinematics, safeHoistM: number, geo: StsCycleGeometry): CycleReadout {
  const groundH = CONTAINER_HEIGHT_M['40HC']
  const s =
    k.lockS +
    k.unlockS +
    travelTime(safeHoistM - geo.pickHeightM, k.hoistLoaded) +
    travelTime(safeHoistM - groundH, k.hoistLoaded) +
    travelTime(safeHoistM - groundH, k.hoistEmpty) +
    travelTime(safeHoistM - geo.pickHeightM, k.hoistEmpty) +
    2 * travelTime(geo.trolleyM, k.trolley)
  return readout(s)
}

/** SHC: a nominal empty and a loaded run of `distanceM`, lift and lower, lock and unlock. */
export function shcNominalCycle(k: ShcKinematics, distanceM = 300): CycleReadout {
  return readout(
    travelTime(distanceM, k.driveEmpty) + travelTime(distanceM, k.driveLoaded) + 2 * travelTime(k.liftHeightM, k.lift) + k.lockS + k.unlockS,
  )
}

/** ASC: pad to slot and back (40 m along the block, 12 m across, a stack 8.7 m deep) with lock and unlock. */
export function ascNominalCycle(k: AscKinematics, alongM = 40, acrossM = 12, liftM = 8.7): CycleReadout {
  return readout(
    2 * Math.max(travelTime(alongM, k.gantry), travelTime(acrossM, k.trolley)) +
      2 * travelTime(liftM, k.hoistEmpty) +
      2 * travelTime(liftM, k.hoistLoaded) +
      k.lockS +
      k.unlockS,
  )
}

/** True when every axis of the profile can move (positive speed, acceleration and deceleration). */
export const profileValid = (p: { vMax: number; accel: number; decel: number }): boolean => p.vMax > 0 && p.accel > 0 && p.decel > 0

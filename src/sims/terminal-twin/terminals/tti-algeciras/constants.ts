/**
 * TTI Algeciras constants: preset names, the capacity-derived yard layout, assumptions of the TTI presets and the
 * figures of its scenery. No THREE here: the engine and the CLI import this file.
 */
import type { FlowMix, PortRotation } from '../../scenario/types'

export const TTI_PRESET_NAME = 'TTI Algeciras baseline'
export const PEAK_DAY_PRESET_NAME = 'TTI Algeciras — peak day'

/** TTI Algeciras' published capacity (TEU): the source of the bay count. */
export const TTI_YARD_TEU = 28647
export const TTI_BLOCKS = 16
export const TTI_ROWS = 8
export const TTI_TIERS = 5
/**
 * [A] 20 ft bays per block: derived from the published 28,647 TEU capacity (16 blocks x 8 rows x 5 tiers
 * x bays), rounded. The block layout itself is not published, so the UI marks this as an assumption.
 */
export const TTI_BAYS = Math.round(TTI_YARD_TEU / (TTI_BLOCKS * TTI_ROWS * TTI_TIERS))

/**
 * [A] unverified (R19): TTI's real reefer share and plug layout are not public. 8% of the full boxes are reefers and
 * rows 1-2 of every block are powered (the first two of the 8 rows across the ASC span).
 */
export const TTI_REEFERS = { share: 0.08, poweredRows: [1, 2] }

/**
 * [A] unverified (spec #106): the peak-day service rotation, an Asia - Mediterranean loop (UN/LOCODEs: Shanghai, Singapore,
 * Algeciras, Tanger Med, Valencia, Fos-sur-Mer, Genoa). TTI's real services and call order are not public.
 */
export const PEAK_DAY_ROTATION: PortRotation = { terminal: 'ESALG', ports: ['CNSHA', 'SGSIN', 'ESALG', 'MAPTM', 'ESVLC', 'FRFOS', 'ITGOA'] }
/** [A] unverified: a peak day at a hub is even more transshipment-heavy than the baseline (89% of moves). */
export const PEAK_DAY_FLOW_MIX: FlowMix = { import: 6, export: 5, transshipment: 89 }
/** [A] unverified: 30% of every vessel's bays carries boxes for later ports, 70% full. */
export const PEAK_DAY_ROB = { bayFraction: 0.3, fill: 0.7 }

/** Length of TTI's North Quay (m): [V] from the reference pack; shown idle. */
export const NORTH_QUAY_LENGTH_M = 550

/**
 * The Rock of Gibraltar across the bay, true scale (scene axes: +x = south along the quay, water towards -z = east).
 * [V] about 5.2 km north to south, about 1.2 km wide, 426 m high; about 9 km east of TTI (the reference map reads
 * 9 to 9.5 km from the quay to the Rock's centre, with the Rock's centre a little south of the terminal's).
 * The GLB generator (`assets/generators/tt_assets/infrastructure.py`, `build_backdrop_rock`) repeats this profile:
 * change both together.
 */
export const ROCK = {
  lengthM: 5200,
  widthM: 1200,
  heightM: 426,
  /** Distance east of the quay line to the Rock's centre (m). */
  distanceM: 9200,
  /** Offset of the Rock's centre south of the quay's middle (m). */
  offsetSouthM: 600,
  /**
   * Crest height (m) along the Rock from its north end (x = -2600) to Europa Point (x = 2600): the steep north face, the
   * 426 m summit ridge, the stepped fall to the southern plateau.
   */
  profile: [
    [-2600, 0], [-2570, 70], [-2500, 250], [-2420, 370], [-2250, 420], [-1900, 426], [-1400, 405], [-900, 392], [-300, 415],
    [300, 330], [800, 255], [1200, 185], [1500, 110], [1800, 62], [2300, 48], [2480, 38], [2600, 0],
  ] as [number, number][],
}

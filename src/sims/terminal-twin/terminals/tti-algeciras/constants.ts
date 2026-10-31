/**
 * TTI Algeciras constants: preset names, the capacity-derived yard layout, assumptions of the TTI presets and the
 * figures of its scenery. No THREE here: the engine and the CLI import this file.
 */
import type { FlowMix, PortRotation } from '../../scenario/types'

export const TTI_PRESET_NAME = 'TTI Algeciras baseline'
export const PEAK_DAY_PRESET_NAME = 'TTI Algeciras, peak day'

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
 * Spec #134, ticket #147: the ground around TTI, from the aerial photo (`docs/reference/tti-algeciras/`). Scene axes:
 * +x south along the quay, -x north, water towards -z. Scenery only (no engine effect): the North Quay is the terminal's
 * north apron, facing a channel of sea, and the ground north of it runs grey, then green into hills. [V] layout from the
 * photo, [A] the metre figures (the ticket's "about 200 m of sea, about 300 m of grey ground").
 */
export const TTI_GROUND = {
  /** The North Quay's water edge, metres north of the terminal's north end (x = -this). */
  northQuayEdgeM: 70,
  /** Depth of the North Quay slab (m, along x). */
  northQuayDepthM: 70,
  /** Landward start of the quay along the terminal's width (z, m): the 550 m quay sits inside the 900 m apron. */
  northQuayStartZ: 175,
  /** Width of the sea channel north of the quay (m). */
  seaChannelM: 200,
  /** The shared apron (`sceneRenderer.addGround`) ends this far north of the terminal (m): the grey ground ends here, the green starts. */
  greenStartM: 600,
  /** The grey tarmac south of the terminal runs this far past the apron (m). */
  southTarmacM: 2400,
  /** Same grey as the shared apron. */
  tarmacColour: '#9a9c9a',
  seaColour: '#2d5873',
  greenColour: '#5f7a45',
  hillColour: '#4a6339',
}

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

/**
 * The surroundings beyond the Rock and the hills (spec #116, ticket #123): one merged GLB per piece, one draw call each.
 * `assets` and the budget repeat `groups['tti-surroundings']` in `assets/budgets.json` (checked by
 * `pnpm run tt:assets:check` and `tests/surroundings.test.ts`): change both together. The generator
 * (`assets/generators/tt_assets/infrastructure.py`, `build_scenery_*`) builds each asset around the origin placed here.
 * Scene axes: +x south along the quay, +z landward, water towards -z. Positions are relative to the quay's middle (x),
 * the quay line (z) and y = 0 at the terminal apron; the shore and anchorage stand in the water (y = -2.5).
 */
export const SURROUNDINGS = {
  assets: ['scenery-shore', 'scenery-anchorage', 'scenery-tanks', 'scenery-landside', 'scenery-town'] as const,
  maxTriangles: 8000,
  maxDrawCalls: 5,
  /** [V] Gibraltar and La Linea share the Rock's bearing and distance; the shore asset is centred on the Rock. */
  shore: { x: ROCK.offsetSouthM, y: -2.5, z: -ROCK.distanceM },
  /** [A] the anchorage: a handful of ships in the bay, clear of the berth approach (1.5 km out and more). */
  anchorage: { x: 0, y: -2.5, z: -4200 },
  /** [V] the tank farm beside the road at the terminal's south-west corner (the terminal's yard ends near z = 500). */
  tanks: { x: 900, y: 0, z: 780 },
  /**
   * [V] the Isla Verde road and rail run along the landside, parallel to the quay, beyond the gate and parking. Spec #134,
   * ticket #146: z = 690 puts the road clear of a 12-truck gate queue (the queue ends at z = 646); its carriageway, centred
   * 10 m nearer the quay than this origin, is the access road the trucks drive (`TTI_ACCESS_ROAD`).
   */
  landside: { x: 0, y: 0, z: 690 },
  /** [A] Algeciras rises inland beyond the apron (which ends at z = 900). */
  town: { x: 0, y: -1.2, z: 1000 },
}

/**
 * Spec #134, ticket #146: the access road of the engine's landside graph. The trucks come up from the south along the
 * Isla Verde carriageway (the scenery's `landside` part, whose carriageway centre lies 10 m nearer the quay than its
 * origin) and turn right (east, towards the water) into the terminal road at the gate; the far end of the terminal road
 * is a teardrop loop. No THREE here: the engine reads this through the TTI presets.
 */
export const TTI_ACCESS_ROAD_Z = SURROUNDINGS.landside.z - 10
/** [A] The trucks enter the access road this far south of the quay's south end (m): well inside the fog, outside the terminal. */
export const TTI_ACCESS_ROAD_RUNUP_M = 100

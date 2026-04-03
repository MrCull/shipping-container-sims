// ---------------------------------------------------------------------------
// Box Empire — Configuration constants
// ---------------------------------------------------------------------------

import type { Position, Position3D } from '../types'

// ---- Simulation -----------------------------------------------------------

export const SIM_TICK_RATE = 20
export const SIM_TICK_INTERVAL = 1 / SIM_TICK_RATE
export const MAX_TIME_SCALE = 100
export const DEFAULT_TIME_SCALE = 1
export const MAX_TICKS_PER_FRAME_NORMAL = 20
export const MAX_TICKS_PER_FRAME_FAST = 200

// ---- Container dimensions (20ft) -----------------------------------------

export const CONTAINER_LENGTH = 6.06
export const CONTAINER_WIDTH = 2.44
export const CONTAINER_HEIGHT = 2.59
export const CONTAINER_TARE_KG = 2200
export const CONTAINER_MAX_GROSS_KG = 30480
export const CONTAINER_MIN_WEIGHT_KG = 10000
export const CONTAINER_MAX_WEIGHT_KG = 25000
export const CONTAINER_STACK_GAP_Y = 0.05
export const CONTAINER_ROW_GAP = 0.30
export const CONTAINER_BAY_GAP = 0.15

export const SHIPPING_LINE_COLORS: Record<string, string> = {
  maersk: '#2E86C1',
  evergreen: '#006747',
  cosco: '#004B87',
  msc: '#FFD700',
  cma_cgm: '#003DA5',
  hapag_lloyd: '#FF6600',
  one: '#CC00CC',
  hmm: '#00BFFF',
}

export const SHIPPING_LINES = Object.keys(SHIPPING_LINE_COLORS)

export const CONTAINER_COLORS: Record<string, string> = SHIPPING_LINE_COLORS

export const CONTAINER_COLOR_LIST = Object.values(SHIPPING_LINE_COLORS)

// ---- Reach Stacker --------------------------------------------------------

export const RS_SPEED_UNLADEN = 5
export const RS_SPEED_LADEN = 4
export const RS_PICK_CYCLE_TIME = 8
export const RS_PLACE_CYCLE_TIME = 8
export const RS_MAX_STACK_HEIGHT = 3
export const RS_LENGTH = 9.5
export const RS_YARD_PARK_OFFSET = 5.5
export const RS_TRUCK_PARK_OFFSET = 8
export const RS_TRUCK_STANDOFF_MULTIPLIER = 1.5

// ---- Mobile Harbor Crane --------------------------------------------------

export const MHC_CYCLE_TIME = 45
export const MHC_REACH = 1

// ---- Truck ----------------------------------------------------------------

export const TRUCK_SPEED = 8
export const GATE_PROCESSING_TIME = 15
export const TRUCK_CAPACITY = 1

// ---- Vessel (Tutorial "Tiny Feeder") --------------------------------------

export const TUTORIAL_VESSEL = {
  name: 'Tiny Feeder',
  loa: 50,
  beam: 12,
  teuCapacity: 10,
  bays: 5,   // 5 container positions spread along the deck (X axis)
  rows: 1,
  tiers: 1,  // single tier on deck
}

// ---- Yard (Tutorial) ------------------------------------------------------

export const TUTORIAL_YARD = {
  id: 'yard-a',
  bays: 10,
  rows: 1,
  maxTier: 3,
}

// ---- Economy --------------------------------------------------------------

export const GATE_OUT_REVENUE = 100
export const VESSEL_LOAD_REVENUE = 150
export const REACH_STACKER_MOVE_COST = 20

// ---- Tutorial scenario ----------------------------------------------------

export const TUTORIAL_EXPORT_COUNT = 5
export const TUTORIAL_IMPORT_COUNT = 5

// ---- Terminal layout positions (meters) -----------------------------------

// Terminal boundary fence — moved back 5m so trucks clear it before entering
export const TERMINAL_FENCE_Z = 63

// In-gate: queue lane runs parallel to the fence (along X), offset to one side of the gatehouse
// Trucks queue along +Z OUTSIDE terminal, lane at x=-44 (beside gatehouse at x=-50)
export const GATE_INGATE_POSITION: Position3D = { x: -44, y: 0, z: TERMINAL_FENCE_Z }
// Queue lane X for trucks waiting (parallel to fence, beside gatehouse)
export const GATE_INGATE_LANE_X = -44

// Out-gate: right-hand fence (mirror of in-gate on the left), landside along +Z
export const GATE_OUTGATE_POSITION: Position3D = { x: 50, y: 0, z: 105 }
// Trucks queue / hold along this Z before the boom (same as gate z)
export const GATE_OUTGATE_FENCE_Z = 105

// Legacy aliases
export const GATE_POSITION: Position3D = { x: -44, y: 0, z: TERMINAL_FENCE_Z }
export const GATE_EXPORT_LANE_POSITION: Position3D = { x: -44, y: 0, z: TERMINAL_FENCE_Z }
export const GATE_IMPORT_LANE_POSITION: Position3D = { x: -44, y: 0, z: TERMINAL_FENCE_Z }

export const YARD_BLOCK_POSITION: Position = { x: -15, z: 20 }
const YARD_TRUCK_STANDOFF = RS_LENGTH * RS_TRUCK_STANDOFF_MULTIPLIER

// Yard truck stand where road trucks wait for RS service, kept well clear of the stack face.
export const YARD_TRUCK_PARK_POSITION: Position3D = {
  x: 0,
  y: 0,
  z: YARD_BLOCK_POSITION.z + YARD_TRUCK_STANDOFF,
}
// Legacy aliases kept while Box Empire still refers to Yard I/O in some UI/docs.
export const YARD_IO_POSITION: Position3D = { ...YARD_TRUCK_PARK_POSITION, y: CONTAINER_HEIGHT / 2 }
export const YARD_IO_WAIT_POSITION: Position3D = { x: -10, y: 0, z: YARD_TRUCK_PARK_POSITION.z }
export const QUAY_BUFFER_POSITION: Position3D = { x: 0, y: CONTAINER_HEIGHT / 2, z: 3 }
export const QUAY_BUFFER_DISCHARGE_POSITION: Position3D = { x: -5, y: CONTAINER_HEIGHT / 2, z: 3 }
export const QUAY_BUFFER_LOAD_POSITION: Position3D = { x: 5, y: CONTAINER_HEIGHT / 2, z: 3 }
// Vessel berth further out to sea so ship doesn't overlap quay
export const BERTH_POSITION: Position3D = { x: 0, y: 0, z: -11.5 }
export const CRANE_POSITION: Position3D = { x: 0, y: 0, z: 0 }

export const TERMINAL_BOUNDS = {
  minX: -60,
  maxX: 60,
  minZ: -60,  // more sea visible
  maxZ: 145,
}

// ── GLB model transforms ────────────────────────────────────────────────────

export const TRUCK_GLB = {
  /** Target height in game meters; uniform scale = targetHeight / measuredHeight */
  targetHeight: 4.5,
  /** rotation.y to face +Z when headingY = 0. (90° base + 225° correction = 315°) */
  rotationY: 7 * Math.PI / 4,
  /** Container deck height (Y) above ground for GLB truck */
  containerOffsetY: 1.4,
  /** Container Z offset relative to truck group origin — 2m further back from cab */
  containerOffsetZ: -4.0,
} as const

// World position of the container when the truck is parked at the yard truck stand facing -Z (heading π).
export const YARD_TRUCK_CONTAINER_POSITION: Position3D = {
  x: YARD_TRUCK_PARK_POSITION.x,
  y: CONTAINER_HEIGHT / 2,
  z: YARD_TRUCK_PARK_POSITION.z + Math.abs(TRUCK_GLB.containerOffsetZ),
}
export const YARD_IO_CONTAINER_POSITION: Position3D = { ...YARD_TRUCK_CONTAINER_POSITION }

export const VESSEL_GLB = {
  /** rotation.y to align GLB (length along Z) → game X-axis (length along X) */
  rotationY: Math.PI / 2,
  /** Vertical shift so GLB waterline sits correctly at sea level */
  yOffset: 5,
  /**
   * Y position of container bottom in vessel local space for GLB ship.
   * Tune to sit containers flush on the visible GLB deck.
   */
  containerDeckY: 1.8,
  /** Z row-spacing for deck containers (across ship width) */
  rowSpacing: 3.0,
} as const

// ---- Sound events ---------------------------------------------------------

export const SOUND_MAP: Record<string, string> = {
  'container.placed': 'container-loaded-to-ship.mp3',
  'vessel.container.lifted': 'container-loaded-to-ship.mp3',
  'vessel.container.placed': 'container-set-down-on-ship.mp3',
  'money.earned': 'money-increase-ca-ching-.mp3',
  'money.spent': 'coin-drop-1-second.mp3',
  // Horn plays only once when vessel first appears (arriving state)
  'vessel.arriving': 'small-ship-three-horns-in-a-row.mp3',
  // Departure horn plays immediately when vessel starts leaving (departing state)
  'vessel.departing': 'small-ship-three-horns-in-a-row.mp3',
  'tutorial.completed': 'group-yay-cheer.mp3',
  'level.up': 'level-up.mp3',
}

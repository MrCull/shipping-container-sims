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

// ---- Mobile Harbor Crane --------------------------------------------------

export const MHC_CYCLE_TIME = 90
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

// ---- Tutorial scenario ----------------------------------------------------

export const TUTORIAL_EXPORT_COUNT = 5
export const TUTORIAL_IMPORT_COUNT = 5

// ---- Terminal layout positions (meters) -----------------------------------

// Terminal boundary fence
export const TERMINAL_FENCE_Z = 55  // z position of the terminal boundary fence

// In-gate: ALL trucks enter here (outside terminal, z > TERMINAL_FENCE_Z)
// Trucks queue along +Z from the gate
export const GATE_INGATE_POSITION: Position3D = { x: -46, y: 0, z: TERMINAL_FENCE_Z }

// Out-gate: ALL trucks exit here (bottom of terminal, z ~ TERMINAL_BOUNDS.maxZ - 5)
// Positioned far from in-gate so trucks flow through terminal naturally
// Trucks queue inside terminal before passing out
export const GATE_OUTGATE_POSITION: Position3D = { x: -46, y: 0, z: 90 }

// Legacy aliases used in sceneBuilder (kept for compat)
export const GATE_POSITION: Position3D = { x: -46, y: 0, z: TERMINAL_FENCE_Z }
export const GATE_EXPORT_LANE_POSITION: Position3D = { x: -46, y: 0, z: TERMINAL_FENCE_Z }
export const GATE_IMPORT_LANE_POSITION: Position3D = { x: -46, y: 0, z: TERMINAL_FENCE_Z }

// Yard handover point where trucks park and equipment loads/unloads
export const YARD_IO_POSITION: Position3D = { x: 0, y: 0, z: 30 }
// Waiting position trucks go to while holding before YARD_IO becomes free
export const YARD_IO_WAIT_POSITION: Position3D = { x: -10, y: 0, z: 30 }
export const YARD_BLOCK_POSITION: Position = { x: -15, z: 20 }
export const QUAY_BUFFER_POSITION: Position3D = { x: 0, y: 0, z: 3 }
export const QUAY_BUFFER_DISCHARGE_POSITION: Position3D = { x: -5, y: 0, z: 3 }
export const QUAY_BUFFER_LOAD_POSITION: Position3D = { x: 5, y: 0, z: 3 }
export const BERTH_POSITION: Position3D = { x: 0, y: 0, z: -8 }
export const CRANE_POSITION: Position3D = { x: 0, y: 0, z: 0 }

export const TERMINAL_BOUNDS = {
  minX: -60,
  maxX: 60,
  minZ: -30,
  maxZ: 120,
}

// ---- Sound events ---------------------------------------------------------

export const SOUND_MAP: Record<string, string> = {
  'container.placed': 'container-loaded-to-ship.mp3',
  'money.earned': 'money-increase-ca-ching-.mp3',
  // Horn plays only once when vessel first appears (arriving state)
  'vessel.arriving': 'small-ship-three-horns-in-a-row.mp3',
  // Departure horn plays immediately when vessel starts leaving (departing state)
  'vessel.departing': 'small-ship-three-horns-in-a-row.mp3',
  'tutorial.completed': 'group-yay-cheer.mp3',
  'level.up': 'level-up.mp3',
}

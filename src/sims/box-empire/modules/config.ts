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
  bays: 1,
  rows: 1,
  tiers: 5,
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

export const GATE_POSITION: Position3D = { x: -40, y: 0, z: 50 }
export const GATE_EXPORT_LANE_POSITION: Position3D = { x: -43, y: 0, z: 50 }
export const GATE_IMPORT_LANE_POSITION: Position3D = { x: -37, y: 0, z: 50 }
export const YARD_IO_POSITION: Position3D = { x: 0, y: 0, z: 30 }
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
  'vessel.arrived': 'small-ship-three-horns-in-a-row.mp3',
  'vessel.departed': 'small-ship-three-horns-in-a-row.mp3',
  'tutorial.completed': 'group-yay-cheer.mp3',
  'level.up': 'level-up.mp3',
}

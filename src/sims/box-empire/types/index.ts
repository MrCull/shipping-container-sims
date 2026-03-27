// ---------------------------------------------------------------------------
// Box Empire — Type definitions
// ---------------------------------------------------------------------------

// ---- Coordinate / Location ------------------------------------------------

export interface Position {
  x: number
  z: number
}

export interface Position3D {
  x: number
  y: number
  z: number
}

export type LocationType =
  | 'gate_buffer'
  | 'yard_slot'
  | 'quay_buffer'
  | 'vessel_slot'
  | 'truck'
  | 'equipment'

export interface Location {
  type: LocationType
  id: string           // human-readable canonical ID (see locationId helpers in gameStore)
  position: Position3D
}

// ---- Location ID helpers ---------------------------------------------------
// Canonical ID formats (used in Job, Location.id, and JobQueueWidget labels):
//   yard slot  →  "{blockId}-{bay:02}-{row:02}-{tier:02}"   e.g. "yard-a-01-01-01"
//   vessel slot → "{vesselId}-{bay:02}-{row:02}-{tier:02}"   e.g. "vessel-1-01-01-03"
//   quay buf   →  "quay-discharge" | "quay-load"
//   truck      →  truck.id
//   gate       →  "gate-export" | "gate-import"
//   equipment  →  equipment.id

export function makeYardSlotId(blockId: string, bay: number, row: number, tier: number): string {
  return `${blockId}-${String(bay).padStart(2, '0')}-${String(row).padStart(2, '0')}-${String(tier).padStart(2, '0')}`
}

export function makeVesselSlotId(vesselId: string, bay: number, row: number, tier: number): string {
  return `${vesselId}-${String(bay).padStart(2, '0')}-${String(row).padStart(2, '0')}-${String(tier).padStart(2, '0')}`
}

export function parseYardSlotId(id: string): { blockId: string; bay: number; row: number; tier: number } | null {
  // Format: "yard-a-01-01-01"  (block id can contain hyphens, last 3 segments are numbers)
  const parts = id.split('-')
  if (parts.length < 5) return null
  const tier = parseInt(parts[parts.length - 1])
  const row = parseInt(parts[parts.length - 2])
  const bay = parseInt(parts[parts.length - 3])
  const blockId = parts.slice(0, parts.length - 3).join('-')
  if (isNaN(bay) || isNaN(row) || isNaN(tier)) return null
  return { blockId, bay, row, tier }
}

// ---- Container ------------------------------------------------------------

export type ContainerSize = '20ft'

export type ContainerLifecycleState =
  | 'on_vessel'
  | 'discharged_to_buffer'
  | 'in_yard'
  | 'staged_for_loading'
  | 'loaded_on_vessel'
  | 'at_gate'
  | 'returning_to_gate'  // import container on truck heading to gate-out
  | 'departed'

export interface Container {
  id: string
  size: ContainerSize
  ownerColor: string
  weight: number
  lifecycleState: ContainerLifecycleState
  visitType: 'import' | 'export'
  currentLocation: Location
  yardSlot: YardSlotRef | null
  vesselSlot: VesselSlotRef | null
  shippingLine: string
  arrivedAt: number       // sim time when container first became active (gate-in or vessel arrival)
  revenueEarned: number   // cumulative revenue credited against this container
}

export interface YardSlotRef {
  blockId: string
  bay: number
  row: number
  tier: number
}

export interface VesselSlotRef {
  vesselId: string
  bay: number
  row: number
  tier: number
}

// ---- Yard -----------------------------------------------------------------

export interface YardBlock {
  id: string
  type: 'mixed'
  bays: number
  rows: number
  maxTier: number
  slots: YardSlot[]
  position: Position
}

export interface YardSlot {
  blockId: string
  bay: number
  row: number
  tier: number
  containerId: string | null
}

// ---- Vessel ---------------------------------------------------------------

export type VesselVisitState =
  | 'announced'
  | 'arriving'
  | 'arrived'
  | 'discharging'
  | 'loading'
  | 'departing'
  | 'departed'

export interface VesselVisit {
  id: string
  name: string
  loa: number
  beam: number
  teuCapacity: number
  state: VesselVisitState
  slots: VesselSlot[]
  position: Position3D
  arrivalTime: number
  hornPlayed: boolean   // ensures horn fires exactly once when 'arriving' begins
}

export interface VesselSlot {
  vesselId: string
  bay: number
  row: number
  tier: number
  containerId: string | null
}

// ---- Truck ----------------------------------------------------------------

export type TruckVisitState =
  | 'approaching'
  | 'at_gate'
  | 'driving_to_yard'
  | 'waiting_for_equipment'
  | 'returning_to_gate'   // import truck loaded with container, driving back to gate-out lane
  | 'at_gate_out'         // import truck processing gate-out
  | 'departing'
  | 'departed'

export interface TruckVisit {
  id: string
  state: TruckVisitState
  containerId: string | null
  visitType: 'import_pickup' | 'export_delivery'
  position: Position3D
  targetPosition: Position3D | null
  stateStartTime: number
  queueIndex: number       // stable queue slot so trucks hold fixed positions without jitter
  waypoints: Position3D[]  // axis-aligned movement waypoints
  waypointIndex: number    // current waypoint being navigated to
  headingY: number         // current Y rotation in radians (updated by truckManager)
}

// ---- Equipment ------------------------------------------------------------

export type EquipmentType = 'reach_stacker' | 'mobile_harbor_crane'

export type EquipmentState =
  | 'idle'
  | 'assigned'
  | 'travel_to_pickup'
  | 'picking'
  | 'travel_to_drop'
  | 'dropping'

export type CraneMode = 'discharge' | 'load' | 'both'

export interface Equipment {
  id: string
  type: EquipmentType
  state: EquipmentState
  position: Position3D
  currentJobId: string | null
  carriedContainerId: string | null
  stateStartTime: number
  stateElapsed: number
  targetPosition: Position3D | null
  speed: number
  enabled: boolean
  craneMode: CraneMode
  armTargetY: number       // current spreader/boom tip height (world Y)
  armDropStartY: number    // armTargetY at the start of the drop phase (for lerp from)
  spreaderZ: number        // lateral position of MHC spreader along jib (+Z=quay, -Z=vessel)
}

// ---- Jobs -----------------------------------------------------------------

export type JobStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'cancelled'

export interface Job {
  id: string
  status: JobStatus
  containerId: string
  pickupLocation: Location
  dropoffLocation: Location
  assignedEquipmentId: string | null
  priority: number
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  equipmentType: EquipmentType
}

// ---- Economy --------------------------------------------------------------

export type TransactionType = 'gate_out_revenue' | 'vessel_load_revenue'

export interface Transaction {
  id: string
  type: TransactionType
  amount: number
  containerId: string
  simTime: number
}

// ---- Events ---------------------------------------------------------------

export type GameEventType =
  | 'container.placed'
  | 'container.picked'
  | 'money.earned'
  | 'vessel.announced'
  | 'vessel.arriving'
  | 'vessel.arrived'
  | 'vessel.departing'
  | 'vessel.departed'
  | 'truck.arrived'
  | 'truck.departed'
  | 'gate.opened'
  | 'gate.closed'
  | 'tutorial.completed'
  | 'level.up'
  | 'job.created'
  | 'job.completed'
  | 'equipment.idle'

export interface GameEvent {
  id: string
  type: GameEventType
  message: string
  simTime: number
  data?: Record<string, unknown>
}

// ---- Tutorial -------------------------------------------------------------

export interface TutorialStep {
  id: string
  stepNumber: number
  prompt: string
  condition: (state: BoxEmpireState) => boolean
  action?: (state: BoxEmpireState) => void
}

// ---- Pathfinding ----------------------------------------------------------

export type PathNodeType = 'gate' | 'yard_io' | 'quay_buffer' | 'junction' | 'berth' | 'crane_base'

export interface PathNode {
  id: string
  type: PathNodeType
  position: Position
}

export interface PathEdge {
  from: string
  to: string
  distance: number
  speedLimit: number
}

export interface PathGraph {
  nodes: Map<string, PathNode>
  edges: PathEdge[]
}

// ---- Gatehouse ------------------------------------------------------------

export interface GatehouseState {
  exportLaneOpen: boolean
  importLaneOpen: boolean
}

// ---- Game Phase -----------------------------------------------------------

export type GamePhase = 'menu' | 'tutorial' | 'playing' | 'paused' | 'completed'

// ---- Store State ----------------------------------------------------------

export interface BoxEmpireState {
  gamePhase: GamePhase
  simTime: number
  timeScale: number
  tutorialStep: number
  tutorialCompleted: boolean
  gatehouse: GatehouseState
  money: number
  transactions: Transaction[]
  equipment: Equipment[]
  containers: Container[]
  yardBlocks: YardBlock[]
  vesselVisits: VesselVisit[]
  truckVisits: TruckVisit[]
  jobs: Job[]
  selectedContainerId: string | null
  selectedEquipmentId: string | null
  events: GameEvent[]
}

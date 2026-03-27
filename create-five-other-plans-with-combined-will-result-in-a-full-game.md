# Box Empire — Master Implementation Roadmap

This document defines a complete implementation roadmap for **Box Empire**, a 3D container terminal simulation / management game. The work is broken into **five sequential implementation plans**. Future agents will execute these plans **one at a time**, with each plan adding more functionality and complexity.

**Do not implement any code from this document directly.** This is a planning document only. Implementation agents will read this file and execute one plan at a time.

---

## Table of Contents

1. [Vision and Overview](#1-vision-and-overview)
2. [Design Principles and Assumptions](#2-design-principles-and-assumptions)
3. [Progression Arc Summary](#3-progression-arc-summary)
4. [Plan 1 — Tutorial and Core Simulation Foundations](#4-plan-1--tutorial-and-core-simulation-foundations)
5. [Plan 2 — Main Game Start and Terminal Setup](#5-plan-2--main-game-start-and-terminal-setup)
6. [Plan 3 — Bigger Containers, More Equipment, More Visibility](#6-plan-3--bigger-containers-more-equipment-more-visibility)
7. [Plan 4 — Special Cargo and Ship-to-Shore Cranes](#7-plan-4--special-cargo-and-ship-to-shore-cranes)
8. [Plan 5 — Multi-Berth and Simultaneous Vessels](#8-plan-5--multi-berth-and-simultaneous-vessels)
9. [Cross-Plan Foundations](#9-cross-plan-foundations)
10. [box-empire-AGENTS.md Guidance](#10-box-empire-agentsmd-guidance)
11. [Implementation Order Guidance and Risk Notes](#11-implementation-order-guidance-and-risk-notes)
12. [Mandatory Instructions for Future Implementation Agents](#12-mandatory-instructions-for-future-implementation-agents)

---

## 1. Vision and Overview

### Game Pitch

**Box Empire** is a 3D container terminal management tycoon game implemented using Three.js and Vue 3. The player starts with a small terminal equipped with a single reach stacker and gradually builds a thriving port operation capable of handling multiple vessels simultaneously.

### Core Gameplay Loop

1. **Accept work**: Vessels arrive carrying import containers; trucks arrive carrying export containers
2. **Manage operations**: Equipment automatically moves containers between gate, yard, and quay
3. **Earn revenue**: Money is earned when containers leave the terminal (gate-out for imports, vessel loading for exports)
4. **Invest and grow**: Buy more equipment, expand yard storage, upgrade to bigger cranes
5. **Handle complexity**: As the terminal grows, manage larger vessels, special cargo, and multiple simultaneous operations

### Player Role

The player is a **terminal manager**, not a manual box-mover. The simulation automates container movements via a job system — equipment picks up and delivers containers based on operational needs. However, the player **may manually intervene** at any time to reassign containers or override automated decisions. When manual intervention occurs, the job system recalculates affected jobs accordingly.

### Thematic Progression

| Stage | Terminal Character | Challenge Focus |
|-------|-------------------|-----------------|
| Tutorial | Tiny port with 1 reach stacker | Learn the basics |
| Early game | Small terminal, manual equipment | Cash flow management |
| Mid game | Growing yard, first yard cranes | Efficiency and throughput |
| Late game | Multiple berths, STS cranes | Resource contention, scheduling |

---

## 2. Design Principles and Assumptions

### Architectural Principles

1. **Sim isolation**: All Box Empire code lives under `src/sims/box-empire/` per the project's AGENTS.md conventions. Nothing leaks into top-level `src/` directories except genuinely shared utilities.

2. **Four-layer architecture** (from the `threejs-vue3-animation` skill):
   - **Layer 1 — Domain Model**: Pure TypeScript logic for containers, equipment, jobs, vessels. No Three.js. Driven by simulation tick.
   - **Layer 2 — Application State**: Pinia store bridging domain and rendering. Holds positions, animation targets, UI state.
   - **Layer 3 — Scene Adapter**: Composables translating Pinia state into Three.js objects. Watchers update meshes.
   - **Layer 4 — Render Loop**: 60fps RAF loop, decoupled from simulation tick. Interpolates between sim states.

3. **Fixed-step simulation**: The simulation runs at a fixed tick rate (e.g., 10-30 Hz) independent of frame rate. Time controls (pause, 1×, 2×, 4×) multiply the sim delta. The render loop interpolates positions for smooth visuals.

4. **Data-driven design**: Entity types, equipment parameters, and economic values are defined in configuration modules, not hardcoded. The skill files provide reference values.

### Coordinate System

- **1 unit = 1 meter**
- **X axis**: Along the quay (East-West)
- **Z axis**: Perpendicular to quay (North-South), negative toward water
- **Y axis**: Up (height)
- **Quay line**: Z = 0
- **Water**: Z < 0
- **Yard**: Z > 0

### Entity Models

Entity interfaces are drawn from the `.ai/skills/` files:

| Entity | Primary Skill Reference |
|--------|------------------------|
| Container | `container-cargo-entities` — ContainerEntity, ContainerPhysicalSpec |
| Equipment | `terminal-equipment-entities` — EquipmentBase, ReachStackerParams, STSCraneParams |
| Vessel | `vessel-entities` — Vessel, VesselClass, StowageSlot |
| Yard | `terminal-infrastructure` — YardBlock, YardSlot, LayoutArchetype |
| Operations | `terminal-operations` — ContainerEvent, VesselOperation, SimulationClock |
| Economy | `terminal-economics` — HandlingCharge, StoragePolicy, TariffBook |

### Container Sizes

- **Plan 1-2**: 20ft containers only (6.06m × 2.44m × 2.59m)
- **Plan 3+**: 40ft containers unlocked (12.19m × 2.44m × 2.59m)
- **Plan 4+**: Reefer and hazardous variants

### Time Controls

Available from Plan 1:
- **Pause**: Simulation frozen, player can inspect and plan
- **1×**: Real-time (1 sim-second = 1 real-second)
- **2×**: Double speed
- **4×**: Quadruple speed

### Assets

Media assets are copied from `available-media/` into `src/sims/box-empire/assets/` as needed:

| Asset Type | Source Folder | Examples |
|-----------|---------------|----------|
| 3D Models | `available-media/3d-models/` | Containers, trucks, cranes, vessels |
| Sound Effects | `available-media/sound-samples/` | Container thuds, ship horns, money sounds |

---

## 3. Progression Arc Summary

| Plan | Title | Equipment | Containers | Vessels | Key New Systems |
|------|-------|-----------|------------|---------|-----------------|
| **1** | Tutorial & Core Foundations | Reach Stacker, Mobile Harbor Crane | 20ft only (10 total) | Tiny feeder (5 slots) | Job system, pathfinding, gate, yard, vessel lifecycle, economy basics, tutorial scripting |
| **2** | Main Game Start | Purchasable RS, MHC, Gatehouse, Yard blocks | 20ft, variable volumes | Small feeders | Purchase/upgrade system, storage config, yard assignment AI, save/load, free play mode |
| **3** | Growth & Visibility | RMG, additional gatehouses | 20ft + 40ft | Larger feeders (~3000 TEU) | Size unlocks via milestones, dashboards/KPIs, yard crane automation |
| **4** | Special Cargo & Quay Cranes | STS gantry cranes | Reefer + Hazardous | Medium vessels (Panamax) | DG/reefer zones, temperature monitoring, STS animation, hatch covers |
| **5** | Multi-Berth Operations | All prior + second berth | All prior | Multiple simultaneous | Berth allocation, crane sharing, resource contention, inter-berth transport |

---

## 4. Plan 1 — Tutorial and Core Simulation Foundations

### Objective

Deliver a playable tutorial scenario that teaches the player the basics while establishing the complete simulation architecture that all subsequent plans build upon.

**This is the largest and most critical plan** because it creates nearly all foundational systems.

### Player Experience

1. Player clicks "Start Tutorial" from the main Box Empire screen
2. A guided scenario begins:
   - Pre-built terminal with gatehouse, 10-bay yard storage, 1 reach stacker, 1 mobile harbor crane
   - A tiny vessel is announced, carrying 5 containers to discharge
   - 5 export containers need to be loaded onto the vessel
3. Tutorial prompts guide the player:
   - "Click 'Open Gatehouse' to allow trucks to enter"
   - 5 trucks arrive carrying export containers
   - Each truck is processed at the gate and drives to the yard
   - The reach stacker automatically picks containers from trucks and places them in yard storage
   - Once all 5 export containers are stored, the vessel arrives
   - The mobile harbor crane discharges 5 import containers from the vessel
   - The reach stacker picks import containers from quayside and places them in yard storage
   - Trucks arrive to collect import containers (gate-out earns money)
   - The reach stacker retrieves export containers and takes them to quayside
   - The mobile harbor crane loads export containers onto the vessel (loading earns money)
4. Tutorial ends when:
   - All 5 import containers have left via the gatehouse
   - All 5 export containers are loaded on the vessel
   - The vessel departs
5. Celebration modal appears with cheering sound effects

### Gameplay Scope

| Feature | Description |
|---------|-------------|
| Gatehouse control | Player can open/close the gatehouse for inbound and outbound traffic |
| Automated operations | Container movements happen automatically via the job system |
| Manual override | Player can click a container and manually reassign its destination; job queue recalculates |
| Revenue display | Running money balance shown in HUD; increases on gate-out and vessel loading |
| Tutorial overlay | Speech-bubble style prompts guide the player through each step |
| Time controls | Pause, 1×, 2× available (4× not needed for tutorial) |

### Simulation and Automation Scope

This plan establishes the **core simulation engine** used by all subsequent plans.

#### Job System

The job system is the heart of the simulation. A **Job** represents a task to move a container from one location to another.

```typescript
interface Job {
  id: string
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  containerId: string
  pickupLocation: Location  // gate buffer, yard slot, vessel slot, quay buffer
  dropoffLocation: Location
  assignedEquipmentId: string | null
  priority: number  // higher = more urgent
  createdAt: number  // sim time
  startedAt: number | null
  completedAt: number | null
}
```

Jobs are created by:
- **Gate-in event**: Truck arrives with container → job to move container from gate to yard
- **Vessel discharge**: Container on vessel needs to go ashore → job to move from vessel to quay buffer, then quay buffer to yard
- **Gate-out request**: Import container ready for collection → job to move from yard to gate
- **Vessel loading**: Export container needs to go aboard → job to move from yard to quay buffer, then quay buffer to vessel

The job scheduler:
1. Maintains a priority queue of pending jobs
2. Assigns jobs to idle equipment based on proximity and capability
3. Tracks job progress as equipment executes
4. Handles job cancellation and reassignment

**Manual override behavior**: When the player manually moves a container:
1. Cancel any job currently involving that container
2. Create a new job for the manual destination
3. Recalculate any dependent jobs (e.g., if the container was next in a load sequence, find a replacement)

#### Equipment State Machine

All equipment follows a common state machine:

```
IDLE → ASSIGNED → TRAVEL_TO_PICKUP → PICKING → TRAVEL_TO_DROP → DROPPING → IDLE
```

State details:
- **IDLE**: Equipment is stationary, waiting for a job
- **ASSIGNED**: Job assigned, equipment preparing to move
- **TRAVEL_TO_PICKUP**: Equipment moving toward pickup location
- **PICKING**: Equipment at pickup location, executing pick animation/timer
- **TRAVEL_TO_DROP**: Equipment carrying container, moving to dropoff
- **DROPPING**: Equipment at dropoff, executing place animation/timer

Each equipment type has different speeds and cycle times (from `terminal-equipment-entities` skill).

#### Pathfinding

Simple node-graph pathfinding based on the road network model from `terminal-infrastructure` skill:

```typescript
interface PathNode {
  id: string
  type: 'gate' | 'yard_io' | 'quay_buffer' | 'junction'
  position: { x: number; z: number }
}

interface PathEdge {
  from: string
  to: string
  distance: number  // meters
  speedLimit: number  // m/s
}
```

For Plan 1, the graph is simple:
- Gate node
- Yard I/O node (where trucks stop for reach stacker service)
- Quay buffer node (where mobile harbor crane places/picks containers)
- Connecting edges with appropriate distances

Equipment uses A* or Dijkstra to find shortest path, then follows the path at the edge speed limit.

#### Container Entity

Subset of `ContainerEntity` from `container-cargo-entities` skill:

```typescript
interface Container {
  id: string  // ISO 6346 format, e.g., "MSKU1234567"
  size: '20ft'  // Only 20ft in Plan 1
  ownerColor: string  // Hex color for rendering
  weight: number  // kg
  lifecycleState: ContainerLifecycleState
  visitType: 'import' | 'export'
  currentLocation: Location
  yardSlot: YardSlotRef | null
  vesselSlot: VesselSlotRef | null
}

type ContainerLifecycleState =
  | 'on_vessel'
  | 'discharged_to_buffer'
  | 'in_yard'
  | 'staged_for_loading'
  | 'loaded_on_vessel'
  | 'at_gate'
  | 'departed'
```

#### Vessel Visit Lifecycle

```
announced → arrived → discharging → loading → departed
```

- **announced**: Vessel ETA known, discharge/load lists available
- **arrived**: Vessel at berth, operations can begin
- **discharging**: Mobile harbor crane unloading import containers
- **loading**: Mobile harbor crane loading export containers
- **departed**: Vessel has left, visit complete

#### Truck Visit Lifecycle

```
approaching → at_gate → driving_to_yard → waiting_for_equipment → departing → departed
```

- **approaching**: Truck visible, heading to gate
- **at_gate**: Truck at gatehouse, being processed
- **driving_to_yard**: Truck driving to yard I/O point
- **waiting_for_equipment**: Truck stopped, waiting for reach stacker
- **departing**: Container loaded/unloaded, truck leaving
- **departed**: Truck has left the terminal

#### Yard Model

Single yard block for the tutorial:

```typescript
interface YardBlock {
  id: string
  type: 'mixed'  // import/export/mixed
  bays: number  // 10 for tutorial
  rows: number  // 1 for tutorial (reach stacker limitation)
  maxTier: number  // 3 for tutorial
  slots: YardSlot[]
}

interface YardSlot {
  blockId: string
  bay: number
  row: number
  tier: number
  containerId: string | null
  maxWeight: number  // kg
}
```

Slot assignment: First-available strategy — find the lowest tier in the first available bay.

#### Economy

Simple flat-rate economy for the tutorial:

| Event | Revenue |
|-------|---------|
| Import container gate-out | $100 |
| Export container loaded on vessel | $150 |

The economy module:
- Tracks running balance
- Records transactions with timestamps
- Triggers audio (ca-ching sound) on revenue events

#### Event System

Based on `SimulationClock` from `terminal-operations` skill:

```typescript
interface SimulationClock {
  currentTime: number  // sim seconds since start
  timeScale: number  // 0 = paused, 1 = normal, 2 = fast, 4 = faster
  tickRate: number  // ticks per real second (e.g., 30)
}
```

Game events flow through a unified event bus:
- `container.placed` → thud sound
- `money.earned` → ca-ching sound
- `vessel.arrived` → ship horn
- `vessel.departed` → ship horn
- `tutorial.completed` → cheering

#### Audio Hooks

Sound effects triggered by events:

| Event | Sound File |
|-------|-----------|
| Container placed | `container-loaded-to-ship.mp3` |
| Money earned | `money-increase-ca-ching-.mp3` |
| Vessel arrived | `small-ship-three-horns-in-a-row.mp3` |
| Vessel departed | `small-ship-three-horns-in-a-row.mp3` |
| Tutorial complete | `group-yay-cheer.mp3` |
| Level up / milestone | `level-up.mp3` |

### Equipment Scope

#### Reach Stacker

Simplified from `terminal-equipment-entities` skill:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Travel speed (unladen) | 5 m/s | ~18 km/h |
| Travel speed (laden) | 4 m/s | ~14 km/h |
| Pick cycle time | 8 s | Position + grab + lift |
| Place cycle time | 8 s | Position + lower + release |
| Max stack height | 3 tiers | Tutorial limitation |
| Row reach | 1 row only | Tutorial simplification |

The reach stacker is the primary yard equipment for Plan 1. It handles:
- Unloading trucks at yard I/O point
- Placing containers in yard storage
- Retrieving containers from yard storage
- Delivering containers to quay buffer (for loading) or gate buffer (for gate-out)

#### Mobile Harbor Crane

A small, slow quayside crane for the tutorial. Not a full STS gantry crane.

| Parameter | Value | Notes |
|-----------|-------|-------|
| Cycle time | 90 s | Full pick-transfer-place cycle |
| Reach | 1 vessel bay | Can only access the single bay |
| Lift capacity | 1 container | Single-lift only |

The mobile harbor crane handles:
- Discharging containers from the vessel to quay buffer
- Loading containers from quay buffer to the vessel

### Vessel, Truck, and Container Scope

#### Vessel

Single vessel class for the tutorial:

| Parameter | Value |
|-----------|-------|
| Name | "Tiny Feeder" |
| LOA | ~50 m |
| Beam | ~12 m |
| TEU capacity | 10 |
| Visible bays | 1 |
| Container slots | 5 (single bay, 1 row, 5 tiers) |

The vessel arrives with 5 import containers and departs with 5 export containers.

#### Trucks

Simple truck model:

| Parameter | Value |
|-----------|-------|
| Travel speed | 8 m/s | ~30 km/h |
| Gate processing time | 15 s | Simplified for tutorial |
| Capacity | 1 × 20ft container |

5 trucks arrive carrying export containers. Additional trucks arrive to collect import containers.

#### Containers

10 containers total:
- 5 export containers (arrive by truck, load onto vessel)
- 5 import containers (arrive on vessel, leave by truck)

All 20ft standard containers with randomized owner colors from `CONTAINER_COLORS` in the skill file.

### UI Scope

#### 3D Viewport

- Full-screen canvas with HUD overlay
- Camera: Orbit controls, centered on terminal
- Lighting: Daylight setup (ambient + directional sun)
- Ground plane: Concrete/asphalt texture for yard and apron

#### Top Bar HUD

- **Money display**: Current balance with animated change indicator
- **Time controls**: Pause / 1× / 2× buttons
- **Tutorial step indicator**: "Step 3 of 8" style progress

#### Tutorial Overlay

- Speech-bubble style prompts pointing to relevant UI elements
- "Next" button to advance through informational steps
- Auto-advance when conditions are met (e.g., "Good! The gatehouse is now open.")

#### Interactive Elements

- **"Open Gatehouse" button**: Toggles gatehouse state
- **Container click**: Shows info tooltip, enables manual reassignment
- **Equipment click**: Shows status tooltip

#### Event Feed

- Last 5 events displayed
- Scrolling list with newest at top
- Color-coded by event type (green for success, yellow for warning)

#### Modals

- **Tutorial Complete**: Celebration modal with star rating, final stats, "Continue to Main Game" button

### Data, State, and Store (Pinia)

Single Pinia store: `useBoxEmpireStore`

```typescript
interface BoxEmpireState {
  // Game phase
  gamePhase: 'menu' | 'tutorial' | 'playing' | 'paused'
  
  // Time
  simTime: number
  timeScale: number
  
  // Tutorial
  tutorialStep: number
  tutorialCompleted: boolean
  
  // Economy
  money: number
  transactions: Transaction[]
  
  // Terminal entities
  equipment: Equipment[]
  containers: Container[]
  yardBlocks: YardBlock[]
  vesselVisits: VesselVisit[]
  truckVisits: TruckVisit[]
  
  // Jobs
  jobs: Job[]
  
  // UI state
  selectedContainerId: string | null
  selectedEquipmentId: string | null
  events: GameEvent[]
}
```

Derived state (computed):
- `activeJobs`: Jobs with status 'assigned' or 'in_progress'
- `pendingJobs`: Jobs with status 'pending'
- `yardOccupancy`: Percentage of yard slots filled
- `equipmentStatus`: Map of equipment ID to current state
- `currentTutorialPrompt`: Text for current tutorial step

### Dependencies

None — this is the first plan.

### Suggested Files and Modules

```
src/sims/box-empire/
├── BoxEmpire.vue                    # Root component (already exists, needs implementation)
├── definition.ts                     # Sim metadata (already exists)
├── box-empire-AGENTS.md              # Sim-specific agent guidance (create in Plan 1)
├── components/
│   ├── GameCanvas.vue                # 3D viewport wrapper
│   ├── TopBar.vue                    # HUD top bar (money, time controls)
│   ├── EventFeed.vue                 # Recent events list
│   ├── ContainerInfo.vue             # Container tooltip/details
│   ├── EquipmentInfo.vue             # Equipment tooltip/details
│   ├── ui/
│   │   ├── TutorialOverlay.vue       # Tutorial prompts
│   │   ├── MoneyDisplay.vue          # Animated money counter
│   │   └── TimeControls.vue          # Pause/speed buttons
│   └── modals/
│       ├── TutorialComplete.vue      # End-of-tutorial celebration
│       └── StartScreen.vue           # Initial menu
├── composables/
│   ├── useThreeScene.ts              # Sim-specific Three.js scene setup
│   ├── useGameLoop.ts                # Sim tick + render coordination
│   ├── useAudio.ts                   # Sound effect management
│   └── useInput.ts                   # Click/hover handlers for 3D objects
├── modules/
│   ├── config.ts                     # Constants, speeds, dimensions, scenario data
│   ├── jobScheduler.ts               # Job creation, assignment, recalculation
│   ├── equipmentController.ts        # Equipment state machines, movement
│   ├── yardManager.ts                # Slot assignment, occupancy tracking
│   ├── vesselManager.ts              # Vessel visit lifecycle, discharge/load lists
│   ├── truckManager.ts               # Truck gate flow, arrival/departure
│   ├── economy.ts                    # Revenue tracking, transaction recording
│   ├── pathfinding.ts                # Node graph, shortest path calculation
│   ├── terminalMap.ts                # Static layout definition, node positions
│   ├── tutorial.ts                   # Tutorial step definitions, conditions, prompts
│   ├── sceneBuilder.ts               # Three.js scene graph construction
│   ├── containerRenderer.ts          # InstancedMesh for containers
│   ├── equipmentRenderer.ts          # Equipment mesh management
│   ├── vesselRenderer.ts             # Vessel mesh management
│   └── truckRenderer.ts              # Truck mesh management
├── store/
│   └── gameStore.ts                  # Pinia store
├── types/
│   └── index.ts                      # All TypeScript interfaces
└── assets/
    ├── models/                       # Copied from available-media/3d-models/
    └── sounds/                       # Copied from available-media/sound-samples/
```

### Testing and Validation Expectations

- [ ] Tutorial plays from start to finish with no player intervention (fully automated flow)
- [ ] Clicking "Open Gatehouse" triggers truck arrivals
- [ ] Trucks arrive, stop at yard I/O, and wait for reach stacker
- [ ] Reach stacker picks containers from trucks and places them in yard
- [ ] Empty trucks depart
- [ ] Vessel arrives after all export containers are stored
- [ ] Mobile harbor crane discharges import containers to quay buffer
- [ ] Reach stacker moves import containers from buffer to yard
- [ ] Trucks arrive to collect import containers
- [ ] Gate-out events earn money ($100 each)
- [ ] Reach stacker retrieves export containers and delivers to quay buffer
- [ ] Mobile harbor crane loads export containers onto vessel
- [ ] Loading events earn money ($150 each)
- [ ] Vessel departs when fully loaded
- [ ] Tutorial-complete modal appears with cheering sound
- [ ] Player can click a container and reassign it; job queue recalculates correctly
- [ ] Time controls (pause, 1×, 2×) work correctly
- [ ] Simulation runs smoothly at 60fps with 10 containers
- [ ] No lint errors
- [ ] Build succeeds

### Acceptance Criteria

1. **Automated flow works end-to-end**: Tutorial completes without player intervention beyond opening the gatehouse
2. **Manual override works**: Player can reassign containers; job system recalculates
3. **Economy works**: Money increases correctly on revenue events
4. **Audio works**: Correct sounds play at correct moments
5. **Tutorial UX works**: Prompts guide player; completion triggers celebration
6. **Performance**: 60fps with 10 containers
7. **Code quality**: No lint errors, clean build

### Out of Scope for Plan 1

- Multiple yard blocks
- Equipment purchasing
- 40ft containers
- RMG or STS cranes
- Reefer or hazardous containers
- Dashboards or KPIs
- Save/load functionality
- Game-over conditions
- Multiple vessel visits
- Complex yard assignment strategies

---

## 5. Plan 2 — Main Game Start and Terminal Setup

### Objective

Transition from the guided tutorial to open-ended gameplay. The player starts at a new, larger terminal that is initially empty of both containers and equipment. The player must purchase equipment and yard storage to begin operations.

### Player Experience

1. After completing the tutorial (or skipping it), player enters the main game
2. Starting conditions:
   - Larger terminal area (more space for expansion)
   - Starting capital: $10,000
   - No equipment owned
   - No yard storage built
   - Vessels and trucks will arrive once the terminal is operational
3. Player must purchase:
   - At least one reach stacker ($2,000)
   - A gatehouse ($1,500)
   - A mobile harbor crane ($5,000)
   - Yard storage blocks (price varies by size)
4. Once equipped, player opens the gatehouse and begins accepting vessel/truck traffic
5. Gameplay continues indefinitely with increasing vessel sizes and volumes
6. Game can be saved and loaded

### Gameplay Scope

| Feature | Description |
|---------|-------------|
| Purchase system | Buy equipment and yard blocks from a catalog |
| Yard configuration | Choose block size (bays × rows), assign block type and filling strategy |
| Expanded vessels | Vessels with 10-30 containers |
| Truck flow | Trucks arrive over time based on vessel schedules |
| Money management | Starting capital, revenue, maintenance costs |
| Save/load | Persist game state to localStorage |
| Game over | If money goes negative, game ends |

### Simulation and Automation Scope

#### Purchase System

```typescript
interface PurchaseCatalog {
  equipment: EquipmentListing[]
  yardBlocks: YardBlockListing[]
  infrastructure: InfrastructureListing[]
}

interface EquipmentListing {
  type: 'reach_stacker' | 'mobile_harbor_crane'
  name: string
  price: number
  maintenanceCost: number  // per sim-day
  specs: EquipmentSpecs
}

interface YardBlockListing {
  basePrice: number  // per slot
  minBays: number
  maxBays: number
  minRows: number
  maxRows: number
  maxTier: number
}
```

Prices (reference values):
- Reach stacker: $2,000
- Mobile harbor crane: $5,000
- Gatehouse: $1,500
- Yard block: $50 per slot (bays × rows × maxTier)

#### Yard Block Configuration

When purchasing a yard block, the player configures:

1. **Size**: Bay count (5-30), row count (1-6), max tier (3-5)
2. **Type**: Import / Export / Mixed
3. **Filling strategy**:
   - First-available (simple, higher rehandle rate)
   - POD-grouped (group by destination port, lower rehandle rate)
   - FIFO (first-in-first-out, good for dwell time)

The yard assignment AI uses `computeYardGroupingScore` from `container-cargo-entities` skill to optimize placement within configured constraints.

#### Expanded Operations

- Vessels now carry 10-30 containers
- Multiple trucks may be queued at the gate
- Equipment may have multiple jobs in queue
- Maintenance costs deducted daily

#### Save/Load

Serialize game state to localStorage:
- All entity states (equipment, containers, vessels, trucks, jobs)
- Economy (money, transactions)
- Terminal configuration (purchased blocks, equipment)
- Time (simTime, phase)

### Equipment Scope

Same as Plan 1:
- Reach Stacker (purchasable, multiple allowed)
- Mobile Harbor Crane (purchasable, one at first)
- Gatehouse (purchasable, one at first)

### Vessel, Truck, and Container Scope

- Vessels: Small feeders (50-100m LOA, 10-30 container slots)
- Trucks: Same as Plan 1, but more volume
- Containers: 20ft only, variable quantities per vessel visit

### UI Scope

New UI elements:

| Element | Description |
|---------|-------------|
| Purchase menu | Catalog of available equipment and yard blocks |
| Yard block configurator | Set size, type, and strategy |
| Terminal overview | See what's built and where |
| Save/load buttons | In pause menu |
| Game over screen | When money goes negative |

### Data/State/Store Additions

```typescript
interface BoxEmpireState {
  // ... Plan 1 fields ...
  
  // Plan 2 additions
  purchasedEquipment: string[]  // IDs of owned equipment
  terminalConfig: TerminalConfig
  dailyMaintenanceCost: number
  lastMaintenanceDeduction: number  // sim time
}

interface TerminalConfig {
  gatehouses: GatehouseConfig[]
  yardBlocks: YardBlockConfig[]
  quayCranes: QuayCraneConfig[]
}

interface YardBlockConfig {
  id: string
  position: { x: number; z: number }
  bays: number
  rows: number
  maxTier: number
  type: 'import' | 'export' | 'mixed'
  fillingStrategy: 'first_available' | 'pod_grouped' | 'fifo'
}
```

### Dependencies

- Plan 1 (all core systems: job system, equipment state machine, pathfinding, yard model, economy, events)

### Suggested Files and Modules

Additional/modified files:

```
src/sims/box-empire/
├── components/
│   ├── PurchaseMenu.vue              # Equipment/block catalog
│   ├── YardBlockConfigurator.vue     # Block setup UI
│   ├── TerminalOverview.vue          # What's built
│   └── modals/
│       ├── GameOver.vue              # Bankruptcy screen
│       └── PauseMenu.vue             # Save/load options
├── modules/
│   ├── purchaseSystem.ts             # Buy/sell logic
│   ├── yardAssignment.ts             # Smart slot assignment using grouping score
│   ├── saveLoad.ts                   # Serialization/deserialization
│   └── maintenance.ts                # Daily cost deductions
```

### Acceptance Criteria

1. Player can purchase equipment and yard blocks
2. Prices are deducted from balance
3. Purchased equipment appears in the terminal and is operational
4. Yard blocks can be configured with different sizes and strategies
5. Yard assignment AI uses grouping score for smart placement
6. Vessels with 10-30 containers are handled correctly
7. Maintenance costs are deducted daily
8. Game state can be saved and loaded
9. Game over triggers when money goes negative

### Out of Scope for Plan 2

- 40ft containers
- RMG or STS cranes
- Multiple gatehouses
- Reefer or hazardous containers
- Dashboards
- Vessel scaling beyond small feeders

---

## 6. Plan 3 — Bigger Containers, More Equipment, More Visibility

### Objective

Introduce 40ft containers (unlocked at a money milestone), RMG yard cranes for efficient stack operations, additional gatehouses for parallel processing, and operational dashboards for visibility.

### Player Experience

1. Upon reaching $50,000 balance, 40ft containers are unlocked
2. Player can now purchase RMG cranes to automate yard stack operations
3. Player can purchase additional gatehouses for parallel truck processing
4. Dashboard screen shows operational KPIs
5. Vessels scale up to ~3000 TEU feeders

### Gameplay Scope

| Feature | Description |
|---------|-------------|
| 40ft containers | Double-length containers, require double-width slots |
| RMG crane | Rail-mounted gantry over yard blocks, faster than reach stacker |
| Multiple gatehouses | Parallel gate processing, queue management |
| Dashboards | Yard occupancy, crane utilization, truck turn time, revenue charts |
| Milestone unlocks | 40ft unlocked at $50K; RMG unlocked at $75K |

### Simulation and Automation Scope

#### 40ft Container Support

40ft containers occupy 2 bay positions (even-numbered bays per `vessel-entities` skill):

```typescript
interface Container {
  // ... existing fields ...
  size: '20ft' | '40ft'  // Extended from Plan 1
}
```

Yard slot changes:
- A 40ft container in bay N occupies bay N and bay N+1
- Mixed stacking allowed (20ft can stack on 40ft, not vice versa)
- Vessel stowage uses even bay numbers for 40ft slots

#### RMG Crane

From `terminal-equipment-entities` skill:

| Parameter | Value |
|-----------|-------|
| Gantry speed | ~1.7 m/s (100 m/min) |
| Trolley speed | ~1.2 m/s (70 m/min) |
| Hoist speed (laden) | ~0.45 m/s (27 m/min) |
| Span | 30-50 m (covers 6-10 rows) |
| Stacking height | 1-over-5 or 1-over-6 |

RMG operates over a specific yard block, handling all container movements within that block. Much faster than reach stacker for dense storage operations.

#### Multiple Gatehouses

Each gatehouse:
- Processes one truck at a time
- Has its own queue
- Can be opened/closed independently

Gate assignment: Trucks are assigned to the gatehouse with the shortest queue.

#### Dashboards

KPIs from `terminal-operations` skill:

| KPI | Formula | Target |
|-----|---------|--------|
| Yard occupancy | occupied_slots / total_slots | 60-80% |
| Crane utilization | busy_time / total_time | 70-90% |
| Truck turn time | gate_out - gate_in | 25-45 min |
| Revenue per day | daily_revenue | Growing |

### Equipment Scope

New equipment:
- **RMG Crane**: $20,000, automates a single yard block

Existing equipment:
- Reach Stacker (still useful for quay transfer and blocks without RMG)
- Mobile Harbor Crane
- Gatehouse (multiple allowed)

### Vessel, Truck, and Container Scope

- Vessels: Feeders up to ~3000 TEU (150-200m LOA, multiple bays)
- Containers: 20ft and 40ft, mixed
- Trucks: Handle both 20ft and 40ft

### UI Scope

New UI elements:

| Element | Description |
|---------|-------------|
| Dashboard screen | KPI charts and graphs |
| 40ft container rendering | Longer container meshes |
| RMG purchase option | In equipment catalog |
| Multiple gatehouse management | Open/close each independently |
| Milestone notification | "40ft containers unlocked!" |

### Dependencies

- Plan 2 (purchase system, yard configuration, save/load)

### Acceptance Criteria

1. 40ft containers appear after reaching $50K milestone
2. 40ft containers occupy double bay width in yard and vessel
3. RMG crane can be purchased and operates over a yard block
4. RMG is significantly faster than reach stacker for yard ops
5. Multiple gatehouses can be purchased and operate in parallel
6. Dashboard shows accurate KPIs
7. Larger vessels (up to 3000 TEU equivalent) are handled

### Out of Scope for Plan 3

- STS gantry cranes
- Reefer containers
- Hazardous containers
- Multiple berths
- Hatch cover logic

---

## 7. Plan 4 — Special Cargo and Ship-to-Shore Cranes

### Objective

Add reefer (refrigerated) and hazardous (DG) containers with their specialized handling requirements, introduce STS gantry cranes for efficient quayside operations, and support medium-sized vessels.

### Player Experience

1. New container types appear in vessel manifests:
   - Reefer containers (need power, temperature monitoring)
   - Hazardous containers (need segregation, special zones)
2. Player can purchase STS gantry cranes for fast quay operations
3. Larger vessels (Panamax class, ~5000 TEU) can be accepted
4. Player must manage dedicated reefer and DG yard zones

### Gameplay Scope

| Feature | Description |
|---------|-------------|
| Reefer containers | Require powered yard slots, temperature monitoring, power surcharge |
| Hazardous containers | Require DG zone, segregation rules, DG surcharge |
| STS gantry cranes | Fast quayside crane with articulated animation |
| Medium vessels | Panamax class with bay-row-tier stowage |
| Hatch covers | Must be removed before accessing under-deck |

### Simulation and Automation Scope

#### Reefer Containers

From `container-cargo-entities` skill:

```typescript
interface Container {
  // ... existing fields ...
  isReefer: boolean
  reeferSetPoint?: number  // target temperature in °C
  reeferActualTemp?: number  // current temperature
}
```

Reefer handling:
- Must be placed in powered yard slots
- Temperature monitored while in yard
- Reefer power surcharge: $50/day (from `terminal-economics` skill)
- Alarm if temperature exceeds threshold

Yard block configuration extended:
```typescript
interface YardBlockConfig {
  // ... existing fields ...
  reeferPowerPoints: number  // 0 for non-reefer blocks
}
```

#### Hazardous Containers

Simplified IMDG classes (from `dk_sse__hazardous_containers_imdg.md`):

| Game Class | IMDG Classes | Handling |
|------------|-------------|----------|
| Flammable | 2.1, 3, 4.1, 4.2 | Fire risk zone |
| Toxic | 2.3, 6.1 | Isolation zone |
| Corrosive | 8 | Corrosive zone |
| General DG | 9 and others | DG zone |

```typescript
interface Container {
  // ... existing fields ...
  isHazardous: boolean
  hazmatClass?: 'flammable' | 'toxic' | 'corrosive' | 'general_dg'
}
```

DG handling:
- Must be placed in DG-designated yard zones
- Segregation: keep flammable away from corrosive, etc.
- DG surcharge: 75% of base handling fee

#### STS Gantry Crane

From `terminal-equipment-entities` skill:

| Parameter | Value |
|-----------|-------|
| Gantry speed | ~0.6 m/s (35 m/min) |
| Trolley speed | ~3.0 m/s (180 m/min) |
| Hoist speed (laden) | ~1.0 m/s (60 m/min) |
| Cycle time | ~62 s baseline |
| Outreach | 50-60 m |
| Rated load | 60-65 t |

Animation states (from skill):
```typescript
type STSPhase =
  | 'idle'
  | 'gantry_travel'
  | 'trolley_out'
  | 'hoist_down'
  | 'lock'
  | 'hoist_up'
  | 'trolley_in'
  | 'hoist_set'
  | 'unlock'
  | 'hoist_clear'
```

The STS crane is much faster than the mobile harbor crane and can work multiple bays.

#### Hatch Cover Logic

Vessel bays are divided into:
- **On-deck**: Accessible without hatch cover removal
- **Under-deck**: Requires hatch cover removal first

Hatch cover handling:
- Remove before accessing under-deck containers (~4 min per hatch)
- Replace after finishing under-deck operations
- Hatch covers stored on deck during operations

#### Medium Vessels

Panamax class vessels:
- LOA: ~290 m
- Beam: 32 m
- TEU capacity: ~5000
- Multiple bays with bay-row-tier addressing
- Multiple cranes can work simultaneously (crane split)

### Equipment Scope

New equipment:
- **STS Gantry Crane**: $100,000, fast quayside operations

### UI Scope

New UI elements:

| Element | Description |
|---------|-------------|
| Reefer indicators | Snowflake icon, temperature display |
| DG indicators | Hazmat diamond icons by class |
| STS crane animation | Articulated gantry + trolley + hoist + spreader |
| Reefer/DG block designation | In yard configurator |
| Hatch cover visualization | Removable deck covers |

### Dependencies

- Plan 3 (40ft support, RMG, dashboards)

### Acceptance Criteria

1. Reefer containers appear and require powered slots
2. Reefer power costs are tracked and charged
3. Temperature monitoring works with alarms
4. DG containers appear and require designated zones
5. Segregation rules are enforced
6. DG surcharges are applied
7. STS crane can be purchased and operates
8. STS animation shows all articulated parts
9. STS is dramatically faster than mobile harbor crane
10. Medium vessels (Panamax) are handled with bay-row-tier slots
11. Hatch covers must be removed for under-deck access

### Out of Scope for Plan 4

- Multiple berths
- Multiple simultaneous vessels
- Advanced automation (ASC)

---

## 8. Plan 5 — Multi-Berth and Simultaneous Vessels

### Objective

Introduce multiple berths that can host vessels simultaneously, creating resource contention and requiring sophisticated planning.

### Player Experience

1. Player can purchase a second berth
2. Multiple vessels can be at the terminal at the same time
3. Player must manage:
   - Berth allocation (which vessel goes where)
   - Crane sharing (STS cranes on shared rails)
   - Equipment prioritization (which vessel gets service first)
   - Inter-berth horizontal transport
4. Significantly higher operational complexity and earning potential

### Gameplay Scope

| Feature | Description |
|---------|-------------|
| Second berth | Purchasable expansion |
| Simultaneous vessels | 2+ vessels at terminal at once |
| Berth allocation | Manual or auto-assign vessels to berths |
| Crane contention | STS cranes share rails, cannot cross |
| Priority management | Set vessel service priority |

### Simulation and Automation Scope

#### Multiple Berths

```typescript
interface Berth {
  id: string
  position: { x: number; z: number }
  length: number  // meters, determines max vessel LOA
  depth: number  // meters, determines max draft
  currentVessel: string | null
  assignedCranes: string[]
}
```

Berth allocation logic:
- Check vessel LOA <= berth length
- Check vessel draft <= berth depth
- Check crane availability
- Assign to first available suitable berth

#### Crane Rail Sharing

STS cranes mounted on shared rails:
- Cranes cannot pass each other
- Cranes have a minimum safe distance (~10m)
- Crane positions must be managed to avoid blocking

```typescript
interface CraneRailSystem {
  railStart: number  // X position
  railEnd: number  // X position
  cranes: CranePosition[]
}

interface CranePosition {
  craneId: string
  currentX: number
  assignedBayRange: { start: number; end: number }
}
```

#### Vessel Priority

When multiple vessels need service:
- Player can set priority per vessel
- Higher priority vessels get equipment first
- Jobs for higher-priority vessels are scheduled before lower-priority

#### Inter-Berth Transport

If horizontal transport is needed between berths:
- Trucks/tractors travel via road network
- Congestion increases with multiple active vessels
- Potential bottleneck at shared paths

### Equipment Scope

No new equipment types. Focus is on coordinating existing equipment across multiple berths.

### UI Scope

New UI elements:

| Element | Description |
|---------|-------------|
| Berth purchase option | In infrastructure catalog |
| Multi-berth overview | See all berths and their vessels |
| Crane rail visualization | Show crane positions on shared rail |
| Vessel priority controls | Set priority per vessel |
| Congestion indicators | Show bottlenecks in transport network |

### Dependencies

- Plan 4 (STS cranes, medium vessels, reefer/DG)

### Acceptance Criteria

1. Second berth can be purchased
2. Two vessels can be berthed simultaneously
3. Berth allocation works correctly based on vessel size
4. STS cranes share rails and cannot cross
5. Crane movements are coordinated to avoid blocking
6. Vessel priority affects job scheduling
7. Inter-berth transport works correctly
8. Congestion is visible when transport is overloaded
9. Terminal can handle significantly more throughput

### Out of Scope for Plan 5

- More than 2 berths (future expansion)
- AGVs or automated horizontal transport
- Rail intermodal
- Barge operations

---

## 9. Cross-Plan Foundations

These systems must be designed consistently from Plan 1 to avoid costly rework in later plans. Implementation agents must follow these guidelines.

### Entity Model

Define full interfaces in Plan 1 with optional fields for later plans:

```typescript
interface Container {
  // Plan 1 fields (required)
  id: string
  size: ContainerSize
  weight: number
  ownerColor: string
  lifecycleState: ContainerLifecycleState
  visitType: 'import' | 'export'
  currentLocation: Location
  yardSlot: YardSlotRef | null
  vesselSlot: VesselSlotRef | null
  
  // Plan 3+ fields (optional)
  // size extended to include '40ft'
  
  // Plan 4+ fields (optional)
  isReefer?: boolean
  reeferSetPoint?: number
  reeferActualTemp?: number
  isHazardous?: boolean
  hazmatClass?: HazmatClass
}
```

Similar pattern for Equipment, Vessel, YardBlock, etc.

### Job System

The job system must support from Plan 1:
- Multiple equipment types
- Priority levels
- Cancellation
- Manual override with recalculation
- Job dependencies (e.g., discharge before load in same bay)

Later plans add job types but the core queue/assignment logic stays the same.

### Terminal Map and Coordinate System

Use a node-graph representation from Plan 1:

```typescript
interface TerminalMap {
  nodes: PathNode[]
  edges: PathEdge[]
}
```

Plan 1 defines the structure. Later plans add nodes:
- Plan 2: Additional yard blocks
- Plan 3: Additional gatehouses
- Plan 5: Second berth

The coordinate system (meters, X along quay, Z perpendicular, Y up) never changes.

### Yard Slot Model

Use consistent slot addressing from Plan 1:

```typescript
interface YardSlotRef {
  blockId: string
  bay: number
  row: number
  tier: number
}
```

This structure accommodates:
- Plan 1: Single block, 1 row
- Plan 2: Multiple blocks, multiple rows
- Plan 3: 40ft containers (double bay width)
- Plan 4: Reefer/DG zones

### Economy

All revenue events flow through a single function:

```typescript
function recordTransaction(
  type: TransactionType,
  amount: number,
  containerId: string,
  details: Record<string, unknown>
): void
```

Plan 1: Flat rates
Plan 2: Tariff book with handling charges
Plan 4: Surcharges (reefer, DG)

The transaction log structure never changes.

### Event and Audio System

Unified event bus from Plan 1:

```typescript
function emitEvent(eventType: string, payload: unknown): void
function onEvent(eventType: string, handler: (payload: unknown) => void): void
```

Audio hooks are event-driven. New events are added per plan; the bus stays the same.

### Pinia Store Shape

Single store with logical sections:

```typescript
interface BoxEmpireState {
  // Core (Plan 1)
  gamePhase: GamePhase
  simTime: number
  timeScale: number
  money: number
  equipment: Equipment[]
  containers: Container[]
  yardBlocks: YardBlock[]
  vesselVisits: VesselVisit[]
  truckVisits: TruckVisit[]
  jobs: Job[]
  
  // Tutorial (Plan 1)
  tutorialStep: number
  tutorialCompleted: boolean
  
  // Config (Plan 2)
  terminalConfig: TerminalConfig
  
  // UI (all plans)
  selectedContainerId: string | null
  events: GameEvent[]
  
  // ... fields added per plan
}
```

Fields are added per plan; the store is never restructured.

### Scene Adapter Pattern

One scene composable owns all Three.js objects:

```typescript
// composables/useThreeScene.ts
function useThreeScene(canvas: Ref<HTMLCanvasElement>) {
  // Create scene, camera, renderer
  // Set up watchers for Pinia state -> mesh updates
  // Return controls and update functions
}
```

Domain state changes -> Pinia -> watchers update meshes.

InstancedMesh for containers from Plan 1. Equipment meshes added per plan.

### Manual Override Behavior

When player manually moves a container:
1. Cancel the container's current job
2. Create a new job for the manual destination
3. Recalculate any dependent jobs

This logic lives in `jobScheduler.ts` and must work correctly from Plan 1.

### Time Controls

Available from Plan 1:
- Pause: timeScale = 0
- 1×: timeScale = 1
- 2×: timeScale = 2
- 4×: timeScale = 4

Sim tick uses `deltaTime * timeScale`.

### Tutorial Hooks

Plan 1 builds a tutorial system with condition-based step progression:

```typescript
interface TutorialStep {
  id: string
  prompt: string
  condition: () => boolean  // When to advance
  action?: () => void  // Auto-action when reached
}
```

The same system can be reused for tooltips/hints in later plans.

---

## 10. box-empire-AGENTS.md Guidance

Future implementation agents must create and maintain a sim-specific agent guidance file at:

```
src/sims/box-empire/box-empire-AGENTS.md
```

### Initial Creation (Plan 1)

Create this file during Plan 1 implementation with these sections:

```markdown
# Box Empire — Sim-Specific Agent Guidance

## Implementation Status
- [x] Plan 1: Tutorial and Core Foundations
- [ ] Plan 2: Main Game Start
- [ ] Plan 3: Bigger Containers
- [ ] Plan 4: Special Cargo
- [ ] Plan 5: Multi-Berth

## Architecture Decisions
(Document key decisions and rationale)

## Module Responsibility Map
(Which file does what)

## Store Shape
(Current Pinia store structure)

## Job System Notes
(How jobs work, edge cases)

## Coordinate System
- 1 unit = 1 meter
- X: Along quay (East-West)
- Z: Perpendicular to quay (North toward yard, South toward water)
- Y: Up

## Audio Trigger Registry
(Event -> Sound mapping)

## Known Limitations
(Technical debt, simplifications)

## Testing Notes
(How to validate changes)
```

### Updates Per Plan

After completing each plan, update the file with:
- Check off completed plan in Implementation Status
- Document any new architecture decisions
- Update module map with new files
- Update store shape with new fields
- Add any new audio triggers
- Note any new limitations or debt

---

## 11. Implementation Order Guidance and Risk Notes

### Plan 1: Highest Risk

Plan 1 is the riskiest because it establishes:
- Job system (core of all automation)
- Pathfinding (all equipment movement)
- Equipment state machines (all operations)

**Guidance:**
- Get the automated container flow working end-to-end before polishing visuals
- The job scheduler and manual override logic are the hardest parts
- Design job recalculation carefully — it affects every subsequent plan
- Test the full tutorial flow repeatedly during development

### Plan 2: Moderate Risk

The yard assignment AI is the main risk.

**Guidance:**
- Use the yard grouping heuristic from the skill files but keep it simple initially
- Start with first-available, then add POD-grouped as enhancement
- Ensure save/load works reliably before moving on

### Plan 3: Moderate Risk

40ft container support touches multiple systems:
- Yard slots (double bay width)
- Vessel stowage (even bay numbers)
- Rendering (longer meshes)

**Guidance:**
- Plan for 40ft from Plan 1 — include `size` field in container entity
- The yard slot model should already support the double-bay concept
- Test 40ft stacking rules thoroughly

### Plan 4: High Complexity

STS crane animation is complex (4 articulated parts).

**Guidance:**
- Use the terminal-equipment-entities skill's state machine and phase breakdown
- Get the animation working with placeholder geometry first
- Add detailed models after the logic is solid

### Plan 5: Highest Complexity

Multi-vessel resource contention is the most complex gameplay logic.

**Guidance:**
- The job scheduler must already handle priority and equipment assignment cleanly
- Test with 2 vessels before attempting more
- Watch for deadlocks in crane rail sharing

---

## 12. Mandatory Instructions for Future Implementation Agents

### Before Starting Any Plan

1. **Read the knowledge base**: Review all `knowledge-base/dk_*.md` files for domain context
2. **Read the skills**: Review relevant `.ai/skills/` files for TypeScript interfaces and defaults
3. **Read AGENTS.md**: Follow project conventions
4. **Read this document**: Understand the full plan and cross-plan foundations

### During Implementation

1. **Build frequently**: Run `npm run build` after each significant change
2. **Lint constantly**: Run `npm run lint` to catch issues early
3. **Fix lint errors**: Run `npm run lint:fix` to auto-fix what's possible
4. **Test manually**: Play through the implemented features
5. **Update box-empire-AGENTS.md**: Document decisions and changes

### After Completing Each Plan

1. **Verify acceptance criteria**: Check every criterion in the plan
2. **Update box-empire-AGENTS.md**: Mark plan complete, document changes
3. **Clean build**: Ensure `npm run build` succeeds with no errors
4. **Clean lint**: Ensure `npm run lint` shows no errors
5. **Commit cleanly**: Descriptive commit message referencing the plan

### Critical Rules

1. **Implement ONE plan at a time**: Do not look ahead or partially implement future plans
2. **All code in sim folder**: Everything stays inside `src/sims/box-empire/`
3. **Follow Vue conventions**: `<script setup lang="ts">`, `<style scoped>`
4. **Strict TypeScript**: No `any` types, handle all cases
5. **Copy assets**: Copy needed files from `available-media/` into `box-empire/assets/`

---

## Appendix: Quick Reference

### Key Skill Files

| Topic | Skill File |
|-------|-----------|
| Container data | `.ai/skills/container-cargo-entities/SKILL.md` |
| Vessel data | `.ai/skills/vessel-entities/SKILL.md` |
| Equipment data | `.ai/skills/terminal-equipment-entities/SKILL.md` |
| Infrastructure | `.ai/skills/terminal-infrastructure/SKILL.md` |
| Operations | `.ai/skills/terminal-operations/SKILL.md` |
| Economics | `.ai/skills/terminal-economics/SKILL.md` |
| Three.js + Vue | `.ai/skills/threejs-vue3-animation/SKILL.md` |
| Adding a sim | `.ai/skills/adding-a-sim/SKILL.md` |

### Key Domain Files

| Topic | Knowledge Base File |
|-------|-------------------|
| Container attributes | `knowledge-base/dk_containers__logical_attributes.md` |
| Hazardous cargo | `knowledge-base/dk_sse__hazardous_containers_imdg.md` |
| Vessel structure | `knowledge-base/dk_vessels__physical_classes_and_structure.md` |
| Quay cranes | `knowledge-base/dk_equipment__quay_cranes_sts.md` |
| Reach stackers | `knowledge-base/dk_equipment__reach_stackers.md` |
| Yard storage | `knowledge-base/dk_yard__storage_blocks_and_locations.md` |
| Terminal layouts | `knowledge-base/dk_infra__terminal_layouts_and_roads.md` |
| Gate processes | `knowledge-base/dk_ops__gatehouse_processes.md` |
| Economics | `knowledge-base/dk_sim__economics_tariffs_costs.md` |

### Container Dimensions

| Size | Length | Width | Height |
|------|--------|-------|--------|
| 20ft | 6.06 m | 2.44 m | 2.59 m |
| 40ft | 12.19 m | 2.44 m | 2.59 m |
| 40HC | 12.19 m | 2.44 m | 2.90 m |

### Equipment Reference Speeds

| Equipment | Travel | Cycle |
|-----------|--------|-------|
| Reach Stacker | 5 m/s unladen | 8s pick + 8s place |
| Mobile Harbor Crane | — | 90s full cycle |
| RMG | 1.7 m/s gantry | ~45s cycle |
| STS | 0.6 m/s gantry, 3 m/s trolley | ~62s cycle |

### Sound Effect Mapping

| Event | Sound File |
|-------|-----------|
| Container placed | `container-loaded-to-ship.mp3` |
| Money earned | `money-increase-ca-ching-.mp3` |
| Vessel arrived | `small-ship-three-horns-in-a-row.mp3` |
| Vessel departed | `small-ship-three-horns-in-a-row.mp3` |
| Tutorial complete | `group-yay-cheer.mp3` |
| Level up | `level-up.mp3` |
| Error/warning | `gaming-negative-event-sound.mp3` |

---

*End of Box Empire Master Implementation Roadmap*

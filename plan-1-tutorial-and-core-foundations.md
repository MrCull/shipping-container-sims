# Box Empire — Plan 1: Tutorial and Core Simulation Foundations

> **Status:** Not started
> **Dependencies:** None — this is the first plan
> **Estimated scope:** Largest plan — establishes all foundational systems

---

## Objective

Deliver a playable tutorial scenario that teaches the player the basics of container terminal operations while establishing the complete simulation architecture that all subsequent plans (2–5) build upon.

This is the **most critical plan** because it creates nearly all foundational systems: the job scheduler, equipment state machines, pathfinding, yard model, vessel lifecycle, economy, event/audio system, tutorial scripting, and the full Three.js rendering pipeline.

---

## Prerequisites — Read Before Implementing

1. **AGENTS.md** — Project conventions, folder structure, linting rules
2. **Skill files** (see [Appendix A](#appendix-a-skill-file-reference)):
   - `.ai/skills/adding-a-sim/SKILL.md` — Folder structure, `SimDefinition`, auto-discovery
   - `.ai/skills/container-cargo-entities/SKILL.md` — Container interfaces, lifecycle states, colors
   - `.ai/skills/vessel-entities/SKILL.md` — Vessel classes, bay-row-tier coordinates
   - `.ai/skills/terminal-equipment-entities/SKILL.md` — Equipment four-lens model, state machines, specs
   - `.ai/skills/terminal-infrastructure/SKILL.md` — Yard blocks, berth model, layout graph
   - `.ai/skills/terminal-operations/SKILL.md` — Container flows, event types, crane cycle model
   - `.ai/skills/terminal-economics/SKILL.md` — Handling charges, surcharges, storage fees
   - `.ai/skills/threejs-vue3-animation/SKILL.md` — Four-layer architecture, InstancedMesh, scene conventions
3. **Knowledge base files** (see [Appendix B](#appendix-b-knowledge-base-reference))

---

## Player Experience

1. Player clicks "Start Tutorial" from the Box Empire start screen
2. A guided scenario begins:
   - Pre-built terminal with gatehouse, 10-bay yard storage, 1 reach stacker, 1 mobile harbor crane
   - A tiny vessel is announced, carrying 5 import containers to discharge
   - 5 export containers need to be loaded onto the vessel
3. Tutorial prompts guide the player through each step:
   - "Click 'Open Gatehouse' to allow trucks to enter"
   - 5 trucks arrive carrying export containers
   - Each truck is processed at the gate and drives to the yard
   - The reach stacker automatically picks containers from trucks and places them in yard storage
   - Once all 5 export containers are stored, the vessel arrives
   - The mobile harbor crane discharges 5 import containers from the vessel to the quay buffer
   - The reach stacker picks import containers from quayside and places them in yard storage
   - Trucks arrive to collect import containers (gate-out earns money)
   - The reach stacker retrieves export containers and takes them to quayside
   - The mobile harbor crane loads export containers onto the vessel (loading earns money)
4. Tutorial ends when:
   - All 5 import containers have left via the gatehouse
   - All 5 export containers are loaded on the vessel
   - The vessel departs
5. Celebration modal appears with cheering sound effects

---

## Architecture Overview

### Four-Layer Architecture

From the `threejs-vue3-animation` skill — all Box Empire code follows this pattern:

| Layer | Responsibility | Technologies |
|-------|---------------|--------------|
| **1 — Domain Model** | Pure TypeScript simulation logic. Containers, equipment, jobs, vessels. No Three.js imports. Driven by simulation tick. | TypeScript modules in `modules/` |
| **2 — Application State** | Pinia store bridging domain logic and rendering. Holds entity positions, animation targets, UI state. | Pinia store in `store/gameStore.ts` |
| **3 — Scene Adapter** | Composables that translate Pinia state into Three.js objects. Watchers react to state changes and update meshes. | Composables in `composables/` |
| **4 — Render Loop** | 60fps `requestAnimationFrame` loop, decoupled from simulation tick. Interpolates between simulation states for smooth visuals. | `useGameLoop.ts` composable |

### Coordinate System

- **1 unit = 1 meter**
- **X axis**: Along the quay (East–West)
- **Z axis**: Perpendicular to quay — negative toward water, positive toward yard
- **Y axis**: Up (height)
- **Quay line**: Z = 0
- **Water**: Z < 0
- **Yard**: Z > 0

### Fixed-Step Simulation

The simulation runs at a fixed tick rate (e.g., 20 Hz) independent of frame rate. Time controls multiply the sim delta:

| Control | `timeScale` |
|---------|------------|
| Pause | 0 |
| 1× | 1 |
| 2× | 2 |

The render loop interpolates entity positions between ticks for smooth 60fps visuals.

---

## Simulation Systems

### 1. Job System (Core of All Automation)

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

**Job creation triggers:**
- **Gate-in event**: Truck arrives with container → job to move container from gate to yard
- **Vessel discharge**: Container on vessel needs to go ashore → job to move from vessel to quay buffer, then quay buffer to yard
- **Gate-out request**: Import container ready for collection → job to move from yard to gate
- **Vessel loading**: Export container needs to go aboard → job to move from yard to quay buffer, then quay buffer to vessel

**Job scheduler behavior:**
1. Maintain a priority queue of pending jobs
2. Assign jobs to idle equipment based on proximity and capability
3. Track job progress as equipment executes
4. Handle job cancellation and reassignment

**Manual override behavior** (critical — design this correctly from the start):
1. Cancel any job currently involving that container
2. Create a new job for the manual destination
3. Recalculate any dependent jobs (e.g., if the container was next in a load sequence, find a replacement)

### 2. Equipment State Machine

All equipment follows a common state machine:

```
IDLE → ASSIGNED → TRAVEL_TO_PICKUP → PICKING → TRAVEL_TO_DROP → DROPPING → IDLE
```

| State | Description |
|-------|-------------|
| `IDLE` | Equipment stationary, waiting for a job |
| `ASSIGNED` | Job assigned, equipment preparing to move |
| `TRAVEL_TO_PICKUP` | Equipment moving toward pickup location |
| `PICKING` | At pickup location, executing pick animation/timer |
| `TRAVEL_TO_DROP` | Carrying container, moving to dropoff |
| `DROPPING` | At dropoff, executing place animation/timer |

Each equipment type has different speeds and cycle times (see Equipment Scope below).

### 3. Pathfinding

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

For the tutorial, the graph is simple:
- **Gate node** — where trucks arrive/depart
- **Yard I/O node** — where trucks stop for reach stacker service
- **Quay buffer node** — where mobile harbor crane places/picks containers
- Connecting edges with appropriate distances

Equipment uses Dijkstra or A* to find the shortest path, then follows the path at the edge speed limit.

### 4. Container Entity

Subset of `ContainerEntity` from `container-cargo-entities` skill:

```typescript
interface Container {
  id: string  // ISO 6346 format, e.g., "MSKU1234567"
  size: '20ft'  // Only 20ft in Plan 1
  ownerColor: string  // Hex color from CONTAINER_COLORS palette
  weight: number  // kg (randomize 10000–25000)
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

**Container dimensions (20ft standard):** 6.06m × 2.44m × 2.59m, tare 2200kg, max gross 30480kg, TEU 1

**Color palette** (from skill): maersk #2E86C1, evergreen #006747, cosco #004B87, msc #FFD700, cma_cgm #003DA5, hapagLloyd #FF6600, one #FF00FF, hmm #00BFFF

### 5. Vessel Visit Lifecycle

```
announced → arrived → discharging → loading → departed
```

| State | Description |
|-------|-------------|
| `announced` | Vessel ETA known, discharge/load lists available |
| `arrived` | Vessel at berth, operations can begin |
| `discharging` | Mobile harbor crane unloading import containers |
| `loading` | Mobile harbor crane loading export containers |
| `departed` | Vessel has left, visit complete |

**Tutorial vessel spec:**

| Parameter | Value |
|-----------|-------|
| Name | "Tiny Feeder" |
| LOA | ~50 m |
| Beam | ~12 m |
| TEU capacity | 10 |
| Visible bays | 1 |
| Container slots | 5 (single bay, 1 row, 5 tiers) |

### 6. Truck Visit Lifecycle

```
approaching → at_gate → driving_to_yard → waiting_for_equipment → departing → departed
```

| State | Description |
|-------|-------------|
| `approaching` | Truck visible, heading to gate |
| `at_gate` | At gatehouse, being processed |
| `driving_to_yard` | Driving to yard I/O point |
| `waiting_for_equipment` | Stopped, waiting for reach stacker |
| `departing` | Container loaded/unloaded, truck leaving |
| `departed` | Truck has left the terminal |

**Truck spec:** Travel speed 8 m/s (~30 km/h), gate processing time 15s, capacity 1 × 20ft container.

### 7. Yard Model

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

**Slot assignment strategy:** First-available — find the lowest tier in the first available bay.

**Yard slot coordinate format:** `(blockId, bay, row, tier)` — this format is consistent through all plans.

### 8. Economy

Simple flat-rate economy for the tutorial:

| Event | Revenue |
|-------|---------|
| Import container gate-out | $100 |
| Export container loaded on vessel | $150 |

The economy module:
- Tracks a running balance (starts at $0 for tutorial)
- Records transactions with timestamps and container IDs
- Triggers audio (`money-increase-ca-ching-.mp3`) on revenue events

```typescript
interface Transaction {
  id: string
  type: 'gate_out_revenue' | 'vessel_load_revenue'
  amount: number
  containerId: string
  simTime: number
}
```

### 9. Event System

Unified event bus for game events:

```typescript
interface SimulationClock {
  currentTime: number  // sim seconds since start
  timeScale: number  // 0 = paused, 1 = normal, 2 = fast
  tickRate: number  // ticks per real second (e.g., 20)
}

// Event emission
function emitEvent(eventType: string, payload: unknown): void
function onEvent(eventType: string, handler: (payload: unknown) => void): void
```

**Event → sound mapping:**

| Event | Sound File (from `available-media/sound-samples/`) |
|-------|---------------------------------------------------|
| `container.placed` | `container-loaded-to-ship.mp3` |
| `money.earned` | `money-increase-ca-ching-.mp3` |
| `vessel.arrived` | `small-ship-three-horns-in-a-row.mp3` |
| `vessel.departed` | `small-ship-three-horns-in-a-row.mp3` |
| `tutorial.completed` | `group-yay-cheer.mp3` |
| `level.up` | `level-up.mp3` |

---

## Equipment Scope

### Reach Stacker

From `terminal-equipment-entities` skill — simplified for tutorial:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Travel speed (unladen) | 5 m/s | ~18 km/h |
| Travel speed (laden) | 4 m/s | ~14 km/h |
| Pick cycle time | 8 s | Position + grab + lift |
| Place cycle time | 8 s | Position + lower + release |
| Max stack height | 3 tiers | Tutorial limitation |
| Row reach | 1 row only | Tutorial simplification |
| Rated capacity | 45 t (1st row) | From skill: 45t/30-35t/15-20t by row |

**Responsibilities:**
- Unload trucks at yard I/O point
- Place containers in yard storage
- Retrieve containers from yard storage
- Deliver containers to quay buffer (for loading) or gate buffer (for gate-out)

**Animation state sequence** (from skill):
```
RS_JOB_ASSIGNED → RS_DRIVE_TO_PICK → RS_ALIGN_TO_PICK → RS_LOCKING → RS_PICK_CONFIRMED
→ RS_LIFT_CLEAR → RS_TRAVEL_WITH_LOAD → RS_ALIGN_TO_SET → RS_LOWERING_TO_SET
→ RS_UNLOCKING → RS_SET_CONFIRMED → RS_JOB_COMPLETED
```

### Mobile Harbor Crane

A small, slow quayside crane for the tutorial (not a full STS gantry crane):

| Parameter | Value | Notes |
|-----------|-------|-------|
| Cycle time | 90 s | Full pick-transfer-place cycle |
| Reach | 1 vessel bay | Can only access the single bay |
| Lift capacity | 1 container | Single-lift only |

**Responsibilities:**
- Discharge containers from the vessel to quay buffer
- Load containers from quay buffer to the vessel

---

## UI Scope

### 3D Viewport

- Full-screen canvas with HUD overlay
- Camera: OrbitControls, centered on terminal
- Lighting: Daylight setup (ambient + directional sun)
- Ground plane: Concrete/asphalt for yard and apron, water plane for sea

### Top Bar HUD

| Element | Description |
|---------|-------------|
| Money display | Current balance with animated change indicator |
| Time controls | Pause / 1× / 2× buttons |
| Tutorial progress | "Step 3 of 8" style indicator |

### Tutorial Overlay

- Speech-bubble style prompts pointing to relevant UI elements
- "Next" button to advance through informational steps
- Auto-advance when conditions are met (e.g., "Good! The gatehouse is now open.")

### Interactive Elements

| Element | Behavior |
|---------|----------|
| "Open Gatehouse" button | Toggles gatehouse state (open/closed) |
| Container click | Shows info tooltip, enables manual reassignment |
| Equipment click | Shows status tooltip (current job, state) |

### Event Feed

- Last 5 events displayed in scrolling list
- Newest at top
- Color-coded by event type (green = success, yellow = warning)

### Modals

| Modal | Trigger |
|-------|---------|
| Start Screen | Game launch — "Start Tutorial" button |
| Tutorial Complete | All 10 containers processed — celebration with star rating and stats |

---

## Data / State / Store (Pinia)

Single Pinia store: `useBoxEmpireStore`

```typescript
interface BoxEmpireState {
  // Game phase
  gamePhase: 'menu' | 'tutorial' | 'playing' | 'paused'

  // Time
  simTime: number
  timeScale: number  // 0 = paused, 1 = normal, 2 = fast

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

**Derived state (computed):**
- `activeJobs` — Jobs with status `'assigned'` or `'in_progress'`
- `pendingJobs` — Jobs with status `'pending'`
- `yardOccupancy` — Percentage of yard slots filled
- `equipmentStatus` — Map of equipment ID to current state
- `currentTutorialPrompt` — Text for current tutorial step

---

## Tutorial Step Definitions

```typescript
interface TutorialStep {
  id: string
  prompt: string
  condition: () => boolean  // When to auto-advance
  action?: () => void  // Auto-action when step is reached
}
```

**Steps:**

| # | Prompt | Condition to Advance |
|---|--------|---------------------|
| 1 | "Welcome to Box Empire! You're the manager of this small container terminal." | Player clicks "Next" |
| 2 | "This is your yard — containers are stored here in stacks." | Player clicks "Next" |
| 3 | "Click 'Open Gatehouse' to allow trucks carrying export containers to enter." | `gatehouseOpen === true` |
| 4 | "Trucks are arriving! Watch as the reach stacker unloads them into the yard." | All 5 export containers are `in_yard` |
| 5 | "A vessel has been announced! It's approaching the berth with 5 import containers." | Vessel state is `arrived` |
| 6 | "The mobile harbor crane is discharging containers from the vessel." | All 5 import containers are `in_yard` |
| 7 | "Trucks are arriving to collect the import containers. Each gate-out earns $100!" | All 5 import containers are `departed` |
| 8 | "Now the export containers are being loaded onto the vessel. Each load earns $150!" | All 5 export containers are `loaded_on_vessel` and vessel is `departed` |

---

## File Structure

```
src/sims/box-empire/
├── BoxEmpire.vue                    # Root component (exists — needs implementation)
├── definition.ts                     # Sim metadata (exists — update status to 'playable')
├── box-empire-AGENTS.md              # Sim-specific agent guidance (create)
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

### Assets to Copy

**From `available-media/sound-samples/` → `src/sims/box-empire/assets/sounds/`:**
- `container-loaded-to-ship.mp3`
- `money-increase-ca-ching-.mp3`
- `small-ship-three-horns-in-a-row.mp3`
- `group-yay-cheer.mp3`
- `level-up.mp3`
- `gaming-negative-event-sound.mp3`

**From `available-media/3d-models/` → `src/sims/box-empire/assets/models/`:**
- Container models (use simple procedural box geometry initially; import GLB models if needed for polish)
- Vessel model: `container-ship-small-empty-no-containers.glb` (~17 MB) or procedural
- Truck models: `truck-no-trailer.glb` or procedural

---

## Implementation Order (Recommended)

Build the simulation logic first, then visuals:

### Phase A — Types and Config
1. Define all TypeScript interfaces in `types/index.ts`
2. Set up constants in `modules/config.ts` (dimensions, speeds, cycle times, tutorial scenario data)

### Phase B — Core Simulation Logic (No Rendering)
3. Implement `modules/pathfinding.ts` and `modules/terminalMap.ts`
4. Implement `modules/yardManager.ts` (slot assignment, occupancy)
5. Implement `modules/jobScheduler.ts` (the hardest module — job queue, assignment, cancellation, recalculation)
6. Implement `modules/equipmentController.ts` (state machine, movement along paths)
7. Implement `modules/vesselManager.ts` (vessel visit lifecycle)
8. Implement `modules/truckManager.ts` (truck gate flow)
9. Implement `modules/economy.ts` (balance, transactions)

### Phase C — Pinia Store
10. Implement `store/gameStore.ts` with full state, actions, and computed properties

### Phase D — Game Loop
11. Implement `composables/useGameLoop.ts` (fixed-step tick + RAF render loop)

### Phase E — Rendering
12. Implement `modules/sceneBuilder.ts` (ground plane, water, lighting, quay)
13. Implement `modules/containerRenderer.ts` (InstancedMesh for containers)
14. Implement `modules/equipmentRenderer.ts` (reach stacker mesh)
15. Implement `modules/vesselRenderer.ts` (vessel mesh)
16. Implement `modules/truckRenderer.ts` (truck meshes)
17. Implement `composables/useThreeScene.ts` (wire renderers to Pinia watchers)

### Phase F — UI Components
18. Implement `components/GameCanvas.vue` (canvas wrapper)
19. Implement `components/TopBar.vue`, `components/ui/MoneyDisplay.vue`, `components/ui/TimeControls.vue`
20. Implement `components/EventFeed.vue`
21. Implement `components/ui/TutorialOverlay.vue`
22. Implement `components/modals/StartScreen.vue`, `components/modals/TutorialComplete.vue`
23. Implement `composables/useInput.ts` (click/hover raycasting)
24. Implement `components/ContainerInfo.vue`, `components/EquipmentInfo.vue`

### Phase G — Audio
25. Implement `composables/useAudio.ts`
26. Copy sound files from `available-media/sound-samples/`

### Phase H — Tutorial
27. Implement `modules/tutorial.ts` (step definitions, conditions, auto-actions)

### Phase I — Integration and Wiring
28. Wire everything together in `BoxEmpire.vue`
29. Update `definition.ts` status to `'playable'`

### Phase J — Polish and Test
30. Test full tutorial flow end-to-end
31. Test manual override (click container, reassign)
32. Lint (`npm run lint`) and fix
33. Build (`npm run build`) and verify
34. Create `box-empire-AGENTS.md`

---

## Cross-Plan Design Considerations

These decisions in Plan 1 affect all future plans. Get them right:

1. **Container `size` field**: Define as `ContainerSize` type (`'20ft'`), not a string literal — Plan 3 adds `'40ft'`
2. **Equipment base interface**: Use a polymorphic `Equipment` type with `equipmentType` discriminator — Plan 3 adds RMG, Plan 4 adds STS
3. **Yard slot model**: Use `(blockId, bay, row, tier)` addressing — Plan 3 needs double-bay for 40ft, Plan 4 needs reefer power flags
4. **Job system**: Support priority levels and equipment capability checks from the start — Plan 5 needs these for multi-vessel contention
5. **Economy transactions**: Use a generic `recordTransaction()` function — Plans 2–4 add new transaction types
6. **Event bus**: Use string-based event types — easy to extend per plan
7. **Terminal map**: Node-graph representation — Plans 2–5 add nodes for new yard blocks, gatehouses, berths

---

## Acceptance Criteria

- [ ] Tutorial plays from start to finish with no player intervention beyond opening the gatehouse
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
- [ ] No lint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

---

## Out of Scope for Plan 1

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

## Appendix A: Skill File Reference

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

## Appendix B: Knowledge Base Reference

| Topic | Knowledge Base File |
|-------|-------------------|
| Container physical specs | `knowledge-base/dk_containers__physical_attributes.md` |
| Container logical attributes | `knowledge-base/dk_containers__logical_attributes.md` |
| Reach stackers | `knowledge-base/dk_equipment__reach_stackers.md` |
| End-to-end flows | `knowledge-base/dk_ops__end_to_end_flows.md` |
| Gatehouse processes | `knowledge-base/dk_ops__gatehouse_processes.md` |
| Yard storage | `knowledge-base/dk_yard__storage_blocks_and_locations.md` |
| Terminal layouts | `knowledge-base/dk_infra__terminal_layouts_and_roads.md` |
| Economics/tariffs | `knowledge-base/dk_sim__economics_tariffs_costs.md` |

---

*End of Plan 1*

# Box Empire — Sim-Specific Agent Guide

## Overview

Box Empire is a container terminal operations sim/tycoon game. The player manages a small terminal, handling import/export containers through a gatehouse, yard storage, and vessel operations. The tutorial walks through a complete vessel visit: export trucks arrive, a vessel discharges imports, import pickup trucks collect them, and finally the export containers are loaded and the vessel departs.

## Architecture

Current implementation note: the Pinia store is now a UI-facing facade. Simulation behavior is delegated into focused domain modules:

- `modules/scenario/` builds initial tutorial state and scenario counters.
- `modules/simulation/` owns the main tick orchestration and store-to-domain runtime contracts.
- `modules/operations/` owns truck operations, tutorial operation planning, and job completion side effects.
- `modules/allocators/` owns reserved yard destinations, shuffle target selection, and destination-specific job creation.
- `modules/movement/` owns centralized moving-entity occupancy checks, static yard stack obstacles, and reach-stacker routing.
- `modules/economy/` owns ledger-style transaction application and money event payloads.

Performance note: the large mutable simulation collections in `store/gameStore.ts` (`containers`, `equipment`, `jobs`, `truckVisits`, `vesselVisits`, `yardBlocks`, and `transactions`) are intentionally `shallowRef(markRaw(...))`. Mutate their objects in place during sim ticks, then call/retain the store's explicit collection refresh path so Vue updates HUD panels without deep-proxying every entity. Do not convert these collections back to deep reactive arrays unless you also replace the sim loop architecture.

Follows the four-layer architecture from `threejs-vue3-animation` skill:

1. **Domain Model** (`modules/`) — Pure TypeScript: scenario setup, simulation orchestration, operations, allocators, movement/occupancy, jobs, equipment, yard, vessels, trucks, economy, pathfinding, and scene construction
2. **Application State** (`store/gameStore.ts`) — Pinia facade bridging domain, UI state, rendering, events, narrator state, and camera cues
3. **Scene Adapter** (`composables/useThreeScene.ts`) — Translates Pinia state to Three.js; owns all renderers
4. **Render Loop** (`composables/useGameLoop.ts`) — Fixed-step 20Hz sim tick + RAF render

## Key Files

| File | Purpose |
|------|---------|
| `modules/scenario/tutorialScenario.ts` | Tutorial scenario factory: initial containers, yard, vessel, equipment, and counters |
| `modules/simulation/simulationEngine.ts` | Main simulation tick orchestration: vessels, trucks, equipment, jobs, tutorial operations, and tutorial progression |
| `modules/simulation/simulationTypes.ts` | Runtime contracts between the Pinia facade and simulation engine |
| `modules/operations/truckOperations.ts` | Truck spawning, truck/container sync, and truck-ready job creation |
| `modules/operations/tutorialOperations.ts` | Tutorial import/export operation planner, narrator milestones, and completion checks |
| `modules/operations/jobCompletion.ts` | Container lifecycle changes and follow-on work after completed jobs |
| `modules/allocators/yardAllocator.ts` | Reserved yard destinations, yard slot allocation, and shuffle target selection |
| `modules/allocators/destinationAllocator.ts` | Destination-specific job creation for truck, yard, quay, vessel, and shuffle moves |
| `modules/movement/occupancyWorld.ts` | Shared occupancy model for trucks, equipment, and static yard stack zones |
| `modules/movement/terminalGeometry.ts` | Shared physical footprints, yard stack geometry, and service-lane clearance calculations |
| `modules/movement/reachStackerRouting.ts` | Reach-stacker parking and waypoint routing around yard stack zones |
| `modules/economy/economyLedger.ts` | Revenue/cost application and money event payloads |
| `store/gameStore.ts` | Pinia facade: UI/render state, user actions, event buffering, narrator queueing, camera cues, and simulation engine delegation |
| `modules/jobScheduler.ts` | Job creation, assignment, cancellation, blocked-job recheck, and RS landside/waterside capability filtering |
| `modules/equipmentController.ts` | Equipment state machine (delegates RS route choice to movement modules; owns MHC slew/trolley/hoist target state) |
| `modules/vesselManager.ts` | Vessel visit lifecycle |
| `modules/truckManager.ts` | Truck gate flow, queue logic, waypoint-based axis-aligned movement |
| `modules/yardManager.ts` | Yard slot assignment (reserved slot tracking) |
| `modules/modelLoader.ts` | Async GLB loader with caching and clone pattern |
| `modules/containerRenderer.ts` | Per-container `Mesh` with full 6-face canvas-texture materials |
| `modules/containerMaterials.ts` | Canvas-texture PBR materials: corrugated walls, ISO markings, door panels, CSC plates, shipping-line liveries |
| `modules/equipmentRenderer.ts` | Procedural reach stacker and MHC meshes; the MHC now uses a shorter luffing boom, rotating upper works, trolley, hoist cables, and spreader-carried container placement tied to the active target |
| `modules/vesselRenderer.ts` | Vessel render with GLB swap-in on load |
| `modules/truckRenderer.ts` | Truck render with GLB swap-in on load |
| `modules/floatingTextRenderer.ts` | Canvas-sprite popups (money earned, events) that drift upward and fade |
| `modules/sceneBuilder.ts` | Full static scene construction: sky dome, animated ocean, quay wall, bollards, fenders, port lights, weathered ground, faded yard markings, old chain-link perimeter fence with in/out gate openings, improved gatehouse buildings with animated barrier rigs, quay buffer markings, terminal buildings |
| `modules/spatialOccupancy.ts` | Legacy AABB helper retained for compatibility |
| `modules/terminalMap.ts` | Path graph (nodes + bidirectional edges with speed limits) for the terminal layout |
| `modules/pathfinding.ts` | Dijkstra-based pathfinding over the terminal graph |
| `modules/economy.ts` | Revenue tracking and transaction creation |
| `modules/tutorial.ts` | 8-step tutorial step definitions with state-condition advancement |
| `modules/config.ts` | All constants and configuration (positions, speeds, economy rates, sound map) |
| `types/index.ts` | All TypeScript interfaces and location-ID helper functions |

## Components

| Component | Purpose |
|-----------|---------|
| `BoxEmpire.vue` | Root component — mounts canvas, wires composables, renders HUD |
| `components/GameCanvas.vue` | Three.js canvas wrapper |
| `components/TopBar.vue` | Money display, time controls, gate buttons, shared god-mode toggle, audio control |
| `components/EventFeed.vue` | Scrolling live event log |
| `components/ContainerInfo.vue` | Selected container detail panel |
| `components/EquipmentInfo.vue` | Selected equipment detail panel |
| `components/VesselInfo.vue` | Selected vessel detail panel with the manual sail action |
| `components/ui/JobQueueWidget.vue` | Active/pending job list |
| `components/ui/MoneyDisplay.vue` | Animated money counter |
| `components/ui/TimeControls.vue` | Speed selector (0×/1×/2×/3×/5×/10×/100×) |
| `components/ui/TutorialOverlay.vue` | Tutorial step prompt and progress indicator |
| `components/modals/StartScreen.vue` | Pre-game start/tutorial launch modal |
| `components/modals/TutorialComplete.vue` | Tutorial complete summary modal |

## Composables

| Composable | Purpose |
|-----------|---------|
| `composables/useThreeScene.ts` | Scene setup, renderer instantiation, per-frame `updateEntities()`, `spawnFloatingText()`, `triggerVesselShake()`, tutorial/narrator camera cue pans, animated gate barrier updates, container raycasting, WebGL failure detection (`webglFailed` ref) |
| `composables/useGameLoop.ts` | RAF loop with fixed-step accumulator; delegates sim ticks to store and render to scene |
| `composables/useAudio.ts` | Sound effect playback mapped via `SOUND_MAP` in config |
| `composables/useInput.ts` | Mouse/pointer event handling for container selection |

## Simulation Flow (Tutorial)

1. Player clicks "Start Tutorial" → `initTutorial()` sets up yard, vessel, containers, equipment
2. Player opens **Export Gate** (`gatehouse.exportLaneOpen = true`) → export trucks spawn and queue in a lane outside the in-gate at `GATE_INGATE_POSITION` (one-at-a-time through gate)
3. Reach stacker stores export containers in yard (slot conflicts prevented via reservation set in `getReservedYardSlotIds()`)
4. Vessel arrives (correctly oriented along the Z axis, bow at +Z) → top-of-stack discharge jobs become pending immediately, then enabled MHCs discharge import containers to crane-relative discharge exchange points
5. Reach stacker moves imports from buffer to yard
6. **Import Gate** opens (`gatehouse.importLaneOpen = true`) → import pickup trucks arrive; RS delivers containers to trucks → trucks exit via the out-gate at `GATE_OUTGATE_POSITION`, earning $100 per container
7. RS moves export containers to load quay buffer → MHC loads onto vessel → $150 revenue per container
8. Vessel departs (horn plays) → tutorial complete. A selected vessel can also be ordered to sail manually; that cancels active vessel moves and charges an unprocessed-import fine for each import container still on board.

## Time Controls

- Supports 0× (pause), 1×, 2×, 3×, 5×, 10×, **100×** speed
- Fixed-step sim tick (20 Hz) with time scaling
- Max 20 ticks/frame at ≤10×; max 200 ticks/frame at ≥50× to allow fast-forward

## Terminal Layout

- **In-gate** — `GATE_INGATE_POSITION` `{ x: -38, z: 54 }` in the front fence; truck queue lane runs along X outside the terminal
- **Out-gate** — `GATE_OUTGATE_POSITION` `{ x: 42, z: 88 }` on the right/back edge of the compact tutorial terminal; import trucks exit here after pickup
- **Yard truck stand** — trucks stop on the landside road no closer than 1.5 reach-stacker lengths from the yard stack line; RS serves them from either truck side based on the shorter approach
- **Quay buffer** — separate discharge `{ x: -5, z: 3 }` and load `{ x: 5, z: 3 }` spots
- **Berth** — first vessel berth is offset to the left of centre and later god-mode berths step along +X behind it, with wide spacing so multiple feeder hulls do not overlap
- **Terminal bounds** — X: -50 → 50, Z: -60 → 118

Trucks use axis-aligned waypoint routes (stored in `TruckVisit.waypoints`), updated by `truckManager`. Truck movement is clamped to one axis per tick even if a direct hold target has both X and Z differences, so trucks should never point or move diagonally. The RS uses side-aware routes from `movement/reachStackerRouting.ts` and validates movement through `movement/occupancyWorld.ts`; its body heading follows the current travel axis while driving, then turns to face the work target only once parked. Reach stackers are allowed to pass through each other, but trucks, mobile harbor cranes, and yard stack zones remain occupancy blockers. Yard stack zones are static occupancy obstacles, and service lanes are derived from `movement/terminalGeometry.ts`, so vehicles cannot drive through storage stacks even if a future route is generated incorrectly.

## Assets

GLB models in `assets/models/`:

| File | Used by | Notes |
|------|---------|-------|
| `container-ship-large-empty-no-containers.glb` | `vesselRenderer.ts` | ~1.8 MB; swapped in after procedural mesh |
| `container-ship-small-empty-no-containers.glb` | `vesselRenderer.ts` | Fallback / smaller vessel variant |
| `truck-no-trailer.glb` | `truckRenderer.ts` | ~8.3 MB; swapped in after procedural mesh |

Sounds in `assets/sounds/`:

| File | Event |
|------|-------|
| `container-loaded-to-ship.mp3` | `container.placed` |
| `money-increase-ca-ching-.mp3` | `money.earned` |
| `small-ship-three-horns-in-a-row.mp3` | `vessel.arriving`, `vessel.departing` |
| `group-yay-cheer.mp3` | `tutorial.completed` |
| `level-up.mp3` | `level.up` |
| `gaming-negative-event-sound.mp3` | Negative events |

The reach stacker uses an enhanced procedural mesh (GLB at 48 MB was too large).
Containers use individual `THREE.Mesh` with per-container `createContainerMaterials()` for full 6-face canvas-texture PBR surfaces (corrugated walls, door panels, ISO markings, CSC plate, hazmat stripe). Materials are cached per shipping-line color hex.

## Equipment Types

- **Reach Stacker** (`rs-1`): Yard operations — unladen 5 m/s, laden 4 m/s, 8s pick/place. Uses axis-aligned waypoints, can access yard stacks from both landside and waterside, and can approach trucks from either side based on the shorter path. `canServeLandside` gates truck ↔ yard jobs, `canServeWaterside` gates quay ↔ yard jobs, both default to enabled, and both are overridden by the main `enabled` toggle. `armTargetY` / `armDropStartY` drive boom tip animation; `headingY` drives body rotation.
- **Mobile Harbor Crane** (`mhc-1`): Vessel operations — 45s full cycle. The base travels along the quay only while empty to line up with vessel bays, keeps at least two container lengths from other MHCs, and carries out pickup/drop reach with the upper works, boom, trolley, hoist, and spreader. The paired import/export quay exchange markings move with the crane base. `spreaderZ` is used as a signed reach command, and `craneMode` controls whether it discharges, loads, or both. Each MHC also has per-vessel and per-bay permissions used by job assignment; newly spawned vessels are enabled by default on all existing MHCs.
- **Vessel stowage**: The small feeder cargo grid is 4 bays × 3 rows × 2 tiers (24 slots), matching the usable deck area of the shared small feeder GLB and avoiding the aft deckhouse. Slot references are ordered tier-first, then bay, then row, so initial/spawned containers fill a whole tier before stacking above another container. God-mode spawned vessels use the first 12 slots for import containers and add 12 export containers at the export gate so road trucks deliver them through the normal truck-to-yard flow.

## Economy

- Import gate-out: **$100** per container
- Export vessel load: **$150** per container
- Reach stacker move cost: **$10** per completed non-revenue move (truck ↔ yard, yard ↔ quay, yard ↔ yard shuffle)
- Quay crane import unload cost: **$20** per completed vessel → quay import discharge move
- Manual sail fine: **$100** per import container still on the departing vessel
- Tutorial total: **$1,250** (5 × $100 + 5 × $150)
- Transactions stored in `Transaction[]` with type `'gate_out_revenue' | 'vessel_load_revenue' | 'reach_stacker_move_cost' | 'quay_crane_import_unload_cost' | 'unprocessed_import_fine'`

## Gatehouse State

`GatehouseState` has two independent lanes:
- `exportLaneOpen` — controls whether export delivery trucks can enter through the in-gate
- `importLaneOpen` — controls whether import pickup trucks can enter and use the out-gate flow

Both flags are checked in the tutorial flow and reflected in the `TopBar` gate-open buttons.
The gate barriers are animated in the scene layer: they raise before nearby trucks pass through the respective gate lane and settle back down once the truck has cleared the boom.

## Shipping Lines / Container Liveries

Eight shipping lines are defined in `containerMaterials.ts` (`SHIPPING_LINE_LIVERY`) and `config.ts` (`SHIPPING_LINE_COLORS`):

| Key | Livery name | Hex |
|-----|-------------|-----|
| `maersk` | MAERSK | `#2E86C1` |
| `evergreen` | EVERGREEN | `#006747` |
| `cosco` | COSCO | `#004B87` |
| `msc` | MSC | `#cc9900` |
| `cma_cgm` | CMA-CGM | `#003DA5` |
| `hapag_lloyd` | HAPAG | `#FF6600` |
| `one` | ONE | `#8800AA` |
| `hmm` | HMM | `#0099CC` |

## Known Behaviours

- Containers with `lifecycleState === 'on_vessel'` are **hidden** (not rendered) until discharged
- Containers are synced to their carrying truck's position during movement phases
- The vessel hull shape runs along the Z axis (bow at +Z, stern at −Z), matching the berth orientation
- Tutorial and narrator milestones can request guided camera pans to relevant areas such as the vessel approach lane, berth, crane, quay, yard, truck stand, out-gate, and gatehouse; these animate the OrbitControls camera rather than replacing the camera system
- Completed reach-stacker jobs deduct operating cost immediately, emit a `money.spent` event, and play `coin-drop-1-second.mp3`
- Shared global god mode can be toggled by typing `god` or using the lightning icon beside mute; in Box Empire it suppresses move-cost and quay-unload money deductions, hides narrator/tutorial dialog prompts, and disables event-driven camera pans
- Trucks depart via the out-gate at `GATE_OUTGATE_POSITION.z`, clearing the terminal
- Yard destination allocation reserves whole stacks around in-progress conflicting work: stacks with an active outbound yard pickup are skipped as new destinations, and yard pickup jobs from a stack remain blocked while another active move is inbound to that same stack.
- `movement/occupancyWorld.ts` is rebuilt during simulation ticks from current moving entity positions plus static yard stack zones; extend it when adding richer traffic, route reservations, or additional blocked zones
- The ocean mesh in `sceneBuilder.ts` is animated each frame via `animateOcean(time)` using vertex displacement — call this from the render loop
- `FloatingTextRenderer.update()` must be called each animation frame to advance fade/drift
- WebGL availability is tested at startup; if it fails, `webglFailed` ref is set and the scene is not initialised

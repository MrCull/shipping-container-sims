# Box Empire — Sim-Specific Agent Guide

## Overview

Box Empire is a container terminal operations sim/tycoon game. The player manages a small terminal, handling import/export containers through a gatehouse, yard storage, and vessel operations. The tutorial walks through a complete vessel visit: export trucks arrive, a vessel discharges imports, import pickup trucks collect them, and finally the export containers are loaded and the vessel departs.

## Architecture

Follows the four-layer architecture from `threejs-vue3-animation` skill:

1. **Domain Model** (`modules/`) — Pure TypeScript: jobs, equipment, yard, vessels, trucks, economy, pathfinding, spatial occupancy, scene construction
2. **Application State** (`store/gameStore.ts`) — Pinia store bridging domain and rendering
3. **Scene Adapter** (`composables/useThreeScene.ts`) — Translates Pinia state to Three.js; owns all renderers
4. **Render Loop** (`composables/useGameLoop.ts`) — Fixed-step 20Hz sim tick + RAF render

## Key Files

| File | Purpose |
|------|---------|
| `store/gameStore.ts` | Central Pinia store — all game state, tick logic, and job/truck/vessel orchestration |
| `modules/jobScheduler.ts` | Job creation, assignment, cancellation, blocked-job recheck, and RS landside/waterside capability filtering |
| `modules/equipmentController.ts` | Equipment state machine and movement (RS waypoints, side-aware truck/yard access, MHC spreader animation) |
| `modules/vesselManager.ts` | Vessel visit lifecycle |
| `modules/truckManager.ts` | Truck gate flow, queue logic, waypoint-based axis-aligned movement |
| `modules/yardManager.ts` | Yard slot assignment (reserved slot tracking) |
| `modules/modelLoader.ts` | Async GLB loader with caching and clone pattern |
| `modules/containerRenderer.ts` | Per-container `Mesh` with full 6-face canvas-texture materials |
| `modules/containerMaterials.ts` | Canvas-texture PBR materials: corrugated walls, ISO markings, door panels, CSC plates, shipping-line liveries |
| `modules/equipmentRenderer.ts` | Procedural reach stacker (body + cab + boom) and MHC meshes with animated spreader |
| `modules/vesselRenderer.ts` | Vessel render with GLB swap-in on load |
| `modules/truckRenderer.ts` | Truck render with GLB swap-in on load |
| `modules/floatingTextRenderer.ts` | Canvas-sprite popups (money earned, events) that drift upward and fade |
| `modules/sceneBuilder.ts` | Full static scene construction: sky dome, animated ocean, quay wall, bollards, fenders, port lights, ground, yard markings, terminal fence with in/out gates, gatehouse buildings with barriers, quay buffer markings, terminal buildings |
| `modules/spatialOccupancy.ts` | AABB soft-collision registry — trucks and equipment register extents; `canMoveTo()` prevents overlap |
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
| `components/TopBar.vue` | Money display, time controls, gate buttons |
| `components/EventFeed.vue` | Scrolling live event log |
| `components/ContainerInfo.vue` | Selected container detail panel |
| `components/EquipmentInfo.vue` | Selected equipment detail panel |
| `components/ui/JobQueueWidget.vue` | Active/pending job list |
| `components/ui/MoneyDisplay.vue` | Animated money counter |
| `components/ui/TimeControls.vue` | Speed selector (0×/1×/2×/3×/5×/10×/100×) |
| `components/ui/TutorialOverlay.vue` | Tutorial step prompt and progress indicator |
| `components/modals/StartScreen.vue` | Pre-game start/tutorial launch modal |
| `components/modals/TutorialComplete.vue` | Tutorial complete summary modal |

## Composables

| Composable | Purpose |
|-----------|---------|
| `composables/useThreeScene.ts` | Scene setup, renderer instantiation, per-frame `updateEntities()`, `spawnFloatingText()`, `triggerVesselShake()`, tutorial/narrator camera cue pans, container raycasting, WebGL failure detection (`webglFailed` ref) |
| `composables/useGameLoop.ts` | RAF loop with fixed-step accumulator; delegates sim ticks to store and render to scene |
| `composables/useAudio.ts` | Sound effect playback mapped via `SOUND_MAP` in config |
| `composables/useInput.ts` | Mouse/pointer event handling for container selection |

## Simulation Flow (Tutorial)

1. Player clicks "Start Tutorial" → `initTutorial()` sets up yard, vessel, containers, equipment
2. Player opens **Export Gate** (`gatehouse.exportLaneOpen = true`) → export trucks spawn and queue in a lane outside the in-gate at `GATE_INGATE_POSITION` (one-at-a-time through gate)
3. Reach stacker stores export containers in yard (slot conflicts prevented via reservation set in `getReservedYardSlotIds()`)
4. Vessel arrives (correctly oriented along the Z axis, bow at +Z) → MHC discharges import containers to the discharge quay buffer
5. Reach stacker moves imports from buffer to yard
6. **Import Gate** opens (`gatehouse.importLaneOpen = true`) → import pickup trucks arrive; RS delivers containers to trucks → trucks exit via the out-gate at `GATE_OUTGATE_POSITION`, earning $100 per container
7. RS moves export containers to load quay buffer → MHC loads onto vessel → $150 revenue per container
8. Vessel departs (horn plays) → tutorial complete

## Time Controls

- Supports 0× (pause), 1×, 2×, 3×, 5×, 10×, **100×** speed
- Fixed-step sim tick (20 Hz) with time scaling
- Max 20 ticks/frame at ≤10×; max 200 ticks/frame at ≥50× to allow fast-forward

## Terminal Layout

- **In-gate** — `GATE_INGATE_POSITION` `{ x: -44, z: 63 }` in the front fence; truck queue lane runs along X outside the terminal
- **Out-gate** — `GATE_OUTGATE_POSITION` `{ x: -50, z: 105 }` in the back fence; import trucks exit here after pickup
- **Yard truck stand** — trucks stop on the landside road no closer than 1.5 reach-stacker lengths from the yard stack line; RS serves them from either truck side based on the shorter approach
- **Quay buffer** — separate discharge `{ x: -5, z: 3 }` and load `{ x: 5, z: 3 }` spots
- **Berth** — `BERTH_POSITION` `{ x: 0, z: -20 }` so the vessel hull clears the quay wall
- **Terminal bounds** — X: −60 → 60, Z: −60 → 145

Trucks use axis-aligned waypoint routes (stored in `TruckVisit.waypoints`), updated by `truckManager`. The RS uses waypoints too; both go through `spatialOccupancy` checks via `canMoveTo()` before moving.

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
- **Mobile Harbor Crane** (`mhc-1`): Vessel operations — 90s full cycle. `spreaderZ` tracks lateral position along jib (positive = quay side, negative = vessel side). `craneMode` controls whether it discharges, loads, or both.

## Economy

- Import gate-out: **$100** per container
- Export vessel load: **$150** per container
- Reach stacker move cost: **$20** per completed non-revenue move (truck ↔ yard, yard ↔ quay, yard ↔ yard shuffle)
- Tutorial total: **$1,250** (5 × $100 + 5 × $150)
- Transactions stored in `Transaction[]` with type `'gate_out_revenue' | 'vessel_load_revenue' | 'reach_stacker_move_cost'`

## Gatehouse State

`GatehouseState` has two independent lanes:
- `exportLaneOpen` — controls whether export delivery trucks can enter through the in-gate
- `importLaneOpen` — controls whether import pickup trucks can enter and use the out-gate flow

Both flags are checked in the tutorial flow and reflected in the `TopBar` gate-open buttons.

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
- Trucks depart via the out-gate at `GATE_OUTGATE_POSITION.z`, clearing the terminal
- `spatialOccupancy` is rebuilt each tick from current entity positions; no manual "update" call is needed
- The ocean mesh in `sceneBuilder.ts` is animated each frame via `animateOcean(time)` using vertex displacement — call this from the render loop
- `FloatingTextRenderer.update()` must be called each animation frame to advance fade/drift
- WebGL availability is tested at startup; if it fails, `webglFailed` ref is set and the scene is not initialised

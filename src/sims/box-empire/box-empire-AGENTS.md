# Box Empire — Sim-Specific Agent Guide

## Overview

Box Empire is a container terminal operations sim/tycoon game. The player manages a terminal, handling import/export containers through gatehouse, yard storage, and vessel operations.

## Architecture

Follows the four-layer architecture from `threejs-vue3-animation` skill:

1. **Domain Model** (`modules/`) — Pure TypeScript: jobs, equipment, yard, vessels, trucks, economy, pathfinding
2. **Application State** (`store/gameStore.ts`) — Pinia store bridging domain and rendering
3. **Scene Adapter** (`composables/useThreeScene.ts`) — Translates Pinia state to Three.js
4. **Render Loop** (`composables/useGameLoop.ts`) — Fixed-step 20Hz sim tick + RAF render

## Key Files

| File | Purpose |
|------|---------|
| `store/gameStore.ts` | Central Pinia store — all game state and tick logic |
| `modules/jobScheduler.ts` | Job creation, assignment, cancellation |
| `modules/equipmentController.ts` | Equipment state machine and movement |
| `modules/vesselManager.ts` | Vessel visit lifecycle |
| `modules/truckManager.ts` | Truck gate flow + queue logic |
| `modules/yardManager.ts` | Yard slot assignment (reserved slot tracking) |
| `modules/modelLoader.ts` | Async GLB loader with caching and clone pattern |
| `modules/containerRenderer.ts` | InstancedMesh rendering with corrugated container geometry |
| `modules/equipmentRenderer.ts` | Reach stacker and MHC procedural meshes |
| `modules/vesselRenderer.ts` | Vessel render with GLB swap-in on load |
| `modules/truckRenderer.ts` | Truck render with GLB swap-in on load |
| `modules/economy.ts` | Revenue tracking |
| `modules/tutorial.ts` | Tutorial step definitions |
| `modules/config.ts` | All constants and configuration |
| `types/index.ts` | All TypeScript interfaces |

## Simulation Flow (Tutorial)

1. Player clicks "Start Tutorial" → `initTutorial()` sets up yard, vessel, containers, equipment
2. Player opens gatehouse → export trucks spawn and queue (one-at-a-time through gate)
3. Reach stacker stores export containers in yard (slot conflicts prevented via reservation set)
4. Vessel arrives (correctly oriented along berth) → MHC discharges import containers to quay buffer
5. Reach stacker moves imports from buffer to yard
6. Import pickup trucks arrive → RS delivers containers to trucks → gate-out revenue
7. RS moves export containers to quay buffer → MHC loads onto vessel → load revenue
8. Vessel departs → tutorial complete

## Time Controls

- Supports 0× (pause), 1×, 2×, 3×, 5×, 10×, **100×** speed
- Fixed-step sim tick (20 Hz) with time scaling
- Max 20 ticks/frame at ≤10×; max 200 ticks/frame at ≥50× to allow fast-forward

## Assets

GLB models are stored in `assets/models/` and loaded at runtime via `modelLoader.ts`:

| File | Used by | Notes |
|------|---------|-------|
| `container-ship-large-empty-no-containers.glb` | `vesselRenderer.ts` | ~1.8 MB; swapped in after procedural mesh displayed |
| `truck-no-trailer.glb` | `truckRenderer.ts` | ~8.3 MB; swapped in after procedural mesh displayed |

The reach stacker uses an enhanced procedural mesh (GLB at 48 MB was too large).  
Containers use an improved `InstancedMesh` geometry (corrugation ribs, corner posts, door panel).

## Equipment Types

- **Reach Stacker** (`rs-1`): Yard operations — unladen 5 m/s, laden 4 m/s, 8s pick/place
- **Mobile Harbor Crane** (`mhc-1`): Vessel operations — 90s full cycle

## Economy

- Import gate-out: $100 per container
- Export vessel load: $150 per container
- Tutorial total: $1,250 (5 × $100 + 5 × $150)

## Known Behaviours

- Containers with `lifecycleState === 'on_vessel'` are **hidden** (not rendered) until discharged
- Containers are synced to their carrying truck's position during all movement phases
- The vessel hull shape runs along the Z axis (bow at +Z, stern at -Z), matching the berth orientation
- Trucks depart via `GATE_POSITION.z + 60`, clearing the gate queue area

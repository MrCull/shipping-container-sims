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
| `modules/truckManager.ts` | Truck gate flow |
| `modules/yardManager.ts` | Yard slot assignment |
| `modules/economy.ts` | Revenue tracking |
| `modules/tutorial.ts` | Tutorial step definitions |
| `modules/config.ts` | All constants and configuration |
| `types/index.ts` | All TypeScript interfaces |

## Simulation Flow (Tutorial)

1. Player clicks "Start Tutorial" → `initTutorial()` sets up yard, vessel, containers, equipment
2. Player opens gatehouse → export trucks spawn and arrive
3. Reach stacker stores export containers in yard
4. Vessel arrives → MHC discharges import containers to quay buffer
5. Reach stacker moves imports from buffer to yard
6. Import pickup trucks arrive → RS delivers containers to trucks → gate-out revenue
7. RS moves export containers to quay buffer → MHC loads onto vessel → load revenue
8. Vessel departs → tutorial complete

## Time Controls

- Supports 0× (pause), 1×, 2×, 3×, 5×, 10× speed
- Fixed-step sim tick (20 Hz) with time scaling
- Max 20 ticks per frame to prevent spiral-of-death at high speeds

## Equipment Types

- **Reach Stacker** (`rs-1`): Yard operations — unladen 5 m/s, laden 4 m/s, 8s pick/place
- **Mobile Harbor Crane** (`mhc-1`): Vessel operations — 90s full cycle

## Economy

- Import gate-out: $100 per container
- Export vessel load: $150 per container
- Tutorial total: $1,250 (5 × $100 + 5 × $150)

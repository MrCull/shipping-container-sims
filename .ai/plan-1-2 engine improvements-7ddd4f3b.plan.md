<!-- 7ddd4f3b-0186-4667-a966-c7daf9ea71b5 -->
---
todos:
  - id: "data-model-updates"
    content: "Update types/index.ts and config.ts with all new fields: Equipment (enabled, craneMode, armTargetY), Container (shippingLine), GatehouseState, blocked JobStatus, dual gate/quay positions"
    status: pending
  - id: "fix-truck-rendering"
    content: "Debug and fix truck rendering (Issues 1+12): add error logging in GLB catch, verify mesh visibility, check spawn positions vs camera, ensure update() is called"
    status: pending
  - id: "spatial-occupancy"
    content: "Create modules/spatialOccupancy.ts: occupancy rectangles, overlap checks, registration, canMoveTo, integrate into truck and equipment movement"
    status: pending
  - id: "equipment-status"
    content: "Equipment enabled/disabled toggle (Issue 3): add enabled field, filter in job scheduler, skip in tick, add UI toggle"
    status: pending
  - id: "crane-mode"
    content: "Crane mode discharge/load/both (Issue 4): add craneMode field, filter in job assignment, add UI control"
    status: pending
  - id: "ground-level-equipment"
    content: "Clamp equipment Y=0, add armTargetY for animated reach (Issues 7+8): update equipmentController to separate ground movement from arm height"
    status: pending
  - id: "mhc-quay-buffers"
    content: "MHC dual quay buffer slots (Issue 9): add discharge/load positions in config, update all job creation to use correct buffer"
    status: pending
  - id: "blocked-jobs"
    content: "Blocked job handling (Issue 15): add blocked status, pre-pick accessibility check, recheckBlockedJobs, skip buried containers"
    status: pending
  - id: "yard-stacking-rules"
    content: "Yard stacking rules (Issue 10): enhance findAvailableSlot to segregate import/export containers by bay"
    status: pending
  - id: "vessel-rotation-model"
    content: "Vessel 90-degree rotation + correct GLB (Issue 5): swap to container-ship-small model, rotate, adjust approach logic"
    status: pending
  - id: "container-fbx-model"
    content: "Container FBX model + shipping line colors (Issue 6): add FBX loader, load 20ft model, add shippingLine field, derive colors"
    status: pending
  - id: "equipment-arm-animation"
    content: "Reach stacker and MHC arm/spreader animation in renderers (Issues 7+8 rendering): animate boom angle, spreader position"
    status: pending
  - id: "floating-money-popup"
    content: "Floating money popup (Issue 11): create floatingTextRenderer.ts with sprite-based text, spawn on money.earned events"
    status: pending
  - id: "dual-lane-gatehouse"
    content: "Dual-lane gatehouse (Issue 13): replace gatehouseOpen with GatehouseState, two lane positions, two queues, UI controls, scene markings"
    status: pending
  - id: "job-queue-widget"
    content: "Job queue UI widget (Issue 14): create JobQueueWidget.vue showing top 10 jobs with expandable details"
    status: pending
  - id: "integration-testing"
    content: "Wire everything together, update tutorial steps for dual gatehouse, test at all speeds, lint, update AGENTS.md"
    status: pending
isProject: false
---
# Plan 1.2: Engine, Data Structures, Graphics, and UI Improvements

> **Status:** Not started
> **Dependencies:** Plan 1.1 (implemented)
> **Scope:** Game engine logic, data model upgrades, 3D graphics, and new UI components -- all within `src/sims/box-empire/`

---

## Objective

Address 14 interconnected issues that require changes to the game engine, data structures, 3D rendering, and UI before the simulation can progress to Plan 2. These improvements make the simulation more realistic, visually polished, and operationally correct.

---

## Issues and Solutions

### 1. Road Trucks Not Rendering

**Problem:** Road trucks are not visible in the scene despite the `TruckRenderer` existing and being wired in `useThreeScene.ts`.

**Root cause investigation:** The `TruckRenderer.update()` filters for `t.state !== 'departed'`, creates meshes, and sets positions. The truck GLB loads from `../assets/models/truck-no-trailer.glb`. Likely causes:
- GLB model failed to load silently (the `.catch(() => {})` swallows errors)
- The procedural fallback mesh may be too small or at wrong Y position
- Truck spawn positions may be far off-camera (currently `z = GATE_POSITION.z + spawnOffset + 20` which is `z = 50 + offset + 20` -- potentially well beyond the camera view at `z = 70+`)

**Solution:**
- Add console warning in the GLB `.catch()` so load failures are visible during development
- Verify procedural truck mesh dimensions and ensure it is clearly visible (bright color, reasonable scale)
- Adjust truck spawn positions or camera bounds so approaching trucks are within the visible scene
- Ensure `truckRenderer.update()` is being called each frame -- verify in `useThreeScene.ts` `updateEntities()`

**Files to change:**
- `modules/truckRenderer.ts` -- Add error logging, verify mesh creation
- `modules/config.ts` -- May need to adjust `GATE_POSITION` or camera far plane
- `composables/useThreeScene.ts` -- Verify `updateEntities` calls `truckRenderer.update()`

---

### 2. Spatial Occupancy / Collision Prevention

**Problem:** Entities can overlap -- two trucks can occupy the same position, equipment can drive through trucks, etc. Where one entity exists, another should not be able to occupy the same space.

**Solution:** Introduce a lightweight spatial occupancy system. Each entity occupies a bounding footprint (rectangle on the XZ ground plane). Before any entity moves to a new position, check that no other entity's footprint overlaps.

**New file:** `modules/spatialOccupancy.ts`

```typescript
interface OccupancyRect {
  entityId: string
  entityType: 'truck' | 'equipment' | 'container'
  cx: number  // center X
  cz: number  // center Z
  halfW: number  // half-width (X)
  halfD: number  // half-depth (Z)
}

function overlaps(a: OccupancyRect, b: OccupancyRect): boolean
function registerEntity(rect: OccupancyRect): void
function removeEntity(entityId: string): void
function canMoveTo(entityId: string, cx: number, cz: number): boolean
function findNearestFreePosition(cx: number, cz: number, halfW: number, halfD: number): Position3D
```

**Integration points:**
- `truckManager.ts` -- Before moving a truck, check `canMoveTo()`. If blocked, hold position.
- `equipmentController.ts` -- Before moving equipment, check occupancy. If target blocked, wait.
- `jobScheduler.ts` -- When assigning pickup/drop positions, verify they are reachable.

**Key design decisions:**
- This is a **soft** collision system (entities slow/stop rather than bounce)
- The occupancy grid is rebuilt each tick from current entity positions
- Gate queue positions are inherently collision-free via queue spacing (Issue 1 in Plan 1.1 already handles this)

---

### 3. Equipment Enabled/Disabled Status

**Problem:** No way to disable equipment. All equipment is always active. Need an `enabled` flag so disabled equipment does nothing.

**Solution:** Add an `enabled: boolean` field to the `Equipment` interface. When `enabled === false`, the equipment state machine skips all processing -- it stays in its current position and does not accept jobs.

**Data model changes (`types/index.ts`):**
```typescript
export interface Equipment {
  // ... existing fields ...
  enabled: boolean
}
```

**Logic changes:**
- `equipmentController.ts` -- At the start of `tickEquipment()`, if `!eq.enabled` return immediately (no-op)
- `jobScheduler.ts` -- In `assignPendingJobs()`, filter equipment to only those where `e.enabled === true`
- `store/gameStore.ts` -- Add `toggleEquipment(equipmentId: string)` action. Initialize all equipment with `enabled: true`

**UI:** Add a small toggle icon on the `EquipmentInfo` panel to enable/disable equipment.

---

### 4. Crane Mode: Discharge vs Load Status

**Problem:** The MHC should have a mode that controls whether it is allowed to discharge (import) containers from the vessel or load (export) containers onto the vessel. Currently it just does whatever job is assigned.

**Solution:** Add a `craneMode` field to `Equipment` (only relevant for crane types):

```typescript
export type CraneMode = 'discharge' | 'load' | 'both'

export interface Equipment {
  // ... existing fields ...
  craneMode: CraneMode  // only meaningful for crane types
}
```

**Logic changes:**
- `jobScheduler.ts` -- When assigning jobs to a crane, check if the job direction matches the crane mode:
  - `discharge` mode: only accept jobs where `pickupLocation.type === 'vessel_slot'`
  - `load` mode: only accept jobs where `dropoffLocation.type === 'vessel_slot'`
  - `both`: accept either
- `store/gameStore.ts` -- Add `setCraneMode(equipmentId, mode)` action. Default to `'both'` in tutorial.
- Tutorial flow in `gameStore.ts` -- When transitioning from discharging to loading phase, auto-switch crane mode if desired (or leave as `'both'` for simplicity).

**UI:** Add a dropdown/toggle on `EquipmentInfo` for crane-type equipment showing discharge/load/both.

---

### 5. Vessel Rotation (90 Degrees)

**Problem:** The vessel needs to be rotated 90 degrees. The vessel's length should run along the X axis (parallel to the quay), not along Z.

**Solution:** The vessel GLB model and the procedural fallback both need a 90-degree Y-axis rotation so the ship's length is along X. The vessel currently uses `container-ship-large-empty-no-containers.glb` but the user wants `container-ship-small-empty-no-containers.glb`.

**Files to change:**
- `modules/vesselRenderer.ts`:
  - Change the GLB URL to reference the correct small vessel model: `container-ship-small-empty-no-containers.glb`
  - Copy the correct GLB into `src/sims/box-empire/assets/models/`
  - Apply a 90-degree rotation so the ship's bow points along +X (or -X depending on the model's native orientation). Likely `glb.rotation.y = Math.PI / 2` or `-Math.PI / 2`
  - Also rotate the procedural fallback hull shape by 90 degrees
- `modules/vesselManager.ts` -- The vessel approach/departure logic may need to change if the vessel now sails along X rather than Z. When `arriving`, the ship should approach from the +X direction along the quay and slow to a stop at the berth position. When `departing`, it sails away along -X or +X.
- `modules/config.ts` -- Adjust `BERTH_POSITION` if needed so the rotated vessel sits correctly alongside the quay.

**Note:** The `container-ship-small-empty-no-containers.glb` file needs to be copied from `available-media/3d-models/` to `src/sims/box-empire/assets/models/`. The existing large vessel model reference should be replaced.

---

### 6. Container Visual Upgrade (FBX Model + Shipping Line Colors)

**Problem:** Containers look awful. Use `20-foot-shipping-container-old.FBX` or similar. Containers should be colored by shipping line by default.

**Solution:** Replace the current procedural corrugated `InstancedMesh` geometry with geometry extracted from the FBX model. Since `InstancedMesh` needs a single geometry, load the FBX, extract and merge its `BufferGeometry`, and use that as the instance template.

**Asset pipeline:**
- The FBX file needs `FBXLoader` from `three/addons/loaders/FBXLoader.js`
- Extend `modelLoader.ts` to support FBX loading alongside GLB
- Copy `20-foot-shipping-container-old.FBX` to `src/sims/box-empire/assets/models/`

**Shipping line colors:** Containers already have an `ownerColor` field assigned from `CONTAINER_COLOR_LIST`. The `ContainerRenderer` already applies per-instance colors. The improvement is:
- Assign a `shippingLine` string field to `Container` (e.g., `'maersk'`, `'evergreen'`)
- Derive `ownerColor` from a `SHIPPING_LINE_COLORS` lookup keyed by line name
- This is cosmetic but semantically correct

**Data model changes (`types/index.ts`):**
```typescript
export interface Container {
  // ... existing fields ...
  shippingLine: string  // e.g., 'maersk', 'evergreen'
}
```

**Files to change:**
- `modules/modelLoader.ts` -- Add `loadFBXModel()` function
- `modules/containerRenderer.ts` -- Load FBX geometry asynchronously, swap into `InstancedMesh` when ready; keep current geometry as fallback
- `types/index.ts` -- Add `shippingLine` field
- `modules/config.ts` -- Add `SHIPPING_LINE_COLORS` map and `SHIPPING_LINES` array
- `store/gameStore.ts` -- When creating containers, pick a random shipping line and derive color from it

---

### 7. Equipment Stays on Ground (Reach Stacker Arm Animation)

**Problem:** The reach stacker rises in elevation when placing containers at higher tiers. It should always stay on the ground (Y = 0) and use its arm/spreader to lift containers to the correct height.

**Solution:** Separate the equipment's ground position from the container's target position. The equipment always travels at Y = 0. The container being carried should animate vertically via the spreader/boom.

**Changes to `equipmentController.ts`:**
- During `travel_to_pickup` and `travel_to_drop`, clamp `eq.position.y = 0` -- only move in XZ
- The target position for travel should be `{ x: target.x, y: 0, z: target.z }` (ground level)
- The carried container's Y position should interpolate toward the target Y during the `picking` and `dropping` phases

**Changes to `equipmentRenderer.ts`:**
- For the reach stacker, animate the boom angle based on the target container height
- Store the current "arm reach height" as a property that interpolates during pick/drop phases
- The container attached to the spreader should be rendered at the boom tip, not at the equipment's base position

**New concept -- `Equipment.armTargetY`:**
```typescript
export interface Equipment {
  // ... existing fields ...
  armTargetY: number  // height the spreader is reaching to
}
```

This way the equipment body stays at ground level and only the arm/spreader conceptually reaches up.

---

### 8. Mobile Harbor Crane Stays on Ground + Arm Animation

**Problem:** Same as reach stacker -- the MHC rises off the ground. Additionally, the MHC's jib and spreader should visually move.

**Solution:** Same principle as Issue 7 -- the crane base stays at Y = 0. The jib and spreader visually animate.

**Changes to `equipmentRenderer.ts`:**
- The MHC mesh should have a `spreaderGroup` child that moves along the jib (Z axis of the jib) and lowers a cable (Y axis)
- During `picking`/`dropping` phases, animate the spreader position along the jib to reach over the vessel or quay buffer
- The spreader lowers to the container pick/place height, locks, then rises

**Changes to `equipmentController.ts`:**
- Ensure `eq.position.y = 0` always for MHC
- Add `eq.spreaderX` and `eq.spreaderY` (or similar) to track the spreader position for rendering

---

### 9. MHC Quay Buffer Slots (Discharge + Load)

**Problem:** The MHC currently drops all containers at a single `QUAY_BUFFER_POSITION`. There should be two dedicated ground slots near the crane: one for discharge/import containers and one for load/export containers.

**Solution:** Define two separate quay buffer positions:

**Config changes (`config.ts`):**
```typescript
export const QUAY_BUFFER_DISCHARGE_POSITION: Position3D = { x: -5, y: 0, z: 3 }
export const QUAY_BUFFER_LOAD_POSITION: Position3D = { x: 5, y: 0, z: 3 }
```

**Logic changes:**
- When the MHC discharges a container from the vessel, the drop location is `QUAY_BUFFER_DISCHARGE_POSITION`
- When the MHC loads a container onto the vessel, the pickup location is `QUAY_BUFFER_LOAD_POSITION`
- The reach stacker delivers export containers to `QUAY_BUFFER_LOAD_POSITION` (not generic quay buffer)
- The reach stacker picks up import containers from `QUAY_BUFFER_DISCHARGE_POSITION`

**Scene changes (`sceneBuilder.ts`):** Add two visible ground markings at the quay buffer positions (colored rectangles -- blue for discharge, orange for load).

**Store changes (`gameStore.ts`):** Update all job creation that references `QUAY_BUFFER_POSITION` to use the correct discharge or load variant based on container visit type.

---

### 10. Yard Stacking Rules (Import/Export Segregation)

**Problem:** The yard freely mixes import and export containers in the same stack. In the tutorial, stacking rules should try to keep imports and exports in separate stacks (bays).

**Solution:** Enhance `findAvailableSlot()` in `yardManager.ts` to consider the container's visit type when selecting a bay.

**Algorithm:**
1. First, try to find a slot in a bay that already contains containers of the same visit type (import or export)
2. If no matching bay has space, use an empty bay
3. Only as a last resort, use a bay with mixed types

**New function signature:**
```typescript
export function findAvailableSlot(
  block: YardBlock,
  reservedSlotIds?: Set<string>,
  preferredVisitType?: 'import' | 'export',
  containers?: Container[],  // to check what's already in each bay
): YardSlotRef | null
```

**Store changes:** Pass the container's `visitType` and the containers array when calling `findAvailableSlot()`.

---

### 11. Floating Money Popup

**Problem:** When money is earned there is no visual feedback at the container location. A floating "$100" or "$150" graphic should appear above the container and fade out.

**Solution:** Create a 3D text sprite system that spawns a floating label above a world position, drifts upward, and fades out over ~2 seconds.

**New file:** `modules/floatingTextRenderer.ts`

```typescript
interface FloatingText {
  id: string
  text: string
  color: string
  position: Position3D
  createdAt: number  // real time (performance.now)
  duration: number   // ms
}

class FloatingTextRenderer {
  spawn(text: string, color: string, worldPos: Position3D): void
  update(camera: THREE.Camera): void  // billboards face camera, animate opacity + Y drift
  dispose(): void
}
```

**Implementation:** Use `THREE.Sprite` with a `CanvasTexture` for each popup. The text is drawn on a small 2D canvas, converted to a texture, and placed as a sprite in the scene. Each frame, the sprite drifts upward and its material opacity decreases. Remove after duration expires.

**Integration:**
- `composables/useThreeScene.ts` -- Create `FloatingTextRenderer`, call `update()` in the render loop
- `store/gameStore.ts` -- When `money.earned` events fire, the scene adapter spawns a floating text at the container's world position

---

### 12. Import Pickup Trucks Not Rendering

**Problem:** Import pickup trucks are spawned in the store logic (lines 328-347) but they may not be rendering visibly. This is likely the same root cause as Issue 1 -- truck rendering is not working.

**Solution:** Fixing Issue 1 (truck rendering) will also fix this. Additionally, verify that `spawnImportPickupTruck()` is actually being called during the tutorial flow:
- `importPickupStarted` is set to `true` when import containers are in the yard and the vessel is discharging or later
- The spawn logic checks `importPickupTrucksActive < 2` and other conditions
- Ensure these conditions are actually being met during normal tutorial progression

**Debugging step:** Add a temporary `console.log` in `spawnImportPickupTruck()` to confirm trucks are created. Check that `truckVisits` array grows.

---

### 13. Dual-Lane Gatehouse with Independent States

**Problem:** The gatehouse currently has a single gate and a single `gatehouseOpen` boolean. It should have two separate lanes: one for export trucks (bringing containers in) and one for import pickup trucks (empty trucks coming to collect).

**Solution:**

**Data model changes (`types/index.ts`):**
```typescript
export interface GatehouseState {
  exportLaneOpen: boolean
  importLaneOpen: boolean
}
```

Replace `gatehouseOpen: boolean` in `BoxEmpireState` with `gatehouse: GatehouseState`.

**Config changes (`config.ts`):**
```typescript
export const GATE_EXPORT_LANE_POSITION: Position3D = { x: -43, y: 0, z: 50 }
export const GATE_IMPORT_LANE_POSITION: Position3D = { x: -37, y: 0, z: 50 }
```

**Logic changes:**
- `truckManager.ts` -- Export trucks target `GATE_EXPORT_LANE_POSITION`; import pickup trucks target `GATE_IMPORT_LANE_POSITION`. Each lane has its own queue.
- `store/gameStore.ts`:
  - Replace `gatehouseOpen` with `gatehouse: ref<GatehouseState>({ exportLaneOpen: false, importLaneOpen: false })`
  - Add `openExportGate()`, `closeExportGate()`, `openImportGate()`, `closeImportGate()` actions
  - Export trucks only spawn when `gatehouse.exportLaneOpen`
  - Import pickup trucks only spawn when `gatehouse.importLaneOpen`
- Tutorial flow: update tutorial steps to prompt opening both lanes at appropriate times

**Scene changes (`sceneBuilder.ts`):**
- Render two gate lanes (two barrier poles) with visible road markings
- Color-code: export lane (orange), import lane (blue)
- Add small labels or arrows

**UI changes:**
- Update `TutorialOverlay` and any gatehouse UI to show two separate open/close buttons
- The `TopBar` or a new gatehouse panel shows each lane's status

---

### 14. Job Queue UI Widget

**Problem:** No visibility into the job scheduler's move list. Need a widget showing the top 10 jobs with expandable details.

**Solution:** Create a new Vue component `components/ui/JobQueueWidget.vue`.

**Layout:**
- Fixed to the right side of the screen
- Shows the top 10 active/pending jobs in a compact list
- Each row: job ID (short), container ID (truncated), status icon, from -> to summary
- Clicking a row expands to show full details (assigned equipment, priority, timestamps)
- Collapsible header to minimize

**Data source:** Read from `store.jobs` filtered to non-completed/non-cancelled, sorted by priority descending.

**Color coding by status:**
- Pending: grey
- Assigned: yellow
- In Progress: green
- Blocked: red (new status, see Issue 15)

**Files to create:**
- `components/ui/JobQueueWidget.vue`

**Files to change:**
- `BoxEmpire.vue` -- Add `<JobQueueWidget />` to the template

---

### 15. Blocked Job Handling (Buried Containers)

**Problem:** Equipment can pick up a container that has another container stacked on top of it, which is physically impossible. If a container is buried, the job should be blocked and the equipment should skip it and do the next job.

**Solution:** Add a `'blocked'` status to `JobStatus` and implement a pre-pick check.

**Data model changes (`types/index.ts`):**
```typescript
export type JobStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'blocked'     // NEW
  | 'completed'
  | 'cancelled'
```

**Logic changes in `equipmentController.ts`:**
- When equipment arrives at the pickup location (transitioning from `travel_to_pickup` to `picking`), check if the container is accessible:
  - If `pickupLocation.type === 'yard_slot'`, call `isContainerOnTop()` from `yardManager.ts`
  - If the container is NOT on top (buried), set `job.status = 'blocked'`, release the equipment (set to `idle`), and the job returns to a blocked pool
- The job scheduler should periodically re-check blocked jobs to see if the blocking container has been removed

**Logic changes in `jobScheduler.ts`:**
- Add a `recheckBlockedJobs()` function called each tick that:
  - For each blocked job, check if the container is now accessible
  - If accessible, set status back to `pending` so it can be reassigned
- In `assignPendingJobs()`, skip jobs whose containers are not on top of their stack

**Files to change:**
- `types/index.ts` -- Add `'blocked'` to `JobStatus`
- `modules/equipmentController.ts` -- Pre-pick accessibility check
- `modules/jobScheduler.ts` -- `recheckBlockedJobs()`, accessibility filter
- `modules/yardManager.ts` -- `isContainerOnTop()` already exists, verify it works correctly
- `store/gameStore.ts` -- Call `recheckBlockedJobs()` in the tick loop

---

## Data Model Summary

Changes to `types/index.ts`:

```
Equipment:
  + enabled: boolean
  + craneMode: CraneMode          // 'discharge' | 'load' | 'both'
  + armTargetY: number             // height the arm is reaching to

Container:
  + shippingLine: string           // e.g., 'maersk'

BoxEmpireState:
  - gatehouseOpen: boolean         // REMOVE
  + gatehouse: GatehouseState      // REPLACE with two-lane state

JobStatus:
  + 'blocked'                      // new status

New types:
  + CraneMode = 'discharge' | 'load' | 'both'
  + GatehouseState = { exportLaneOpen: boolean; importLaneOpen: boolean }
  + OccupancyRect (in spatialOccupancy.ts)
  + FloatingText (in floatingTextRenderer.ts)
```

---

## New Files

```
src/sims/box-empire/
  modules/
    spatialOccupancy.ts      -- Spatial collision/occupancy system
    floatingTextRenderer.ts  -- Floating money popup sprites
  components/
    ui/JobQueueWidget.vue    -- Job queue sidebar widget
```

---

## Asset Changes

- Copy `available-media/3d-models/container-ship-small-empty-no-containers.glb` to `src/sims/box-empire/assets/models/` (replace the large vessel model reference)
- Copy `available-media/3d-models/20-foot-shipping-container-old.FBX` to `src/sims/box-empire/assets/models/`
- Update `modelLoader.ts` to support FBX loading via `FBXLoader`

---

## Implementation Order

### Phase A -- Foundational Data Model and Engine Changes
1. Update `types/index.ts` with all new fields (equipment enabled/craneMode/armTargetY, container shippingLine, GatehouseState, blocked job status)
2. Update `config.ts` with new positions (dual gate lanes, dual quay buffers, shipping line data)
3. Fix truck rendering (Issue 1 + Issue 12) -- debug and verify trucks appear
4. Create `modules/spatialOccupancy.ts` (Issue 2)

### Phase B -- Equipment Behavior Overhaul
5. Equipment enabled/disabled toggle (Issue 3)
6. Crane mode discharge/load/both (Issue 4)
7. Ground-level equipment movement -- clamp Y=0, separate arm animation (Issues 7 + 8)
8. MHC dual quay buffer slots (Issue 9)
9. Blocked job handling (Issue 15)

### Phase C -- Yard and Job Scheduling
10. Yard stacking rules -- import/export segregation (Issue 10)
11. Integrate spatial occupancy into truck and equipment movement (Issue 2)

### Phase D -- 3D Graphics Upgrades
12. Vessel rotation + correct GLB model (Issue 5)
13. Container FBX model + shipping line colors (Issue 6)
14. Reach stacker arm animation in renderer (Issue 7 rendering)
15. MHC arm/spreader animation in renderer (Issue 8 rendering)

### Phase E -- UI and Visual Effects
16. Floating money popup (Issue 11)
17. Dual-lane gatehouse UI and scene (Issue 13)
18. Job queue widget (Issue 14)

### Phase F -- Integration and Testing
19. Wire all new systems together in `gameStore.ts` tick loop
20. Update tutorial steps for dual gatehouse
21. Test full tutorial at 1x / 10x / 100x
22. Run `npm run lint` and fix issues
23. Update `box-empire-AGENTS.md`

---

*End of Plan 1.2*

# Plan: Box Empire — 3D GLB Models for Trucks & Vessels

## Context

Box Empire currently renders both trucks and vessels using 100% procedural Three.js geometry (BoxGeometry, CylinderGeometry, custom BufferGeometry). The GLB assets are already present in `src/sims/box-empire/assets/models/` and the `modelLoader.ts` utility is fully implemented and ready to use. The stowage-master sim recently received the same treatment: procedural meshes replaced with GLB swap-in on load. This plan replicates that approach in box-empire using the same assets and `modelLoader.ts` infrastructure that already exists.

**Assets available (already in box-empire):**
- `truck-no-trailer.glb` — truck cab/chassis (8.3 MB)
- `container-ship-small-empty-no-containers.glb` — vessel model (18 MB)
- `container-ship-large-empty-no-containers.glb` — larger vessel variant (1.8 MB, not used in tutorial)

## Approach

### Overview
1. Pre-warm both GLBs in `useThreeScene.ts` during `init()` so they're cached before any truck or vessel appears.
2. In `TruckRenderer.createTruckMesh()`: use `getModelSync()` to get the GLB if already loaded, else build the procedural mesh and then async-swap to GLB when load completes.
3. In `VesselRenderer.createVesselMesh()`: same pattern — GLB if cached, else procedural with async swap-in.
4. Add GLB transform constants to `config.ts` (rotation, scale target, y-offset, container-on-truck offset).

### Why Pre-warm
Trucks can appear quickly (player opens export gate early). Pre-warming in `init()` starts the download before the sim ticks begin, maximising the chance the GLB is ready before `createTruckMesh()` is called. The vessel appears later (after export trucks complete), so it will almost certainly be cached in time.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/sims/box-empire/modules/config.ts` | Add GLB transform constants |
| `src/sims/box-empire/composables/useThreeScene.ts` | Pre-warm GLBs in `init()` |
| `src/sims/box-empire/modules/truckRenderer.ts` | GLB swap-in replacing procedural |
| `src/sims/box-empire/modules/vesselRenderer.ts` | GLB swap-in replacing procedural |

---

## Step-by-Step Implementation

### Step 1 — Add GLB constants to `config.ts`

Add a new section after existing constants:

```ts
// ── GLB model transforms ────────────────────────────────────────────────────
export const TRUCK_GLB = {
  /** Uniform scale target: match a real ~8m truck length after GLB load */
  targetLength: 8,
  /** Y-rotation to align GLB facing +Z (value to be confirmed at runtime) */
  rotationY: Math.PI,
  /** Vertical shift so wheels sit on y=0 ground plane */
  yOffset: 0,        // set after measuring GLB bounding box min.y
  /** Container resting position relative to truck group origin */
  containerOffsetY: 1.5,   // adjust to sit on GLB deck
  containerOffsetZ: -1.0,  // same as current procedural offset
}

export const VESSEL_GLB = {
  /** GLB length axis is Z; game uses Z for vessel length — rotate to match */
  rotationY: 0,            // confirm at runtime; may need Math.PI / 2
  /** Vertical shift so waterline sits correctly relative to quay */
  yOffset: -2.5,           // to be tuned: stowage-master used 3.0
}
```

> **Note:** Exact values for `rotationY`, `yOffset`, and `containerOffsetY` must be measured at runtime using `new THREE.Box3().setFromObject(model)` — the values above are starting points to be confirmed during implementation.

---

### Step 2 — Pre-warm GLBs in `useThreeScene.ts` `init()`

After the renderer instantiations (after `truckRenderer = new TruckRenderer(scene)`), fire off pre-warm loads:

```ts
import { loadModel } from '../modules/modelLoader'

// Inside init(), after renderer instantiation:
const truckGlbUrl = new URL('../assets/models/truck-no-trailer.glb', import.meta.url).href
const vesselGlbUrl = new URL('../assets/models/container-ship-small-empty-no-containers.glb', import.meta.url).href
loadModel(truckGlbUrl).catch(e => console.warn('Box Empire: truck GLB pre-warm failed', e))
loadModel(vesselGlbUrl).catch(e => console.warn('Box Empire: vessel GLB pre-warm failed', e))
```

`loadModel()` already handles caching; subsequent calls from the renderers via `getModelSync()` will return from cache without a second network request.

---

### Step 3 — Modify `truckRenderer.ts`

**3a. Add GLB URL constant at module top:**
```ts
import { loadModel, getModelSync } from './modelLoader'
import { TRUCK_GLB } from './config'

const TRUCK_GLB_URL = new URL('../assets/models/truck-no-trailer.glb', import.meta.url).href
```

**3b. Add helper to build a GLB-based truck group:**
```ts
function buildTruckGroupFromGLB(glbRoot: THREE.Group): THREE.Group {
  // Measure to compute uniform scale targeting TRUCK_GLB.targetLength
  const box = new THREE.Box3().setFromObject(glbRoot)
  const size = new THREE.Vector3()
  box.getSize(size)
  // GLB length is along whichever axis is longest after rotation — confirm at runtime
  const modelLength = size.z  // or size.x — confirm visually
  const scale = TRUCK_GLB.targetLength / modelLength
  glbRoot.scale.setScalar(scale)

  // Ground the model (min.y → 0)
  const groundedBox = new THREE.Box3().setFromObject(glbRoot)
  glbRoot.position.y = -groundedBox.min.y + TRUCK_GLB.yOffset

  // Align heading
  glbRoot.rotation.y = TRUCK_GLB.rotationY

  const group = new THREE.Group()
  group.add(glbRoot)
  return group
}
```

**3c. Replace `createTruckMesh()` with GLB-first approach:**
```ts
private createTruckMesh(truck: TruckVisit): THREE.Group {
  const cached = getModelSync(TRUCK_GLB_URL)
  if (cached) {
    return buildTruckGroupFromGLB(cached)
  }

  // Fallback: procedural mesh while GLB loads
  const group = this.buildProceduralTruck(truck.visitType)  // rename existing logic
  // Async swap-in when GLB arrives
  loadModel(TRUCK_GLB_URL).then(glbRoot => {
    const existing = this.meshes.get(truck.id)
    if (!existing) return  // truck already departed
    // Clear existing children, replace with GLB
    while (existing.children.length) existing.remove(existing.children[0])
    const glbGroup = buildTruckGroupFromGLB(glbRoot)
    glbGroup.children.forEach(c => existing.add(c))
  }).catch(e => console.warn('truck GLB swap failed', e))
  return group
}
```

**3d. Keep container-on-truck positioning**, updating `containerOffsetY` to use `TRUCK_GLB.containerOffsetY` instead of the hardcoded `0.72`.

---

### Step 4 — Modify `vesselRenderer.ts`

**4a. Add GLB URL + imports:**
```ts
import { loadModel, getModelSync } from './modelLoader'
import { VESSEL_GLB } from './config'

const VESSEL_GLB_URL = new URL('../assets/models/container-ship-small-empty-no-containers.glb', import.meta.url).href
```

**4b. Add GLB build helper:**
```ts
function buildVesselGroupFromGLB(glbRoot: THREE.Group, vessel: VesselVisit): THREE.Group {
  glbRoot.rotation.y = VESSEL_GLB.rotationY

  // Scale to match vessel.loa
  const box = new THREE.Box3().setFromObject(glbRoot)
  const size = new THREE.Vector3()
  box.getSize(size)
  // After rotation, vessel length should be along Z (game convention: bow at +Z)
  const modelLength = size.z  // confirm at runtime
  const scale = vessel.loa / modelLength
  glbRoot.scale.setScalar(scale)

  // Centre X/Z, apply Y offset
  const scaledBox = new THREE.Box3().setFromObject(glbRoot)
  const center = new THREE.Vector3()
  scaledBox.getCenter(center)
  glbRoot.position.x = -center.x
  glbRoot.position.z = -center.z
  glbRoot.position.y = VESSEL_GLB.yOffset

  const group = new THREE.Group()
  group.add(glbRoot)
  return group
}
```

**4c. Update `createVesselMesh()` with GLB-first + async swap pattern** (same pattern as trucks):
- Try `getModelSync()` first
- Fall back to procedural
- Async swap-in on load complete
- Preserve the `deckContainers` Map and `shakeState` — these are tracked by vessel ID on the outer `THREE.Group`, not on children, so a child-swap won't break them
- Preserve `triggerLoadShake()` — it modifies `shakeState` by vessel ID, unaffected by GLB swap

---

## Transform Tuning (during implementation)

When the GLB first renders, use the browser console or add a temporary `console.log` with bounding box data:
```ts
const b = new THREE.Box3().setFromObject(glbRoot)
const s = new THREE.Vector3(); b.getSize(s)
console.log('GLB size:', s, 'min.y:', b.min.y)
```

Adjust `TRUCK_GLB.*` and `VESSEL_GLB.*` constants until:
- Truck wheels sit on y=0
- Truck heading matches direction of travel (driven by `headingY` already applied to outer group)
- Container sits visually on the truck bed
- Vessel sits correctly at the quay — hull waterline aligned with quay level
- Vessel bow faces correct direction (same as procedural: bow at +Z)

---

## Key Reuse (no new utilities needed)

| Utility | Location | Reuse |
|---------|----------|-------|
| `loadModel()` | `modules/modelLoader.ts` | Pre-warm + async swap |
| `getModelSync()` | `modules/modelLoader.ts` | Sync GLB-first path |
| `disposeModel()` | `modules/modelLoader.ts` | Called during existing mesh dispose |
| `TRUCK_GLB.*` / `VESSEL_GLB.*` | `modules/config.ts` | New constants (single source of truth) |

---

## Verification

1. **Run the sim** — start the tutorial, watch export trucks enter through the in-gate. They should display as the `truck-no-trailer.glb` model (possibly procedural for a moment if loading is slow).
2. **Check truck heading** — trucks must face the direction they travel (not backwards). Adjust `TRUCK_GLB.rotationY` if wrong.
3. **Check truck grounding** — wheels should sit on y=0 (no floating, no clipping below ground).
4. **Check container position** — container mesh must sit visually on the truck bed. Tune `TRUCK_GLB.containerOffsetY`.
5. **Check vessel orientation** — vessel should appear at berth with bow facing +Z (toward quay), same as the procedural version.
6. **Check vessel waterline** — hull should appear to float at correct height relative to the quay wall. Tune `VESSEL_GLB.yOffset`.
7. **Check vessel shake** — trigger a container load/discharge; the screen-shake should still work (it operates on the outer group, not GLB children).
8. **Fast-forward** (100× speed) — ensure no race conditions with the async swap (the `this.meshes.get(truck.id)` guard handles departed trucks).

# Plan: 3D GLB Truck Models in Stowage-Master

## Context

The stowage-master game already renders the ship using a real GLB model loaded via `shipRenderer.ts > loadShipGLB()`. The trucks that queue at the dock are currently built from procedural box geometry in `sceneBuilder.ts > createTerminalTruck()`. The goal is to replace these procedural trucks with the real GLB models (`truck-no-trailer.glb` + `container-trailer-chassis-empty.glb`), using the same async-load-with-caching pattern the ship uses.

Also save a copy of this plan to `.ai/plans/3d-truck-models.md` in the repo.

---

## Critical Files

| File | Role |
|---|---|
| `src/sims/stowage-master/modules/config.ts` | Add `TRUCK` constants block |
| `src/sims/stowage-master/modules/truckRenderer.ts` | **Create new** — GLB loading, caching, assembly |
| `src/sims/stowage-master/modules/sceneBuilder.ts` | Add `createTerminalTruckGLB()` async export |
| `src/sims/stowage-master/components/GameCanvas.vue` | 4 change sites: imports, buildScene, updateQueueMeshes, triggerTruckAdvance |
| `src/sims/stowage-master/assets/` | Copy 2 GLB files here |

---

## Step 1 — Copy GLB Assets

Copy into `src/sims/stowage-master/assets/` (required for Vite `import.meta.url` bundling):
- `available-media/3d-models/truck-no-trailer.glb` → `assets/truck-cab.glb`
- `available-media/3d-models/container-trailer-chassis-empty.glb` → `assets/container-trailer-chassis.glb`

---

## Step 2 — Add `TRUCK` Constants to `config.ts`

Append after the `HAZMAT` block:

```typescript
export const TRUCK = {
  /** Height of trailer deck above ground (game meters). Replaces hardcoded truckHeight = 0.85. */
  deckHeight: 1.75,
  /** Uniform scale applied to trailer GLB to reach ~14 m length. */
  trailerScale: 1.1227,
  /** Non-uniform scale for cab GLB (after rotation.y = PI/2). */
  cabScale: { x: 1.4451, y: 3.8043, z: 3.4286 },
  /** Cab X offset in truck group (trailer front + cab half − 5th-wheel overlap). */
  cabXOffset: 8.5,
  /** Spacing between truck group origins along X. Replaces local TRUCK_SPACING = 10. */
  spacing: 22,
} as const
```

---

## Step 3 — Create `truckRenderer.ts`

New file: `src/sims/stowage-master/modules/truckRenderer.ts`

```typescript
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { TRUCK } from './config'

const GLB_URLS = {
  trailer: new URL('../assets/container-trailer-chassis.glb', import.meta.url).href,
  cab:     new URL('../assets/truck-cab.glb', import.meta.url).href,
}

const _loader = new GLTFLoader()
const _cache  = new Map<string, THREE.Group>()

async function loadAndCache(key: 'trailer' | 'cab'): Promise<THREE.Group> {
  const url = GLB_URLS[key]
  if (_cache.has(url)) return _cache.get(url)!.clone(true)
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    _loader.load(url, resolve, undefined, reject)
  )
  const root = gltf.scene
  root.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) { obj.castShadow = true; obj.receiveShadow = true }
  })
  _cache.set(url, root.clone(true))
  return root
}

/** Pre-warm both GLBs into cache (call in buildScene alongside loadShipGLB). */
export async function loadTruckGLBs(): Promise<void> {
  await Promise.all([loadAndCache('trailer'), loadAndCache('cab')])
}

/** Assemble a combined truck+trailer group. Both models are grounded to y=0. */
export async function createTruckGLB(): Promise<THREE.Group> {
  const [trailerRoot, cabRoot] = await Promise.all([
    loadAndCache('trailer'),
    loadAndCache('cab'),
  ])

  // Trailer: long axis is X in GLB — no rotation needed
  trailerRoot.scale.setScalar(TRUCK.trailerScale)
  const tBox = new THREE.Box3().setFromObject(trailerRoot)
  trailerRoot.position.y = -tBox.min.y

  // Cab: long axis is Z in GLB — rotate 90° so it aligns along game-X
  cabRoot.rotation.y = Math.PI / 2
  cabRoot.scale.set(TRUCK.cabScale.x, TRUCK.cabScale.y, TRUCK.cabScale.z)
  const cBox = new THREE.Box3().setFromObject(cabRoot)
  cabRoot.position.y = -cBox.min.y
  cabRoot.position.x = TRUCK.cabXOffset

  const group = new THREE.Group()
  group.name = 'terminal-truck'
  group.add(trailerRoot)
  group.add(cabRoot)
  return group
}
```

---

## Step 4 — Update `sceneBuilder.ts`

Add import and async wrapper alongside the existing `createTerminalTruck()`:

```typescript
import { createTruckGLB } from './truckRenderer'

export async function createTerminalTruckGLB(): Promise<THREE.Group> {
  return createTruckGLB()
}
```

Keep `createTerminalTruck()` untouched (not deleted — it serves as a fallback reference).

---

## Step 5 — Update `GameCanvas.vue`

### 5a. Imports (line ~9–13)
```typescript
// Replace createTerminalTruck with createTerminalTruckGLB
import {
  createOcean, animateOcean,
  createDock, createLighting, createSkybox, createSkyDome,
  createFoamParticles, animateFoam, createTerminalTruckGLB,
} from '../modules/sceneBuilder'
import { loadTruckGLBs } from '../modules/truckRenderer'
import { CONTAINER, TRUCK } from '../modules/config'
```

Remove the local `const TRUCK_SPACING = 10` (line ~44).

Replace all 3 occurrences of `const truckHeight = 0.85` with `const truckHeight = TRUCK.deckHeight`.

### 5b. Pre-warm in `buildScene()`
After `createDock(scene)` and before `loadShipGLB`:
```typescript
const truckPrewarm = loadTruckGLBs()   // start download in parallel
// ... loadShipGLB ...
await truckPrewarm                       // ensure cache is hot before trucks needed
```

### 5c. Convert `updateQueueMeshes()` to async
```typescript
async function updateQueueMeshes(containers: Container[]): Promise<void> {
  // ...existing dispose code...
  if (!craneObj || !scene || !containers.length) return
  const dockPos = getDockPosition(craneObj)
  const zPos = dockPos.z

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i]
    const xPos = dockPos.x - i * TRUCK.spacing        // was TRUCK_SPACING
    const truck = await createTerminalTruckGLB()
    truck.position.set(xPos, 0.0, zPos)
    truck.name = `queue-truck-${i}`
    scene.add(truck)
    truckMeshes.push(truck)

    const mesh = createContainerMesh(container)
    mesh.scale.setScalar(0.88)
    mesh.position.set(xPos, TRUCK.deckHeight + CONTAINER.size.y / 2, zPos)  // was truckHeight = 0.85
    mesh.name = `queue-${i}`
    scene.add(mesh)
    queueMeshes.push(mesh)
  }
}
```

### 5d. Convert `triggerTruckAdvance()` to async
```typescript
async function triggerTruckAdvance(): Promise<void> {
  // ...existing advance loop (update TRUCK_SPACING → TRUCK.spacing)...
  const departingTruck = await createTerminalTruckGLB()   // was createTerminalTruck()
  departingTruck.position.set(dockX, 0.0, zPos)
  scene.add(departingTruck)
  truckAnimations.push({
    truck: departingTruck, container: null,
    startX: dockX, endX: dockX + TRUCK.spacing * 2,
    elapsed: 0, duration: 1.8, departing: true,
  })
}
```

The watch callbacks and `handleClick` call sites do not need `await` — GLBs are pre-warmed before interaction is possible.

---

## GLB Orientation & Scale Reference

| Model | GLB long axis | Rotation needed | Scale strategy | Target game size |
|---|---|---|---|---|
| `container-trailer-chassis.glb` | X (12.47 m) | None | Uniform 1.1227 | 14 m long, 1.75 m tall |
| `truck-cab.glb` | Z (1.75 m) | `rotation.y = PI/2` | Non-uniform xyz | 6 m long, 3.5 m tall, 2.5 m wide |

Both models grounded via `position.y = -Box3.min.y` (measured after scale, before adding to group).

> **Runtime tuning note:** After first load, log `new THREE.Box3().setFromObject(root)` for each model to verify axis layout. All scale/offset values are in `TRUCK` config for easy adjustment.

---

## Verification

1. `npm run dev` — open the stowage-master game
2. Start a game — truck queue at the dock should show 3 real GLB truck+trailer assemblies
3. Click a slot — crane picks up container, GLB truck departs, queue advances (all with GLB models)
4. Check container height above truck looks correct (containers should sit on trailer deck, not float/clip)
5. Verify no console errors from GLB loading or bounding-box grounding
6. `npm run build` — confirm Vite bundles both GLB files into `dist/assets/`

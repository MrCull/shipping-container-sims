# Plan: Stowage Master — Real GLB Vessel Model (Level 1)

## Context

Level 1 ("Feeder Vessel") currently renders the ship using procedurally generated Three.js geometry. This plan replaces that with the real GLB model `container-ship-small-empty-no-containers.glb` (a CMA CGM-branded small feeder with visible forward mast, flat cargo deck, and large aft superstructure/bridge). Container stowage slots are positioned above the cargo deck between the forward mast and aft superstructure. Physics/weight-balance calculations continue to use the existing system, calibrated to the real model's proportions.

The GLB model dimensions from the 3D viewer:
- Z axis (length): 4200.27 units
- X axis (width): 790.42 units
- Y axis (height, including mast): 1310.44 units

After loading, the model will be uniformly scaled so its Z length = the game's `shipConfig.length` (40m for small preset). Estimated post-scale height ≈ 12.5m. The cargo deck is estimated at ~35-37% up from the model bottom, which after vertical alignment will sit at `deckOffsetY` in ship-group local space.

---

## Critical Files

| File | Action |
|------|--------|
| `src/sims/stowage-master/assets/` | Copy GLB here |
| `src/sims/stowage-master/types/index.ts` | Add optional fields to `ShipPreset` |
| `src/sims/stowage-master/modules/config.ts` | Update `small` preset |
| `src/sims/stowage-master/modules/shipRenderer.ts` | Add async GLB loader, keep procedural for medium/large |
| `src/sims/stowage-master/modules/containerRenderer.ts` | Use `deckOffsetY` instead of hardcoded `height * 0.3` |
| `src/sims/stowage-master/components/GameCanvas.vue` | Make `buildScene` async |

---

## Step-by-Step Implementation

### Step 1 — Copy Asset

Copy:
```
available-media/3d-models/container-ship-small-empty-no-containers.glb
  → src/sims/stowage-master/assets/container-ship-small-empty-no-containers.glb
```

### Step 2 — Update `types/index.ts`

Add three optional fields to `ShipPreset`:

```typescript
/** Relative path to a GLB model (imported via ?url). If absent, use procedural geometry. */
glbPath?: string
/**
 * Y position (in ship-group local space) of the cargo deck surface.
 * Containers and slot indicators are placed above this level.
 * Defaults to height * 0.3 for procedural ships.
 */
deckOffsetY?: number
/**
 * Vertical offset applied to the loaded GLB group to align its deck with deckOffsetY.
 * Determined empirically after measuring the scaled model's bounding box.
 */
glbYOffset?: number
```

### Step 3 — Update `config.ts` — small preset

```typescript
small: {
  name: 'small',
  bays: 4,
  rows: 4,
  tiers: 4,
  length: 40,
  width: 12,
  height: 4,
  emptyWeight: 800,
  emptyVCG: 4.0,
  maxStackWeight: 120,
  // Cargo area calibrated to real vessel: clear deck between fwd mast (~5% from bow)
  // and aft superstructure (~30% from stern). Net cargo zone ≈ 65% of ship length,
  // centred slightly bow-ward.
  cargoLengthFraction: 0.62,
  cargoXOffsetFraction: 0.07,
  cargoWidthFraction: 0.68,
  sternBlockedBays: 0,
  // GLB model fields
  glbPath: new URL('../sims/stowage-master/assets/container-ship-small-empty-no-containers.glb', import.meta.url).href,
  deckOffsetY: 1.2,   // matches existing slot indicator math (height * 0.3 = 1.2)
  glbYOffset: 3.0,    // lift model so scaled deck aligns with deckOffsetY — tune at runtime
},
```

> **Note on `glbPath`**: `config.ts` is a plain module, not inside a Vue component, so `import.meta.url` works with Vite. Alternatively, declare the URL in `shipRenderer.ts` next to the loader and pass it in via the preset string key. See Step 4.

A cleaner approach is to put the URL constant in `shipRenderer.ts` and keep `config.ts` free of import paths:

```typescript
// config.ts — just add an identifier string
glbPath: 'small-feeder',

// shipRenderer.ts — maps identifier to URL
const GLB_URLS: Record<string, string> = {
  'small-feeder': new URL('./assets/container-ship-small-empty-no-containers.glb', import.meta.url).href,
}
```

Use the identifier approach — it keeps `config.ts` clean and avoids `import.meta.url` path confusion.

### Step 4 — Update `shipRenderer.ts`

Add async GLB loading. The file continues to export:
- `createShip()` — synchronous, procedural geometry (used for medium/large presets and as fallback)
- `loadShipGLB()` — async, returns `Promise<THREE.Group>`

```typescript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Identifier → asset URL mapping (import.meta.url resolves relative to this file)
const GLB_URLS: Record<string, string> = {
  'small-feeder': new URL(
    '../assets/container-ship-small-empty-no-containers.glb',
    import.meta.url
  ).href,
}

const _loader = new GLTFLoader()
const _cache = new Map<string, THREE.Group>()

export async function loadShipGLB(
  scene: THREE.Scene,
  shipConfig: ShipPreset
): Promise<THREE.Group> {
  const url = GLB_URLS[shipConfig.glbPath!]
  if (!url) throw new Error(`No GLB URL for preset glbPath: ${shipConfig.glbPath}`)

  // Load (or clone from cache)
  let root: THREE.Group
  if (_cache.has(url)) {
    root = _cache.get(url)!.clone(true)
  } else {
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
      _loader.load(url, resolve, undefined, reject)
    )
    root = gltf.scene
    root.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })
    _cache.set(url, root.clone(true))
  }

  // Scale to target length
  const box = new THREE.Box3().setFromObject(root)
  const modelLength = box.max.z - box.min.z   // Z is the ship's long axis in the GLB
  const scale = shipConfig.length / modelLength
  root.scale.setScalar(scale)

  // Wrap in a group so we can apply the same group-level transforms the rest of the
  // code expects (tilt, sail-away, sail-in)
  const group = new THREE.Group()
  group.name = 'ship'

  // After scaling, re-measure and centre the model in X/Z; lift in Y via glbYOffset
  root.position.set(0, shipConfig.glbYOffset ?? 0, 0)
  group.add(root)

  scene.add(group)
  return group
}
```

**Axis alignment note**: The GLB may have its length along X or Z. After loading, compute the bounding box and identify the longest axis; swap axes if needed using `root.rotation.y = Math.PI / 2`. Include a comment documenting the result after first test.

**Centering note**: Compute the bounding box center after scaling and offset `root.position.x/z` so the ship's midpoint is at (0, 0) in group-local space. This ensures the crane, slot indicators, and sail animations all line up.

### Step 5 — Update `containerRenderer.ts`

Replace the hardcoded `ship.height * 0.3` in slot indicator positioning:

```typescript
// Old (line 166):
slot.yOffset + shipConfig.height * 0.3 + CONTAINER.size.y / 2

// New:
const deckY = shipConfig.deckOffsetY ?? shipConfig.height * 0.3
slot.yOffset + deckY + CONTAINER.size.y / 2
```

This is backward-compatible: presets without `deckOffsetY` behave exactly as before.

Also apply the same `deckOffsetY` in `GameCanvas.vue` wherever container world positions are computed relative to the deck (search for `ship.height * 0.3` usages in the canvas component).

### Step 6 — Make `buildScene` async in `GameCanvas.vue`

```typescript
// Change signature:
async function buildScene(): Promise<void> {
  const scene = getScene()
  if (!scene || !store.shipConfig) return
  clearScene()

  createSkybox(scene)
  createSkyDome(scene)
  createLighting(scene)
  ocean = createOcean(scene)
  foam = createFoamParticles(scene)
  createDock(scene)

  // Load real model for presets with glbPath, procedural for all others
  if (store.shipConfig.glbPath) {
    shipGroup = await loadShipGLB(scene, store.shipConfig)
  } else {
    shipGroup = createShip(scene, store.shipConfig)
  }

  craneObj = createCrane(scene, store.shipConfig)
  // ... rest unchanged
}
```

The `watch` calling `buildScene()` fires it without `await`, which is fine — Vue's reactivity system and the game loop handle timing. The ship will not appear until the GLB finishes loading; while loading, `shipGroup` is null and the game loop's null-checks protect against errors.

Optionally add a loading state ref to show a brief spinner in the UI:
```typescript
const sceneLoading = ref(false)
// set true before await, false after
```

### Step 7 — Imports in `GameCanvas.vue`

```typescript
import { createShip, loadShipGLB, updateShipTilt } from '../modules/shipRenderer'
```

---

## Cargo Area Calibration (Level 1)

The values in Step 3 are initial estimates based on visual inspection of the screenshots. After first render, adjust these in `config.ts` to fine-tune slot placement:

| Parameter | Initial Value | Meaning |
|-----------|-------------|---------|
| `cargoLengthFraction` | 0.62 | 62% of 40m = 24.8m cargo zone length |
| `cargoXOffsetFraction` | 0.07 | Cargo zone center at +2.8m (bow-ward) from ship midpoint |
| `cargoWidthFraction` | 0.68 | 68% of 12m = 8.16m cargo zone width |
| `deckOffsetY` | 1.2 | Cargo deck Y in ship-group local space |
| `glbYOffset` | 3.0 | Lift GLB model so deck aligns with deckOffsetY |

**Tuning workflow**:
1. Run `npm run dev`
2. Load Level 1 — slot indicators should float just above the ship's cargo deck, between the forward mast and the aft accommodation block
3. If slots are too high/low → adjust `deckOffsetY` and/or `glbYOffset`
4. If slots extend into the superstructure → reduce `cargoLengthFraction` or increase `cargoXOffsetFraction`
5. If slots overflow the hull sides → reduce `cargoWidthFraction`

---

## Axis Alignment Verification

The GLB model axes must be confirmed after loading:
- **Bow** should point toward positive X (matching the existing game convention where bow is +X)
- **Port side** toward negative Z, **starboard** toward positive Z
- **Up** toward positive Y

If the model's bow points along a different axis, add a rotation to `root` before adding to the group:
```typescript
root.rotation.y = Math.PI    // rotate 180° around Y if bow faces -Z
```

Verify by checking that the aft superstructure (bridge/funnel) aligns with negative X (stern side) in-game.

---

## Physics Unchanged

The existing list/trim/VCG calculations in `physics.ts` use `slot.xOffset` and `slot.zOffset` which are computed from `shipGrid.ts` based on `cargoLengthFraction` / `cargoXOffsetFraction` / `cargoWidthFraction`. By updating those config values to match the real model, the physics correctly reflects where containers are placed on this vessel. No changes needed to `physics.ts`, `scoring.ts`, or `gameStore.ts`.

---

## Verification

1. **Visual check**: Run `npm run dev` → Start Level 1 → confirm the CMA CGM feeder model renders, is properly scaled, and sits in the ocean at the correct height
2. **Slot placement**: Slot indicators must appear above the flat cargo deck, between forward mast and aft superstructure (not overlapping either structure)
3. **Container placement**: Place a container → crane animation delivers it to the slot → container sits visually on the deck, not floating in air or sunk into the hull
4. **Tilt**: Place heavy containers on one side → ship visually tilts; trim/list meters respond correctly
5. **Level 2 & 3**: Confirm medium and large presets still render the procedural ship (no `glbPath` set)
6. **Lint**: Run `npm run lint` — no new errors

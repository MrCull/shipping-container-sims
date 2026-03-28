# Reach Stacker GLB Integration Plan

## Context

The reach stacker in box-empire is currently rendered entirely with procedural Three.js geometry (BoxGeometry meshes). Trucks and vessels already use GLB models with a procedural fallback pattern — the same approach should now be applied to the reach stacker.

A source model `reach-stacker-rivana.3mf` (7.2 MB) exists in `available-media/3d-models/`. A previously converted GLB (`reach-stacker-spreaker.glb`, 48 MB) was deemed too large for web use. The goal is to compress/convert it to a usable size (< ~10 MB) and wire it in using the exact same pattern as `truckRenderer.ts`.

---

## Step 0 — One-Time Manual Conversion (pre-requisite, outside code)

**Option A — gltf-pipeline CLI (fastest, from existing GLB):**
```
npx gltf-pipeline -i available-media/3d-models/reach-stacker-spreaker.glb \
  -o src/sims/box-empire/assets/models/reach-stacker-rivana.glb \
  --draco.compressionLevel 7
```
Target: under 8 MB. If still too large, increase compression level to 10.

**Option B — Blender re-export from 3MF (best quality control):**
1. File > Import > 3MF → `reach-stacker-rivana.3mf`
2. Object > Apply > All Transforms
3. File > Export > glTF 2.0, enable Draco compression, limit textures to 1024px
4. Name the boom/arm assembly node **"Boom"** in the Outliner before exporting
5. Save to `src/sims/box-empire/assets/models/reach-stacker-rivana.glb`

**After conversion — inspect the GLB** at https://gltf.report and record:
- Overall height in metres (for `targetHeight`)
- Forward direction (which axis faces +Z in Three.js terms → sets `rotationY`)
- Name of the boom/arm node in the scene hierarchy (for `boomNodeName`)

> ⚠️ If Draco compression is used, `modelLoader.ts` must have `DRACOLoader` wired up (see Step 1 note).

**Destination:** `src/sims/box-empire/assets/models/reach-stacker-rivana.glb`

---

## Step 1 — (If Draco) Add DRACOLoader to `modelLoader.ts`

**File:** `src/sims/box-empire/modules/modelLoader.ts`

Only needed if the GLB was compressed with Draco. Add after the existing `GLTFLoader` import:

```typescript
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
loader.setDRACOLoader(dracoLoader)
```

No other changes to `modelLoader.ts`.

---

## Step 2 — Add `RS_GLB` Constants to `config.ts`

**File:** `src/sims/box-empire/modules/config.ts`

Add after the existing `VESSEL_GLB` block:

```typescript
export const RS_GLB = {
  /** Uniform scale target — set after inspecting converted GLB height in gltf.report */
  targetHeight: 5.4,
  /** rotation.y to align GLB forward axis to +Z. Try Math.PI if model faces backward. */
  rotationY: 0,
  /** Name of boom/arm node in the GLB scene graph (update from actual GLB hierarchy). */
  boomNodeName: 'Boom',
} as const
```

Tune `targetHeight`, `rotationY`, and `boomNodeName` after inspecting the converted GLB.

---

## Step 3 — Modify `equipmentRenderer.ts`

**File:** `src/sims/box-empire/modules/equipmentRenderer.ts`

### 3a — New imports and URL export

Add at the top alongside existing imports:

```typescript
import { loadModel, getModelSync } from './modelLoader'
import { RS_GLB } from './config'

export const RS_GLB_URL = new URL(
  '../assets/models/reach-stacker-rivana.glb',
  import.meta.url
).href
```

### 3b — New `buildReachStackerFromGLB()` module-level function

Add before the `EquipmentRenderer` class definition, following the same structure as `buildTruckGroupFromGLB()` in `truckRenderer.ts`:

```typescript
function buildReachStackerFromGLB(
  glbRoot: THREE.Group
): { group: THREE.Group; boomGroup: THREE.Group | null } {
  glbRoot.rotation.y = RS_GLB.rotationY

  // Scale uniformly to targetHeight
  const box = new THREE.Box3().setFromObject(glbRoot)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = RS_GLB.targetHeight / size.y
  glbRoot.scale.setScalar(scale)

  // Ground the model (shift so bottom sits at y=0)
  const groundedBox = new THREE.Box3().setFromObject(glbRoot)
  glbRoot.position.y = -groundedBox.min.y

  const group = new THREE.Group()
  group.userData['isGlb'] = true
  group.add(glbRoot)

  // Locate boom node — exact name match first, then partial match
  let boomGroup: THREE.Group | null = null
  glbRoot.traverse(obj => {
    if (!boomGroup && obj.name === RS_GLB.boomNodeName && obj instanceof THREE.Group) {
      boomGroup = obj as THREE.Group
    }
  })
  if (!boomGroup) {
    glbRoot.traverse(obj => {
      if (!boomGroup && /boom|arm|jib/i.test(obj.name) && obj instanceof THREE.Group) {
        boomGroup = obj as THREE.Group
      }
    })
  }
  if (!boomGroup) {
    console.warn('Box Empire: RS GLB — boom node not found; boom will not animate')
  }

  return { group, boomGroup }
}
```

### 3c — Rename existing `createReachStacker()` → `createProceduralReachStacker()`

The existing procedural method becomes the fallback. Rename it (private) so the new entry-point can use it:

```typescript
private createProceduralReachStacker(): THREE.Group { ... }
```

### 3d — New `createReachStackerMesh()` private method

```typescript
private createReachStackerMesh(): { group: THREE.Group; boomGroup: THREE.Group | undefined } {
  const cached = getModelSync(RS_GLB_URL)
  if (cached) {
    const { group, boomGroup } = buildReachStackerFromGLB(cached)
    return { group, parts: { boomGroup: boomGroup ?? undefined } }
  }
  const proceduralGroup = this.createProceduralReachStacker()
  return { group: proceduralGroup, boomGroup: undefined }
}
```

### 3e — Update call site and add async GLB swap

In the `update()` method, where equipment meshes are created (the `if (!mesh)` block):

```typescript
// Replace existing reach_stacker branch with:
const r = eq.type === 'reach_stacker'
  ? this.createReachStackerMesh()
  : this.createMobileHarborCrane()
const group = r.group
this.parts.set(eq.id, { boomGroup: r.boomGroup })

// ... (existing scene.add, meshes.set lines) ...

// Async GLB swap (only if currently procedural)
if (!group.userData['isGlb'] && eq.type === 'reach_stacker') {
  const eqId = eq.id
  loadModel(RS_GLB_URL).then(glbRoot => {
    const existingGroup = this.meshes.get(eqId)
    if (!existingGroup) return
    // Dispose old procedural children
    const oldChildren = [...existingGroup.children]
    oldChildren.forEach(c => {
      existingGroup.remove(c)
      c.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.isMesh) {
          m.geometry?.dispose()
          if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
          else m.material?.dispose()
        }
      })
    })
    // Add GLB children
    const { group: glbGroup, boomGroup } = buildReachStackerFromGLB(glbRoot)
    glbGroup.children.slice().forEach(c => existingGroup.add(c))
    existingGroup.userData['isGlb'] = true
    this.parts.set(eqId, { boomGroup: boomGroup ?? undefined })
  }).catch(e => console.warn('Box Empire: RS GLB swap failed', e))
}
```

### 3f — Boom animation (no change needed)

The existing animation code in `update()` already uses `p?.boomGroup` guard:
```typescript
if (p?.boomGroup && eq.type === 'reach_stacker') {
  const t = Math.min(1, eq.armTargetY / 9)
  p.boomGroup.rotation.x = -0.15 - t * 0.60
}
```
This works for both the procedural and GLB paths. If the GLB has no detectable boom node, `boomGroup` is `undefined` and the guard silently skips animation — acceptable first-pass behaviour.

---

## Step 4 — Pre-Warm in `useThreeScene.ts`

**File:** `src/sims/box-empire/composables/useThreeScene.ts`

Add import alongside existing truck/vessel URL imports:
```typescript
import { RS_GLB_URL } from '../modules/equipmentRenderer'
```

Add pre-warm call alongside the existing two:
```typescript
loadModel(RS_GLB_URL).catch(e => console.warn('Box Empire: RS GLB pre-warm failed', e))
```

---

## Critical Files

| File | Change |
|------|--------|
| `src/sims/box-empire/assets/models/reach-stacker-rivana.glb` | New — place converted GLB here |
| `src/sims/box-empire/modules/config.ts` | Add `RS_GLB` constants |
| `src/sims/box-empire/modules/equipmentRenderer.ts` | Main change — GLB loading + swap |
| `src/sims/box-empire/composables/useThreeScene.ts` | Add pre-warm call |
| `src/sims/box-empire/modules/modelLoader.ts` | Add DRACOLoader (only if Draco used) |

---

## Verification

1. Run `npm run dev` and open box-empire
2. In the browser devtools Network tab, confirm `reach-stacker-rivana.glb` loads successfully
3. Start the tutorial — a reach stacker should appear in the yard
4. The reach stacker should display the GLB model (not the blocky procedural version)
5. When the RS picks up a container, the boom should angle upward (if boom node was found)
6. Check console for any `Box Empire: RS GLB` warnings
7. Confirm no memory leaks: open Chrome DevTools Memory tab, take heap snapshots before/after several RS operations

## Known Uncertainties (resolve during Step 0)

- `boomNodeName`: depends on GLB hierarchy — update `RS_GLB.boomNodeName` in config after inspection
- `rotationY`: depends on GLB's exported orientation — start with `0`, try `Math.PI` if model faces wrong way
- `targetHeight`: measure actual GLB height in gltf.report
- Draco vs. no Draco: if gltf-pipeline produces a small enough GLB without Draco, skip `modelLoader.ts` changes entirely

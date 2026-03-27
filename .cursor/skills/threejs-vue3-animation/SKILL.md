---
name: threejs-vue3-animation
description: >-
  Three.js + Vue 3 animation tips, scene management, performance optimization,
  and rendering patterns for container terminal simulations. Use when creating
  3D scenes, animating equipment, managing cameras, or optimizing render
  performance in shipping container sims.
---

# Three.js + Vue 3 Animation for Container Terminal Sims

## 1. Architecture: Four-Layer Mental Model

### Layer 1: Domain Model (pure TypeScript, no Three.js)

Container states, vessel schedules, equipment positions, event queues. Driven by simulation tick. No rendering concerns here.

### Layer 2: Application State (Pinia / reactive refs)

Bridge between domain and rendering. Holds current positions, animation targets, camera mode. Vue reactivity drives scene updates.

### Layer 3: Scene Adapter (composables)

Translates app state into Three.js objects. Uses watchers/computed to sync. The `useTerminalScene` composable pattern:

```ts
function useTerminalScene(
  canvas: Ref<HTMLCanvasElement | null>,
  onTick: (ctx: { scene: Scene; camera: Camera }, delta: number) => void
) {
  // Creates scene, camera, renderer
  // Handles resize via ResizeObserver
  // Runs render loop via Clock + requestAnimationFrame
  // Disposes everything in onUnmounted
}
```

All Three.js object creation and disposal happens here.

### Layer 4: Render Loop

`requestAnimationFrame` via `THREE.Clock`. Decoupled from sim tick (sim at 10-60 Hz, render at 60 fps). Interpolate between sim states for smooth visuals.

---

## 2. Scene Conventions for Container Terminals

### Coordinate System

- 1 unit = 1 meter
- X axis = along quay (East-West)
- Z axis = perpendicular to quay (North-South), negative toward water
- Y axis = up (height)

### Grid Layout

- Quay at Z = 0, water Z < 0, yard Z > 0
- Each berth, yard block, and gate has a local origin

### Container Dimensions (Three.js units)

| Type | Width (X) | Height (Y) | Length (Z) |
|------|-----------|------------|------------|
| 20ft | 2.44      | 2.59       | 6.06       |
| 40ft | 2.44      | 2.59       | 12.19      |
| 40HC | 2.44      | 2.90       | 12.19      |

### Container Spacing in Stacks

- Vertical gap between tiers: 0.05 m
- Row gap (across): ~0.30 m
- Bay gap (along): ~0.15 m

---

## 3. Performance: InstancedMesh for Containers

Containers are the most numerous objects. ALWAYS use `InstancedMesh`:

```ts
const containerMesh = new THREE.InstancedMesh(geometry, material, MAX_CONTAINERS)
const matrix = new THREE.Matrix4()
const color = new THREE.Color()

for (let i = 0; i < containers.length; i++) {
  matrix.makeTranslation(x, y, z)
  containerMesh.setMatrixAt(i, matrix)
  containerMesh.setColorAt(i, color.set(containers[i].color))
}
containerMesh.instanceMatrix.needsUpdate = true
containerMesh.instanceColor!.needsUpdate = true
```

### Performance Targets

- Aim for < 5,000 draw calls
- Use `InstancedMesh` for any object type with > 50 instances
- Container limit: 10,000+ with instancing, < 500 without
- LOD: full detail < 200 m, simplified 200-500 m, box > 500 m
- Merge static geometry (ground plane, buildings, quay wall)

---

## 4. Asset Pipeline

- **Preferred format:** glTF / GLB
- **Compression:** Draco (geometry), KTX2 (textures), Meshopt (mesh optimization)
- **Material reuse:** create materials once, share across meshes. Use `MeshStandardMaterial` for PBR.
- **Shadows:** cast only for key equipment (cranes), receive on ground plane only. Use shadow maps sparingly.

### Loading Pattern

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)
```

---

## 5. Camera Patterns

Three useful camera modes:

1. **Overview/Orbit** — `OrbitControls`, centered on terminal. Good for wide views.
2. **Follow** — Camera tracks a moving entity (crane, truck). Lerp camera position toward target.
3. **First-person** — Attached to equipment operator position. Good for training sims.

### Smooth Transitions Between Modes

```ts
function transitionCamera(
  camera: PerspectiveCamera,
  from: Vector3,
  to: Vector3,
  duration: number
) {
  const start = performance.now()
  function update() {
    const t = Math.min((performance.now() - start) / (duration * 1000), 1)
    const eased = easeInOutCubic(t)
    camera.position.lerpVectors(from, to, eased)
    if (t < 1) requestAnimationFrame(update)
  }
  update()
}
```

---

## 6. Equipment Animation Patterns

### Time-Based Movement (CRITICAL: never frame-based)

```ts
// WRONG — frame-rate dependent:
// position.x += speed

// RIGHT — time-based:
// position.x += speed * deltaTime
```

### Easing Functions

```ts
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t)
```

### Crane Animation State Machine

```ts
type CranePhase =
  | 'idle'
  | 'gantry_travel'
  | 'trolley_out'
  | 'hoist_down'
  | 'lock'
  | 'hoist_up'
  | 'trolley_in'
  | 'hoist_set'
  | 'unlock'
  | 'hoist_clear'

interface CraneAnimationState {
  phase: CranePhase
  elapsed: number
  duration: number
  startValue: number
  endValue: number
  property: 'gantryX' | 'trolleyY' | 'spreaderZ'
}
```

### Pivot Points for Cranes

- STS crane gantry pivot: base center, on rails
- Trolley pivot: along boom
- Spreader pivot: hanging from trolley, Y axis
- Container attaches to spreader bottom

### Truck / AGV Path Following

```ts
interface PathSegment {
  start: Vector3
  end: Vector3
  speed: number
}

function followPath(segments: PathSegment[], progress: number): Vector3 {
  // Calculate position along path based on cumulative distance and progress 0-1
}
```

---

## 7. Container Stack Visualization

Calculate container position in a yard block:

```ts
function containerPositionInBlock(
  blockOrigin: Vector3,
  bay: number,
  row: number,
  tier: number,
  containerLength: number
): Vector3 {
  const x = blockOrigin.x + row * (2.44 + 0.3)
  const y = blockOrigin.y + tier * (2.59 + 0.05)
  const z = blockOrigin.z + bay * (containerLength + 0.15)
  return new Vector3(x, y, z)
}
```

---

## 8. Lighting Setup

- **Ambient light:** intensity 0.3-0.5 (daylight), 0.05-0.1 (night)
- **Directional (sun):** intensity 1.0, cast shadows, position high and angled
- **Night mode:** add point lights on crane booms, floodlights on mast poles
- **Fog:** optional, for atmosphere (`near: 500`, `far: 2000`)

---

## 9. Data-Driven Scene Generation

Pattern: domain data -> scene adapter -> Three.js objects

```ts
watch(
  () => store.containers,
  (containers) => {
    updateContainerInstances(containerMesh, containers)
  },
  { deep: true }
)

watch(
  () => store.cranes,
  (cranes) => {
    cranes.forEach((crane, i) => {
      craneObjects[i].gantry.position.x = crane.gantryX
      craneObjects[i].trolley.position.z = crane.trolleyZ
      craneObjects[i].spreader.position.y = crane.spreaderY
    })
  }
)
```

---

## 10. Fidelity Tiers

| Tier   | Distance  | Containers          | Cranes            | Ground   |
|--------|-----------|---------------------|-------------------|----------|
| High   | < 200 m   | Textured boxes, labels | Articulated parts | Textured |
| Medium | 200-500 m | Colored boxes       | Simple shapes     | Flat color |
| Low    | > 500 m   | Merged blocks       | Icons / sprites   | Flat     |

---

## 11. Common Pitfalls

- **Never** create Three.js objects in Vue reactive state (not serializable, memory leaks).
- **Always** dispose geometries, materials, and textures in `onUnmounted`.
- Don't use Vue watchers at 60 fps — watchers for state changes, render loop for interpolation.
- Use `Object3D` hierarchy for compound equipment (crane = base > boom > trolley > spreader).
- Keep render loop lean: no allocations, reuse `Vector3` / `Matrix4` instances.

---

## 12. Debug Helpers

- `AxesHelper` — orientation reference
- `GridHelper` — ground plane reference
- `Stats.js` — FPS monitoring
- `lil-gui` — runtime parameter tweaking
- Wireframe mode — collision debugging

All code in this skill assumes Vue 3 Composition API with `<script setup lang="ts">`.

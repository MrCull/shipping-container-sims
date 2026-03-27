# three.js + Vue 3 tips and tricks for container terminal scenes

## What this file is for

This file is aimed at an AI agent building container terminal style scenes, interactions, and animations with Vue 3 and three.js.

The goal is not "maximum realism at any cost". The goal is:
- believable scale
- smooth camera motion
- smooth equipment animation
- strong performance with lots of repeated assets
- a clean separation between simulation state and 3D presentation
- output that can scale from a simple visualiser to a sim/game scene

Treat this as a practical build guide, not a standards document.

## Golden rules

1. Vue owns app state, UI state, panels, filters, forms, selected entities, and high level commands.
2. three.js owns the render loop, scene graph, GPU resources, cameras, materials, lights, and animation playback.
3. Never make thousands of scene objects deeply reactive.
4. Prefer data-driven scene generation over hand-placed meshes.
5. Instancing beats duplication for repeated terminal assets.
6. Animation should be time-based, not frame-based.
7. Keep the simulation model separate from the display model.
8. Use fake complexity where players will not notice the real one.
9. Use physically plausible dimensions and movement envelopes even when simplifying logic.
10. Dispose of GPU resources properly or the browser will eventually hate you.

## Recommended mental model

Use 4 layers:

### 1) Domain layer
Pure data and rules.

Examples:
- container records
- vessel bay plan
- yard block definitions
- truck visit queue
- crane jobs
- weather state
- simulation clock

This layer must be framework-agnostic.

### 2) App state layer
Vue or Pinia state that tracks:
- current view mode
- selected container, crane, vessel, truck
- filters
- playback speed
- paused/running state
- debug toggles
- camera presets
- hovered entity id

This layer should store IDs and small objects, not entire three.js meshes.

### 3) Scene adapter layer
A thin mapping layer that translates domain objects into renderable descriptors.

Examples:
- container archetype -> geometry/material/instance bucket
- crane job -> animation target positions
- vessel bay slots -> transforms
- yard block -> grid generation parameters
- selected entity id -> highlight state

### 4) Rendering layer
three.js renderer, scene, camera, controls, lights, post processing, loaders, animation mixers, raycasting, and pooled temporary objects.

This layer should not contain business logic.

## Vue 3 integration pattern that does not turn into a bin fire

Use a composable such as `useTerminalScene()`.

That composable should:
- create the renderer, scene, camera, controls, and root groups
- expose mount and dispose functions
- expose command methods such as `focusEntity`, `setPlaybackSpeed`, `setSelection`, `setWeather`
- hold non-reactive three.js objects in plain variables or shallow refs
- subscribe to simulation/app state changes and push minimal updates into three.js

### Good pattern
- `onMounted()` to create and attach renderer
- `onUnmounted()` to cancel RAF, remove listeners, and dispose resources
- `shallowRef()` for external stateful objects when Vue must know they changed
- composables for reusable logic
- Pinia or a shared store for UI/sim coordination

### Bad pattern
- storing thousands of meshes in `reactive()`
- deep watchers over full scene data
- rebuilding the whole scene because one container moved
- letting UI components mutate three.js objects directly
- coupling simulation rules to camera code

## Suggested folder structure

This project hosts **many independent sims** under `src/sims/`. Each sim is fully self-contained — all code, components, composables, stores, types, and media live inside its own sub-folder. Nothing sim-specific goes into the top-level `src/` directories.

### Per-sim layout (everything lives under `src/sims/<sim-id>/`)

```text
src/sims/<sim-id>/
  definition.ts                 # sim metadata (auto-discovered)
  <SimName>.vue                 # root component (mounts canvas)
  components/
    GameCanvas.vue              # canvas wrapper + HUD overlays
    ui/                         # UI widgets (meters, popups)
    modals/                     # modal dialogs (start screen, level complete)
  composables/
    useThreeScene.ts            # sim's own scene setup, render loop, disposal
    useGameLoop.ts              # sim tick / game clock
    useAudio.ts                 # sound effects
    useRaycastSelection.ts      # picking
  modules/
    config.ts                   # constants, dimensions, speed tables
    sceneBuilder.ts             # assemble the Three.js scene graph
    containerRenderer.ts        # InstancedMesh for containers
    shipRenderer.ts             # vessel mesh building / updates
    craneSystem.ts              # crane animation state machine
    truckMovementSystem.ts      # truck / AGV path following
    weatherSystem.ts            # wind, rain, lighting changes
    physics.ts                  # simplified physics / collision
    scoring.ts                  # game scoring logic
    levels.ts                   # level definitions
  store/
    gameStore.ts                # Pinia store (domain + app state)
  types/
    index.ts                    # sim-specific interfaces
  assets/
    models/                     # 3D models (copy from available-media/ as needed)
    sounds/                     # sound effects
    textures/                   # textures, skyboxes
```

### Shared top-level code (only for logic reused by multiple sims)

```text
src/
  composables/
    useThreeScene.ts            # shared baseline Three.js setup
    useSimRegistry.ts           # auto-discovers sims
    useMenuMusic.ts             # main-menu music
  components/                   # shared UI components (SimCard, etc.)
  stores/                       # shared Pinia stores
  types/                        # shared interfaces (SimDefinition, etc.)
```

Sims can use the shared `src/composables/useThreeScene.ts` or create their own in `composables/useThreeScene.ts` if they need a custom camera, post-processing, or render loop.

## Scene conventions

Define these once and do not drift.

### Units
- Use meters for world units.
- Use kilograms for mass.
- Use seconds for timing.
- Use radians internally.

### Axes
Pick one convention and stick to it. Recommended:
- X = left/right across terminal
- Y = up
- Z = along berth / forward depth through the scene

### Grid
- Snap yard content to a metric grid.
- Keep a separate logical grid for bay/row/tier addressing.
- Do not infer business meaning from raw world position.

### Origins
- Use a stable world origin near the main playable area.
- Put each major subsystem under a root group:
  - `world`
  - `quay`
  - `yard`
  - `road`
  - `vessels`
  - `effects`
  - `ui3d`

### Naming
Every renderable entity should have:
- stable id
- type
- optional parent system id
- selection/picking id
- optional domain reference id

## What matters visually in a container terminal

Players notice these things immediately:
- container size and spacing
- whether cranes move plausibly
- whether vehicles follow lanes
- whether stacks align cleanly
- whether the berth and vessel scale feel sane
- whether repeated assets stutter performance
- whether shadows and lighting make the scene readable

Players usually do not care about:
- perfect bolt-level geometry
- exact legal text on markings
- exact structural members inside cranes
- exact yard algorithm, unless it creates visible nonsense
- every single cable and pulley if the motion reads correctly

## Container dimension cheat sheet for believable visuals

Use these as the baseline visual archetypes:

### Dry container families
- 20 ft standard: about 6.06m x 2.44m x 2.59m external
- 40 ft standard: about 12.19m x 2.44m x 2.59m external
- 40 ft high cube: about 12.19m x 2.44m x 2.90m external
- 45 ft high cube: about 13.72m x 2.44m x 2.90m external

### Common visual variants
- dry van / general purpose
- high cube
- reefer
- open top
- flat rack
- tank container

### Practical rendering advice
- Start with one good 20 ft and one good 40 ft mesh.
- Generate many visual variants from material sets, decals, dirt masks, and props.
- For far distance, collapse door hardware detail aggressively.
- For stacks, clean silhouette matters more than micro detail.
- For reefers, visible machinery housing and cable/power context sells the asset quickly.
- Tank containers are visually sparse but structurally distinct, so silhouette matters a lot.

## Suggested physical scale hints for larger terminal objects

Use plausible ranges, not fake giant nonsense.

### Yard stack planning hints
- Typical stack footprint should align to container dimensions plus a small operational gap.
- Keep row spacing wide enough for equipment lanes.
- High stacks can look impressive, but overdoing height makes equipment feel toy-sized unless the whole terminal scales up with it.

### STS crane visual hints
A believable STS crane needs:
- tall gantry
- boom projecting over the ship
- trolley motion along boom
- hoist motion vertically
- spreader visibly sized to container length modes

For gameplay visuals, the motion phases matter more than structural perfection:
1. trolley align
2. hoist down
3. pick / lock
4. hoist up
5. trolley travel
6. hoist down
7. set / unlock
8. hoist clear

### Terminal tractor hints
- Keep them compact and low compared to road trucks.
- They should feel agile but not fast.
- Their visual identity comes from cab shape, trailer coupling, and lane movement.

## Performance strategy for terminal scenes

This is the section that saves your arse.

### 1) Instance repeated assets
Use `InstancedMesh` for:
- containers of the same geometry/material family
- light poles
- lane barriers
- bollards
- fence posts
- simple parked trailers
- repeated yard props

Bucket by:
- geometry
- material
- shadow behaviour
- interaction needs

Do not create one mesh per container unless the scene is tiny.

### 2) Use LOD on expensive hero assets
Use LOD for:
- ships
- cranes
- large buildings
- detailed trucks
- hero machinery

Use aggressive simplification at distance.
For very far range, use:
- very low poly replacements
- billboard or facade style proxies where acceptable
- reduced shadow contribution

### 3) Compress assets properly
Prefer glTF or GLB.
Use:
- Draco or Meshopt for geometry compression
- KTX2 for compressed textures where the asset pipeline supports it

Do not ship giant PNG texture packs for everything.

### 4) Reuse materials
Keep the material count low.
For terminal scenes, many objects can share:
- painted metal variants
- rubber
- concrete
- asphalt
- safety yellow
- weathered steel
- container paint families

### 5) Keep shadows under control
Shadows look good and murder frame time.
Use them surgically:
- strong shadows for hero view
- softer or fewer shadows in overview mode
- disable shadow casting for tiny repeated props
- bake or fake where possible for static scenery

### 6) Avoid per-frame object churn
Do not allocate vectors, matrices, colors, arrays, or closures in hot loops if you can avoid it.
Pool temp math objects.

### 7) Decouple simulation tick from render tick
A good default:
- simulation updates at a fixed step
- rendering updates every RAF
- interpolation for visible motion between authoritative sim states

This keeps motion smooth even when logic is heavier.

### 8) Dirty-update only what changed
Examples:
- if only 30 instance transforms changed, update only those buckets
- if vessel plan changed, rebuild only affected slot groups
- if weather changed, update fog/light/wind systems, not the whole scene

## Asset pipeline guidance

### Preferred formats
- `.glb` for most production assets
- `.gltf` only if external texture management is useful
- separate JSON or TS config for procedural parameters

### Authoring guidance
Ask for assets that are:
- cleanly named
- correctly scaled in meters
- pivoted sensibly
- sparse in material count
- UV unwrapped consistently
- exported with frozen transforms
- made with LOD variants if possible

### Pivot conventions that save pain
- containers: centered or one corner origin, but be consistent
- cranes: root at rail contact centre or a clearly documented base point
- trucks: root on ground plane at vehicle centre
- vessels: root on centreline with documented reference point
- spreaders: root at kinematic centre

### glTF loading advice
When loading models:
- traverse once
- tag pickable nodes
- assign shared materials if appropriate
- disable unnecessary shadow behaviour
- cache loaded assets
- clone smartly
- keep animations and skeletons out of instancing paths unless genuinely needed

## Lighting and atmosphere for terminal scenes

Container terminals look best when readability wins over "cinematic darkness".

### Good baseline setup
- one directional light for sun
- one hemisphere light or ambient contribution for fill
- fog or atmospheric depth for scale
- sky gradient or sky system
- subtle tone mapping and exposure tuning

### Time of day ideas
- morning: long shadows, cool fill
- noon: flatter but clear
- dusk: dramatic but riskier for readability
- night: use sparingly unless gameplay depends on lighting

### Night scenes
Night terminals can look excellent, but you need:
- mast lights
- crane lights
- emissive accents
- stronger exposure discipline
- very controlled contrast so players can still read lanes and stacks

## Camera patterns that work well

Use multiple camera modes.

### Recommended modes
- orbit overview
- free fly inspection
- crane operator view
- truck chase view
- vessel side overview
- top-down planning view

### Camera rules
- maintain sensible near/far planes
- avoid clipping through stacks
- use damped controls for inspection modes
- snap to meaningful presets
- keep transitions eased and time-based

### Good UX trick
When focusing an entity:
- fly camera to a framed position
- set orbit target to entity centroid
- add a subtle highlight or outline
- avoid instant teleport unless in debug mode

## Animation guidance for smooth believable movement

### General rules
- use delta time
- use easing for camera and UI-driven moves
- use fixed-duration or speed-based paths for equipment moves
- use state machines for machinery, not random tweens everywhere

### STS crane animation model
Represent the crane as sub-parts:
- gantry root
- boom
- trolley
- hoist cable
- spreader

Then animate by job phases:
- idle
- align trolley
- lower spreader
- lock
- hoist
- travel
- lower
- unlock
- return or continue

For visual quality:
- trolley movement should feel heavy but precise
- hoist should not accelerate like a bloody drone
- spreader sway can be subtle secondary animation
- lock/unlock can be represented by short pauses and small pose changes

### Yard crane animation model
Use the same approach:
- bridge travel
- trolley travel
- hoist
- spreader

### Truck movement model
Use splines or lane graphs.
Rules:
- follow lanes, not straight lines through geometry
- use eased acceleration and braking
- leave queue spacing
- do not rotate instantly
- clamp steering visually to movement direction

### Container movement
Containers do not need complex physics in most cases.
Use:
- kinematic movement driven by parent equipment
- optional subtle sway for lifted loads
- snap-to-slot at completion with a tiny settle animation

### Secondary motion
Cheap tricks that add life:
- cable sway
- slight crane vibration at pickup/setdown
- wheel suspension bob on heavy trucks
- subtle exhaust or dust
- reefer fan/audio cues
- water motion near berth

## Data-driven generation for a terminal

An AI agent should not hand-model the whole terminal scene. Generate it from data.

### Terminal layout descriptors
Define:
- berth length
- number of STS cranes
- yard block count
- yard block dimensions
- lane graph
- gate positions
- rail zone positions if used
- building footprints
- reefer rack zone
- hazmat zone
- empty depot zone

### Yard block descriptors
For each block:
- block id
- origin
- heading
- bay count
- row count
- tier count
- stack family
- access side
- equipment type
- handover lane positions

### Vessel descriptors
For each vessel:
- length
- beam
- bay count
- row pattern
- under deck tier count
- on deck tier count
- reefer slot map
- current berth position

### Container descriptors
For each container:
- id
- length type
- height type
- variant
- color family
- condition
- load state
- current location
- target location
- moving yes/no
- selected yes/no

## Recommended fidelity tiers

### Tier 0: visual mock
- static vessel
- static cranes
- instanced containers
- simple day lighting
- orbit camera
- minimal interactivity

### Tier 1: living scene
- truck loops
- crane cycles
- stack updates
- entity selection
- simple timeline
- lane-following movement

### Tier 2: operational sim-lite
- job queues
- import/export/tranship flows
- yard allocation logic
- gate arrivals
- vessel loading/discharge sequences
- dashboard metrics

### Tier 3: serious sim
- fixed-step simulation
- realistic-ish bottlenecks
- weather effects on operations
- equipment downtime
- constraints such as reefer slots or hazmat zones
- load plan and yard strategy interplay

## Domain shortcuts that make scenes feel right fast

These shortcuts are worth using unless the project demands heavy realism.

### Containers
- Bias the visual population toward 40 ft and 40 ft high cube.
- Use 20 ft units as heavier, denser-looking stacks or special placements.
- Randomise weathering, stickers, and color tone within safe limits.
- Keep stack alignment strict. Sloppy stacks look fake immediately.

### Yard blocks
- Separate zones visually by purpose:
  - imports
  - exports
  - empties
  - reefers
  - hazardous
- Use lane markings and signage to make purpose legible from camera height.

### Vessel scenes
- Put more visual density near the active work zone.
- Show a visible bay pattern, not just a giant coloured rectangle.
- Use hatch covers, lashing bridges, and deck stacks only to the level needed for silhouette and logic.

### Quay scenes
- Show parked terminal tractors waiting at handover points.
- Add fenders, bollards, ladders, rails, and basic berth markings.
- Keep the water plane simple and performant.

## Picking, highlighting, and selection

### Picking strategy
Use raycasting for modest interactive sets.
For huge scenes:
- pick proxies
- pick simplified colliders
- pick logical cells instead of actual triangles when possible

### Good selection feedback
- outline
- emissive pulse
- label card
- camera focus
- path preview
- job information panel

Do not rely on tiny color changes alone.

## Text, labels, and overlays

### 3D labels
Use them sparingly.
They are best for:
- selected object names
- block ids
- crane ids
- berth ids
- debug overlays

### 2D overlays
Prefer screen-space UI for:
- inspector panels
- metrics
- timeline
- queue counts
- entity detail
- debug toggles

### Rule
World space is for spatial meaning.
Screen space is for dense information.

## Materials and texturing

### Container materials
Recommended layers:
- base paint
- roughness variation
- dirt/grime
- decals / numbers
- edge wear

### Terminal surfaces
- asphalt should read as broad, slightly varied, not noisy
- concrete should have large-scale variation
- lane paint should be readable from distance
- safety markings should be simple and high contrast

### Avoid
- ultra glossy everything
- over-sharpened grunge maps
- tiny repeated decals everywhere
- too many unique materials per asset

## Weather and environmental effects

These can massively improve scale if done lightly.

### Good cheap effects
- fog depth
- mild heat haze near asphalt
- rain streaks or wetness tint
- wind sway on suspended loads
- water normal animation
- distant haze

### Operational links
Use weather to change visible behaviour:
- stronger wind -> slower crane animation or parked crane state
- rain -> darker surfaces, softer visibility
- night -> more local lights, clearer emissive signage

## Common pitfalls

### Pitfall 1
Making every container a separate mesh.

Result:
- draw call explosion
- bad CPU overhead
- miserable selection scaling

Fix:
- instance them
- keep a logical index from instance id to domain id

### Pitfall 2
Making three.js objects deeply reactive.

Result:
- useless Vue overhead
- hard-to-debug update storms

Fix:
- keep external objects plain
- sync only the small state that UI actually needs

### Pitfall 3
Using exact simulation transforms as final render transforms with no smoothing.

Result:
- jitter
- visual harshness
- ugly camera tracking

Fix:
- interpolate or ease visible transforms

### Pitfall 4
Over-modeling hero assets and under-building layout readability.

Result:
- gorgeous crane, shit terminal

Fix:
- prioritise composition, scale, lanes, stack structure, and motion clarity

### Pitfall 5
Ignoring cleanup.

Result:
- memory leaks
- weird hot-reload issues
- browser death by a thousand discarded buffers

Fix:
- dispose geometries, materials, textures, render targets, controls, and listeners

## Sensible defaults for a first playable scene

Use these defaults unless there is a strong reason not to.

### Terminal
- 1 berth
- 1 vessel
- 2 STS cranes
- 4 to 8 yard blocks
- 1 gate area
- 10 to 30 moving trucks
- 1000 to 8000 visible containers using instancing

### Camera modes
- orbit
- top-down
- entity focus

### Visual style
- daylight
- moderate fog
- limited post FX
- clear lane markings
- strong silhouettes

### Interactivity
- click to select
- hover tooltip
- camera focus
- play/pause
- 1x / 4x / 16x time scale
- debug overlays for ids and routes

## AI agent build checklist

Before coding:
- decide world axis convention
- decide coordinate origin
- decide instancing buckets
- decide data schemas
- decide fidelity tier
- decide whether vessel and cranes are procedural, model-based, or hybrid

When building:
- scaffold the sim folder (`src/sims/<sim-id>/`) with components/, composables/, modules/, store/, types/, assets/ sub-dirs
- create one clean viewport component inside `components/`
- create one scene composable inside `composables/`
- build scene from descriptors in `modules/`
- keep selection and focus flows simple
- measure draw calls and frame time early
- get one crane cycle working before adding everything else

Before adding realism:
- verify scale
- verify lane readability
- verify stack spacing
- verify camera usability
- verify selection feedback
- verify disposal on unmount

Before shipping:
- profile CPU and GPU
- reduce shadow cost
- compress assets
- test on weaker hardware
- test large container counts
- test camera transitions and memory usage over long sessions

## Suggested implementation order

1. static viewport with camera controls
2. world axes, ground, fog, sun
3. yard block generator
4. instanced containers
5. simple vessel blockout
6. one STS crane blockout with articulated animation
7. truck lane graph and moving tractors
8. picking and inspector
9. data-driven updates from simulation state
10. LOD, cleanup, and profiling
11. prettier materials and atmosphere
12. optional advanced constraints and dashboards

## Pseudocode architecture

```ts
type SimState = {
  time: number
  containers: ContainerRecord[]
  cranes: CraneRecord[]
  trucks: TruckRecord[]
  vesselCalls: VesselCallRecord[]
  weather: WeatherState
}

type SceneApi = {
  mount: (el: HTMLDivElement) => void
  unmount: () => void
  sync: (state: SimState) => void
  focusEntity: (id: string) => void
  setSelection: (id: string | null) => void
}

function createTerminalScene(): SceneApi {
  let renderer: WebGLRenderer
  let scene: Scene
  let camera: PerspectiveCamera
  let rafId = 0

  const systems = {
    containers: createContainerInstanceSystem(),
    cranes: createCraneAnimationSystem(),
    trucks: createTruckMovementSystem(),
    weather: createWeatherSystem(),
    picking: createPickingSystem()
  }

  function mount(el: HTMLDivElement) {
    renderer = createRenderer(el)
    scene = createScene()
    camera = createCamera(el)
    startLoop()
  }

  function sync(state: SimState) {
    systems.containers.sync(state.containers)
    systems.cranes.sync(state.cranes, state.time)
    systems.trucks.sync(state.trucks, state.time)
    systems.weather.sync(state.weather)
  }

  function unmount() {
    cancelAnimationFrame(rafId)
    disposeAll()
  }

  return {
    mount,
    unmount,
    sync,
    focusEntity: id => systems.picking.focus(id),
    setSelection: id => systems.picking.select(id)
  }
}
```

## Practical notes for generated code

When generating Vue + three.js code:
- prefer small focused modules
- avoid giant 900-line viewport files
- keep math helpers pure
- keep scene mutation APIs explicit
- do not hide expensive work inside watchers
- use TypeScript types for scene descriptors
- make debug toggles first-class
- keep hot paths branch-light and allocation-light

## Debug views worth having

Add these early:
- axes helper toggle
- grid helper toggle
- instance bounds toggle
- lane graph toggle
- crane path / trolley path toggle
- bay/row/tier labels toggle
- FPS and draw-call panel
- selection id overlay

## Final advice

For container terminals, the winning combination is:
- procedural layout
- instanced repetition
- a few strong hero machines
- disciplined camera design
- state machines for motion
- restrained realism

If the scene reads clearly, moves smoothly, and respects scale, it will feel far more convincing than a hyper-detailed mess running like a stabbed slug.

## Source notes to check when implementing

### Vue 3
- official lifecycle hooks docs
- official composables guide
- reactivity in depth, especially shallow refs for external state systems
- official performance guide

### three.js
- InstancedMesh docs
- LOD docs
- GLTFLoader docs
- DRACOLoader docs
- color management and renderer guidance in the manual
- disposal / cleanup guidance in the manual
- picking guidance in the manual

### Container and terminal realism
For believable dimensions and asset archetypes, verify against:
- ISO container standards where available to your team
- carrier equipment specification sheets
- terminal operator public materials
- vessel and crane OEM documents for representative ranges

Useful public references include carrier container specification guides from Hapag-Lloyd and Maersk for common external dimensions and equipment families.

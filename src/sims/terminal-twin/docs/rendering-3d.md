# Rendering (3D view)

Checked against ENGINE_VERSION 0.53.0.

Read this when you change anything drawn in the Three.js view: containers, equipment rigs, vessel hulls, hatch panels,
infrastructure, quality tiers, lighting, the backdrop and scenery, positional sound, or the home card. Pipeline, budgets
and sidecars of the GLBs: [assets-pipeline.md](assets-pipeline.md). Frame-rate work: [optimising/frame-rate.md](optimising/frame-rate.md).
Worker protocol, `SceneModel` ingest and the `__tt` dev API: [browser-host.md](browser-host.md). Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

The view is presentation only. Nothing here touches the engine, so nothing here moves a golden summary or an
event-log hash. Proof is Vitest (pure modules), `tt:assets:check`, screenshots and the browser smoke suite.

## Scene setup

`composables/useTwinScene.ts#useTwinScene` owns the renderer, camera, OrbitControls and the `requestAnimationFrame` loop.
Nothing Three.js-related is ever put in Vue reactivity (no `ref` around meshes, materials or the scene).

| Setting | Value |
|---|---|
| Renderer | `WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })`, PCF shadow map, ACES filmic tone mapping, sRGB output |
| Pixel ratio | `min(devicePixelRatio * profile.resolutionScale, 2)` |
| Camera | Perspective, fov 45, near 1 m, far 14 000 m (the backdrop needs it) |
| Controls | damping 0.08, `minDistance` 8 m, `maxDistance` 3 500 m, `maxPolarAngle` PI / 2.05 |
| Opening camera | `SceneRenderer.overviewTarget()` plus the scenery's `defaultCameraOffset` (TTI (40, 45, 210): low from the apron facing the water, the Rock on the horizon), else the generic (95, 70, 115) |
| No WebGL | `webglFailed` is set; `TerminalTwin.vue` hides the canvas, perf panel and FPS chip |

The Quay and Overview view presets (`modules/viewPresets.ts#viewPresetPose`) stay steep and top-down by design: tilt the camera to see the Rock from them.

## Units and axes

- 1 unit = 1 m, +Y up. Quay edge at Z = 0, sea towards -Z, yard and landside towards +Z, X along the quay
  (`modules/sceneModel.ts` header). At TTI +X is south and the quay faces east.
- Apron top is y = 0. The water plane sits at y = -`QUAY_ABOVE_WATER_M` (2.5 m, `scenario/vesselClasses.ts`), the same
  height every hull's waterline is built for.
- STS waterside rail at Z = `STS.waterRailZ` (3 m, `modules/equipmentDims.ts#STS`); landside rail at that plus the gauge.
- GLB frames: glTF +Y up, metres, origin at the ground-contact point, length along +X. The renderer converts each asset's
  frame to scene coordinates in its rig class (below). Containers have their origin at the bottom centre:
  `ContainerInstancer.push` takes the box **centre** (as `SceneModel` returns it) and subtracts half the height.
- Container sizes: `modules/sceneModel.ts#CONTAINER_DIMS` (20: 6.058 x 2.591 x 2.438 m, 40: 12.192 long, 40HC 2.896 high).

## The per-frame pipeline

```
rAF loop (useTwinScene)
  controller.tick(now) ; store.sync()           playback clock, deltas, cue release
  rebuild SceneRenderer if controller.model changed
  skip posing and rendering while controller.busy (flat-out run)
  overlays, colour by, camera keys, follow camera
  lighting: re-applied when the local clock crosses a minute or the daylight lock flips
  frustum from camera
  SceneRenderer.update(displayTime, selection, camera, frustum)     <- poseMs measures this
    containers: for every container id
        SceneModel.containerPose(id, t)  -> centre, yaw, carriedBy, yard
        tintOf (colour by)               -> ContainerInstancer.push
        custodyAt (only if a kind wants owners) -> KindFrame.loads
    ContainerInstancer.end(camera, frustum)   cull, LOD choice, close-up faces, write instance buffers
    AtmosphereRig.update(t)                   night glow follows equipment
    KindFrame -> each EQUIPMENT_KINDS renderer.update(frame)  rigs, LODs, beacons, sound sources
    ShotTracker (one-shot sounds), harbour ambience source
    reservation zones, ASC rail segments, overlay layers, selection box
  PositionalSound.update(camera, sources)
  renderer.render(scene, camera)                                     <- cpuMs = pose + submit
  FpsMeter, AutoQuality, apply a changed quality level next frame
  perf store report every 250 ms
```

Containers are posed first because what each spreader carries decides its configuration (20 / 40 / twin-20) and the
carried box height drives the SHC and ASC hoists (`KindFrame.carried`).

`SceneModel` (`modules/sceneModel.ts#SceneModel`) is the renderer's pure-TS view of the run: per-entity timelines built
from worker deltas, so any display time at or before the engine horizon can be drawn exactly at any speed.
`containerPose` resolves custody at time t: SHC, ASC and STS custody follow the carrier pose; `yardSlot` poses are
parsed once per slot and size and cached in `yardPoses` (the returned object is shared: treat it as read-only);
`vesselSlot` follows the vessel placement; `external` is not drawn. `SceneModel.prune` drops axis segments and hatch
history behind the display time (display time never goes back). Ingest details: [browser-host.md](browser-host.md).

## Containers: `ContainerInstancer`

`modules/containerInstancer.ts#ContainerInstancer`, one per scene, group name `containers`.

- **Placeholders first.** One `InstancedMesh` per size in the livery body colour, so the scene is usable at once.
  `modules/containerAssets.ts#loadContainerAssets` (cached per page, shared with the asset viewer) then swaps in 6
  InstancedMeshes: 3 sizes x LOD0/LOD1. LOD0 is the body and closed doors merged into one geometry; LOD1 is a 12-triangle
  box with a normal-mapped corrugation at the same pitch, so switching LOD does not pop.
- **Capacity.** Per size, the scenario's container count. With landside trucks, every size gets
  `min(2500, ceil(daily truck profile * 0.5) + scripted trucks + 60)` extra for boxes trucks create during the run
  (`SceneRenderer` constructor). Instances beyond capacity are not drawn.
- **Retained slots (#250):** the instancer keeps every box (`set(key, ...)`, `remove(key)`; `begin`/`push`/`end` remain as an immediate mode for the asset viewer and tests). A box keeps its slot in a size x LOD layer until it changes layer (LOD, culled in or out of the frustum); a freed slot is taken by the layer's last box. Only boxes whose data changed (a `set` with different values) or whose slot changed are written, and each buffer is uploaded by the range written (`addUpdateRange`; the whole buffer if over half of the layer). With no change and a still camera the cull and LOD pass is skipped and `stats.instanceBytes` is 0. `SceneRenderer.update` poses a box only when it must: `SceneModel.custodyChanges(t0, t1, seq)` lists the boxes whose custody entry fell in `(t0, t1]` or arrived late (log position `seq`), carried boxes (`containerPose` leaves `poseRest` 0) are posed every frame, and a vessel's boxes when its placement changes. A restart builds a new model and renderer (a full pose); a colour-by change, a time-based colour mode, a backwards jump and the first frame pose every box (unchanged ones cost nothing to the instancer). `stats.posed` / `perf().stats.boxesPosed` counts the boxes handed to the instancer.
- **Cull before posing (#257):** a moving box (`poseRest` 0) is skipped when `ContainerInstancer.nearFrustum(key, frustum, 20 m + 20 m/s x sim seconds since it was posed)` is false, unless its custody changed or it is the selected box; its cached position stays and it is posed again once it could have entered the view, so it is drawn correctly on its first visible frame. The close-up offer (`offerCloseups`) runs only when the camera moved, an option changed or a box within reach of the camera changed, and walks `reachKeys` (the boxes within `closeupDistanceM x hysteresis + 8` of the camera, kept by `set`/`remove`), not every box.
- **Per instance:** a matrix, a `liveryIndex` float attribute (atlas tile) and an instance colour. A colour-by tint
  switches the box to the generic tile and sets an instance colour of tint / generic body colour, so the grey tile comes
  out as the tint. The instance colour exists from the first frame so the shader never recompiles when a tint first appears.
- **Livery shader:** GLB TEXCOORD_0 is authored for tile 0 (HMM); `liveryMaterial()` in `modules/containerAssets.ts`
  patches the material so `vMapUv += tileOffset(liveryIndex + liveryBase)`. `liveryIndexForLine(line)` reads
  `assets/models/containers/livery-atlas.json` (11 tiles: 10 lines plus the generic grey).
- **Culling.** `end(camera, frustum)` tests a 7.5 m sphere per box against the frustum and never writes culled boxes to
  the GPU. Every container InstancedMesh has `frustumCulled = false` (one mesh spans the whole yard).
  `containerLods.culled` counts them.
- **LOD choice** (`chooseLods`): boxes within `lod0DistanceM` of the camera are LOD0 candidates; a box already at LOD0
  keeps it out to x`hysteresis` (1.15). At most `lod0Cap` of the nearest candidates get LOD0 (sorted only when over the
  cap). Culled boxes are never LOD0. Defaults `DEFAULT_LOD_OPTIONS` (140 m, cap 300), overridden by the quality profile.
- **Colour by** is cached per box: static modes per mode, time-based modes per 30 sim s bucket (`COLOUR_BUCKET_S`),
  at most 4 000 recomputes per frame (`COLOUR_BUDGET_PER_FRAME`); the rest catch up over the next frames.

### Hero level (#258)

Above the close-up level, within `HERO_DISTANCE_M` (15 m, hysteresis 1.15) of the camera. `ContainerCloseups` forwards every
`offer` to `HeroLevel` (`heroRenderer.ts`), so the instancer's offer loop is unchanged. Pure selection is
`heroFaceSelection.ts`: exposed faces (a buried box has none), turned towards the camera, nearest first, at most
`heroBoxes x 3` faces (`selectFaces` with hysteresis); the frustum test is the instancer's cull, and there is no line-of-sight
test against other stacks or equipment. Each chosen face is one instance of its `hero-<size>-<kind>` model (the -Z side is the
side model turned 180 degrees), instanced per (size, kind, part): draw calls are bounded by the kinds in use. The white paint
takes livery or tint from the instance colour; wear (rust, scuffs) comes from the box's `wearFor` seed (per-instance detail map
offset and amount), so a box looks the same at every zoom and after a rewind. The plain box and the close-up decals stay under
and over it (polygon offset -1 against the decals' -2; hero markings replace the close-up decal on a full hero face, #260). Models are fetched the first time a face of
that size and kind is chosen (`heroAssets.ts`, the only non-dev file that names `models/hero`); until they arrive the close-up
level shows, and `onReady` marks the close-up pass dirty so a still camera redraws. Low draws none and requests none.
`stats.heroFaces` (also `__tt.perf().stats`) counts faces drawn.

#### Smooth arrival (#259)

`heroPrep.ts` (pure) plus `HeroLevel`: a chosen face is drawn only once it is **prepared** (its model's meshes built, its paint and
wear made); until then the close-up level shows, and a prepared face fades in, so a zoom shows today's look first and then sharpens.
Named constants (all in `heroPrep.ts`):

| Constant | Value | Meaning |
|---|---|---|
| `HERO_PREP_ALLOWANCE_MS` | 3 | per-frame time for preparing faces; nearest first; an item is not started when the last one's cost would pass it, but one always runs so a backlog drains |
| `HERO_FADE_MS` | 200 | a ready face fades in linearly over this; drawn as an ordered screen-door dither (`heroFade` instance attribute, `discard`), so no blending, no sorting, no pop |
| `HERO_CAMERA_SPEED_MPS` | 5 | above this camera position speed no new face is prepared |
| `HERO_SETTLE_MS` | 150 | the camera must stay at or below the speed for this long before preparation starts |

Faces already prepared and still chosen (selection runs every frame, with its hysteresis) stay drawn through a camera move; a face
that leaves the selection loses its prepared state and fades in again if it returns. Model files are fetched as before; building a
model's meshes is part of preparing its first face (inside the allowance). While faces wait (gate closed, allowance spent) or fade,
`HeroLevel.busy` keeps the instancer's close-up pass dirty so a still camera keeps redrawing. `__tt.scene().containerLods.heroPrepared`
counts faces prepared since the start (it does not grow during a fast fly-through). Tests: `tests/hero-prep.test.ts` (fake clock and
fake work items; the renderer through the instancer with a fake clock), smoke `hero-faces.smoke.ts` (arrival test).

#### Sharp markings (#260)

`modules/heroMarkings.ts` (`HeroMarkings`, owned by `HeroLevel`): a hero face's markings are painted at 4x the close-up tile
(`HERO_MARK_SCALE.sharp` = 4: a long side 2048 x 384 px, about 168 px per metre against 42; an end 768 x 768) into their own atlas pages
(`sharp`: 2048 px pages, 16 MB of texels each; 5 side tiles or 4 end tiles per page), as a transparent decal 3 cm off the hero face
(`HERO_MARK_OFFSET_M`, polygon offset -4, alpha-fade with the face), so the hero paint, ribs and wear show through. Roofs print nothing.
The content is the close-up level's: one pure `describeMarkings` result, painted by the same `drawSideMarks` / `drawDoorMarks` /
`drawFrontMarks` / `drawWear` in `containerTextures.ts` (`paintFaceMarks`, wear speckle seeded from the close-up region so the pixels
agree too), so number, line name, ISO type, weight plate, CSC plate, SUPER HEAVY, bolt seal and wear match the close-up face.

- **Painting is preparation.** The tile is painted in the face's `runPrep` item, so it sits inside `HERO_PREP_ALLOWANCE_MS` and behind the
  camera gate. A face whose tile is missing (new step, evicted) is prepared again for its tile only; its geometry stays drawn.
- **Bounded, least recently shown reuse.** Pages per kind are capped at `maxPages(kind, step, heroBoxes)` (a box shows at most one side and
  one end to a camera): High (32 boxes) at most 7 side + 8 end pages, 240 MB of texels in the worst case, Medium (12) 3 + 3. A full kind gives
  up the tile shown longest ago, never one shown this frame; with none to give the face shows without hero markings (the close-up decal stays).
  Tiles are kept while their face is cached (a face that leaves and returns repaints nothing).
- **Close-up decal hidden under a full hero face.** `HeroLevel.covers(id)`: once a hero face is fully faded in (and has its tile, or prints
  nothing), `ContainerCloseups` skips that face's decal, so the older decal no longer shows between the hero ribs. During the fade it is
  still drawn underneath.
- **Second shedding step.** `HeroLevel.setMarkStep('standard')` (`SceneRenderer.setHeroMarkStep`, `__tt.setHeroMarkings('sharp'|'standard')`)
  repaints hero faces at today's resolution (512 px pages, 1 MB each) without losing the hero geometry; `'sharp'` switches back. Not wired to
  Auto yet (#261). `__tt.scene().containerLods` adds `heroMarkStep`, `heroMarkPages`, `heroMarkTiles`, `heroMarkDrawCalls`, `heroMarkBytes`.
- Tests: `tests/hero-markings.test.ts` (atlas, LRU, allowance, step switch, covered decal, same content); look: `docs/prototypes/260/`.

### Close-up markings (#119, #143)

Markings are drawn per visible face, not per box, on every quality level (#158).

- Boxes within `closeupDistanceM` are offered to `modules/containerCloseups.ts#ContainerCloseups` with their exposed faces.
  `modules/exposedFaces.ts#exposedFaces`: `'yard'` (via `neighboursOf(box, others)`) hides a stacked box's underside and every face a neighbour touches
  (a box on top, the next bay at either end, the next row at either side, within 0.9 m); `'free'` (vessel, truck,
  spreader boxes) shows all six. Face names in the box frame: `top`, `bottom`, `door` (+X), `front` (-X), `sideP` (+Z), `sideN` (-Z).
  The `yard` flag comes from `ContainerPose.yard` (yardSlot custody only); neighbours come from a 14 m grid (`GRID_CELL_M`) of yard boxes in reach.
- Faces turned away from the camera are dropped; the rest compete for `closeupFaceBudget`, nearest first, with
  hysteresis x1.15 (`modules/closeupFaceBudget.ts#selectFaces`).
- A chosen face is one instance of a shared unit quad sampling a tile of a canvas atlas, drawn 6 mm off the plain
  instanced box, which keeps its LOD and is the fallback for every hidden or unchosen face.
- Atlas (`modules/containerTextures.ts`): pages per face kind (long side 512x96 tiles, roof 512x64, end 192x192),
  created on demand. `paintContainer` paints a box whole into a scratch canvas (`TEXTURE_LAYOUT`, 1024x512) and the face
  regions are copied into tiles (`canvasAtlasBackend`). A tile stays while its face is cached, is repainted when the
  tint changes, and the least recently shown tile is reused when a page kind is full. One draw call per atlas page in
  use (20 to 32 tiles per 1024 px page), none when the camera is far. Painting sits behind `AtlasBackend` so Vitest stubs it.
- Content (`modules/containerMarkings.ts#describeMarkings`, pure): door end (owner prefix, serial, check digit from the
  id's 11th character, computed with `iso6346CheckDigit` only for an id without one; ISO type; weight plate from
  `plateFor(isoType)`; CSC plate; SUPER HEAVY when heavy; bolt seal when laden), side text (box number, line name in the
  livery's text colour, no logo), wear (`wearFor(id)`: fade, rust, dents, seeded from the id). Roofs carry no text (#170).
  Plate tare is `tareKgOf`, equal to the stored tare. The 45G1 row is the reference photo; other max gross and capacity
  values, and the 22U1, 42U1, 22P1, 42P1, 22T1 rows, are [A]. An ISO type with no row gets no plate: a plate never
  shows another type's numbers. `SceneModel.containerDetail` carries `laden`, `isoType`, `heavy` (weight class HEAVY).
- The close-up corrugation (`modules/closeupGeometry.ts#CORRUGATION_PITCH_M`, 0.25 m, the real rib pitch) differs from
  the LOD0 GLB rib (0.56 m, an [M] for the triangle budget). Kept as is.

### Far-field legibility (#170, measured, not fixed)

On the TTI baseline (04:00, 1280x720, software WebGL, camera 150 m from block B01) a side wordmark (letters about 0.93 m
tall in the 2048 atlas) reads up to about 80 to 100 m on Low and High alike and fades to the body colour beyond. LOD
is not the cause: LOD0 and LOD1 sample the same atlas. Anisotropy 4 to 16 and a 2.5x LOD1 normal scale changed nothing;
removing the LOD1 normal map changed nothing either (the 0.56 m ribs are about 3 px at 150 m). The Yard view preset
(about 493 m) is sub-pixel for both. Options: a larger wordmark in the atlas (needs `tt:assets`, so bpy) or a far-LOD design decision.

## Equipment kinds registry

`modules/equipmentKinds/index.ts#EQUIPMENT_KINDS` lists one `EquipmentKindDef` per kind
(`modules/equipmentKinds/types.ts`). The scene renderer, dev API, picking, labels and inspector iterate it. Order =
build and update order and the Labels overlay's priority.

| Kind | Module | `sceneKey` | `rigKey` | Labelled | Wants container owners |
|---|---|---|---|---|---|
| `sts` | `equipmentKinds/sts.ts` | `sts` | `stsRendered` | yes | yes |
| `shc` | `equipmentKinds/shc.ts` | `shcs` | `shcRigs` | yes | yes |
| `asc` | `equipmentKinds/asc.ts` | `ascs` | `ascRigs` | yes | yes |
| `truck` | `equipmentKinds/truck.ts` | `trucks` | `truckRigs` | no | no |
| `vessel` | `equipmentKinds/vessel.ts` | `vessels` | `vesselHulls` | yes | no |
| `hatch` | `equipmentKinds/hatch.ts` | `hatchPanels` | `hatchRigs` | no | no |

- `KindFrame` (built once per frame): `t`, `cameraPosition`, `lodScale` (quality), `carried` (box height per carrier),
  `loads` (boxes per `<ownerKind>:<ownerId>`, filled only when a renderer sets `wantsContainerOwners`; the owner comes from the box's pose, `SceneModel.poseOwner`, with no second lookup, #257), `live` (clock running), `flashOn` (beacon phase), `colour`, and the output `sounds`.
- `KindRenderer`: `update(frame)`, optional `onInfrastructureLoaded()`, `rigState()` (dev API, empty until the GLB
  loads), `stats()` (its `SceneStats` fields), `dispose()`.
- **Adding a kind:** a module exporting an `EquipmentKindDef`, one entry in `EQUIPMENT_KINDS`, and an
  `inspector.kind.<kind>` catalogue entry. `registrationProblems(def)` lists anything missing. `sceneModel.ts` still has
  its own kind chain beside the registry (a known gap).

## Equipment models and rigs

Every kind starts with a procedural placeholder (the `equipmentDims.ts` sizes) and swaps in its GLB rig when it loads.
Rig node names come from the sidecar; the rules are in [assets-pipeline.md](assets-pipeline.md#rig-and-sidecar-conventions).

| Model | Loader / rig | LOD switch (m, camera distance) | Hysteresis | `lodScale` applies |
|---|---|---|---|---|
| Container | `ContainerInstancer` | LOD0 within profile `lod0DistanceM`, capped | x1.15 | no (own profile fields) |
| STS | `modules/stsAssets.ts#loadStsTemplate`, `StsModel` | 250 / 900 (sidecar `lods.*.maxDistanceM`) to crane centre | x1.15 (`STS_LOD_HYSTERESIS`) | yes |
| SHC | `modules/shcAssets.ts#loadShcModel`, `ShcRig` | 110 / 380 (`SHC_LOD_DISTANCES`) | x1.15 | yes |
| ASC | `modules/ascAssets.ts#loadAscModel`, `AscRig` | 90 / 300 (`ASC_LOD_DISTANCES`, from the sidecar) | x1.15 | yes |
| Truck | `modules/truckAssets.ts#loadTruckModels`, `TruckRig` | 60 / 200 (`TRUCK_LOD_DISTANCES`) | x1.15 | no |
| Vessel hull | `modules/vesselAssets.ts#loadHullModel`, `VesselHulls` | 300 / 1100 to the hull's bounding box (`modules/vesselRenderer.ts#DEFAULT_VESSEL_LOD`) | x1.1 | no |

`lodScale` divides the camera distance before the STS, SHC and ASC LOD choice, so Low (0.4) drops them to cheaper LODs 2.5x sooner.

### STS (Malaccamax)

- `sts-malaccamax.glb`. Rail gauge 30.48 m, 52 m lift above rail, 68 m outreach [V]; apex 82 m, 18 m backreach, 18 m leg
  spacing, 27 m over buffers (= `quay.stsMinSpacingM`) [A]. Root mounted at (0, 0, `waterRailZ` = 3)
  (sidecar `sceneMounting`); `modules/equipmentDims.ts#STS.apexY` is kept in sync for picking.
- `StsModel.setPose`: `gantry` = gantryX, `trolley` = trolleyZ - 3, `hoist` = hoistY; spreader telescope and twin-lock
  values from the sidecar's `spreaderModes`; twist-locks 90 deg while carrying; ropes by the sidecar `stretch` rule.
  Rig nodes repeat per LOD with suffixes (`trolley_lod1`, per sidecar `lodNaming`); `modules/assetRig.ts#AssetRig`
  accepts both suffixed names and identical names that GLTFLoader renames (found via `userData.name`).
- Crane number (101, 102, ...) via an own plate material per crane (tiles of `sts-atlas.json`).
- The engine gantry is unbounded along the rail; the sidecar's +-40 m gantry range is for the viewer only.

### Spreader mode rule (#142)

`modules/spreaderMode.ts#spreaderModeFor` (pure) is shared by STS, ASC and SHC: a single 20 is `20`, other single boxes
`40`, two boxes `twin-20` only with `canTwin` (STS), empty keeps the last mode. ASC and SHC GLBs have no telescope
nodes, so their rigs scale `spreader_geo` along X (scale and position, since meshopt put the dequantisation transform
there) and move the `twistlock_*` nodes by the ratio of `CASTING_SPACING_M` (short 5.853 m over long 11.985 m).
A true telescoping mesh needs a generator change.

### SHC

- Red Kalmar-style shuttle carrier. Rig: `steer_fl|fr|rl|rr` (about +Y, +-35 deg) > `wheel_*` (about +Z, forward roll is
  negative); `hoist` (+Y, 0 to -3.1 m) > `spreader` (0 to 0.35 m float) > `twistlock_*`. LOD0 all, LOD1 wheels, steering,
  hoist, spreader; LOD2 a static silhouette.
- Attach point `container_attach` = top of the carried box, 6.0 m above ground at hoist 0: `hoist = (lift + box height) - 6.0`.
  Lowest travel puts the plane at 2.9 m, the top of a 40HC on the ground.
- Pose (`SceneModel.shcPose`, pure, `tests/shc-pose.test.ts`): wheel roll = -odometerM / tyre radius (reversing rolls
  backwards); at a corner the yaw swings over 2 s (shorter on short legs, smoothstep) and `steerRad` follows
  sin(PI * progress) up to +-35 deg, rear pair opposite; a reversal over 135 deg is driven in reverse. Spawn yaw faces
  the first leg (`modules/shcSpawn.ts#shcSpawnYaw`; east, yaw 0, before any leg is known).
- Hoist (`equipmentKinds/shc.ts`): carrying, it follows the engine's `lift` exactly. Empty, it is raised while driving or
  parked and lowered otherwise, eased at `EMPTY_HOIST_MPS` 1.5 m/s of display time, so it never snaps. Corners are
  visual only: the engine plans rest-to-rest legs, so the 2 s swing happens at the start of the next leg.
- Fleet number plates ("SHC 01" to "SHC 120"): `shcPlateMaterial()` gives each `ShcRig` its own material copy with UVs
  offset to the id's tile (`SHC07` is 7; grid from `meta.branding.fleetNumbers`); `ShcRig.dispose()` frees it.

### Truck

- Three cab GLBs (`truck-cab-high|mid|day`, tractor plus skeletal chassis) and `truck-chassis`. `truckVariant` picks cab
  shape and livery from the id; livery = texture clone with a tile offset, shared per shape and livery.
- Frame: origin under the centre of a 40 ft box, cab at +X; deck `TRUCK_DECK_M` 1.3 m.
- Pose (`SceneModel.truckPose`, `tests/truck-pose.test.ts`): wheel roll = -odometerM / 0.5; `articulationRad = steerRad x 1.15`
  clamped to 40 deg (`MAX_ARTICULATION_RAD`) swings the tractor about `fifth_wheel`; `loadOffsetM` = -3.0675
  (`TRUCK_BOX20_OFFSET_M`) for a 20 ft box so it sits on the front pins. A truck's box is drawn doors to the rear (yaw + PI).
- Reversing into a stall does not articulate realistically (follows the steering sign, no hitch model). Placeholder steering sign is `+steerRad`.

### ASC

- Blue ZPMC-style RMG. 25.4 m between rail centres, 8 rows, 40 t [V]; 29.2 m over the decks, 10.1 m along the rails
  (two fit the engine's 12 m minimum separation), 24.7 m high, bridge underside 20.0 m. glTF X = across rows (trolley),
  Z = along the rails (gantry). Placed at (block.x, 0, 0).
- Rig: `gantry` (+Z) > `trolley` (+X, +-11 m) > `ropes` (stretch rule) and `hoist` (+Y, 0 to -15.1 m) > `spreader` >
  `twistlock_*` (LOD0 only). LOD2 keeps gantry, trolley, hoist, spreader, so far cranes still move.
- `modules/ascRig.ts#ascRigValues` (pure) maps `SceneModel.ascPose` and the carried box height to rig values. Attach plane
  = top of carried box, 18.0 m at hoist 0: `hoist = (box bottom + box height) - 18.0`. 18.0 m clears a 5-high stack
  with the engine's 0.6 m travel clearance. Unit-tested over a whole fixture run: no clamping.
- `ascScaleY(tiers)` stretches the whole rig vertically for blocks of 6 to 8 tiers. Picking uses `ASC_MODEL`
  (29.2 x 24.7 x 10.1 m, stretched the same); `modules/equipmentDims.ts#ASC` only sizes the placeholder.

### Gantry beacons

Amber lamps at the sidecar `beaconMounts`: 8 per STS (`stsBeaconOffsets()`, z shifted by `STS.waterRailZ`), 4 per ASC
(`ascBeaconOffsets(scaleY)`). `modules/gantryBeacons.ts#GantryBeacons` shows them only while gantrying and on the
wall-clock flash phase (`BEACON_PERIOD_MS` 800). A paused sim is never gantrying.

### Vessel hulls

- Five class GLBs (`vessel-feeder|feedermax|panamax|neo-panamax|ulcv`). Frame (`modules/vesselHull.ts`, pure, shared with
  Node tests): stern at x = 0, bow +X, y = 0 at the waterline, z = 0 centreline, +Z the quay side (row 0). The sidecar
  `bayGrid` (origin, `holdTopY`, bays, rows, tiers, pitches) maps slots: `hullSlotCentre` and `hullPlacement` match the
  engine's `slotCentre` (`tests/vessel-hulls.test.ts` cross-checks every class).
- `VesselHulls` draws a procedural placeholder at once, then loads only the classes the scenario uses. Livery: hull UVs
  authored for tile 0, shifted per line (`vesselLiveryIndex`); line from `VesselConfig.line` or the name's style
  (`scenario/vesselNames.ts#vesselLine`, `lineFromVesselName`); `vesselName(line, random)` builds fictional names. Name
  boards are runtime canvas textures. LOD distance is to the hull's bounding box, at berth and anchorage alike.

**V-shaped holds, rendering side (#131).** Below deck the holds narrow towards the keel per `VesselClassSpec.holdRows`
(engine side and the "never enumerate `0..spec.rows` for a hold tier" rule: [state-model.md](state-model.md)). In 3D the
hold liner under each open hatch (`modules/hullHatchOpening.ts#holdLinerOutline`, extruded by `VesselHulls.holdLiners`)
is the same stepped V. The bay viewer marks out-of-profile cells `BayCell.absent`. Not done: the outer hull skin is baked
by the Blender generator (`vessels.py`) and is unchanged.

**Hatch cover cutting (TT-R10, #173).** The GLB's `hatch_covers` are static, so for every LOD `VesselHulls` cuts its copy
of the hull with `hullWithOpenHatches(meta, lod, mesh, bays)`: cover triangles inside an open bay's footprint go, flat
main-deck triangles are clipped to outside the coaming (`modules/meshClip.ts#clipPolygon`), and a hold liner is added.
`openHatchBays(hatchCovers, bayCount, panelBays)`: hatch covers off, every bay is open (no cover over any hold at any
LOD); on, the bays that have panels are open and the `hatch` kind draws those panels. LOD2 is one box over all bays: its
top is clipped over every open bay (needed so a crane never works under a solid far cover), its walls stay as coamings.
`HULL_HATCH_GAP_M` (1.4) and `HULL_COAMING_M` (1.7) mirror `HATCH_GAP` and `COAMING_M` in
`assets/generators/tt_assets/vessels.py`: change them together. Engine side of hatch covers: [subsystems/quay.md](subsystems/quay.md).

### Hatch panels

`equipmentKinds/hatch.ts`: one instanced box mesh (`hatch_panels`, `frustumCulled = false`) posed from
`SceneModel.hatchPanelPose`: on the hatch, on the spreader, or stacked in the quay laydown. Hidden panels get a zero-scale matrix.

### Infrastructure

- 23 GLBs in `assets/models/infrastructure/` on one shared atlas: gate (`gate-lane` 3.5 m, `gate-lane-oog` 8 m,
  `gate-island` 1.2 m, `gate-office`), quay (edge, rail, bollard, fender), yard (ASC rail, fence, markings, mast),
  buildings (control, substation, workshop), backdrop (rock, hills, coast) and five TTI `scenery-*`.
- Lane widths match the engine's `GATE_LANE_W_M`, `GATE_OOG_LANE_W_M`, `GATE_ISLAND_W_M` (`engine/landsideGraph.ts`), so
  models and truck paths agree. The barrier boom is baked raised (closed on the unused OOG lane); trucks do not trigger it.
- `modules/infrastructureLayout.ts` (pure: `gatePlacements`, `quayPlacements`, `yardPlacements`, `buildingPlacements`,
  `mastSpots`), `modules/infrastructureAssets.ts#loadInfrastructureAssets` (lazy, one material and atlas),
  `modules/infrastructureRenderer.ts#InfrastructureScene` (one InstancedMesh per geometry key: about 20 draw calls however long
  the quay). `yard-markings.glb` holds two markings side by side; the loader re-centres the parts.
- Masts (`mastSpots`, shared with the night glow; at most `MAX_MASTS` 400) stand only mid-gap between neighbouring blocks
  and beside the outermost blocks, never inside a block footprint (`BLOCK_FOOTPRINT_HALF_X_M`): a block's centre line is
  where its ASCs travel. `tests/infrastructure.test.ts` asserts this for every preset and fixture.
- **Far tier (#249):** `modules/farTier.ts`. Yard fences, ASC rails and masts (`FAR_TIER`: 220, 220 and 350 m) draw as
  12-triangle box stand-ins (`standInGeometry`: the source's bounding box, UV of its largest upward-facing triangle, footprint of its lower 60 %, so the same atlas
  swatch and the same material) beyond that 3D distance from the camera. The choice is per instance (`FarTierSelector`,
  hysteresis 30 to 40 m, recomputed only after the camera moves 2 m), done in `InfrastructureScene.update(cameraPosition)`
  each frame: each tiered key has a near mesh and a far mesh, and an instance sits in exactly one. A mesh with no instances
  is hidden, so draw calls do not rise (TTI overview 282 before and after); `InfrastructureStats.drawCalls` and `triangles`
  count visible meshes only. No cross-fade: the box has the source's footprint and colour, so the swap at 220 m or more is
  a few pixels (screenshots in `docs/prototypes/249`). TTI overview triangles (main plus shadow pass): 1 561 283 to 382 435.
- Placeholders (procedural quay lines, ASC rails, pad and stall outlines, gate furniture, mast poles) stay until the GLBs
  load, then hide (`SceneRenderer` `infraPlaceholders`, `LandsideScene.useGateModels`, `AtmosphereRig.useMastModels`).
  Roads, queue approach and stall spurs stay procedural.
- Static flat scenery (yard slabs, rails, bay ticks, stall, pad and bay markings, road surfaces, gate buildings) goes
  through `modules/staticBatch.ts#StaticBatch`, merged per material. New static scenery must use it, not one mesh per piece.

## Quality tiers and Auto

`modules/quality.ts` (pure, `tests/quality.test.ts`). `QUALITY_PROFILES`:

| Field | Low | Medium | High | Applied by |
|---|---|---|---|---|
| `shadows` / `shadowMapSize` | off / 512 | on / 1024 | on / 2048 | `useTwinScene.applyQuality`, `AtmosphereRig.setQuality` |
| `lod0DistanceM` / `lod0Cap` | 40 / 60 | 90 / 180 | 140 / 300 | `ContainerInstancer.setLodOptions` |
| `closeupDistanceM` / `closeupFaceBudget` | 18 / 48 | 25 / 120 | 35 / 400 | same |
| `heroBoxes` | 0 | 12 | 32 | `HeroLevel.setLimits` via `SceneRenderer.setQuality`: boxes' worth of hero faces (x3 faces; #258) |
| `lodScale` | 0.4 | 0.7 | 1 | `KindFrame.lodScale` (STS, SHC, ASC) |
| `resolutionScale` | 0.65 | 0.85 | 1 | pixel ratio |
| `oceanSegments` | 1 (flat Lambert quad) | 24 | 96 (standard material, 0.18 m swell) | `SceneRenderer.setOceanDetail` |
| `nightLights` | 24 | 120 | 400 | mast glow points drawn at night |
| `environmentReflections` | off | on | on | `AtmosphereRig.setQuality`: `scene.environment` is the sky environment or null (#248) |
| `contactShadows` | off | on | on | `SceneRenderer.setQuality` sets the shared contact-shadow uniform to 0 or 0.5 (#248) |

Antialiasing is chosen at renderer creation and is not part of a live profile.

- Setting: Auto (default), Low, Medium, High, remembered in localStorage (`store/perfStore.ts`, guarded). Auto starts at High.
- `AutoQuality`: steps down one level when 4 consecutive one-second windows are under `AUTO_DOWN_FPS` 45; steps up when
  8 windows are at or above `AUTO_UP_FPS` 57. A step up undone within 30 s doubles the windows needed for the next one
  (max 240). A frame gap over 1 s (hidden tab) is skipped. History restarts after every change.
- UI: `components/PerfPanel.vue` (quality picker, Stats button, key P: fps, draw calls, triangles, frame CPU ms, level).
  `components/FpsChip.vue` (`tt-fps-chip`, teleported into `SimPage`'s `#sim-header-slot`, hidden when `webglFailed`)
  shows the `FpsMeter` 1 s average; `modules/fpsChip.ts#fpsSeverity` amber below 30, red below 20; a click toggles the overlay.

## Lighting, daylight and night

- `modules/atmosphere.ts` (pure): `hourOfDay(startIso, t)` is the local hour (same zone as the clock display).
  `lightingFor(hour, lockDaylight)`: sun between `SUNRISE_H` 6.5 and `SUNSET_H` 19.5, modes `day` / `dusk` / `night`.
  The daylight lock squeezes 24 h into the daylight window: the sun still travels, night never falls.
  `ambientIntensity(daylight)` = 1.4 + 0.5 (1 - daylight): brighter at night (1.9), with brighter night colours, so
  boxes, trucks and cranes stay distinguishable.
- `modules/atmosphereRig.ts#AtmosphereRig` (owned by `SceneRenderer`): hemisphere light, sun, sky and fog colours.
  Sun shadow camera is a fixed 500 x 500 m box (near 10, far 800), `normalBias` 0.35 (container corrugation shows acne
  without it), `bias` -0.0004. The sun casts only when both the time of day and the quality allow it.
- **Sky reflections and contact shadows (#248):** `modules/skyEnvironment.ts` (pure, `tests/skyEnvironment.test.ts`)
  holds the sky colours per lighting mode, `environmentIntensity(daylight)` (0.12 at night to 0.67 by day) and
  `EnvironmentCache`. `AtmosphereRig.attachRenderer` (called by `useTwinScene` after `setQuality`; headless hosts never call it, so
  they get no reflections) bakes a procedural sky dome (gradient plus a sun patch) into a PMREM texture, once per
  lighting mode on first use and cached (`environmentBuilds` in `atmosphere()` is at most 3, never per frame). Only
  `scene.environmentIntensity` follows daylight each lighting change. No new draw calls or triangles (TTI overview on
  High: 315 calls, 395,075 triangles before and after). `modules/contactShadow.ts` patches the container materials
  (placeholder box and the `liveryMaterial(..., true)` GLB materials) so the lowest 0.7 m of every box face fades down to
  50 % brightness (box-local height, boxes have their origin at the bottom), which darkens both box-to-ground and
  box-to-box joins in the fragment shader: no extra pass. One shared uniform turns it off on Low without a recompile.
  Not covered: close-up marking decals and the vessel hull. Before and after screenshots: `docs/prototypes/248/`.
- Night is the cheaper mode: no shadow pass, no extra real lights. High-mast poles (instanced) get additive glow points
  (up to `nightLights`) and every STS, ASC and SHC gets one glow point that follows it: 2 draw calls in all.
- **Daylight on entry (#171, #192):** every run launch sets `store.lockDaylight = true` (`launch` in
  `store/twinStore.ts`), for fixtures and presets alike; Reset turns it back on. The top-bar Daylight toggle changes it
  for that run only. Presets start at 08:00 local (`clockStart(8 * 3600)`; the setup dialog's default is Monday 08:00);
  fixtures keep 06:00, so goldens are unchanged.
- Not done: trucks have no night lights; the sun is not seasonal.

## Backdrop and terminal scenery

- `modules/backdrop.ts#sceneryFor(name)` asks the terminal registry (`terminals/index.ts#terminalForScenario`); a
  scenario no terminal owns gets `GENERIC_SCENERY` (coastline, headland, `fogFarM` 9 000 m). Generic modules never compare
  preset names (`tests/terminals.test.ts` fails if one imports a TTI preset-name constant).
- `buildBackdrop` adds a hinterland plane, then calls the scenery's `build(ctx)`. Parts are flat-shaded Lambert meshes
  that neither cast nor receive shadows. `Backdrop.useModels` swaps the parts named in `modelParts` for GLB geometry
  once infrastructure has loaded (`atmosphere().scene.backdrop.models`).
- TTI (`terminals/tti-algeciras/scenery.ts#TTI_SCENERY`, `fogFarM` 24 000 so the Rock reads as haze): the Rock at true
  scale (`ROCK`: 5.2 km x 1.2 km x 426 m, centre 9.2 km east and 600 m south of the quay middle; the GLB
  `build_backdrop_rock` repeats the profile: change both together), hills, coast, the 550 m North Quay (bare slab), the
  ground layout `TTI_GROUND` (#147: grey tarmac south, sea channel 200 m north of the North Quay, then green land and
  mountains), and the five surroundings `SURROUNDINGS` (#123): `shore`, `anchorage` (nine ships 1.5 km out and more),
  `tanks`, `landside` (Isla Verde road, rail, freight train, warehouses), `town`. Each is one mesh, a stand-in until its
  GLB loads. The tanks and town show from landward views only.
- Water, land and the far plane were enlarged for the scenery: water plane 40 000 x 12 000 m, camera far 14 000 m.

### Scenery road at the north land edge (#172, #192)

- The Isla Verde road (`landside` part, stand-in and `scenery-landside` GLB) stops at the north land edge,
  `TTI_ROAD_NORTH_END_X` (scene x = -70 m, the North Quay's water face) and runs inland to the south end. The engine's
  access road (`ls:AS` to `ls:AJ`, junction x = 43 m) and truck spawn are separate and unchanged.
- The stand-in boxes start at that line. The GLB's baked road runs further north, so `TerminalScenery.modelClipX`
  (TTI: `{ landside }`) cuts the loaded geometry in `useModels` (`clipGeometryToX` in `backdrop.ts`, using
  `modules/meshClip.ts#clipMeshToHalfSpace`, the same pure clip as the hatch opening). The loader cache's geometry is not touched.
- No asset is rebuilt: `build_scenery_landside` still bakes the full road, so no budget moves and the clip stays a no-op on a cut asset.
- The `seaChannel` plane sits at `TTI_SEA_CHANNEL_Y` (0.08 m), not 0.04 m, so it never shares a depth with road, rails
  and yard markings (all at 0.04 m). From above, clipped and unclipped roads look alike; the geometry test is the proof.
- Proof: `tests/scenery-road.test.ts`, `tests/tti-road.test.ts`; screenshot command in terminal-twin-AGENTS.md "How to prove a change works".

## Sound

Every sound goes through the shared master gain (`useAudioStore().masterGain`: volume, or 0 while muted; default
unmuted at 40%). Terminal Twin has no sound toggle of its own.

- **Cues** (`modules/cues.ts#CuePlanner`): `StsGrounded` / `StsLoaded` landed, `VesselArrived` / `VesselDeparted` horn
  (departure also shows `components/DepartureBanner.vue`, 3.5 s, click-through, shown regardless of mute),
  `ScenarioEnded` chime. Released when the display clock reaches them; long-past cues (a Run to jump) are dropped.
  Cues come from `delta.events`, capped at `EVENT_SUMMARY_CAP` 200 per batch (`worker/protocol.ts`), so flat-out runs
  drop most by design. `SoundPlayer` plays MP3s at base level x gain; at gain 0 no `Audio` object is created; a gain
  change retunes sounds still playing. `minGapMs`: landed 150 ms up to x10, 600 ms to x60, 2.5 s above; horns 3 s, 12 s above x60.
- **Positional** (#125, #129): kind renderers push `SoundSource`s into `KindFrame.sounds`; `ShotTracker`
  (`soundShots.ts`) adds one-shots from `SceneModel.shotsBetween(t0, t1)` (custody handoffs, truck leg ends), each kept
  `SHOT_MS` 300 ms of wall clock so it is heard at any speed; seeks, rewinds and a paused clock make none.
  `modules/soundMixer.ts#mixSources` (pure) returns at most `MAX_VOICES` 12 voices (loudest, ties by id); `diffVoices`
  gives start / stop / retune. `PositionalSound` (Web Audio, lazy, nothing created at gain 0) loops one buffer per voice
  through one master `GainNode`.

| `SOUND_PROFILES` entry | When | Ref / max distance (m) | Level | Loop |
|---|---|---|---|---|
| `gantryAlarm` | STS, ASC gantrying | 40 / 500 | 0.6 | yes |
| `motorWhine` | STS, ASC working (trolley or hoist moving) | 25 / 220 | 0.35 | yes |
| `twistlock` | STS, ASC, SHC lock or unlock | 15 / 160 | 0.7 | no |
| `landingThud` | set down (not carrier to carrier) | 20 / 220 | 0.8 | no |
| `reverseBeeper` | SHC, truck reversing | 12 / 130 | 0.5 | yes |
| `truckEngine` | visible trucks idle or driving | 8 / 80 | 0.3 | yes |
| `airBrake` | truck drive leg ends | 8 / 90 | 0.5 | no |
| `harbourAmbience` | always (`HARBOUR_SOURCE`), not positional, counts toward 12 but never crowded out | all | 0.12 | yes |

Gain = level inside the reference distance, then level x (ref / d) x (1 - ((d - ref) / (max - ref))^2), 0 at max (`attenuate`).
Files: MP3 cues copied from `available-media/sound-samples`; WAVs synthesized (`pnpm run tt:sounds`, see [assets-pipeline.md](assets-pipeline.md#synthesized-sounds)).

**Mute on entry (#171, #192).** `store.enterSim()` (from `TerminalTwin.vue` `onMounted`) mutes the shared store on every
entry; `store.leaveSim()` (`onBeforeUnmount`) restores the mute from before entry unless the owner changed it inside.
Both are transient (`audio.setSoundMutedTransient`, no write to site storage), so closing the tab inside leaves the
stored choice alone; only the owner's own change is stored. Other sims are untouched. Proof: `tests/daylight-and-mute.test.ts`.

## Home card

`pnpm run tt:card` (`scripts/tt-home-card.mjs`) drives `scripts/screenshot.mjs` (headless Chromium, software WebGL, no
server needed): loads `TTI Algeciras baseline` with seed 7 starting 10:00 local, runs `TT_CARD_HOURS` (default 1) hours,
pauses, hides all UI, `cameraTo('STS104', 380)`, and captures 1200x630 to `assets/home-card.png`
(`definition.ts` `cardImage`). Re-run and commit whenever visuals change. Do not edit sim source while it runs (Vite hot reload kills the capture).

## Benchmarks and dev API

- **Engine benchmark** (`pnpm run tt:bench`, `cli/benchmark.ts#runBenchmark`, local only): measures the engine, not the
  view. Exit 1 when any metric is over 20% worse than `perf/baseline.json` (`REGRESSION_THRESHOLD`); `--slow-ms n` is the
  self-test that trips it. Compare only on a like machine and load (check `load1`). Its findings: any code adding or
  deleting `state.yardSlots` entries must call `indexYardSlotAdded` / `indexYardSlotRemoved` (`engine/yardIndex.ts`);
  `engine/subsystems/landside.ts#eligiblePickups` still scans every yard slot per truck arrival. Options and numbers: [optimising/run-speed.md](optimising/run-speed.md).
- **Renderer**: the yard stress test (`?viewer=yard`) and the `__tt.perf()` procedure are in [optimising/frame-rate.md](optimising/frame-rate.md).
- `__tt.scene()`: counts, `containerLods {lod0, lod1, closeup, closeupFaces, culled}`, `stsLods`, `shcLods`, `ascLods`,
  `vesselLods`, `*Assets` (`placeholder` / `loaded`), `landside`, `infrastructure`, `gantryBeacons`, `render {calls, triangles}`, `frames`.
  `__tt.sceneState()`: the `sceneKey` and `rigKey` maps above, `liveries[id]` (atlas index, size, LOD, tint, centre).
  `__tt.atmosphere()`: `{ lockDaylight, soundGain, sound, positional: { voices }, banner, scene: { mode, daylight, shadows, masts, equipmentLights, backdrop } }`.

## Proof

| Area | Vitest | Smoke (`tests/browser/`) |
|---|---|---|
| Containers, close-ups | `container-closeup`, `exposed-faces`, `closeup-face-budget`, `container-markings` | `container-assets`, `container-closeup` |
| Quality, perf | `quality`, `fps-chip`, `perf-structures` | `terminal-twin-perf`, `terminal-twin-volume-fps`, `terminal-twin-fps-chip.prod` |
| STS, SHC, ASC, truck | `sts-asset`, `shc-asset`, `shc-pose`, `shc-fleet-number`, `asc-asset`, `asc-rig`, `truck-asset`, `truck-pose`, `spreader-mode` | `sts-asset`, `shc-model`, `asc-model`, `truck-model`, `spreader-spawn` |
| Hulls, hatches | `vessel-hulls`, `vessel-liveries`, `hatch-scene`, `hull-profile` | `vessel-hulls`, `terminal-twin-hatch` |
| Infrastructure, scenery | `infrastructure`, `backdrop`, `surroundings`, `scenery-road`, `tti-road`, `terminals` | `infrastructure` |
| Atmosphere, sound | `atmosphere`, `cues`, `sound-player`, `sound-mixer`, `positional-sound`, `sound-synth`, `gantry-beacons`, `gantry-motion`, `sound-sources`, `sound-shot-tracker`, `daylight-and-mute` | `terminal-twin-atmosphere`, `gantry-alarm` |

Screenshots: `pnpm run screenshot --path /sim/terminal-twin ...` (commands in terminal-twin-AGENTS.md). Headless runs use
SwiftShader: only draw calls and triangles mean anything there, never fps.

## Gotchas

- GLTFLoader renames duplicate node names (`wheel_fl`, `wheel_fl_1`) and keeps the file name in `userData.name`: look nodes
  up by `userData.name` and animate every node of a name. Do not rename `@LODn`-stripped names in glTF tooling.
- Rig nodes are empties; the mesh is the `<name>_geo` child. Animating a mesh node directly gives a wrong pivot after meshopt.
- `loadContainerAssets()` (and every other loader) is one cached promise per page shared with the viewer: never dispose
  its materials, textures or geometries from a renderer. Per-entity material copies (SHC plates, STS numbers, truck
  liveries) are the rig's own and are freed by its `dispose()`.
- An instanced mesh spanning the scene must set `frustumCulled = false` and cull per instance itself, or it vanishes when its bounding sphere leaves the view.
- Async loads must check `isDisposed()` / `this.disposed` before touching the scene: a scenario reload disposes the old scene.
- `SceneModel.containerPose` returns shared objects for yard boxes: never mutate them.
- Changing `HULL_HATCH_GAP_M` / `HULL_COAMING_M` without the generator (or vice versa) leaves covers floating or holes misaligned.
- Changing `ROCK` without `build_backdrop_rock`, or `SURROUNDINGS` without `budgets.json` `groups`, fails `tests/surroundings.test.ts` or mismatches the GLB.
- Gate booms are static; the coast GLB is used for TTI only (generic presets keep the procedural coastline).

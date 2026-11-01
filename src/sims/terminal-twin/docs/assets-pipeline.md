# Terminal Twin: asset pipeline

Blender (`bpy`) generators, budgets, rig and sidecar conventions, containers and liveries, and the renderer integration. Individual models are in [equipment-models.md](equipment-models.md). Guide: [terminal-twin-AGENTS.md](../terminal-twin-AGENTS.md). Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## Phase 2 asset pipeline

Blender (`bpy`) Python generators → raw GLB → gltf-transform (meshopt) → committed GLB + `.meta.json` sidecar + WebP previews. The web build never runs Blender, and CI checks only the committed outputs.

### File map (assets and asset CLI)

```
├── assets/                   Phase 2 asset library (see "Phase 2 asset pipeline")
│   ├── budgets.json          Triangle / draw-call / file-size budgets per asset kind
│   ├── generators/           Python (bpy) generators: build.py, tt_assets/*.py (containers, liveries, parts, shc, shc_meta, asc, asc_meta), fonts/ (OFL), requirements.txt
│   └── models/<group>/       Committed outputs: <asset>.glb + .meta.json, livery-atlas.json, previews/*.webp
├── cli/                      Node-only: run.ts→runCli.ts (tt:run), diff.ts→diffCli.ts (tt:diff),
│                             golden-cli.ts→golden.ts (tt:golden), handlerSets.ts, build-fixtures.ts,
│                             assets/ (build.ts = tt:assets, check.ts→budgetCheck.ts = tt:assets:check,
│                             screenshots.ts = tt:assets:shots, glb.ts = JSON-chunk GLB reader)
```

### Setup (once)

- Python **3.13** in a venv (the `bpy` 5.2 wheels target 3.13 only): `python3.13 -m venv .venv-bpy`, then `.venv-bpy/bin/pip install -r src/sims/terminal-twin/assets/generators/requirements.txt`. On Windows: `py -3.13 -m venv .venv-bpy`, then `.venv-bpy\Scripts\pip install -r ...`. `.venv-bpy/` is git-ignored.
- A Blender install can run the generator too (`blender --background --python src/sims/terminal-twin/assets/generators/build.py -- --out <dir>`), but then you compress the GLBs yourself. `pnpm run tt:assets` needs a Python that can `import bpy`.
- The Node dependencies (`@gltf-transform/*`, `meshoptimizer`) come with `pnpm install`.

### Regenerate (one command, also on Windows)

```
pnpm run tt:assets --python .venv-bpy/bin/python      # or set TT_BPY_PYTHON; Windows: .venv-bpy\Scripts\python.exe
pnpm run tt:assets --check --python ...               # regenerate into a temp dir and byte-compare with the commit
pnpm run tt:assets --no-previews --python ...         # fast iteration (keeps the committed previews)
pnpm run tt:assets --only asc --python ...            # one group only (containers | shc | asc | sts | vessels); the other groups' files are untouched
```

What `cli/assets/build.ts` does:

1. Finds Python: `--python`, then `$TT_BPY_PYTHON`, then `python3.13`/`python3`/`python` (`py -3.13` on Windows).
2. Runs `assets/generators/build.py --out <staging>`.
3. Compresses each GLB with gltf-transform `dedup` + `prune` + `meshopt`. Meshopt also quantises; TEXCOORD_1 stays float because it tiles beyond [0, 1].
4. Replaces `assets/models/<group>/` entirely, then runs the budget check.

It takes about 80 s for containers, mostly the Cycles previews. Two runs give byte-identical outputs, and `--check` proves it: there is no randomness, the Cycles seed is 0, there is no denoiser, and sample counts are fixed.

- **No Draco:** the bpy exporter's Draco option silently does nothing.
- **No KTX2:** no encoder is available. Textures are WebP from the Blender exporter (`EXT_texture_webp`).
- **Offline:** the meshopt decoder is `three/examples/jsm/libs/meshopt_decoder.module.js` (bundled), and GLB URLs are Vite asset URLs. No CDN is ever contacted (smoke-tested).
- **Never commit** `.blend` files (git-ignored). Reference photos live committed in `docs/reference/` (owner decision); do not copy them into asset directories.
- `.gitignore` ignores `out` (a CRA leftover), `*.blend`, `__pycache__/` and `.venv-bpy/`: never name an asset directory `out`.
- `tt:assets` is slow when several Blender jobs share the CPU; regenerate one group with `--only <group>`.
- A new asset group must be added to `GROUPS` in both `cli/assets/build.ts` and `assets/generators/build.py`.

### Terminal-specific assets

Scenery that belongs to one real terminal is described in that terminal's folder (`terminals/<id>/`, see [scene-quality-atmosphere.md](scene-quality-atmosphere.md#per-terminal-folders-terminals)); the generator group that builds its GLBs stays `infrastructure`. The TTI Rock (`backdrop-rock`) is built to true scale by `build_backdrop_rock` from the same profile as `terminals/tti-algeciras/constants.ts` `ROCK` (keep both in step), inside the `backdrop` budget (4 000 triangles, one draw call). The TTI **surroundings** (ticket #123) are five more `infrastructure` GLBs of kind `scenery` (`scenery-shore`, `-anchorage`, `-tanks`, `-landside`, `-town`, built by `build_scenery_*`, seeded, flat swatches of the shared atlas only so the atlas and every other GLB stay byte-identical). Each is one merged mesh: at most 5 000 triangles and one draw call, and the `tti-surroundings` **group budget** in `budgets.json` caps the five together at 8 000 triangles and 5 draw calls (`tt:assets:check` sums the LODs of the group's assets; `tests/surroundings.test.ts` ties the group to `SURROUNDINGS` in `terminals/tti-algeciras/constants.ts`). Generators never read the reference photos: they are git-ignored, absent in CI, and `docs/reference/tti-algeciras/PHOTOS.md` records which photo informed which model.

### Budgets and the check

`assets/budgets.json` holds the budgets per asset kind and the library total (15 MB). Containers are used now; the STS/ASC/SHC/truck/vessel/building numbers from the spec are pre-filled for later tickets.

`pnpm run tt:assets:check` (`cli/assets/budgetCheck.ts`) reads only each GLB's JSON chunk. It also runs as a Vitest suite (`tests/asset-budgets.test.ts`) and as a step in `.github/workflows/pr-checks.yml`. It fails on:

- triangles or draw calls (primitives) per `LODn` subtree over budget;
- file size over `maxFileBytes`, or the library over `libraryMaxBytes`;
- a missing required rig node (`requiredNodes`), or a GLB node that the sidecar's `nodes` list does not document;
- a missing sidecar or sidecar field (`requiredMetaFields`);
- Draco/KTX2 extensions, or external buffer/image URIs.

| Asset | LOD0 | LOD1 | Draw calls (LOD0 / LOD1) | File |
|---|---|---|---|---|
| `container-20` | 308 triangles (budget 450) | 12 (budget 12) | 3 / 1 | ~134 KB |
| `container-40`, `container-40hc` | 440 triangles (budget 450) | 12 | 3 / 1 | ~136 KB |
| `shc` | 11,016 (budget 12,000) | 2,532 (3,000); LOD2 342 (400) | 15 / 11 (budgets 16 / 12; LOD2 2 of 3) | ~147 KB |
| `asc` | 14,474 (budget 15,000) | 3,624 (4,000); LOD2 556 (600) | 9 / 5 (budgets 10 / 6; LOD2 3 of 3) | ~300 KB |

Most of each container file is the embedded 2048² livery atlas. The renderer shares one texture between them.

### Rig and sidecar conventions (all assets)

- **Hierarchy:** the root node is the asset name, with children `LOD0` and `LOD1` (plus `LOD2` for big equipment). Movable parts are named nodes under the LOD with their **origin at the mechanical pivot**. Use the spec's names: `gantry`, `trolley`, `hoist`, `spreader`, twist-locks, `wheel_*`, `steer_*`, `boom`. Containers have `LOD0/{body, door_left, door_right}` and a `LOD1` mesh.
- **Rig nodes are empties** (ASC, STS and SHC alike): the mesh of a rig node lives in a `<name>_geo` child, because meshopt puts its dequantisation transform on mesh nodes, which would offset a pivot. Static meshes (`frame`, `body`) may be mesh nodes. Each asset test guards this (`_geo`).
- **Axes (glTF):** +Y up, metres, origin at the ground-contact point (bottom centre for containers), length along +X (container doors at +X), width along Z. Blender authoring is Z-up, and the exporter converts (glTF Z = −Blender Y).
- **Sidecar `<asset>.meta.json`:**
  - `asset`, and `kind` (the budget key);
  - `dimensions` and `axes`;
  - `nodes`: every non-root node, with its parent, role, pivot and axis;
  - `travelLimits` per rig node: `rotation` with `minDeg`/`maxDeg`, or `translation` with `minM`/`maxM`, plus axis and rest;
  - `attachPoints` (containers: 4 top twist-lock points and 4 bottom stacking points) and `groundContact`;
  - `lods` and `provenance`.
- **Provenance tags** follow the TTI reference pack: `V` verified, `P` photo-supported, `A` approximated, `M` intentional modification (with a `reason`). Anything newly assumed is `A`. For example, the container corrugation pitch is `M`: 0.56 m instead of about 0.28 m, to fit the triangle budget.
- **Rig sliders** in the asset viewer are generated from `travelLimits`, so a new asset gets them for free.

### Containers and liveries

- **Geometry** (`generators/tt_assets/containers.py`): ISO 668 sizes `20`, `40` and `40HC` [V] and ISO 1161 corner castings [V]. It builds corrugated sides (a valley plane plus trapezoid ribs), frame rails, corner posts, the front wall, and two door leaves with two locking bars and handles each, hinged at the outer corners (270° swing [P]).
- **LOD1** is a 12-triangle box. Its normal map (TEXCOORD_1, 128×4, repeat) has the same rib profile and pitch as LOD0's geometry, so switching LODs does not pop.
- **Liveries** (`generators/tt_assets/liveries.py`):
  - `LIVERIES` order = atlas index = per-instance livery index. Lines and owner prefixes match `LINE_OWNER_PREFIX` in `scenario/builder.ts`, and the last entry is the generic grey.
  - The atlas is 2048² with 2×6 tiles. Each tile has the regions `side40`, `side20`, `door`, `front`, `solid`, `dark` and `metal`.
  - Wordmarks are the brand name in brand colours, set in an open-licence typeface close to the brand's (`generators/fonts/`, with the OFL licences alongside) [A].
  - **To use official logos later:** draw them into the same regions in `_draw_tile` (keep the layout) and regenerate.
- **Livery in the renderer:** GLB TEXCOORD_0 is authored for **tile 0 (HMM)**. `liveryMaterial()` in `modules/containerAssets.ts` patches the material so that `vMapUv += tileOffset(liveryIndex + liveryBase)`. `livery-atlas.json`, committed next to the GLBs, is the renderer's lookup (`liveryIndexForLine(line)`).
- **Adding a line:** append it to `LIVERIES` **before** the generic entry, add its prefix to `LINE_OWNER_PREFIX`, and regenerate. The current atlas holds at most 12 tiles.

### Renderer integration (`ContainerInstancer`)

- It starts with procedural placeholder boxes (one InstancedMesh per size, in the livery body colour), so the scene is usable at once. `loadContainerAssets()`, cached per page, then swaps in 6 InstancedMeshes (3 sizes × LOD0/LOD1). LOD0 is the body and the closed doors merged into one geometry.
- **LOD choice per frame:** boxes within `lod0DistanceM` (140 m) of the camera are LOD0 candidates. A box already at LOD0 keeps it out to ×1.15 (hysteresis). At most `lod0Cap` (300) of the nearest candidates get LOD0. Tune these in `DEFAULT_LOD_OPTIONS`.
- **Close-up level (#119, #143):** markings are drawn per visible face, not per box. Boxes within `closeupDistanceM` (35 m on High) are offered to `ContainerCloseups` with their exposed faces; faces turned away from the camera are dropped and the rest compete for `closeupFaceBudget` (High 400, Medium 120 within 25 m, Low 48 within 18 m; `QUALITY_PROFILES`; on on every level since #158, because Auto settles on Low on a laptop), nearest first, with hysteresis (a drawn face keeps its place out to x1.15 of the cut). A chosen face is one instance of a shared unit quad that samples a tile of a texture atlas, drawn 6 mm off the plain instanced box (which keeps its LOD and stays the fallback for every hidden or unchosen face). `__tt.perf().stats.closeup` (boxes with a face drawn) and `closeupFaces` (faces drawn, never above the budget) report it; `__tt.scene().containerLods` carries both. Draw calls are one per atlas page in use (20 to 32 tiles per 1024 px page), none when the camera is far.
  - **Exposed faces** (`modules/exposedFaces.ts`, pure, unit-tested in `tests/exposed-faces.test.ts`): `exposedFaces('yard', neighboursOf(box, others))` hides a stacked box's underside and every face a neighbour touches (a box on top, the next bay at either end, the next row at either side, within 0.9 m); `exposedFaces('free')` (vessel, truck, spreader boxes) shows all six. Faces are named in the box frame: `top`, `bottom`, `door` (+X), `front` (-X), `sideP` (+Z), `sideN` (-Z). The instancer takes the `yard` flag from `ContainerPose.yard` (set for `yardSlot` custody only) and finds neighbours through a 14 m grid of the yard boxes in range.
  - **Face budget** (`modules/closeupFaceBudget.ts`, pure, `tests/closeup-face-budget.test.ts`): `selectFaces(candidates, { budget, maxDistM, hysteresis }, previous)`.
  - **Markings** (`modules/containerMarkings.ts`, pure, unit-tested): `describeMarkings({ id, size, line, isoType, laden, heavy })` returns the door end (owner prefix, serial, check digit read from the id's 11th character (computed with `iso6346CheckDigit` only for an id without one), ISO type as given, weight plate from `plateFor(isoType)` (or none), CSC plate, SUPER HEAVY when `heavy`, bolt seal when `laden`), the side and roof text (box number, line name in the livery's `text` colour, no logo) and the wear (`wearFor(id)`: fade, rust streaks, dents, seeded from the id). Plate tare is `tareKgOf`, so it equals the box's stored tare; the 45G1 row is the reference photo; other max gross / capacity values are [A], as are the open-top (U), flat-rack (P) and tank (T) rows (22U1, 42U1, 22P1, 42P1, 22T1; a flat rack has no CU. CAP. line). An ISO type with no row has no plate (`plateFor` returns null, no weight lines are drawn): a plate never shows another type's numbers. `SceneModel.containerDetail` carries `laden`, `isoType` and `heavy` (from the planned box, or from `NewContainer`); heavy = weight class HEAVY.
  - **Atlas** (`modules/containerCloseups.ts`, `modules/containerTextures.ts`): pages per face kind (long side 512x96 tiles, roof 512x64, end 192x192) are canvas textures created on demand up to the budget; a box is painted whole by `paintContainer` into a scratch canvas (`TEXTURE_LAYOUT`, 1024x512) and the face regions are copied into tiles (`canvasAtlasBackend`). A tile stays painted while its face is cached, is repainted when the box's tint changes, and the least recently shown tile is reused when a page kind is full. The shader reads the tile through an instanced `uvRect` and the shared corrugation normal map through the instanced face size. Painting sits behind `AtlasBackend`, so Vitest stubs it (`tests/container-closeup.test.ts`); the painted result is covered by `tests/browser/container-closeup.smoke.ts`.
  - Gone with #143: the per-box close-up mesh (door rods, handles, corner castings) and its per-box canvas texture; the GLB LOD0 carries the hardware.
- Model origins are at the bottom, so `push()` takes the box **centre** (as `SceneModel` returns it) and subtracts half the height.
- **Yard scale** (dev viewer `?viewer=yard`, and a smoke test): 18,000 boxes come to about 264k container triangles, 6 container draw calls, and 14 draw calls per frame including the shadow pass.
  - Headless SwiftShader renders this at well under 1 fps, which says nothing about real frame rate.
  - The frame-rate target and what was measured are in § Performance and graphics quality (TT-19). Check fps on a real GPU in the viewer's readout.

- Assets: run the generators only through `pnpm run tt:assets`; it replaces `assets/models/<group>/` wholesale, so hand edits to a committed GLB or sidecar are lost.
- Assets: the viewer and the twin share one cached `loadContainerAssets()` promise; never dispose its materials or textures from a renderer.
- Assets: container shadows need `shadow.normalBias` (0.35 in the twin) or the corrugation shows shadow acne.
- Fixture `liveries-mixed` (12 generated boxes, equal weights over all ten lines → 8 lines with seed 7, all three sizes) exists for the livery smoke test.

### Adding the next asset (STS, truck, vessels, …)

1. Add `generators/tt_assets/<kind>.py` (use `tt_assets/parts.py`: `Atlas` for the swatch/region atlas, `Part` for boxes, beams, plates and revolves), and wire a group into `build.py` (`GROUPS`) and `cli/assets/build.ts` (`GROUPS`).
2. Follow the rig and sidecar conventions above, and tag every dimension `V`, `P`, `A` or `M`.
3. Check or tune its entry in `budgets.json` and run `pnpm run tt:assets`. Look at the previews and at `?viewer=<asset>`, then run `pnpm run tt:assets:shots`.
4. Commit the generators, GLBs, sidecars and previews (never `.blend` files or photos).

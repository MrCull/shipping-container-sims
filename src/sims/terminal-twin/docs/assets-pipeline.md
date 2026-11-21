# Asset pipeline

Checked against ENGINE_VERSION 0.53.0.

Read this when you add or change a GLB model, a livery or atlas, a sidecar, an asset budget, or a synthesized sound;
when `tt:assets:check` or `tt:sounds:check` fails in CI; or when you need the dev asset viewer. How the renderer uses
the models (rigs, LODs, posing): [rendering-3d.md](rendering-3d.md). Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

```
Blender bpy generators (Python)  ->  raw GLB + sidecar + Cycles previews  (staging dir)
  -> gltf-transform dedup + prune + meshopt (Node)
  -> assets/models/<group>/ replaced wholesale  ->  budget check
```

The web build never runs Blender and CI checks only the committed outputs. Assets have no effect on the engine,
goldens or event-log hashes, with one exception: hull sizes come from the engine's vessel class table (see Vessels).

## File map

```
assets/
  budgets.json                 per-kind triangle / draw-call / file budgets, groups, required sidecar fields
  generators/
    build.py                   entry: --out, --only <group>, --no-previews, --samples, --vessel-classes; GROUPS
    requirements.txt           bpy==5.2.3 (Python 3.13 only)
    fonts/                     open-licence typefaces with their OFL texts (wordmarks)
    tt_assets/
      blender.py               scene helpers, preview renders
      parts.py                 shared modelling vocabulary: Atlas (swatch/region atlas), Part (boxes, beams, plates, revolves)
      containers.py, liveries.py
      hero_containers.py       hero faces: geometry, procedural detail maps, sidecar
      hero_spreaders.py        hero spreaders (STS, ASC, SHC): geometry in the source rig's spreader frame, sidecar
      hero_shc.py, hero_truck.py  hero SHC body; hero truck chassis and cabs (truck.py frame and rig, sidecar)
      shc.py, shc_meta.py      asc.py, asc_meta.py      sts.py, sts_atlas.py
      truck.py, truck_meta.py  vessels.py, vessel_liveries.py
      infrastructure.py, infrastructure_meta.py
  models/<group>/              committed: <asset>.glb, <asset>.meta.json, atlas JSON, previews/*.webp
  sounds/                      cue MP3s (copied from available-media) and synthesized WAVs
cli/assets/
  build.ts                     pnpm run tt:assets
  check.ts -> budgetCheck.ts   pnpm run tt:assets:check
  screenshots.ts               pnpm run tt:assets:shots
  glb.ts                       reads a GLB's JSON chunk only
cli/sounds/build.ts, synth.ts  pnpm run tt:sounds, tt:sounds:check
dev/AssetViewer.vue, assetViewerScene.ts, assetViewerApi.ts    ?viewer=<asset>|yard
```

Groups (`GROUPS` in both `cli/assets/build.ts` and `assets/generators/build.py`): `containers`, `hero`, `hero-equipment`, `shc`, `asc`, `sts`,
`trucks`, `vessels`, `infrastructure`. A new group must be added to both lists.

## Setup (once)

- Python **3.13** venv (the `bpy` 5.2 wheels target 3.13 only): `python3.13 -m venv .venv-bpy`, then
  `.venv-bpy/bin/pip install -r src/sims/terminal-twin/assets/generators/requirements.txt`. Windows: `py -3.13 -m venv .venv-bpy`,
  then `.venv-bpy\Scripts\pip install -r ...`. `.venv-bpy/` is git-ignored.
- A Blender install can run the generator too (`blender --background --python src/sims/terminal-twin/assets/generators/build.py -- --out <dir>`),
  but then you compress the GLBs yourself. `tt:assets` needs a Python that can `import bpy`.
- Node dependencies (`@gltf-transform/*`, `meshoptimizer`) come with `pnpm install`.
- **Cloud sessions:** `bpy` is not installed by the session-start hook (about 1 GB). When your ticket changes a generator or
  needs regenerated models, run `scripts/install-bpy.sh` once (opt-in, idempotent, under a minute; it builds the venv in
  `$HOME/.cache/tt-bpy-venv`, outside the repo, and prints its python path on the last line; `scripts/test-install-bpy.sh` tests it),
  then `pnpm run tt:assets --python "$(scripts/install-bpy.sh | tail -n 1)" ...`. A second run does nothing. Tickets that do not
  touch the generators never need it.

## `pnpm run tt:assets`

```
pnpm run tt:assets --python .venv-bpy/bin/python      # or set TT_BPY_PYTHON; Windows: .venv-bpy\Scripts\python.exe
pnpm run tt:assets --check --python ...               # regenerate into a temp dir and byte-compare with the commit
pnpm run tt:assets --no-previews --python ...         # fast iteration, keeps the committed previews
pnpm run tt:assets --only asc --python ...            # one group (repeatable); other groups' files untouched
pnpm run tt:assets --samples 48                       # Cycles samples per preview (default 48)
```

`cli/assets/build.ts`:

1. Finds Python: `--python`, then `$TT_BPY_PYTHON`, then `python3.13` / `python3` / `python` (`py -3.13` on Windows).
2. Writes the engine's vessel class table (`vesselClassTable()`) to `vessel-classes.json` in staging, then runs
   `build.py --out <staging> --samples n --vessel-classes <file> [--only g ...] [--no-previews]`.
3. Compresses each GLB: `dedup()`, `prune({ keepLeaves: true })`, `meshopt({ level: 'medium' })`. Meshopt also quantises;
   TEXCOORD_1 stays float because it tiles beyond [0, 1]. Dot-folders (generator scratch `.work/`) are skipped.
4. Without `--check`: replaces `assets/models/<group>/` entirely, then runs the budget check (its exit code is the result).
   With `--check`: compares every file byte for byte and prints `Regenerated assets are identical to the committed ones`
   (exit 0) or one line per differing file (exit 1).

Reference photographs of real containers (the look the container and hero models match) are committed in `docs/reference/containers/`, with a README saying what each shows. Sidecar `source` strings that say "reference photographs (not committed)" predate them; the generators keep that wording because it is written into the committed sidecars.

Determinism: two runs give byte-identical outputs. No randomness (scenery generators are seeded), Cycles seed 0, no
denoiser, fixed sample counts. Run times: containers about 80 s (mostly previews), STS about 60 s, trucks about 90 s,
vessels about 40 s with previews. Slow when several Blender jobs share the CPU: use `--only <group>`.

**Cloud check (2026-11-12, `bpy` 5.2.3, `tt:assets --check` over all groups, about 7 minutes):** every GLB, sidecar and atlas JSON
in all seven groups is byte-identical to the commit. Cycles previews render in a cloud session (software CPU, no GPU needed) and
`containers` and `vessels` previews are byte-identical too, but the `.webp` previews of `asc`, `shc`, `sts`, `trucks` and
`infrastructure` differ (56 files, reproducible: two runs of `--only shc` give the same four differing files). They are the
same scenes rendered on a different CPU (Cycles sums floats in a thread-dependent order), so treat a preview-only difference
there as expected and look at the images instead of byte-comparing them; previews are documentation, the runtime never loads
them. To check models alone, or to skip the slow renders, add `--no-previews`.

Format rules:

- **No Draco:** the bpy exporter's Draco option silently does nothing. **No KTX2:** no encoder is available. Textures are
  WebP from the exporter (`EXT_texture_webp`). The budget check fails on `KHR_draco_mesh_compression` or `KHR_texture_basisu`.
- **Offline:** the meshopt decoder is `three/examples/jsm/libs/meshopt_decoder.module.js` (bundled) and GLB URLs are Vite
  asset URLs (`new URL('../assets/models/...', import.meta.url)`). No CDN is contacted (smoke-tested). No external buffer or image URIs.
- **Never commit** `.blend` / `.blend1` files (git-ignored). `.gitignore` also ignores `out` (a CRA leftover),
  `__pycache__/` and `.venv-bpy/`: never name an asset directory `out`.
- Never hand-edit a committed GLB or sidecar: the next `tt:assets` replaces the group wholesale.

## Budgets and `tt:assets:check`

`assets/budgets.json` holds per-kind budgets (per LOD subtree), `requiredNodes`, `maxFileBytes`, the library total
`libraryMaxBytes` (15 MB), `requiredMetaFields`, and named `groups`. `pnpm run tt:assets:check`
(`cli/assets/budgetCheck.ts#checkAssetLibrary`) reads only each GLB's JSON chunk. It runs in `pnpm test`
(`tests/asset-budgets.test.ts`) and as its own step in `.github/workflows/pr-checks.yml`. It fails on:

- triangles or draw calls (primitives) of a `LODn` subtree over budget;
- a file over `maxFileBytes`, or the library over `libraryMaxBytes`;
- a missing `requiredNodes` entry, or a GLB node (other than the root) not documented in the sidecar's `nodes`;
- a missing sidecar, a missing `requiredMetaFields` entry (`asset`, `kind`, `dimensions`, `axes`, `nodes`,
  `travelLimits`, `attachPoints`, `groundContact`, `provenance`), or a `kind` not in `budgets.json`;
- Draco / KTX2 extensions, external buffer or image URIs;
- a group whose assets' triangles or draw calls, summed over all LODs, exceed its cap, or that names a missing asset.

Budgets and current counts (from `tt:assets:check`, triangles / draw calls):

| Kind | Budget LOD0 | Budget LOD1 | Budget LOD2 | File max | Current |
|---|---|---|---|---|---|
| `container` | 450 / 3 | 12 / 1 | | 400 KB | 20 ft 308 / 3, 12 / 1; 40 and 40HC 440 / 3, 12 / 1; about 135 KB each (mostly the 2048 livery atlas) |
| `hero-container` | 520 / 3 (per face, LOD0 only) | | | 60 KB | 82 to 458 triangles, 2 to 3 draw calls; 20 to 29 KB per face (see Hero container faces) |
| `hero-equipment` | 8 000 / 12 (per spreader, LOD0 only) | | | 300 KB | STS 2 408 / 12, ASC 2 512 / 5, SHC 2 584 / 5; 59 to 63 KB (see Hero spreaders) |
| `hero-shc` | 30 000 / 12 (LOD0 only) | | | 1.2 MB | 18 092 / 11; about 300 KB (see Hero SHC body) |
| `hero-truck-chassis` | 10 000 / 6 (LOD0 only) | | | 800 KB | 8 188 / 4; about 130 KB (see Hero truck) |
| `hero-truck-cab` | 15 000 / 8 (LOD0 only) | | | 800 KB | about 7 700 / 4 per cab shape; about 196 KB each (see Hero truck) |
| `sts` | 40 000 / 20 | 8 000 / 10 | 1 000 / 6 | 3 MB | 31 686 / 20, 5 872 / 10, 474 / 6; 567 KB (#299: every LOD at its draw-call cap; LOD1 folds the headblock and twin-lift housing into the spreader mesh) |
| `asc` | 15 000 / 10 | 4 000 / 6 | 600 / 3 | 1.5 MB | 12 998 / 9, 3 844 / 5, 556 / 3; 295 KB |
| `shc` | 12 000 / 16 | 3 000 / 12 | 400 / 3 | 1.5 MB | 9 856 / 16, 2 154 / 12, 358 / 2; 291 KB |
| `truck` | 8 000 / 8 | 2 000 / 8 | 300 / 2 | 1 MB | about 6 870 / 8, 1 850 / 8, 248 / 2 per cab |
| `chassis` | 4 000 / 4 | 1 000 / 4 | 150 / 1 | 600 KB | 3 636 / 4, 956 / 4, 108 / 1 |
| `vessel` | 20 000 / 10 | 5 000 / 6 | 800 / 3 | 2 MB | feeder 8 528 / 3 to ULCV 16 128 / 3; LOD1 1 896 to 4 318 / 1; LOD2 408 to 576 / 1 |
| `gate` / `building` | 5 000 / 8 | | | 600 KB / 1 MB | 88 to 340 triangles |
| `quay` / `yard` | 1 200 / 2, 1 500 / 3 | | | 150 / 200 KB | 24 to 284 triangles |
| `scenery` | 5 000 / 1 | | | 250 KB | 618 to 2 380 / 1 |
| `backdrop` | 4 000 / 1 | | | 400 KB | rock 2 880 / 1, hills 590, coast 472 |

Group `tti-surroundings`: the five `scenery-*` assets, 8 000 triangles and 5 draw calls in all (currently about 6 070 / 5).
It must equal `SURROUNDINGS` in `terminals/tti-algeciras/constants.ts` (`tests/surroundings.test.ts`). Library: 53
assets, 5.83 MB. Draw calls in a budget are primitives in the GLB; the renderer may instance or merge them (see rendering-3d).

## Rig and sidecar conventions

- **Hierarchy:** root node = asset name, children `LOD0`, `LOD1` (plus `LOD2` for equipment and hulls). Movable parts are
  named nodes under the LOD with the **origin at the mechanical pivot**: `gantry`, `trolley`, `hoist`, `spreader`,
  `twistlock_*`, `wheel_*`, `steer_*`, `boom`. Containers: `LOD0/{body, door_left, door_right}` and a `LOD1` mesh.
- **Rig nodes are empties** (ASC, STS, SHC, trucks): the mesh of a rig node is a `<name>_geo` child, listed with role
  `mesh`, because meshopt puts its dequantisation translation and scale on mesh nodes, which would offset the pivot,
  rest position and scale. Static meshes (`frame`, `body`) may be mesh nodes. Each asset test guards this.
- **LOD naming:** Blender object names carry `@LODn` to stay unique; `build.py` strips it so names repeat per LOD
  (SHC, ASC, trucks). The STS instead suffixes (`trolley_lod1`), per its sidecar `lodNaming`. Do not rename either in glTF tooling.
- **Axes (glTF):** +Y up, metres, origin at the ground-contact point (bottom centre for containers), length along +X
  (container doors at +X), width along Z. Blender authors Z-up; the exporter converts (glTF Z = -Blender Y).
- **Sidecar `<asset>.meta.json`:** `asset`, `kind` (the budget key), `dimensions`, `axes`, `nodes` (every non-root node
  with parent, role, pivot, axis), `travelLimits` per rig node (`rotation` with `minDeg`/`maxDeg`, or `translation`
  with `minM`/`maxM`, plus axis and rest), `attachPoints`, `groundContact`, `lods`, `provenance`. Kind-specific extras:
  STS `geometry`, `sceneMounting`, `spreaderModes`, `stretch`, `beaconMounts`, `lods.*.maxDistanceM`; ASC `stack`,
  `hoist`, `stretch`, `beaconMounts`; SHC `branding.fleetNumbers`, tunnel clearances; truck `loadConfigurations`,
  `chassisDetail`; hull `bayGrid`, `waterline`; gate `module.laneWidthM`.
- **Stretch rules** (sidecar `stretch`, applied by `modules/assetRig.ts#AssetRig.applyStretch`, no kind-specific code):
  `axis: 'Y'` scales a node down to a sibling (`scale.y = node.y - (to.y + offsetM)`, hoist ropes); `mode: 'aim'` turns
  the node's local `axis` (`+Y`) towards the `to` node, wherever it is in the tree, and sets that axis's scale to the
  distance over `unitLengthM`. An aim node is an empty (role `stretch`) whose `_geo` mesh is authored unit length along
  local +Y from the pivot; members may have different X at each end (the X offsets survive because the aim only turns
  about the line between the two origins). Its target is an empty (role `anchor`) on the moving part. STS (#299):
  `forestays` (apex beam to `forestay_anchor` on the boom nose) and `boom_hoist_ropes` (apex head sheaves to
  `boom_hoist_anchor`, the sheave block on the outer overhead frame) are gantry children; their anchors are boom children,
  so both stay attached at every boom angle. LOD0 has twin forestay rods per side and four ropes, LOD1 one rod per side and
  two ropes, LOD2 one rod per side and the rope node as an empty only. `build.py#pose_sts` applies the same aim for the
  previews (`raised` preview: boom at 80 degrees).
- **Provenance tags** (TTI reference pack): `V` verified, `P` photo-supported, `A` approximated, `M` intentional
  modification (with a `reason`). Anything newly assumed is `A`. Example: container corrugation pitch is `M`, 0.56 m
  instead of about 0.28 m, to fit the triangle budget.
- **Rig sliders** in the asset viewer are generated from `travelLimits`, so a new asset gets them for free.

## Reference photos

`docs/reference/tti-algeciras/` (repo root) holds the committed aerial and map references and `PHOTOS.md`, which records
which photo informed which model. The equipment photos (`sts-*`, `shc-*`, `asc-*`, the container-on-chassis photo) are
not in the repo. Generators never read any photo, so they run in CI and in agent sessions without them. Never copy
photos into asset directories.

## Containers and liveries

- **Geometry** (`tt_assets/containers.py`): ISO 668 sizes `20`, `40`, `40HC` [V], ISO 1161 corner castings [V];
  corrugated sides (valley plane plus trapezoid ribs), frame rails, corner posts, front wall, two door leaves with two
  locking bars and handles each, hinged at the outer corners (270 deg swing [P]). Attach points: 4 top twist-lock and 4
  bottom stacking points.
- **LOD1** is a 12-triangle box with a normal map on TEXCOORD_1 (128x4, repeat) of the same rib profile and pitch as LOD0.
- **Liveries** (`tt_assets/liveries.py`): `LIVERIES` order = atlas index = per-instance livery index. Lines and owner
  prefixes match `LINE_OWNER_PREFIX` (`scenario/lines.ts`, re-exported by `scenario/builder.ts`); the last entry is the
  generic grey. Now 11 tiles: HMM, MSC, Maersk, CMA CGM, Hapag-Lloyd, ONE, Evergreen, COSCO, ZIM, Yang Ming, generic.
  Atlas 2048x2048 with 2x6 tiles (12 at most); regions per tile `side40`, `side20`, `door`, `front`, `solid`, `dark`, `metal`.
  Wordmarks are the brand name in brand colours in an open-licence typeface close to the brand's [A], no logos.
- **Far-field atlas** (#256): `liveryMaterial` blends `livery-atlas-far.webp` (1024 px WebP rendered by `liveries.py#render_atlas(far=True)`,
  same tile layout, so the same UVs; enlarged wordmark, coarse 1.2 m rib shading, no owner code) over the embedded near atlas
  between 65 and 100 m. It is not embedded in the GLBs, so the GLB bytes are unchanged; `livery-atlas.json` has a `far` entry.
- `livery-atlas.json` (committed beside the GLBs) is the renderer's lookup; TEXCOORD_0 is authored for tile 0 (HMM) and
  the renderer offsets per instance (`modules/containerAssets.ts`).
- **Adding a line:** append it to `LIVERIES` before the generic entry, add its prefix to `LINE_OWNER_PREFIX`, regenerate.
- **Official logos later:** draw them into the same regions in `_draw_tile` (keep the layout) and regenerate.
- Fixture `liveries-mixed` (12 generated boxes, equal weights over ten lines, 8 lines with seed 7, all three sizes) feeds the livery smoke test.

## Hero container faces

`hero` group (#255), `tt_assets/hero_containers.py`: 12 GLBs `hero-<20|40|40hc>-<side|door|front|roof>`, kind `hero-container`, `LOD0` only. They are not referenced by the page (a test guards that); the renderer (#258) fetches them on the first close zoom. Each face is modelled in the box frame (origin bottom centre) at its true position, so the four faces of a size assemble with no offsets; the far side is the side face turned 180 degrees about +Y. The underside is not modelled. Dev viewer: `?viewer=hero-box-40` (also `-20`, `-40hc`) assembles the box.

- **Geometry:** corrugation at the real pitch (about 0.25 m, divided evenly into the span: 47 ribs on a 40 ft side, 0.252 m; door leaves 4 ribs each at 0.266 m; front end and roof corrugated too, roof shallow), ISO 1161 castings with aperture decals, posts, rails; door end with gaskets, locking bars, bar guides, cam keepers, handles and 4 hinges per leaf (5 on high cube); forklift pockets on the 20 ft side only.
- **Nodes:** `paint` (white base colour: livery colour and colour-by tint multiply it), `hardware` (fixed galvanised), `dark` (fixed rubber and openings). Materials are back-face culled.
- **Material inputs:** UV0 spans the face (markings, livery), UV1 is metres over 0.5 m for two repeating 256 px maps shared by the faces: `hero_detail_normal` (tangent space) and `hero_orm` (R wear mask, G roughness variation, B metal 0). They are procedural and tileable; rust, dents and scuffs are meant to be driven per box in the renderer from the wear seed (offset and threshold on the R mask), not baked.
- **Measured cost (per face, compressed):** triangles 20 ft side 192, door 434, front 82, roof 164; 40 ft side 312, door 434, front 82, roof 314; 40HC side 312, door 458, front 82, roof 314. Draw calls 2 (door 3). Bytes 20.4 to 28.7 KB per face file, of which about 18 KB is the two textures embedded in every file (12 files, 0.30 MB all). A box shows at most 3 faces: worst case 458 + 312 + 314 = 1 084 triangles and 7 draw calls before instancing.
- **Proposed caps** (`heroCaps` in `budgets.json`, checked by `tests/hero-container-asset.test.ts`): High 32 boxes, Medium 12, Low 0, as the spec's starting point. At 3 faces a box and the worst face (458) that is at most 44 000 triangles on High and 16 500 on Medium, about one STS crane's worth; instanced per face kind and material there are at most 27 draw calls. Geometry would allow about double; the binding costs are preparation time and marking atlas pages (#258, #259), so keep 32 and 12 until measured in the renderer.
- Previews: `previews/hero-<size>-<face>-view.webp` per face and `hero-<size>-assembled.webp` (the paint is white, so the box looks pale until tinted).

## Hero spreaders

`hero-equipment` group (#273), `tt_assets/hero_spreaders.py`: 3 GLBs `hero-spreader-<sts|asc|shc>` in `assets/models/hero-equipment/`, kind `hero-equipment`, `LOD0` only. (The spec named `assets/models/hero/`; a group is replaced wholesale, so the new group has its own folder and the hero faces stay untouched.) They are not referenced by the page: `modules/heroEquipmentAssets.ts` (`loadHeroEquipment(kind)`) fetches a file on first need and returns a clone of its `LOD0` subtree; `tests/hero-equipment-asset.test.ts` guards both.

- **Frame:** `LOD0` is the source rig's `spreader` node frame (origin, axes and overall extents of `sts.py#spreader_part` with its telescopes and twin unit, `asc.py#spreader_mesh`, `shc.py#spreader_mesh`). The renderer adds `LOD0` under that rig's LOD0 `spreader` node with an identity transform and hides the rig's own spreader meshes. The asset test decodes the hero GLB and the source rig GLB and fails when a pivot differs by a millimetre or the bounds by more than 1 cm.
- **Rig nodes** keep the source names and pivots, each an empty with a `<name>_geo` mesh child: ASC and SHC `twistlock_fl|fr|rl|rr`; STS `spreader_tele_fore|aft` (with `twistlock_{fore|aft}_{land|sea}` below them), `twin_locks` (with `twistlock_twin_{aft|fore}_{land|sea}`). `spreader_geo` is the fixed frame. Flippers are modelled raised and have no node. The source rig code does not reach these copies by itself: the hero level (`modules/heroEquipment.ts`) gives each one its rig node's motion from rest every frame ([rendering-3d.md](rendering-3d.md), Hero equipment).
- **Detail:** ASC and SHC: headblock plate with four sheaves, main beam with lightening holes and ribs, telescopic inner beams with collars, wear pads and guide rollers, a twist-lock housing block with its bearing collar at each corner, twist-locks with shank, oblong head and tapered cone, corner guides (shoe and lip), raised flippers with hinge and cylinder, hoses, a cable festoon, a power pack, warning bands on the end beams. STS: the same on its main frame, two telescopes (corner guide shoe with a side and an end lip) and twin-lock unit; its headblock stays the rig's `hoist` node, so the hero file has only the seat.
- **Material:** one, `hero_spreader`: UV0 picks a swatch of a 64 x 8 palette (`PALETTE`), UV1 is metres over 0.5 m for `hero_detail_normal` and `hero_orm`, the same two maps as the hero container faces (same names, so `heroAssets.ts#shareHeroMaps` can share them).
- **Draw calls:** one mesh per moving rig node, on one material: ASC and SHC 5 (frame and 4 twist-locks), STS 12 (frame, 2 telescopes, twin unit, 8 twist-locks). The spec asked for 4; that is only possible with the twist-locks baked into the frame, which stops them turning, so the budget is 12 and the owner decides on #273 or #274 (a renderer may also merge the twist-locks of a spreader that is not locking).
- **Budget:** the kind `hero-equipment` (per spreader) and `heroEquipmentCaps` in `budgets.json`: the three assets and, per quality level, the spreaders drawn at most (keyed by the quality profile cap field, `heroEquipment`) with their triangle and draw-call totals (High 3, Medium 1, Low 0). `tests/hero-equipment-asset.test.ts` checks the list against the library, the levels against `QUALITY_PROFILES` and the measured files against the caps.
- Previews: `previews/hero-spreader-<kind>-view.webp`.

## Hero SHC body

Same `hero-equipment` group (#275), `tt_assets/hero_shc.py`: `assets/models/hero-equipment/hero-shc.glb` plus `hero-shc.meta.json` and `previews/hero-shc-view.webp`, kind `hero-shc`, `LOD0` only (18 092 triangles, 11 draw calls, about 300 KB). It is `shc.glb` LOD0 in the same root frame (origin on the ground below the frame centre), with the same rig nodes, pivots and axes imported from `shc.py`: `frame` and `plates` meshes, `steer_fl|fr|rl|rr` > `wheel_*` and `hoist`, each rig node an empty with a `<name>_geo` mesh child.

- **Left out:** the `spreader` subtree (spreader and its four twist-locks). The #273 hero spreader already replaces those under LOD0's `spreader` node and keeps working unchanged; putting a spreader in the body would mean remounting the hero spreader under it. The sidecar lists the left-out nodes in `heroEquipment.leftOut`.
- **Detail:** chevron tread lugs in geometry up to the full tyre radius (so rolling radius and bounds stay those of `shc.glb`), a sidewall band, rims with hub cap and 10 nuts; fork stiffeners and a steering cylinder; leg stiffeners and diaphragm lips above the hazard bands, chain sprockets at the leg heads; cab glazing bars, wipers, a second mirror, door grab and roof handrail; warning bands on the bumper rails; chain stubs and hazard bands on the hoist frame. All static detail is merged into the moving node's own mesh (the frame for everything fixed).
- **Materials:** the two of `shc.glb`, `shc_atlas` (same swatch atlas) and `shc_plate` (fleet-number plates, authored for tile 0; the renderer finds it by name and offsets the UVs per SHC). No normal map: the tread is geometry, within budget.
- **Budget:** kind `hero-shc` in `budgets.json` (the `hero-equipment` kind's 8 000 triangles cannot hold a body): LOD0 30 000 triangles and 12 draw calls, 1.2 MB per file. `tests/hero-shc-asset.test.ts` decodes it against `shc.glb` LOD0: every non-spreader rig node with the same world pivot (1 mm) and rotation, overall bounds without the spreader within 1 cm, no spreader or twist-lock node, `shc_plate` on `plates`, and the budget.

## Hero truck

Same `hero-equipment` group (#276), `tt_assets/hero_truck.py`: `assets/models/hero-equipment/hero-truck-chassis.glb` and `hero-truck-cab-high|mid|day.glb`, each with a sidecar and `previews/<name>-view.webp`, `LOD0` only. A truck GLB holds the tractor and the chassis, so the hero pieces split them and swap on their own: `hero-truck-chassis` replaces LOD0's `chassis` and `wheel_t1|t2|t3`, `hero-truck-cab-<shape>` replaces LOD0's `fifth_wheel` subtree (`tractor`, `steer_fl|fr` > `wheel_fl|fr`, `wheel_r`). Same root frame as the truck GLBs (origin on the ground below the centre of a 40 ft box), with dimensions, node names, pivots and axes imported from `truck.py`, and `attachPoints`, `loadConfigurations`, `travelLimits`, `wheel`, `liveries` and `atlas` copied into the sidecar from `truck_meta.sidecar()` (so a box sits on the same `load_*` seats). `wheel_*` nodes are empties with a `<name>_geo` mesh child; `fifth_wheel` and `steer_*` are empties as in the truck GLBs.

- **Detail:** tyres with staggered tread lugs up to the full radius (rolling radius unchanged) and a rim with 10 nuts on the outer face. Chassis: twist-lock castings (collar, cone, apertures) at every pin under the `load_*` seats, cross tubes, gooseneck gussets and tunnel plate, landing-leg sand shoes, bands, crank grip and cross shaft, mudguard stays and mud-flap hangers, rear lamp bezels, reversing and fog lamps, front outline markers, number-plate lamp, ABS and air lines to each axle and an ABS modulator. Cabs: windscreen and side-window seals, wiper pivots and blades, mirror glass and a kerb mirror, grille surround and bars, step treads and grab handles, exhaust heat shield, clamps and rain cap, fifth-wheel ramps, lock handle and grease grooves. All static.
- **Livery:** one material, `truck_atlas`, the truck livery atlas with TEXCOORD_0 on tile 0 as in the truck GLBs, on every mesh. The cab colour, `cab_dark` and wordmark are on `tractor`, the chassis colour on `chassis`; the sidecar's `livery.mesh` names that mesh. The runtime gives the hero meshes the rig's material for the shape and livery tile (`TruckModels.materialFor`), as for LOD0.
- **Quantization:** in the truck GLBs a wheel is a mesh node, and mesh quantization moves its origin along the axle (`wheel_fl` sits 4 cm outboard of its sidecar pivot); the hero `wheel_*` empties sit on the sidecar pivots. Both roll about the same axle line.
- **Budget:** kinds `hero-truck-chassis` (LOD0 10 000 triangles, 6 draw calls) and `hero-truck-cab` (15 000, 8), 800 KB per file. Each piece has 4 draw calls (one per moving node plus the static mesh). `tests/hero-truck-asset.test.ts` decodes each piece against the source LOD0 part: rig node names, world pivots (1 mm, against the source sidecar, and the axle line against the source GLB) and rotations, `load_*` attach points (1 mm) and load configurations, overall bounds within 1 cm, `truck_atlas` with tile 0 UVs on the livery mesh, and the budget.

## Equipment, vessels and infrastructure generators

| Group | Generator | Outputs | Provenance and notes |
|---|---|---|---|
| `sts` | `sts.py`, `sts_atlas.py` | `sts-malaccamax.glb`, `sts-super-post-panamax.glb` (#303: `configure(cls)` in `sts.py`; the same geometry, `ry()` lowers everything from the portal up by 9 m and shortens the leg section between the sills and the portal, `OUTREACH` 65 m shortens the boom 3 m: the reverse of the 2021 to 2023 heightening; sidecar `craneClass`, `geometry.boomUndersideM`), `sts-atlas.json` (16 swatches of 64 px plus crane-number tiles), previews incl. `closeup` and `raised` (boom 80 deg) | Gauge 30.48 m, lift 52 m, outreach 68 m [V]; the rest [A]. Cobalt legs, A-frame, lattice boom, white house and trolley, yellow spreader; text `TTI ALGECIRAS`, `ZPMC` plates. 8 `beaconMounts` (legs at 6 m, portal-beam ends). Rig incl. `spreader_tele_fore/aft` (0 to 3.067 m), `twin_locks` (0.4 m drop), `boom` (0 to 80 deg); `forestays` and `boom_hoist_ropes` aim-stretch to anchors on the boom. Boom side plate (#300, every LOD) with `TTI ALGECIRAS` from the atlas region `tti_on_blue` at LOD0 and LOD1 (sidecar `branding.boomSidePlate`; `sts-atlas.json` lists `regions` as pixel rects); LOD0 only: extra A-frame bracing and leg stairs (switches `EXTRAS` in `sts.py`, recorded in the sidecar provenance). LOD0 is held at or under 33,274 triangles (spec #297). |
| `shc` | `shc.py`, `shc_meta.py` | `shc.glb`, two 1024 WebP atlases (swatches and wordmarks; fleet-number plates 8x15 tiles of 128x64 for "SHC 01" to "SHC 120", material `shc_plate`) | Look [P], dimensions [A]. Single tyres (R 0.95 m), 4.0 m clear tunnel, 6.4 m high; KALMAR and TTI ALGECIRAS as text. Sill shows "SHC nn", not the real "SHC 240 H". |
| `asc` | `asc.py`, `asc_meta.py` | `asc.glb`, one 1024 atlas | Span 25.4 m, 8 rows, 40 t [V]; the rest [A] (tune constants at the top of `asc.py`). Zig-zag stairs, sign band with unit number, `TTI ALGECIRAS`, `ZPMC`, `40 t`. 4 `beaconMounts` at 4.5 m. Sidecar `stack`: 8 rows at 2.9 m pitch, `designTiers` 5, `underBridgeM` 20.0. |
| `trucks` | `truck.py`, `truck_meta.py` | `truck-cab-high|mid|day`, `truck-chassis`, `truck-livery-atlas.webp` (8 liveries, 2048x1024) | Proportions [A]. 4x2 cab-over plus gooseneck tri-axle chassis, about 16 m x 2.55 m. Maker wordmarks only (Volvo, Scania, DAF, MAN, Mercedes-Benz), no haulier names. Attach points `pin_40_*` (11.985 x 2.259 m), `pin_20_mid_*`, seats `load_40`, `load_20_front` (3.0675 m ahead), `load_20_rear`, `load_20_twin_a|b`. `fifth_wheel` is an empty with no position in the sidecar. |
| `vessels` | `vessels.py`, `vessel_liveries.py` | five hull GLBs, `vessel-livery-atlas.json` (container tile order plus generic) | Sized from `--vessel-classes` (the engine's `VESSEL_CLASSES` and bay-plan pitches, `scenario/vesselClasses.ts`): change the class table, then `--only vessels`. Required nodes `hull`, `hatch_covers`, `lashing_bridges`, `bay_grid`. `HATCH_GAP` 1.4 and `COAMING_M` 1.7 are mirrored in `modules/hullHatchOpening.ts`. The accommodation block (`build_superstructure`) and the sidecar `airDraftM` are mirrored in `VesselClassSpec.superstructure` (#302, cross-checked in `tests/vessel-hulls.test.ts`): change one, change both. Colours and marks [A]. |
| `infrastructure` | `infrastructure.py`, `infrastructure_meta.py` | 23 GLBs on one `infra-atlas.json`, root > `LOD0` > meshes, no further LODs | Gate, quay, yard, building, backdrop and scenery kinds. `build_backdrop_rock` repeats `ROCK` from `terminals/tti-algeciras/constants.ts` (change both). `build_scenery_*` (seeded, flat swatches of the shared atlas only, so the atlas and every other GLB stay byte-identical) build the five `scenery-*` GLBs, each one merged mesh. `scenery-landside` still bakes the road past the north land edge; the renderer clips it (#172). |

Terminal-specific scenery is described in the terminal's folder (`terminals/<id>/`); its GLBs stay in the
`infrastructure` group.

## Previews, shots and the asset viewer

- **Previews:** Cycles renders written by the generators into `assets/models/<group>/previews/*.webp` (views such as
  `front`, `side`, `rear`, `three-quarter`, `closeup`, or numbered for infrastructure), plus atlas images. Committed.
- **`pnpm run tt:assets:shots`** (`cli/assets/screenshots.ts`): starts Vite on a free port (or `--base <url>`), opens the
  viewer in headless Chromium (SwiftShader), shows every asset at LOD0, LOD1 and LOD2, and the yard stress test
  (`--no-yard` skips it). Output `.screenshots/assets/` (git-ignored, `--out` to change). Exit 1 on page errors or a failed load.
- **Dev asset viewer** (`/sim/terminal-twin?viewer=<asset>` or `?viewer=yard`, dev builds only, stripped from production):
  `dev/AssetViewer.vue` lists every GLB that has a sidecar (`import.meta.glob`), with LOD buttons (auto LOD uses the
  sidecar distances), livery picker, rig sliders from `travelLimits`, and a reference box. `window.__ttAssets`
  (`dev/assetViewerApi.ts#AssetViewerApi`): `list`, `show(name, { lod, livery })`, `setLod`, `setLivery`, `setRig(node, value)`,
  `setStack(tiers)`, `setLoad(mode)`, `stats`, `pose`, `yard(count)`.
  - STS: a 40 ft box hangs from the spreader's `container` attach point at true scale.
  - SHC: a 40HC hangs from the attach plane and follows the hoist slider; `stats().reference.fitsTunnel` checks the sidecar clearances.
  - ASC: 8 rows of 40HC under the span with a stack slider; `stats().stack` reports `sideClearanceM`, `carryClearanceM`,
    `carriedBottomM`, `fits` (true at 5 tiers, false at 6).
  - Trucks: `setLoad('40' | '40HC' | '20front' | '20rear' | '20twin' | 'none')`; `stats().load` checks ISO casting
    centres against the sidecar pins (`maxPinErrorM`, `onPins`).
  - `yard(count)` (default 18 000) fills TTI-like blocks through a real `ContainerInstancer`.

## Synthesized sounds

- `pnpm run tt:sounds` writes `assets/sounds/*.wav` from `cli/sounds/synth.ts#SYNTHS` (pure maths at `SAMPLE_RATE`
  22 050 Hz, a seeded mulberry32 PRNG for noise). `pnpm run tt:sounds:check` regenerates in memory and fails on any
  byte of drift, naming the file (`Sounds are up to date.`, exit 0). It runs in `pnpm test` (`tests/sound-synth.test.ts`) and as a CI step.
- WAVs: `gantry-alarm`, `motor-whine`, `twistlock`, `landing-thud`, `reverse-beeper`, `truck-engine`, `air-brake`,
  `harbour-ambience` (8 s whole-cycle loop). MP3 cues (`container-landed`, `horn-small`, `horn-large` cut to 1.7 s,
  `scenario-complete`) are copies from `available-media/sound-samples`. No music.
- **Adding a sound:** one `SYNTHS` entry, one `SOUND_PROFILES` entry (`modules/soundMixer.ts`) and a `urls` entry in
  `modules/positionalSound.ts`, then `pnpm run tt:sounds`.

## Adding the next asset

1. Add `tt_assets/<kind>.py` (use `parts.py` `Atlas` and `Part`), wire the group into `GROUPS` in `build.py` and `cli/assets/build.ts`.
2. Follow the rig and sidecar conventions; tag every dimension `V`, `P`, `A` or `M`.
3. Add or tune its kind in `budgets.json` (and a group cap if it belongs to one); run `pnpm run tt:assets --only <group>`.
4. Look at the previews and `?viewer=<asset>`, then run `pnpm run tt:assets:shots`.
5. Add an asset test (`tests/<kind>-asset.test.ts`: rig nodes, `_geo` children, attach points, provenance).
6. Commit generators, GLBs, sidecars and previews; never `.blend` files or photos.

## Gotchas

- Run the generators only through `pnpm run tt:assets`; it replaces `assets/models/<group>/` wholesale.
- `tt:assets --check` needs bpy; CI does not run it. CI runs only `tt:assets:check` (budgets) and `tt:sounds:check`.
- A sidecar that misses a node the GLB has fails the check: list new rig, `_geo` and helper nodes in `nodes`.
- Every loader is one cached promise per page shared by the viewer and the twin: never dispose shared materials or textures from a renderer.
- Container shadows need the sun's `shadow.normalBias` (0.35) or the corrugation shows acne.
- `requiredNodes` in `budgets.json` lists rig names the renderer depends on; renaming a node in a generator breaks the rig silently unless it is listed.

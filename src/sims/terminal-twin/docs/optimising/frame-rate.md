# Optimising browser frame rate

Checked against ENGINE_VERSION 0.53.0.

Read this when the 3D view is slow, before you change posing, instancing, LODs, quality profiles or shadows, and when
you write a smoke test that looks at frames. The pipeline itself is described in [../rendering-3d.md](../rendering-3d.md);
engine speed (headless and the worker) is [run-speed.md](run-speed.md). Terms: [GLOSSARY.md](../../../../../GLOSSARY.md).

Nothing here changes engine behaviour, goldens or event-log hashes. Frame-rate work is proved with `__tt.perf()`
numbers on a real GPU, Vitest for the pure modules, and the smoke suite.

## Where the time goes

The engine runs in a Web Worker; the main thread only plays the scene back. One frame on the main thread
(`composables/useTwinScene.ts#useTwinScene`, `loop`):

```
controller.tick + store.sync              not in cpuMs (playback, deltas, cue release)
|-- view.update(...)  ------------------+
|   containers: pose, tint, push        |  poseMs  (EMA, 0.9 old + 0.1 new)
|   ContainerInstancer.end              |
|   kind renderers, sounds, overlays    |
|-- positional.update ------------------+
|-- renderer.render(scene, camera)          Three.js CPU side: matrices, sort, main + shadow pass submit
+-----------------------------------------  cpuMs (EMA of pose + render submit), not GPU time
```

- `perf().stats.cpuMs` is main-thread ms per frame for posing plus the render submit. `poseMs` is the posing part.
  Both are exponential moving averages, so read them after the view has settled.
- With vsync at 60 Hz the frame budget is 16.7 ms. When `cpuMs` is above it, frames miss every other vblank and fps
  **quantises to 30**, whatever the GPU does. An fps of exactly 30 with `cpuMs` of 17 to 20 means the main thread is the limit.
- GPU cost shows as fps below what `cpuMs` allows. Draw calls and triangles (`stats.calls`, `stats.triangles`, from
  `renderer.info`, main plus shadow pass) are the GPU proxies.
- While `controller.busy` (a flat-out "Run to" jump) nothing is posed or rendered.

### What posing costs per frame

`modules/sceneRenderer.ts#SceneRenderer.update` walks **every container id** every frame:

| Step | Per box | Notes |
|---|---|---|
| `SceneModel.containerPose(id, t)` | binary search of the custody list, then a pose by owner kind | yard boxes hit the `yardPoses` cache (no parse), but still pay the search and the call |
| `tintOf` | cheap when colour by is `default` | time-based modes recompute per 30 sim s bucket, at most 4 000 boxes per frame (`COLOUR_BUDGET_PER_FRAME`) |
| `custodyAt(id, t)` | a second binary search | runs because STS, SHC and ASC renderers set `wantsContainerOwners` (to know spreader loads) |
| `ContainerInstancer.push` | writes structure-of-arrays | |
| `end`: `cull` | one frustum-sphere test (7.5 m) | |
| `end`: `chooseLods` | one distance; sort only when candidates exceed `lod0Cap` | |
| `end`: `offerCloseups` | one distance; grid and `exposedFaces` only within reach (`closeupDistanceM x 1.15 + 8`) | |
| `end`: write | `setMatrixAt`, livery index, instance colour for every visible box | `needsUpdate` re-uploads the instance buffers every frame |

At TTI scale (about 10 000 stacked boxes, more with the realistic yard mix) this loop is the main-thread cost. Equipment
rigs are a few dozen objects and cost little by comparison. Static scenery (backdrop, scenery GLBs, batched ground) adds
no per-frame posing.

## Measuring: the `__tt.perf()` procedure

Use a real GPU, never the headless screenshot or smoke browsers (SwiftShader software WebGL: about 0.3 to 19 fps, so
only draw calls and triangles mean anything there; CPU and pose ms are noise).

1. Start the `dev` entry of `.claude/launch.json` (`pnpm exec vite --port 5174 --strictPort`) and open
   `/sim/terminal-twin` in a browser on the real GPU. `window.__tt` exists in dev builds only.
2. In the console:
   ```
   await __tt.load('TTI Algeciras baseline'); await __tt.runTo(4*3600); __tt.pause()
   __tt.cameraTo('STS104', 1100)        // overview: the whole terminal in view
   __tt.setQuality('high')              // repeat for 'medium', 'low', 'auto'
   ```
3. Take several one-second samples per setting of `__tt.perf().stats` (`fps`, `calls`, `triangles`, `cpuMs`, `poseMs`,
   `closeup`, `closeupFaces`) and average them. Also note `__tt.scene().containers` and `containerLods`.
4. Compare `cpuMs` and `poseMs` with 16.7 ms. Use `__tt.drawBreakdown()` (visible drawables per top-level scene group and
   geometry type, main pass only, so it is below `renderer.info` when shadows are on) to see where draw calls and triangles go.
5. Record the numbers in the Recorded numbers section below with the date, `ENGINE_VERSION`, machine, browser, dev or
   production build, window size, and scenario time. A dev server is unminified: main-thread numbers are pessimistic;
   re-check on `pnpm run build && pnpm run preview` before concluding.

Other dev API levers: `perfOverlay(on)` (also key P, the Stats button, or a click on the FPS chip), `setFrameLoad(ms)`
(busy-wait per frame, dev only), `setAutoThresholds({ down, up })` (retune Auto for slow renderers; null restores 45 / 57).

## Targets

- **60 fps** for the full TTI preset at overview zoom on the reference machine: a mid-range laptop, 4-core CPU of about
  2020 (Core i5-1135G7 or Apple M1 class), integrated GPU (Intel Iris Xe or similar), 16 GB, Chrome, 1080p window, engine in its worker.
- Budget that follows: at most about 300 draw calls and 400k triangles (main plus shadow pass), and under about 8 ms of
  main-thread posing per frame.
- Auto holds 45 fps or better by stepping quality down, but only when quality is what costs the time (see below).

## Levers

| Lever | Where | Effect | Notes |
|---|---|---|---|
| Per-instance culling | `ContainerInstancer.end(camera, frustum)` | culled boxes are not written | zoomed on one crane, over 80% of boxes are culled; posing still visits them |
| Container LOD | `QUALITY_PROFILES.*.lod0DistanceM`, `lod0Cap`, `DEFAULT_LOD_OPTIONS` | LOD0 440 triangles vs LOD1 12 | at overview every box is LOD1 already |
| Close-up faces | `closeupDistanceM`, `closeupFaceBudget` | one draw call per atlas page, none when far | budget caps canvas painting too |
| Equipment LOD | `lodScale` (STS, SHC, ASC), `*_LOD_DISTANCES`, `DEFAULT_VESSEL_LOD` | e.g. STS LOD0 31 690 vs LOD2 490 triangles | trucks and hulls ignore `lodScale` |
| Far tier | `modules/farTier.ts`, `InfrastructureScene.update` | fences, ASC rails and masts beyond 220 to 350 m draw as 12-triangle boxes: TTI overview 1.56M to 382k triangles, 282 draw calls both | per instance, hysteresis; headless counts only (#249) |
| Draw calls | `StaticBatch` per material, `InfrastructureScene` one InstancedMesh per geometry key, instanced masts, hatch panels and containers | TTI overview went from 1 563 to 265 draw calls with `StaticBatch` | new static scenery must be batched or instanced |
| Shadows | `shadows`, `shadowMapSize`; night drops the shadow pass | the shadow pass roughly doubles triangles (Low has half the triangles of Medium) | `normalBias` 0.35 must stay for containers |
| Render resolution | `resolutionScale` (0.65 / 0.85 / 1, cap 2 x DPR) | fill-rate only | no help when main-thread bound |
| Ocean | `oceanSegments` (1 flat Lambert quad, 24, 96) | small | |
| Night glow | `nightLights` | glow points drawn | 2 draw calls in all |
| Pose cost | `SceneModel.containerPose`, `yardPoses`, `wantsContainerOwners`, colour budget | the real limit today | see "What has been tried" |

### What has been tried and what is next

- **Done:** yard pose cache (`yardPoses`), per-instance culling, static batching (1 563 to 265 calls), instanced
  infrastructure, LOD hysteresis, colour-by caching with a per-frame budget, close-up faces per atlas page instead of a
  mesh and canvas per box (#143), close-ups on every level (#158).
- **Quality steps do not touch posing.** On real hardware Low halved triangles and changed neither fps nor pose time;
  Auto churned High to Medium to Low without gaining fps and never stepped back up (#158: that is why Low draws close-ups too).
- **Done in #250:** boxes at rest are posed only when their custody changes (retained instance slots, upload by dirty range; see `rendering-3d.md`, Containers).
- **Next wins (not done):** cull before
  posing (skip `containerPose` for boxes whose cached position is outside the frustum); fold the second custody search
  (`custodyAt` for `loads`) into `containerPose`; a far-LOD for containers (the infrastructure one is done, #249:
  the TTI overview fell from 1.56M to 382k triangles).
- Anything that adds per-box work per frame (a new colour mode, a new per-box lookup) must be budgeted like colour by.

## Recorded numbers

**Baseline for the smooth-playback spec (#243, ticket #246), 2026-11-12, ENGINE_VERSION 0.53.0.** `pnpm run tt:baseline` on the
full-scale `TTI Algeciras baseline` preset. Machine: 4-core Intel Xeon 2.1 GHz cloud container, Node 22, headless Chromium
(dev server, unminified), **load average 7.7 from other agents, so both parts are pessimistic**; no real GPU. Later tickets
compare against these on a like machine, or re-run the command first. Re-record with the same command.

- *Posing per frame, Overview camera (Node, `cli/headlessPose.ts`: no render submit, no GPU), display time 14 400 s, 30 frames after 5 warm-up:*
  mean 14.3 ms, min 12.5, max 17.6. Boxes posed per frame 9 895 (of 11 616 boxes in the scene; the rest have no pose),
  instance bytes uploaded per frame 2 006 400 (1.9 MiB: every container instance buffer is re-uploaded in full, capacity
  not count, today). Compare with the 8 ms posing budget above and with real-hardware 13 to 16 ms (V11-19).
- *After #250 (posing by custody), same command with `--skip-rate`, same machine class (4-core Xeon 2.1 GHz, load average 6.6), same camera and time:* posing mean 2.40 ms per frame (min 1.21, max 5.52), **about 6 times less than 14.3**; boxes posed per frame 9 (the carried ones; was 9 895); instance bytes uploaded per frame 0 (was 2 006 400). What remains per frame is the O(boxes) close-up offer loop and the carried boxes; #257 (cull before posing) targets it. The drawn-box reference is unchanged.
- *Engine in its worker, no rendering (a playback clock driven at the speed step, no scene built), from 7 200 s, 8 s window after a 2 s settle:*

| Speed | Achieved sim s per wall s | Engine advance sim s per wall s |
|---|---|---|
| x60 | 60 | 60 |
| x120 | 120 | 120 |
| x300 | 300 | 298 |
| x600 | 600 | 597 |
| x1200 | 1 185 | 1 013 |
| x1800 | 1 323 | 1 146 |
| x3600 | 1 442 | 1 492 |

The engine keeps every step to x600 exactly and saturates near 1 300 to 1 500 sim s per wall s from x1200 up: the earlier
"about 600" estimate was low (headless Node runs the same preset at about 1 000 sim s per wall s with invariants on).
Those are the first 2 to 4 sim hours; a busier phase of the day will be lower. The x3600 `@load` floor of 600 is therefore
met by the engine alone; the page adds the delta application and the render on top.

**Counters (#246).** `perf().stats.boxesPosed` and `stats.instanceBytes` (also in the performance readout) are the last
frame's box count posed and container instance-buffer bytes handed to the GPU upload (matrix, livery index, colour; each
buffer flagged for upload counts in full, or only its update ranges once a buffer uses them; close-up faces excluded).
Posing tickets are judged by these plus `poseMs`, and by `tests/drawn-boxes.test.ts` (below).

**Drawn-box reference (#246).** `tests/drawn-boxes.test.ts` runs the posing loop headless (`cli/headlessPose.ts`) and hashes
which boxes are drawn with which matrices, liveries and colours at display times, for custody changes, a vessel arriving
and departing, a restart, a rewind, colour by and quality; the hashes are in `tests/drawn-boxes.reference.json`. A posing
change must leave it unchanged; regenerate (`UPDATE_DRAWN_BOXES=1`) only on purpose. Two facts it taught: the harness must
feed the model with `advance` steps like playback (a flat-out `run` compacts motion plans, so mid-run poses differ), and a
box in flight at display time T is posed from motion the engine plans later, so a model only replayed to T+900 s differs
from a longer run at T (the controller's look-ahead exists for this).

All on the TTI baseline preset unless stated. Headless numbers are SwiftShader: only draw calls and triangles count.

**Real hardware, V11-19 (#79), 2026-10-29, ENGINE_VERSION 0.12.0.** Windows 11 laptop, Intel Iris Xe (ANGLE D3D11),
8 logical cores, display scale 1.25, in-app browser pane 1024x768, Vite dev server (unminified), engine in its worker.
Run to 04:00 (10 110 containers, none culled, all LOD1), paused, `cameraTo('STS104', 1100)`, 8 one-second samples per setting:

| Setting | fps | Draw calls | Triangles | cpuMs | poseMs |
|---|---|---|---|---|---|
| Low | 30 | 246 | 834k | 16.7 | 13.3 |
| Medium | 30 | 281 | 1.57M | 17.8 | 13.8 |
| High | 29.9 (min 29.5) | 286 | 1.58M | 20.3 | 16.1 |
| Auto | 30 (stepped High > Medium > Low, 4 changes) | 269 | 1.30M | 17.3 | 13.5 |

The 60 fps target is not met: every setting sits at 30 fps. The main thread is the cause: `cpuMs` 17 to 20 ms (over
16.7, so frames quantise to 30) and posing alone 13 to 16 ms against the 8 ms budget. Draw calls are within 300;
triangles are not (1.6M against 400k at Medium and High). Since then colour by (#130), per-face close-ups (#143),
spreader loads (#142) and a larger realistic yard (#188, #222) changed the posing loop: re-measure before relying on these.

**Headless, TT-19, 2026-10-28, ENGINE_VERSION 0.7.0.** Overview at 1 100 m from STS104, High: 10 151 containers,
265 draw calls, 307k triangles, posing about 10 ms (inflated: four cores shared with the rasteriser and other agents).
Zoomed on one crane, over 80% of boxes culled.

**Asset viewer yard, 2026-10-28, ENGINE_VERSION 0.7.0.** `?viewer=yard`, 18 000 boxes: about 264k container triangles,
6 container draw calls, 14 draw calls per frame including the shadow pass.

**Surroundings cost (#123), 2026-10-31, ENGINE_VERSION 0.25.0.** TTI baseline at 08:00, High, headless.
Overview (`cameraTo('STS104', 1100)`): before 277 calls, 1 578 380 triangles; after 282 calls (+5), 1 584 449 triangles
(+6 069, +0.4%). Default camera: 717 to 721 calls, 1 870 172 to 1 875 623 triangles. The five scenery meshes are static,
cast and receive no shadows, are frustum-culled and share the infrastructure atlas material: no per-frame posing.

**Not measured yet:** real-GPU fps at night (night has no shadow pass); the close-up `@load` spec on a real GPU (Overview
camera vs about 10 boxes wide, `cameraTo('B01', 40)`, annotation `frame-ms`); the frame cost of Low's 48 close-up faces
on the reference laptop; real-GPU fps on a production build. Fill them in here.

## Smoke-test rules for frames

- Frame-based checks use `tests/browser/frameSampling.ts`: `sampleFrames(page, { minWallMs, minFrames, maxWallMs })`
  samples on every animation frame for a minimum wall-clock window (extended to a minimum frame count, capped at 30 s),
  and assertions are ratios: `simPerWallSecond`, `advancedFraction`. Never assert an absolute frame count or fps, and
  never sample a fixed number of frames: CI runs software WebGL on a loaded 2-core runner.
- Budget assertions use deterministic quantities (draw calls, triangles, culled counts), e.g. `terminal-twin-perf.smoke.ts`:
  TTI overview under 450 draw calls and 2M triangles, over 80% culled near one crane.
- Specs that need a real frame rate are tagged `@load` in the title. CI runs `pnpm run test:smoke --grep-invert @load`;
  run `@load` specs locally on real hardware. Current `@load` specs: Auto steps down and recovers
  (`terminal-twin-perf.smoke.ts`, uses `setFrameLoad` and `setAutoThresholds`), x3600 sustains 600 sim s per wall s
  (`terminal-twin.smoke.ts`, #191; the engine alone measures 1 300 to 1 450 sim s per wall s at x1800 and x3600 on the 4-core container, see the baseline below; the 190 to 396 once quoted here came from a fixture too small to measure anything), colour-by modes pose within 1.5x the livery frame
  plus 3 ms (`colour-by.smoke.ts`), and the close-up view costs no more than the Overview camera, within 1.1x plus 3 ms
  (`container-closeup.smoke.ts`). They report numbers as test annotations (`pose-ms`, `frame-ms`, `tti-overview`).
- `@load` comparisons are ratios with a small absolute slack, never fixed ms.
- Smoke suite timing: `SMOKE_JSON_REPORT=<file>` writes a Playwright JSON report; `node scripts/smoke-timing.mjs <file>`
  turns it into a duration table.

## Gotchas

- Do not judge frame rate from screenshots, `tt:assets:shots` or the smoke browsers: software WebGL.
- A lower quality level that does not change `poseMs` will not raise fps while `cpuMs` is above 16.7 ms.
- `drawBreakdown()` excludes the shadow pass; `stats.calls` and `stats.triangles` include it.
- Any InstancedMesh spanning the scene needs `frustumCulled = false` and its own culling, or it pops out of view.
- Rewriting instance buffers is per frame today: adding attributes per instance multiplies upload cost at TTI scale.
- Never put Three.js objects in Vue reactivity: proxies on meshes and matrices slow every frame.

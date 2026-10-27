# Terminal Twin — Agent Guide

## Overview

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root — use its terms in code, tests and docs.

**Status:** headless engine tracer (TT-01), the decision-point framework (TT-03) and headless debug tooling — structured logs, run diff, snapshot time windows, golden updates (TT-04). It also has the browser tracer (TT-02): a home card, a setup dialog shell, the engine in a Web Worker, a procedural 3D quay with time controls, and the dev-only `window.__tt` API. TT-20 added locale and units, the message catalogue and keyboard shortcuts. Phase 2 has started with the asset pipeline and container models (TT-22): Blender-generated GLBs with LODs and a livery atlas, instanced in the 3D view, plus a dev asset viewer and an asset budget check in CI. See [Phase 2 asset pipeline](#phase-2-asset-pipeline). TT-05 adds SHC horizontal transport (STS ground position → WTP pad) over a generated lane graph with conflict-zone reservations, the `shcDispatch` decision point, an instant ASC stub, subsystem modes, SHC setup fields and 3D lane/reservation overlays.

**Sim ID:** `terminal-twin`

## How to prove a change works

| Kind of change | Command | What "works" looks like |
|---|---|---|
| Anything | `npm run verify` | lint, build (incl. `vue-tsc` for engine, CLI and tests) and `npm test` all pass |
| Engine behaviour | `npm test` | all Vitest suites pass, including golden summaries |
| One scenario, by hand | `npm run tt:run -- --fixture tracer-1sts-10-boxes` | `Stopped: ended`, `0 violations`, `First error: none`, exit code 0 |
| Partial run | `npm run tt:run -- --fixture <name> --until time:600` (or `moves:5`, `vessels:1`, `event:StsPicked`) | stops at the condition |
| Another seed | `npm run tt:run -- --fixture <name> --seed 7` | runs to the end; hash differs from the golden |
| Inspect events | `npm run tt:run -- --fixture <name> --events /tmp/ev.jsonl --out /tmp/summary.json` | one JSON event per line; summary = golden format |
| Failure path | `npm run tt:run -- --fixture <name> --handlers broken-first-lane` | exit 1, first error names `custody.single-owner` at the offending event |
| Decision points / TOS latency | `npm run tt:run -- --fixture <name> --strategy stsGroundPosition=highest-free-lane --latency stsGroundPosition=exp:2000,timeout:10,error:10 [--async-mode pause]` | `TOS handlers:` block shows calls, fallbacks, latency, backlog, idle caused; invariants still 0 |
| Structured logs | `npm run tt:run -- --fixture <name> --log /tmp/run.log.jsonl --log-level "sts=debug,vessel=warn,*=info"` | one JSON object per line with `t`, `eventId`, `seq`, `subsystem`, `level`, `type`, `subjects` (+ `causedBy`, `payload` at `debug`); `grep '"subsystem":"sts"'` |
| Two strategies diverge where? | `npm run tt:diff -- --fixture <name> --b-handlers highest-free-lane` | exit 1; `First divergence at seq N`, differing fields, context and both payloads (exit 0 + `No divergence` if identical) |
| Two seeds | `npm run tt:diff -- --fixture <name> --a-seed 1 --b-seed 2` | same report |
| Two code versions | before: `npm run tt:run -- --fixture <name> --events /tmp/before.jsonl`; after your change: `… --events /tmp/after.jsonl`; then `npm run tt:diff -- /tmp/before.jsonl /tmp/after.jsonl` | first diverging event = first effect of your change |
| Reproduce a late bug | `npm run tt:run -- --fixture <name> --until time:50400 --snapshot /tmp/h14.json`, then `npm run tt:run -- --from-snapshot /tmp/h14.json --until time:54000 --events /tmp/win.jsonl --log /tmp/win.log.jsonl --log-level debug` | the window's events equal that window of the uninterrupted run; re-run the window as often as needed |
| Check goldens | `npm run tt:golden` (also part of `npm test`) | `<fixture>: match` per fixture, exit 0; drift prints `path: golden X → actual Y` per field and exits 1 |
| Intentional behaviour change | `npm run tt:golden -- --update` (or `UPDATE_GOLDEN=1 npm test`), then review the `*.golden.json` diff | the golden diff shows only the change you intended |
| Browser / UI / 3D view | `npm run test:smoke` | Playwright smoke tests in `tests/browser/*.smoke.ts` pass (dev server + a production build). Not part of `npm test` or CI. |
| Look at the 3D view | `npm run screenshot -- --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('tracer-1sts-10-boxes').then(() => window.__tt.runTo(330)).then(() => window.__tt.pause())"` | PNG in `.screenshots/` shows the STS mid-cycle, no page errors |
| UI text, locale, units, shortcuts | `npm test` (`display-format`, `display-settings`, `message-catalogue`) + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-display.smoke.ts` | catalogue audit lists no hard-coded strings; locale/units/shortcut smoke tests pass |
| Fixture definition change | `npm run tt:fixtures`, then `npm run tt:golden -- --update` | committed fixture JSON matches `definitions.ts` |
| SHC transport | `npm run tt:run -- --fixture shc-1sts-2shc-1wtp` | `Horizontal: 10 boxes to WTP pads`, per-SHC jobs/distances/reservation wait, `0 violations` |
| SHC dispatch strategies | `npm run tt:diff -- --fixture shc-1sts-2shc-1wtp --b-handlers nearest-job` (or `tt:run … --strategy shcDispatch=nearest-job`) | first divergence at the first `shcDispatch` `DecisionResolved` (`payload.reply.wtpPadId`) |
| SHCs in 3D | `npm run screenshot -- --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('shc-1sts-2shc-1wtp').then(() => window.__tt.runTo(300)).then(() => { window.__tt.pause(); window.__tt.overlays({ laneGraph: true, reservations: true }) })"` | SHCs on the apron, boxes on pads/yard, cyan lane graph, amber reserved zones |
| Smoke tests side by side with another checkout | `SMOKE_DEV_PORT=5299 SMOKE_PROD_PORT=5298 npm run test:smoke` | same as `npm run test:smoke`, on other ports |
| Asset budgets (CI) | `npm run tt:assets:check` (also in `npm test`) | `ok` per GLB with LOD triangles/draw calls, `Budgets: pass`, exit 0 |
| Regenerate assets (needs bpy) | `npm run tt:assets -- --python <venv python>` | GLBs, sidecars, atlas, previews rewritten; budget check passes; `git diff` shows only intended changes |
| Generator is deterministic | `npm run tt:assets -- --check --python <venv python>` | `Regenerated assets are identical to the committed ones`, exit 0 |
| Assets in the real renderer | `npm run tt:assets:shots` | PNG per asset × LOD + `yard.png` in `.screenshots/assets/`, no page errors |
| Look at one asset | `npm run dev`, open `/sim/terminal-twin?viewer=container-40` (or `?viewer=yard`) | viewer with LOD buttons, livery picker, rig sliders, 20 ft reference box |

Never regenerate goldens to make a failing test pass unless the behaviour change is intended and explained in the commit. Without `--update` / `UPDATE_GOLDEN=1` nothing ever rewrites a golden.

All three commands print usage with `--help`. Exit codes: `tt:run` 0 ok / 1 violation or error / 2 usage; `tt:diff` 0 identical / 1 diverged / 2 usage; `tt:golden` 0 all match / 1 drift or missing / 2 usage.

## Folder layout

```
terminal-twin/
├── terminal-twin-AGENTS.md   This guide
├── engine/                   Headless engine — NO DOM/Vue/Three/Node imports (ESLint-enforced)
│   ├── index.ts              Public API barrel: import engine code ONLY from here
│   ├── simulation.ts         createSimulation / restoreSimulation, run loop, snapshot, why, subscribe
│   ├── events.ts             Event envelope + EventPayloads catalogue
│   ├── context.ts            EngineContext + Reactor types (internal behaviour per event type)
│   ├── subsystems/quay.ts    Vessel berthing + STS discharge cycle reactors (+ ground-position wait/resume)
│   ├── subsystems/shc.ts     SHC jobs, pull dispatch, whole-trip planning, parking (TT-05)
│   ├── subsystems/ascStub.ts Instant ASC stub: AscPicked / AscStacked at the drop time (until TT-06)
│   ├── laneGraph.ts          Waterside one-way lane graph from config + shortest paths (cached per config)
│   ├── reservations.ts       Conflict-zone time-window reservations (earliestStart / reserve)
│   ├── handlers.ts           HandlerSet re-exports (TOS seams)
│   ├── decisions/            Decision-point framework
│   │   ├── types.ts          Request/reply catalogue, contract versions, HandlerSet, DecisionsConfig
│   │   ├── strategies.ts     Built-in strategy registry (1–3 per decision point) + defaultHandlers
│   │   ├── runtime.ts        Dispatch, async modes, timeouts/fallback, handler KPIs (SimState.decisions)
│   │   └── latency.ts        Latency injector (own RNG stream)
│   ├── invariants.ts         INVARIANTS registry + custody holders
│   ├── kinematics.ts         Motion profiles + MotionSegment + positionAt
│   ├── state.ts              SimState (plain JSON) + initial state from config
│   ├── query.ts              Read-only SimQuery
│   ├── kpis.ts, summary.ts   KpiReport, RunSummary (golden format)
│   ├── logging.ts            Structured log records + per-subsystem verbosity (EVENT_LOG_META)
│   ├── runDiff.ts            diffEventLogs: first diverging event between two logs
│   └── rng.ts, hash.ts, eventQueue.ts
├── scenario/
│   ├── types.ts              ScenarioConfig (schemaVersion 1, SI units)
│   ├── builder.ts            Typed ScenarioBuilder + [A] default kinematics
│   ├── iso6346.ts            Container id check digits
│   ├── presets.ts            Preset registry (empty until TT-15)
│   └── fixtures/             definitions.ts → <name>.json (+ <name>.golden.json), index.ts
├── i18n/                     UI text and display formatting (no Vue)
│   ├── messages.ts           Message catalogue (`t(key, params)`); ALL user-visible component strings
│   ├── format.ts             createFormatter({locale, units}): clock, numbers, length/speed/mass, week start (Intl)
│   └── display.ts            Browser defaults, remembered choice (localStorage), runConfigFor (config + display, SI)
├── definition.ts             Home card (keep light: eagerly imported)
├── TerminalTwin.vue          Root: TopBar, 3D host, SetupDialog, banner; installs window.__tt in DEV
├── components/               TopBar.vue (clock, speeds, Run to…, Reset, New Scenario, ?), OverlayToggles.vue,
│                             modals/SetupDialog.vue (scenario, seed, start, display, SHC count + kinematics),
│                             modals/ShortcutHelp.vue
├── composables/useTwinShortcuts.ts  Window keydown → store actions (table in modules/shortcuts.ts)
├── composables/useTwinScene.ts  Renderer/camera/OrbitControls + the frame loop (tick → sync → pose → render)
├── modules/                  Main-thread, non-reactive
│   ├── twinController.ts     Playback clock, look-ahead, Run to/runUntil/step, generation guard
│   ├── engineClient.ts       Promise wrapper over the worker (request ids)
│   ├── sceneModel.ts         Pure-TS timelines from worker deltas → poses/positions at any time
│   ├── sceneRenderer.ts      Three.js procedural quay, STS, SHCs, pads/blocks, vessel hulls; containers via
│   │                         ContainerInstancer (yaw per box); lane-graph + reservation overlays
│   ├── containerAssets.ts    Loads container GLBs (meshopt decoder from three), bakes LODs, livery shader patch
│   ├── containerInstancer.ts Instanced containers: placeholders → GLB LOD0/LOD1 per size, liveryIndex per instance
│   ├── shortcuts.ts          SHORTCUT_HELP table + shortcutFor(key event) (ignores typing targets)
│   └── time.ts               Start date default (Mon 06:00), datetime-local helpers
├── store/twinStore.ts        Pinia facade (small reactive UI state; controller/view kept raw)
├── worker/                   Engine Web Worker (same ESLint bans as engine/)
│   ├── engine.worker.ts      Entry; serialises requests
│   ├── engineHost.ts         Serves requests via the public engine API; builds compact Deltas
│   └── protocol.ts           Request/reply/Delta types (internal, not a public seam)
├── dev/devApi.ts             window.__tt (dev builds only)
├── dev/AssetViewer.vue       Dev asset viewer (?viewer=<asset>|yard); assetViewerScene.ts; assetViewerApi.ts (window.__ttAssets)
├── assets/                   Phase 2 asset library (see "Phase 2 asset pipeline")
│   ├── budgets.json          Triangle / draw-call / file-size budgets per asset kind
│   ├── generators/           Python (bpy) generators: build.py, tt_assets/*.py, fonts/ (OFL), requirements.txt
│   └── models/<group>/       Committed outputs: <asset>.glb + .meta.json, livery-atlas.json, previews/*.webp
├── cli/                      Node-only: run.ts→runCli.ts (tt:run), diff.ts→diffCli.ts (tt:diff),
│                             golden-cli.ts→golden.ts (tt:golden), handlerSets.ts, build-fixtures.ts,
│                             assets/ (build.ts = tt:assets, check.ts→budgetCheck.ts = tt:assets:check,
│                             screenshots.ts = tt:assets:shots, glb.ts = JSON-chunk GLB reader)
└── tests/                    Vitest suites (Node-only); tests/browser/*.smoke.ts = Playwright (npm run test:smoke)
```

`cli/`, `*.test.ts` and `*.smoke.ts` are type-checked by `tsconfig.tools.json` (Node types + DOM for `page.evaluate`); everything else by `tsconfig.app.json`.

## Browser host (TT-02)

- **Threads.** The engine runs in a Web Worker (`worker/engine.worker.ts`), driven only through the public engine API (`runUntilAsync`, `step`, `query`, `inject`, …). The main thread renders and runs the UI. The worker answers each request with a **Delta**: new motion plans per STS (diffed by `StsState.motion` identity), custody changes (with the grounding X for ground positions), STS/vessel status changes, the last 200 summarised events, and per-type counts. It also sends `EngineInfo` (engine time, status, end time, moves, hash).
- **Playback clock** (`TwinController`). `displayTime` advances by wall time × speed. It is clamped to the **engine horizon** (`info.now`) and to the scenario end. While playing, the controller keeps the engine a look-ahead ahead (`max(5 s, 1.5 s × speed)`) with `advance` requests, so the motion segments for the displayed instant are already known. That keeps animation smooth up to ×600. **While paused it does not run ahead**, so the scene and dev-API queries describe the same instant.
- **Flat-out runs.** "Run to…", `__tt.runUntil` and `__tt.step` send `run`/`step`. Rendering is skipped while `busy`. The delta is compacted to the latest plan, custody and status per entity, and the display jumps to the target (Run to…) or to the engine time (runUntil/step, which also pause).
- **Scene model.** `SceneModel` keeps per-axis segment lists and custody/status timelines and prunes history older than the display time. `positionAt` interpolates the crane, and a carried box follows the spreader. Display time never goes backwards, except on reset/load, which build a new model; a generation counter drops replies that belong to the old scenario.
- **Rendering.** Containers are drawn by `ContainerInstancer`: procedural boxes until the GLBs load, then one `InstancedMesh` per size × LOD with a livery per instance (see [Phase 2 asset pipeline](#phase-2-asset-pipeline)). STS, hulls and the quay are shared low-poly boxes. Three.js objects never enter Vue reactivity; the store mirrors only the clock, speed, engine info and selection.
- **Setup dialog.** It lists fixtures plus the `presets` registry, with an editable seed (re-roll) and start date/time (default Monday 06:00 of the current week, local time). Start = `store.startScenario({ name, seed, startDateTime })`. The start date changes only the clock, not the run.

### Locale, units, message catalogue, shortcuts (TT-20)

- **Message catalogue.** Every user-visible string in the sim's `.vue` files comes from `i18n/messages.ts` via `t('key', { param })`. `tests/message-catalogue.test.ts` parses every SFC (template text, `title`/`aria-label`/`placeholder`/`alt`/`label`, string literals in `<script>` and template expressions that read as UI text) and fails on hard-coded text. Add the key first, then use it. Ids, fixture names and engine values are data, not text.
- **Display settings** (`DisplaySettings {locale, units}`, type in `scenario/types.ts`): `store.display`, `store.fmt` (a `Formatter`), `store.setDisplay(partial)`. They default from `navigator.languages` on first open (US region → imperial, else metric; bare `en` → US), are remembered in `localStorage` (`terminal-twin.display`), and are written into the run's config as `config.display` (`store.config`, the SI config a save should store). Changing them applies live (the setup dialog's select/radios call `setDisplay` immediately; Cancel keeps them).
- **Units are display-only.** Engine, configs, snapshots stay SI. Format with `store.fmt.length(m)`, `.speed(m/s)` (km/h or **mi/h**; never "mph", which means crane moves per hour), `.mass(t)` (t or US tons), `.number(n, digits)`, `.movesPerHour`, `.teu`, `.clock(startIso, t)`, `.dateTime(date)`, `.firstDayOfWeek()`, `.weekdayName(d)`. Never format numbers or dates with `toFixed`/`toLocale*` in components.
- **Shortcuts** (`modules/shortcuts.ts` table → `composables/useTwinShortcuts.ts`): Space pause/resume, 1–9 = ×1…×600, 0 = pause, `.` single-step (`store.step()`, pauses), F follow selection (`store.following`; the scene loop re-aims the camera each frame), Esc closes help else deselects (stops following), D `store.dashboardOpen` (placeholder panel until TT-16), O `store.overlaysVisible` (state only, plus a toast; TT-18 overlays read it), `?` help overlay (`store.helpOpen`; also the top bar `?` button). Ignored with Ctrl/Meta/Alt, in inputs/selects/textareas/contenteditable, on key repeat (except `.`), and while the setup dialog is open. Space calls `preventDefault` so a focused button is not also clicked. The help overlay renders `SHORTCUT_HELP`, so add new shortcuts there.
- **God mode:** the shared `useGodModeHotkey` ("god" typed anywhere) is not mounted by Terminal Twin. Don't add it: its `o`/`d` keys would also toggle overlays and the dashboard.

### Dev API (`window.__tt`, dev builds only)

`dev/devApi.ts` is dynamically imported inside `if (import.meta.env.DEV)`, so production builds don't contain it (checked by `terminal-twin.prod.smoke.ts`). Every call is async-safe from `page.evaluate`:

```js
await __tt.load('tracer-1sts-10-boxes', { seed?, startDateTime?, autoplay? })  // default: fixture's own seed, paused
await __tt.runUntil({ time?, eventType?, moves?, vesselsCompleted?, maxEvents? }) // no arg = to the end; pauses
await __tt.runTo(600); await __tt.step()
await __tt.query('summary' | 'kpis' | 'containers' | 'stsList' | 'vessels' | 'invariants' | 'eventLog')
await __tt.query('container' | 'vessel' | 'sts' | 'groundPosition', id)
await __tt.inject('VesselBerthed', 120, { vessels: ['V001'] }, { vesselId: 'V001', berthX: 50 })  // new root event
await __tt.snapshot(); await __tt.why(eventId)
__tt.select(id | null); __tt.cameraTo(id); __tt.setSpeed(600); __tt.pause(); __tt.play(); await __tt.reset(); __tt.newScenario()
await __tt.query('shc' | 'wtpPad', id); await __tt.query('shcList' | 'reservations')
__tt.overlays({ laneGraph?, reservations? })   // toggles 3D overlays, returns the state
await __tt.load('shc-1sts-2shc-1wtp', { shc: { count: 3, kinematics } })  // SHC fleet override, like the setup dialog
__tt.clock()       // { displayTime, speed, paused, busy, engine: EngineInfo }
__tt.scene()       // rendered { containers, sts, shcs, vessels, overlays, reservedZones, frames,
                   //   containerLods: { lod0, lod1 }, containerAssets: 'placeholder'|'loaded' }
__tt.sceneState()  // what the scene shows: custody per box, status + pose per STS and SHC, status per vessel,
                   //   active reservations, liveries: { [containerId]: { index (atlas tile), size, lod } } as drawn
__tt.cameraTo(id, distanceM?)  // aim at an entity, optionally from a distance (60 → LOD0, 600 → LOD1)
__tt.display(); __tt.setDisplay({ locale: 'de-DE', units: 'imperial' })  // live locale/units
__tt.config()      // loaded scenario config (SI) + current display settings
__tt.ui()          // { selectedId, following, overlaysVisible, dashboardOpen, helpOpen }
```

## Horizontal transport: SHCs (TT-05)

- **Config** (all optional, so older fixtures are unchanged): `shcs: [{id}]`, `kinematics.shc` (`DEFAULT_SHC_KINEMATICS` [A]), `yard.blocks: [{id, x, wtpPads}]`, `apron` (lane geometry, `DEFAULT_APRON_LAYOUT`), `driverVariabilityPct`, `subsystems: {shc, asc}`. Builder: `.shcs(n, kin?)`, `.block(id, {x, wtpPads})`, `.driverVariability(pct)`, `.subsystems({...})`; `withShcFleet(config, n, kin?)` (setup dialog).
- **Lane graph** (`engine/laneGraph.ts`, pure, cached per config object): STS lanes run +X under each crane (entry E → ground position G → exit X) with entry/exit spines to a westbound/eastbound apron loop (crossovers at every apron X); WTP pads are spurs off the eastbound lane (`AE → C (clear position) → P (pad)` and back); one parking spur per SHC west of everything. Every edge is along X or Z. Node ids: `AW@x`, `AE@x`, `E:<sts>:<lane>`, `G:<gpId>`, `X:<sts>:<lane>`, `C:<padId>`, `P:<padId>`, `S:<shcId>`. Pads: `<blockId>-WTP<n>`, centred on the block across X, boxes along Z.
- **Conflict zones and reservations** (`engine/reservations.ts`): zones are intersections (apron and spine nodes), each ground position's lane section, and each pad with its spur. A trip reserves `[t(enter − clearance), t(leave + clearance))` for every zone visit before it starts; if any window overlaps, **the whole trip departs later** (`earliestStart`). Vehicles therefore wait only where they rest (parking spot, pad clear position), which are not zones. The STS also reserves its ground position's lane from the start of the carry until the box is down, and delays the carry if an SHC is still in the lane. Windows are half-open; zero-length (instant) windows are not stored.
- **Jobs and dispatch:** `StsGrounded` releases a job (`J<n>`) into the pool. `maybeDispatch` asks one free SHC (available first, then parked, by id) per open job/free pad not already being asked about. The `shcDispatch` decision point replies `{jobId, wtpPadId}` (or nulls → the SHC parks). Strategies: `oldest-job` (default; FIFO, first free pad) and `nearest-job` (shortest route, nearest free pad). The engine **trusts** the reply; invariants catch a double claim or a double-occupied pad.
- **Trip:** the whole job is planned at once (straight runs rest-to-rest, stop at every turn; lock/lift/lower/unlock at the box and pad) and installed as `ShcState.motion` + `ShcState.plan`. Phase events chain (`ShcJobAssigned → ShcRoutingEmpty → ShcPositioningAtPickup → ShcLocking → ShcPicked → ShcRoutingLoaded → ShcPositioningAtDropoff → ShcLowering → ShcUnlocking → ShcDroppedAtWtp → ShcCleared`), each carrying the `segments` that led up to it. "Positioning" = the final straight run into the box/pad. Custody: GP → SHC at `ShcPicked`, SHC → pad at `ShcDroppedAtWtp`. Idle SHCs: `ShcRoutingToParking → ShcParked`.
- **Waiting:** a `null` ground-position reply → `StsWaitingForGroundPosition` (status `waiting-for-ground-position`); when an SHC picks a box off that crane's lane, `StsGroundPositionWaitEnded {waitedS}` fires and the STS asks again. KPI `horizontal.stsGroundPositionWaitS`.
- **Subsystem modes** (`SimulationOptions.subsystems` overrides `config.subsystems`; resolved into `SimState.subsystems`): SHC `real` (default with SHCs + blocks) / `instant` (same events, zero durations) / `off` (no jobs; boxes stay on ground positions). ASC `instant` (default: `AscPicked` + `AscStacked` at the drop time, yard slots `<block>:I<n>`) / `off` (pads fill) / `real` → throws until TT-06.
- **KPIs:** `kpiReport().horizontal` (only with SHCs): `boxesToWtp`, per SHC `jobs`, `emptyDistanceM`, `loadedDistanceM`, `reservationWaitS`, and `stsGroundPositionWaitS`. The CLI prints a `Horizontal:` block.
- **Invariants added:** `reservation.no-overlap`, `claim.single-holder`. Double occupancy of a ground position or pad surfaces as `custody.single-owner` with "… is double-occupied: X was set down on it" (a place holds one `containerId`).
- **Browser:** the worker diffs `ShcState.motion`/`status` like the STS and sends new reservations (`Delta.reservations`). `SceneModel.shcPose(id,t)` → `{x, z, lift, heading}`; `containerPose` adds a yaw (boxes on pads/SHCs heading Z lie along Z). Overlays: `store.overlays` / `OverlayToggles.vue` (catalogue keys `overlays.*`) / `__tt.overlays()`; the O shortcut (`store.overlaysVisible`) is the master switch over them. The setup dialog edits SHC speeds in display units (km/h or mi/h, m/s² or ft/s²) and stores SI.

## Phase 2 asset pipeline

Blender (`bpy`) Python generators → raw GLB → gltf-transform (meshopt) → committed GLB + `.meta.json` sidecar + WebP previews. The web build never runs Blender, and CI checks only the committed outputs.

### Setup (once)

- Python **3.13** in a venv (the `bpy` 5.2 wheels target 3.13 only): `python3.13 -m venv .venv-bpy`, then `.venv-bpy/bin/pip install -r src/sims/terminal-twin/assets/generators/requirements.txt`. On Windows: `py -3.13 -m venv .venv-bpy`, then `.venv-bpy\Scripts\pip install -r ...`. `.venv-bpy/` is git-ignored.
- A Blender install can run the generator too (`blender --background --python src/sims/terminal-twin/assets/generators/build.py -- --out <dir>`), but then you compress the GLBs yourself. `npm run tt:assets` needs a Python that can `import bpy`.
- The Node dependencies (`@gltf-transform/*`, `meshoptimizer`) come with `npm install`.

### Regenerate (one command, also on Windows)

```
npm run tt:assets -- --python .venv-bpy/bin/python      # or set TT_BPY_PYTHON; Windows: .venv-bpy\Scripts\python.exe
npm run tt:assets -- --check --python ...               # regenerate into a temp dir and byte-compare with the commit
npm run tt:assets -- --no-previews --python ...         # fast iteration (keeps the committed previews)
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
- **Never commit** `.blend` files (git-ignored) or third-party reference photos. Record photo URLs and credits only.

### Budgets and the check

`assets/budgets.json` holds the budgets per asset kind and the library total (15 MB). Containers are used now; the STS/ASC/SHC/truck/vessel/building numbers from the spec are pre-filled for later tickets.

`npm run tt:assets:check` (`cli/assets/budgetCheck.ts`) reads only each GLB's JSON chunk. It also runs as a Vitest suite (`tests/asset-budgets.test.ts`) and as a step in `.github/workflows/pr-checks.yml`. It fails on:

- triangles or draw calls (primitives) per `LODn` subtree over budget;
- file size over `maxFileBytes`, or the library over `libraryMaxBytes`;
- a missing required rig node (`requiredNodes`), or a GLB node that the sidecar's `nodes` list does not document;
- a missing sidecar or sidecar field (`requiredMetaFields`);
- Draco/KTX2 extensions, or external buffer/image URIs.

| Asset | LOD0 | LOD1 | Draw calls (LOD0 / LOD1) | File |
|---|---|---|---|---|
| `container-20` | 308 triangles (budget 450) | 12 (budget 12) | 3 / 1 | ~134 KB |
| `container-40`, `container-40hc` | 440 triangles (budget 450) | 12 | 3 / 1 | ~136 KB |

Most of each container file is the embedded 2048² livery atlas. The renderer shares one texture between them.

### Rig and sidecar conventions (all assets)

- **Hierarchy:** the root node is the asset name, with children `LOD0` and `LOD1` (plus `LOD2` for big equipment). Movable parts are named nodes under the LOD with their **origin at the mechanical pivot**. Use the spec's names: `gantry`, `trolley`, `hoist`, `spreader`, twist-locks, `wheel_*`, `steer_*`, `boom`. Containers have `LOD0/{body, door_left, door_right}` and a `LOD1` mesh.
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
- Model origins are at the bottom, so `push()` takes the box **centre** (as `SceneModel` returns it) and subtracts half the height.
- **Yard scale** (dev viewer `?viewer=yard`, and a smoke test): 18,000 boxes come to about 264k container triangles, 6 container draw calls, and 14 draw calls per frame including the shadow pass.
  - Headless SwiftShader renders this at well under 1 fps, which says nothing about real frame rate.
  - The TT-19 frame-rate target is not defined yet. Check fps on a real GPU in the viewer's readout.

### Adding the next asset (STS, ASC, …)

1. Add `generators/tt_assets/<kind>.py`, and wire a group into `build.py` (`GROUPS`) and `cli/assets/build.ts` (`GROUPS`).
2. Follow the rig and sidecar conventions above, and tag every dimension `V`, `P`, `A` or `M`.
3. Check or tune its entry in `budgets.json` and run `npm run tt:assets`. Look at the previews and at `?viewer=<asset>`, then run `npm run tt:assets:shots`.
4. Commit the generators, GLBs, sidecars and previews (never `.blend` files or photos).

## Engine architecture

- **Discrete-event clock.** `state.queue` is a binary heap ordered by `(t, id)`. `step()` pops one event, sets `now`, runs its reactors, commits it to the log (assigning `seq`), checks invariants, then checks end conditions.
- **Event envelope:** `{ id, seq, t, type, causedBy, subjects, payload }`. `id` is assigned at scheduling and `seq` at processing. `causedBy` is set automatically to the event being processed when a reactor schedules. `ScenarioStarted` is the only root.
- **Reactors vs handlers.** Reactors (`ReactorMap`, in `engine/subsystems/*`) are the engine's own physics and flow logic. Handlers (`HandlerSet`) are TOS decisions, and they are swappable through `createSimulation(config, handlers)`. A reactor asks a handler, then acts on the reply.
- **Motion.** Each crane move is planned per axis with `planSegment`, so its end time is known when it starts. Equipment event payloads carry `segments` = the motion that led up to that event, and `StsState.motion` holds the live plan for renderers.
- **Custody.** Change it only via `ctx.transferCustody(containerId, owner)` at grip and release, and update the physical holder (slot, `sts.carrying`, ground position) in the same reactor.
- **Determinism.** Draw randomness only from `ctx.random()` (mulberry32, state in `SimState.rngState`); `Math.random` is lint-banned in `engine/`. The event-log hash is a streaming 53-bit hash of each committed event's JSON.
- **Snapshots.** These are a JSON deep copy of `{config, seed, state, log, status, …}`. `SimState` must stay plain JSON, with no Maps, classes or functions.

## Public engine API (`engine/index.ts`)

```ts
const sim = createSimulation(config, handlers?, { seed?, asyncMode?, invariants?: { enabled?, failFast? },
                                                 log?: { verbosity?: 'sts=debug,*=warn', write(record) } })
sim.step(); sim.runUntil({ time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate? })
await sim.runUntilAsync(cond?) // same, but awaits async (Promise) handlers instead of stopping
sim.asyncMode               // 'keep-running' | 'pause'
sim.snapshot(); sim.restore(snap); restoreSimulation(snap, handlers?, options?)
sim.query.container(id) / .containers() / .vessel(id) / .vesselSlot(id) / .sts(id) / .groundPosition(id)
sim.why(eventId)            // [event, parent, …, ScenarioStarted]
sim.inject(type, at, subjects, payload) // schedule an external event as an extra root (causedBy null; dev API / tests)
sim.subscribe(fn, { types? }) // returns unsubscribe
sim.eventLog(); sim.eventLogHash(); sim.kpiReport(); sim.invariantReport(); sim.status; sim.firstError
summarizeRun(sim)           // RunSummary = CLI --out and golden format
diffEventLogs(logA, logB, { context? }) // { diverged, commonEvents, seq, a, b, differences, before, afterA, afterB }
parseLogVerbosity('asc=debug,*=warn'); toLogRecord(event, verbosity)
```

## Extending

- **New event type:** add it to `EventPayloads` in `events.ts`, and add its reactor to a subsystem `ReactorMap` listed in `REACTORS` (`simulation.ts`).
- **New subsystem:** create `engine/subsystems/<name>.ts` that exports a `ReactorMap`, then add it to `REACTORS`.
- **New custody owner kind:** extend `CustodyKind` and add its holders to `custodyHolders()` in `invariants.ts`.
- **New invariant:** append it to `INVARIANTS` with a dotted id, and add a test that uses a broken handler or reactor to trigger it.
- **New fixture:** add it to `scenario/fixtures/definitions.ts`, run `npm run tt:fixtures`, import the JSON in `fixtures/index.ts`, then `UPDATE_GOLDEN=1 npm test`.
- **Logging a new event type:** nothing to do if its name starts with its subsystem (`AscMoveStarted` → `asc`, level `info`). Otherwise, or for a `debug`/`warn`/`error` level, add it to `EVENT_LOG_META` in `engine/logging.ts`.
- **New CLI strategy for diffs:** add a named handler set to `cli/handlerSets.ts` (or, for one decision point, pass `--strategy <dp>=<name>`; `tt:run` takes the same flag).
- **New decision point or strategy:** see [Decision points](#decision-points-tos-seams) below.

## Decision points (TOS seams)

Every TOS decision goes through `engine/decisions/`. A reactor never calls a handler directly: it calls `ctx.requestDecision(dp, request, { equipment: [waitingId], … })` and handles the reply in its own `DecisionResolved` reactor (narrow on `e.payload.decisionPoint`; the payload carries both `request` and `reply`).

```
ctx.requestDecision → DecisionRequested (handler called) → [DecisionFailed] → DecisionResolved → subsystem acts
```

- **Contract:** the handler gets `DecisionRequestMessage { correlationId, decisionPoint, version, t, payload }` plus a live `SimQuery`, and returns the reply or a `Promise` of it. Requests and replies are plain JSON. The correlation id is `<dp>-<n>`. Keep it message-shaped so ActiveMQ/REST adapters can be plain async handlers.
- **Selection:** `config.decisions.points.<dp>.strategy` picks a built-in strategy by name. Handlers passed to `createSimulation(config, handlers)` win over it and are labelled `custom` in events and KPIs.
- **Async mode** (`config.decisions.asyncMode` or `options.asyncMode`):
  - `keep-running` (default): other events keep processing and the waiting equipment idles.
  - `pause`: the clock cannot pass `now` while any decision is pending.
  - Built-in strategies are synchronous and resolve at the request time, so both modes give the same log.
- **Latency injector** (`points.<dp>.latency = { delay: none|fixed|uniform|exponential, timeoutPct?, errorPct? }`): the delay is in wall ms.
  - In keep-running the reply is scheduled `delay/1000 × simSecondsPerWallSecond` sim seconds later (default scale 1).
  - In pause no sim time passes, and the log equals the no-latency run.
  - Draws use a separate RNG stream (`state.decisions.rngState`), so the main RNG is untouched.
- **Timeouts and errors (fallback):**
  - Triggers: an injected timeout, a delay of at least `timeoutMs` (default 5000), an injected error, a handler that throws, a rejected Promise, or an async reply slower than `timeoutMs` wall time.
  - What happens: `DecisionFailed { failure: 'timeout'|'error', message, fallback }` at the failure time, then `fallbackStrategy` (default: the decision point's default strategy) answers with `DecisionResolved { outcome: 'fallback' }`.
  - Late async replies are discarded and counted (`lateReplies`).
- **Async (Promise) handlers:**
  - `runUntil` returns `waiting-for-decision` when it cannot proceed, and `runUntilAsync` awaits the reply.
  - A settled reply is applied at the sim time the engine has reached when it next runs (`drain`). With `runUntil({ time })` in keep-running mode, the clock advances past an in-flight reply, which is how a paced host such as the worker shows TOS latency.
  - A snapshot keeps pending decisions, and restore re-sends the in-flight async requests.
- **KPIs:** `kpiReport().handlers[dp]` holds calls, ok/fallbacks/timeouts/errors/lateReplies, pending/maxPending (backlog), sim latency and wall latency (mean/max; sync handlers count as 0 wall ms), and `equipmentIdleS` (sim latency × waiting equipment). The CLI prints them under `TOS handlers:`.

**Add a strategy:** add a named entry to `strategies.<dp>.strategies` in `decisions/strategies.ts`. Keep at most 3 per decision point. A strategy must be synchronous and pure, with no `Math.random`. Then add a test that selects it via `config.decisions.points.<dp>.strategy`.

**Add a decision point:**
1. `decisions/types.ts`: add its request to `DecisionRequests`, its reply to `DecisionReplies`, and its version to `DECISION_CONTRACT_VERSIONS`. Bump the version whenever the shape changes.
2. `decisions/strategies.ts`: register 1–3 strategies and a `default`, and add it to `defaultHandlers`.
3. In the asking reactor, call `ctx.requestDecision(dp, request, { equipment: [...] })`, set the equipment to a waiting status, and act on the reply in the subsystem's `DecisionResolved` reactor.
4. Test it in `tests/decisions.test.ts` style: strategy selection, a scripted handler, and a latency case. Then `UPDATE_GOLDEN=1 npm test` if fixtures use it.

## Known behaviours and pitfalls

- The tracer fixture gives STS01 **10 ground positions** and has no SHCs (its golden is unchanged by TT-05). `shc-1sts-2shc-1wtp` (3 ground positions, 2 SHCs, block B01 with 4 pads west of the crane) ends at `simDurationS 1800`, after every box is in the yard.
- SHC trips are planned whole at dispatch; a later conflict never re-plans a trip, it only delays the next trip's departure. A vehicle waiting at a pad clear position holds no reservation, so another SHC approaching that same pad can pass through it visually (rare; dispatch is instant).
- Ground positions sit at the STS's **home** gantry X in the lane graph; an SHC positions at the box's actual X, clamped to the lane section (`stsLaneHalfSpanM`, default 30 m).
- `kpis.handlers` omits decision points that were never called (so fixtures without SHCs keep their goldens).
- Shortest paths are cached per lane graph (WeakMap on the config object) and the lane graph per config object: do not mutate a config after `createSimulation`.
- Every decision adds two events (`DecisionRequested`, `DecisionResolved`) to the log. The tracer golden went from 35 to 55 events in TT-03, with KPIs unchanged.
- An injected delay of at least `timeoutMs` (default 5 s) is a timeout. Raise `timeoutMs` when you inject long latencies.
- A reply computed at request time is delivered later in keep-running mode, so it can be stale. That is realistic: a reply with an invalid ground position surfaces as an invariant violation.
- If the ground-position handler returns `null`, the STS raises `StsWaitingForGroundPosition` and idles for good. Nothing wakes it yet.
- Invariants are checked over the whole state after every event (O(state)), which is fine at tracer scale. Revisit before the TTI preset (TT-19).
- Snapshots embed the full event log. `--from-snapshot` runs write only the window's events/log lines, but KPIs and the event-log hash in the summary are cumulative from t = 0.
- `--until time:T` leaves `now = T`, so a snapshot taken there resumes at exactly `T`; events at `t ≤ T` are in the snapshot, the window holds `t > T`.
- Handlers are not in snapshots: pass the same `--handlers` when resuming a window.
- Logs are derived from committed events only; there is no free-text reactor logging yet.
- Browser: `runUntil({ time })` leaves `now = time`, so the engine horizon is exact. Playback in time slices gives the same hash as one run (`tests/live-driving.test.ts`).
- Browser: injected events are extra roots, so `why` on them (or their descendants) ends at the injected event, not at `ScenarioStarted`.
- Browser: deltas in a flat-out run are compacted per entity. Large Run to… jumps at TTI scale may still need a smarter "final state only" message (TT-19).
- Smoke tests: `playwright.config.ts` starts a Vite dev server (port 5199) and builds plus previews production (`.smoke-dist/`, port 5198) every run. Chromium falls back to `/opt/pw-browsers/chromium` like `npm run screenshot`.
- Locale: `<input type="datetime-local">` (setup start, Run to…) is rendered by the browser in the *browser's* locale, not the chosen one; the clock, preview and readouts follow the chosen locale.
- Shortcut `.` while playing pauses and steps the engine's next event, which is beyond the look-ahead, so the display jumps forward slightly. Pause first (Space/0) to step event by event.
- The `ScenarioEnded` and `InvariantViolated` events are committed directly. They are not queued and are not invariant-checked.
- Assets: run the generators only through `npm run tt:assets`; it replaces `assets/models/<group>/` wholesale, so hand edits to a committed GLB or sidecar are lost.
- Assets: the viewer and the twin share one cached `loadContainerAssets()` promise; never dispose its materials or textures from a renderer.
- Assets: container shadows need `shadow.normalBias` (0.35 in the twin) or the corrugation shows shadow acne.
- Fixture `liveries-mixed` (12 boxes, 10 lines, all three sizes) exists for the livery smoke test.

# Terminal Twin — Agent Guide

## Overview

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root — use its terms in code, tests and docs.

**Status:** headless engine tracer (TT-01), the decision-point framework (TT-03) and headless debug tooling — structured logs, run diff, snapshot time windows, golden updates (TT-04). It also has the browser tracer (TT-02): a home card, a setup dialog shell, the engine in a Web Worker, a procedural 3D quay with time controls, and the dev-only `window.__tt` API. TT-20 added locale and units, the message catalogue and keyboard shortcuts. Phase 2 has started with the asset pipeline and container models (TT-22): Blender-generated GLBs with LODs and a livery atlas, instanced in the 3D view, plus a dev asset viewer and an asset budget check in CI. See [Phase 2 asset pipeline](#phase-2-asset-pipeline). TT-09 added real vessel calls: five size classes, generated bay plans, a continuous quay with berth allocation and anchorage, STS cranes on one rail with a crane split, twin-20 lifts, and the setup dialog's vessel table and generator. TT-05 adds SHC horizontal transport (STS ground position → WTP pad) over a generated lane graph with conflict-zone reservations, the `shcDispatch` decision point, an instant ASC stub, subsystem modes, SHC setup fields and 3D lane/reservation overlays. TT-06 replaces the stub with real block storage: yard blocks (8 rows, configurable bays/tiers), one ASC per block with gantry/trolley/hoist motion, the `yardAllocation` decision point, stack and ASC/SHC handover invariants, yard setup fields and 3D blocks, ASCs and stacked boxes. See [ASC block storage](#asc-block-storage-tt-06). TT-25 replaced the procedural shuttle carrier with a rigged Kalmar-style GLB model (see [SHC model](#shc-model-tt-25)). TT-08 adds a second ASC per block on a shared rail with no-passing reservations and the `ascDispatch` decision point. See [Paired ASCs](#paired-ascs-tt-08). TT-07 added the KPI collector (hourly and per-shift series), end conditions, the KPI strip, the final report and JSON/CSV export (see [KPIs, end conditions and final report](#kpis-end-conditions-and-final-report-tt-07)). TT-24 replaced the procedural stacking crane with a rigged ZPMC-style ASC GLB (see [ASC model](#asc-model-tt-24)).

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
| Debugger and inspector (breakpoints, step, cause chain, picking, follow, overlays) | `npx vitest run src/sims/terminal-twin/tests/{breakpoints,debugger-host,debugger-controller,event-feed,event-inspector,entity-inspector,picking}.test.ts` + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-debugger.smoke.ts` | Vitest proves the logic through the worker host and an in-process controller; the smoke spec clicks, steps, pauses at breakpoints and checks the overlays against `sceneState()` |
| Debugger in 3D | `npm run screenshot -- --path /sim/terminal-twin --wait 2500 --fail-on-error --eval "window.__tt.load('shc-1sts-2shc-1wtp').then(async () => { await window.__tt.addBreakpoint('eventType','ShcDroppedAtWtp'); await window.__tt.runTo(1e5); window.__tt.overlays({occupancy:true,labels:true}); window.__tt.select('SHC01'); window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'})) })"` | feed on the left with the breakpoint hit highlighted, inspector on the right (event, payload, cause chain), labels and pad plates in the scene |
| KPIs, end conditions, report, export | `npm run tt:run -- --fixture asc-1sts-10-boxes-1block --end moves:5 --kpi-csv /tmp/k.csv --kpi-json /tmp/k.json` + `npx vitest run src/sims/terminal-twin/tests/{kpi-*,end-*,cli-kpi}.test.ts` + `npx playwright test terminal-twin-kpi` | `Headline KPIs:` block, `Stopped: ended (moves >= 5)`; files parse; smoke shows the strip, the report and downloads |
| Dashboard (charts, heatmap, Gantt, lazy ECharts) | `npx vitest run src/sims/terminal-twin/tests/dashboard` + `npx playwright test dashboard` (dev and prod projects) | Vitest: timeline, palette, view models, options, host query, lazy-import scan; smoke: ECharts chunk absent until D, 24 h series zoom, heatmap = engine fill, Gantt windows = vessel state, final report tab |
| Fixture definition change | `npm run tt:fixtures`, then `npm run tt:golden -- --update` | committed fixture JSON matches `definitions.ts` |
| Berthing / anchorage | `npm run tt:run -- --fixture two-vessels-compete-for-berth` | V002 `anchorage` > 0 s, `Quay: 1 vessel(s) waited`; `tests/berthing.test.ts` |
| Crane split / rail order | `npm run tt:run -- --fixture crane-split-4sts --strategy craneSplit=equal-bays` (vs the default `balanced-moves`) | 4 STS lines with different move counts, 0 violations (`sts.rail-order` is checked after every event); `tests/crane-split.test.ts` |
| Twin-20 | `npm run tt:run -- --fixture twin-20-lift` | `4 moves in 2 cycles (2 twin-20)`; `tests/vessels.test.ts` |
| Vessels in 3D | `npm run screenshot -- --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('crane-split-4sts').then(() => window.__tt.runTo(1500)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001'))"` | hull at its berth, four STS along it, deck boxes on the hatch covers |
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
│   ├── subsystems/berth.ts   Vessel calls: arrival, berth allocation, anchorage, mooring, crane split, departure
│   ├── subsystems/quay.ts    STS discharge cycle (gantry to bay, deck before hold, twin-20) + work order;
│   │                         ground-position wait/resume; lane reservation while setting down (with SHCs)
│   ├── subsystems/rail.ts    Shared STS rail: reservations, waiting for the rail, free cranes stepping aside
│   ├── subsystems/shc.ts     SHC jobs, pull dispatch, whole-trip planning, parking (TT-05)
│   ├── subsystems/asc.ts     ASC block storage: allocation on pad drop, job pick order, whole-cycle planning, pad reservation (TT-06)
│   ├── subsystems/ascRail.ts Shared ASC rail of twin blocks: occupancy pieces, rail-segment windows, park holds, step-aside target (TT-08)
│   ├── yardLayout.ts         Block geometry, slot ids (`B01:03-5-2`), `candidateSlots` (pure)
│   ├── laneGraph.ts          Waterside one-way lane graph from config + shortest paths (cached per config)
│   ├── reservations.ts       Conflict-zone time-window reservations (earliestStart / reserve)
│   ├── handlers.ts           HandlerSet re-exports (TOS seams)
│   ├── decisions/            Decision-point framework
│   │   ├── types.ts          Request/reply catalogue, contract versions, HandlerSet, DecisionsConfig
│   │   ├── strategies.ts     Built-in strategy registry (1–3 per decision point) + defaultHandlers
│   │   ├── yardStrategies.ts Yard allocation (random, nearest-wtp, group-by-vessel)
│   │   ├── quayStrategies.ts Berth allocation (first-fit, best-fit), crane split (balanced-moves, equal-bays)
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
│   ├── lines.ts              Shipping lines: owner prefixes, default weights, default cargo mix
│   ├── vesselClasses.ts      VESSEL_CLASSES (Feeder → ULCV) + bay-plan geometry (slotX/Z, tierBaseY, slot ids)
│   ├── bayPlan.ts            planCargo(config, seed): slots + discharge boxes (engine AND scene model call it)
│   ├── vesselGenerator.ts    generateVessels(...): "Generate N vessels"
│   ├── overrides.ts          Setup-dialog edits (quay length, STS count, vessel table) + validation
│   ├── presets.ts            Preset registry (empty until TT-15)
│   └── fixtures/             definitions.ts → <name>.json (+ <name>.golden.json), index.ts
├── i18n/                     UI text and display formatting (no Vue)
│   ├── messages.ts           Message catalogue (`t(key, params)`); ALL user-visible component strings
│   ├── format.ts             createFormatter({locale, units}): clock, numbers, length/speed/mass, week start (Intl)
│   └── display.ts            Browser defaults, remembered choice (localStorage), runConfigFor (config + display, SI)
├── definition.ts             Home card (keep light: eagerly imported)
├── TerminalTwin.vue          Root: TopBar, 3D host, SetupDialog, banner; installs window.__tt in DEV
├── components/               TopBar.vue (clock, speeds, Step, Run to…, Reset, New Scenario, ?), OverlayToggles.vue,
│                             debug/EventFeedPanel.vue (left: step/continue, breakpoints, filterable feed),
│                             debug/InspectorPanel.vue (right: event inspector + selection inspector),
│                             modals/SetupDialog.vue (scenario, seed, start, display, quay, STS, vessels, SHC fleet),
│                             modals/ShortcutHelp.vue, setup/VesselTable.vue (vessel table + "Generate N vessels")
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
│   ├── breakpoints.ts        Breakpoint kinds + eventMatchesBreakpoint (also used inside the worker)
│   ├── eventFeed.ts          Feed rows: filter, display-time cut-off, burst summaries, caps
│   ├── eventInspector.ts     describeEvent: payload, subject links, decision request/reply
│   ├── entityInspector.ts    describeEntity: state, current job, custody history of a container/STS/SHC/ASC/vessel
│   ├── picking.ts            entityBounds + pickEntity (ray vs oriented boxes; also the selection outline)
│   ├── overlays.ts           OverlayState (laneGraph, reservations, occupancy, labels) + NO_OVERLAYS
│   ├── overlayLayers.ts      Three.js occupancy plates and state labels (read the SceneModel at display time)
│   ├── equipmentDims.ts      STS / SHC proportions shared by the renderer and picking
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
│   ├── generators/           Python (bpy) generators: build.py, tt_assets/*.py (containers, liveries, parts, shc, shc_meta, asc, asc_meta), fonts/ (OFL), requirements.txt
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
- **Shortcuts** (`modules/shortcuts.ts` table → `composables/useTwinShortcuts.ts`): Space pause/resume, 1–9 = ×1…×600, 0 = pause, `.` single-step (`store.step()`, pauses), F follow selection (`store.following`; the scene loop re-aims the camera each frame), Esc closes help else deselects (stops following), D `store.toggleDashboard()` (the dashboard tab, TT-16), O `store.overlaysVisible` (master switch of the TT-18 overlays, plus a toast), E / I toggle the event feed and inspector panels (TT-18), `?` help overlay (`store.helpOpen`; also the top bar `?` button). Ignored with Ctrl/Meta/Alt, in inputs/selects/textareas/contenteditable, on key repeat (except `.`), and while the setup dialog is open. Space calls `preventDefault` so a focused button is not also clicked. The help overlay renders `SHORTCUT_HELP`, so add new shortcuts there.
- **God mode:** the shared `useGodModeHotkey` ("god" typed anywhere) is not mounted by Terminal Twin. Don't add it: its `o`/`d` keys would also toggle overlays and the dashboard.

### Dev API (`window.__tt`, dev builds only)

`dev/devApi.ts` is dynamically imported inside `if (import.meta.env.DEV)`, so production builds don't contain it (checked by `terminal-twin.prod.smoke.ts`). Every call is async-safe from `page.evaluate`:

```js
await __tt.load('tracer-1sts-10-boxes', { seed?, startDateTime?, autoplay?, overrides? })  // default: fixture's own seed, paused
await __tt.runUntil({ time?, eventType?, moves?, vesselsCompleted?, maxEvents? }) // no arg = to the end; pauses
await __tt.runTo(600); await __tt.step()
await __tt.query('summary' | 'kpis' | 'containers' | 'stsList' | 'vessels' | 'vesselSlots' | 'invariants' | 'eventLog')
await __tt.query('container' | 'vessel' | 'sts' | 'groundPosition', id)
await __tt.inject('VesselBerthed', 120, { vessels: ['V001'] }, { vesselId: 'V001', berthX: 50 })  // new root event
await __tt.snapshot(); await __tt.why(eventId)
__tt.select(id | null); __tt.cameraTo(id); __tt.setSpeed(600); __tt.pause(); __tt.play(); await __tt.reset(); __tt.newScenario()
await __tt.query('shc' | 'wtpPad', id); await __tt.query('shcList' | 'reservations')
__tt.overlays({ laneGraph?, reservations?, occupancy?, labels? })   // toggles 3D overlays, returns the state
await __tt.load('shc-1sts-2shc-1wtp', { shc: { count: 3, kinematics } })  // SHC fleet override, like the setup dialog
__tt.clock()       // { displayTime, speed, paused, busy, engine: EngineInfo }
__tt.scene()       // rendered { containers, sts, shcs, vessels, overlays, reservedZones, frames,
                   //   containerLods: { lod0, lod1 }, containerAssets: 'placeholder'|'loaded',
                   //   shcLods: { lod0, lod1, lod2 }, shcAssets: 'placeholder'|'loaded',
                   //   ascLods: { lod0, lod1, lod2 }, ascAssets: 'placeholder'|'loaded' }
__tt.sceneState()  // what the scene shows: custody per box, status + pose per STS and SHC, status per vessel,
                   //   active reservations, liveries: { [containerId]: { index (atlas tile), size, lod } } as drawn,
                   //   shcRigs: { [shcId]: { lod, steerRad, wheelRollRad, hoistM, carrying } } as drawn,
                   //   ascRigs: { [ascId]: { lod, gantryZ, trolleyX, hoistM, ropeScale, scaleY, carrying } } as drawn
__tt.cameraTo(id, distanceM?)  // aim at an entity, optionally from a distance (60 → LOD0, 600 → LOD1)
__tt.display(); __tt.setDisplay({ locale: 'de-DE', units: 'imperial' })  // live locale/units
__tt.config()      // loaded scenario config (SI) + current display settings
__tt.ui()          // { selectedId, following, overlaysVisible, dashboardOpen, helpOpen, feedOpen, inspectorOpen }
__tt.dashboard()   // { open, tab, group, bucketing, rendered } (TT-16); await __tt.openDashboard({ tab, group, bucketing })
await __tt.addBreakpoint('eventType' | 'container' | 'equipment' | 'decision', value); await __tt.removeBreakpoint(id); await __tt.clearBreakpoints(); __tt.breakpoints()
await __tt.inspectEvent(eventId)   // opens the inspector on the event and its cause chain
__tt.debug()       // { breakHit, paused, inspectedEvent: { id, type, chain: [{id, type, causedBy}] }, entity: { kind, id, status } }
__tt.screenPoint(id); __tt.pickAt(clientX, clientY); __tt.cameraTarget()   // 3D picking and the follow camera, client coordinates
```

## Debugger and inspection UI (TT-18)

- **Panels.** `E` toggles the left panel (`EventFeedPanel`: Step, Continue, breakpoints, filter, event feed), `I` the right panel (`InspectorPanel`). Both start collapsed. Clicking something, or a breakpoint hit, opens the inspector. They overlay the 3D view (the canvas is not resized). The top bar has a Step button as well as `.`.
- **Breakpoints** (`modules/breakpoints.ts`): on an event type, a container id, an equipment id or a decision point (matches `DecisionRequested/Resolved/Failed` of that point). The list lives in the store and is sent to the worker (`setBreakpoints`), which keeps it across load/reset. `eventMatchesBreakpoint` is the stop `predicate` of every `advance`/`run`/`step`, so the engine stops right after the matching event and `Delta.breakpoint` names it. The controller keeps it as `pendingBreak` until the display reaches that event (look-ahead), then pauses with `breakHit` set, and the store opens the inspector on it. `play()`, a speed button, Run to… and step clear `breakHit`. A breakpoint added while the engine is already ahead of the display (look-ahead, at most `max(5 s, 1.5 s × speed)`) only catches events that have not been processed yet.
- **Single-step** is one engine event per press at any speed (it pauses). The inspector shows the stepped event. With the engine ahead of the display after a pause, the display jumps to that event's time (see the pitfalls).
- **Event feed** (`modules/eventFeed.ts`): the store keeps the last `FEED_BUFFER_CAP` (1000) summarised events; the panel rebuilds its rows every `FEED_REFRESH_MS` (250 ms, never per frame), shows only events up to the display time, newest first, at most `FEED_MAX_ROWS` (150). From ×60 (`FEED_SUMMARY_MIN_SPEED`) while playing, runs of three or more events of one type collapse into a "N × Type" row. The filter takes space-separated terms that must all occur in the event type or a subject id.
- **Event inspector** (`modules/eventInspector.ts`): payload (motion segments summarised), clickable subjects, and for decision events the handler, outcome, request and reply. The cause chain comes from the engine's `why` through the worker (`op: 'why'`), newest first and ending at the root `ScenarioStarted` (or an injected root); clicking an entry shows that event while keeping the chain.
- **Selection** (`modules/picking.ts`): `entityBounds(model, id, t)` gives each container, SHC, ASC, STS and vessel an oriented box (also the selection outline). `pickEntity` returns the nearest container the ray hits, else the nearest equipment or vessel (their boxes enclose their boxes). A click (under 5 px and 600 ms) selects; a click on nothing deselects; dragging orbits as before. `store.select(id)` opens the inspector and `refreshEntity()` queries the engine (`container`, `sts`, `shc` + `shcJobs`, `asc`, `vessel`); the inspector refreshes twice a second. It shows the engine's state (which may be slightly ahead of the display while playing); the container custody history is the engine's full history. For equipment and vessels, "history" is the recent events that name the id (from the feed buffer).
- **Follow camera.** The Follow button in the inspector or `F`. The scene loop re-aims the orbit target at the selection every frame, keeping the viewing offset.
- **Overlays** (`modules/overlays.ts`, `OverlayToggles.vue`): `laneGraph`, `reservations`, `occupancy`, `labels`, independent of each other; `O` is the master switch. Occupancy tints WTP pads free/occupied and marks boxes standing on STS ground positions; labels float above each STS, SHC, ASC and berthed or anchored vessel with its status. Both read the `SceneModel` at the display time (`OverlayLayers`), and `scene().layers` reports the counts for tests. An overlay for the ASC reserved rail segments is not built: the ASCs (TT-06) do not reserve rail segments yet, so add it with the ticket that introduces them.

## KPIs, end conditions and final report (TT-07)

- **Collector** (`engine/kpi/collector.ts`, `clock.ts`, `headline.ts`; `engine/export.ts`). `Simulation.kpiSeries()` returns every KPI as hourly, per-shift and whole-run series (`KpiSeriesReport {clock, elapsedS, hours, shifts, series[id].entities[entity] = {hourly[], shifts[], total}}`; null = no data). The collector is a pure fold over the committed events (`commit()` feeds it); a snapshot restore rebuilds it by replaying the log, so it is never stored and does not touch the event-log hash or the goldens. It stores per-hour **components** (counts, seconds in a state, metres, gauges) and each KPI is a function of the summed components of a window, so shift and run values are exact (never averages of averages). Open states (a crane waiting, an ASC mid-cycle) are closed at `now` on a copy when a report is built.
- **Buckets.** Hours are cut on the scenario clock (a 06:30 start gives a half-hour first bucket); shifts are 3 x 8 h of whole hours (default 06-14, 14-22, 22-06; night shift belongs to the day it starts). The clock comes from `config.kpi {startTimeOfDayS?, shiftStartHour?}`; default is `startDateTime` read in UTC (machine independent). The browser's `runConfigFor` sets `startTimeOfDayS` from the local start time so shifts match the clock on screen.
- **KPIs** (`KPI_DEFS`, add rows there plus an `observe` case for new events): quay `sts.moves`, `sts.gross-moves-per-hour` (moves per hour on a vessel, i.e. not waiting for work), `sts.net-moves-per-hour` (also minus waiting for SHC and for the rail), `sts.wait-shc-s`, `sts.wait-work-s`, `sts.wait-rail-s`, `berth.moves-per-hour`, `vessel.remaining-moves` (gauge); horizontal (only with SHCs) `shc.loaded-pct|empty-pct|idle-pct`, `shc.empty-travel-ratio`, `shc.empty|loaded-distance-m`, `shc.jobs`, `shc.cycle-time-s`, `wtp.dwell-s` (per block, drop to ASC pick); yard (only with blocks) `asc.utilisation-pct`, `asc.jobs`, `asc.cycle-time-s`, `yard.fill-pct` (gauge per block, from `AscStacked`; TT-10/13 retrieval must lower it); TOS handlers `handler.calls|mean-latency-s|fallbacks|failures|backlog` per decision point. Cross-checks against the engine counters are in `tests/kpi-collector.test.ts`.
- **Headline and highlights** (`headlineKpis`, `highlightsOf`): the strip and CLI numbers; highlights = hardest-working crane, busiest block, busiest SHC and the longest wait (anchorage, SHC or rail). Both are pure functions of the series and `kpiReport()`, so the CLI, worker and UI agree (`tests/kpi-host.test.ts`).
- **End conditions**: `config.endConditions {vesselsCompleted?, simDurationS?, moves?}`; none set means all scheduled vessels; the first one met ends the run (`tests/end-conditions.test.ts`). The setup dialog's "End conditions" fieldset (`modules/endConditions.ts`) only replaces the scenario's own once edited; vessels blank means all scheduled. CLI: `--end moves:<n> | vessels:<n> | time:<s>` (repeatable).
- **Final report** (`components/FinalReport.vue`): a docked panel (not a modal) that appears when the display reaches the end (`store.runEnded`). It shows the reason (`modules/endReason.ts`), highlights (`modules/highlights.ts`), headline KPIs, cranes and vessels tables and the export buttons; it can be closed and reopened. After the end the clock is frozen: speed buttons, pause, Run to, Step and their shortcuts are disabled (store actions are no-ops); Reset and New Scenario work; the scene, selection, inspector and feed stay usable.
- **KPI strip** (`components/KpiStrip.vue`, logic in `modules/kpiStrip.ts`): top-left over the 3D view, count-up (ease-out 600 ms, skipped with reduced motion) and a pulse when a value crosses its threshold (`crossedThreshold`; thresholds are [A] illustrative). The store polls `kpiHeadline` once a second when the event count changed and after reset/run-to/step, so the strip shows the engine's state, which runs up to the look-ahead ahead of the display while playing (equal when paused).
- **Export** (`engine/export.ts`): `kpiReportJson` (summary, series, headline, highlights), `kpiReportCsv` (long form: kpi, unit, entityKind, entity, bucket hour|shift|total, index, startS, endS, value), `eventLogJson`, `eventLogCsv` (payload and subjects as JSON cells). UI: report buttons download via the worker `export` request. CLI: `--kpi-json --kpi-csv --events-json --events-csv`.
- **Worker/dev API**: queries `kpiSeries`, `kpiHeadline`, request `export`; `__tt.exportRun(kind)`, `__tt.report()`, `load(name, {endConditions})`, `ui().reportOpen`. Smoke: `tests/browser/terminal-twin-kpi.smoke.ts`.

## Dashboard (TT-16)

- **What:** the full-screen tab (`D`, or the top-bar Dashboard button; `store.dashboardOpen`) in `components/DashboardTab.vue`. Tabs: **Charts** (KPI group selector Quay / Horizontal transport / Yard / Landside / TOS handlers, an hours or shifts toggle) and **Final report** (the TT-07 `FinalReport.vue` rendered with the `embedded` prop). When the run ends the dashboard opens itself on the report tab, once per run (`refreshKpis`); closing it docks the report panel over the 3D view as before. Reset and New Scenario close the dashboard. Landside has no KPIs yet, so its tab only appears when a series exists.
- **Lazy loading:** `TerminalTwin.vue` loads `DashboardTab` with `defineAsyncComponent`, and the component loads `modules/chartLib.ts` (the only runtime importer of `echarts`, tree-shaken: line, heatmap and custom charts, grid/legend/tooltip/dataZoom/visualMap/aria, canvas renderer) with a dynamic `import()` when it mounts. Never import `echarts` or `chartLib` statically anywhere else (`tests/dashboard-lazy.test.ts` scans the sources; `terminal-twin.prod.smoke` / `terminal-twin-dashboard.prod.smoke.ts` checks the built output, where `chartLib-*.js` is its own chunk fetched on first open).
- **Data:** the worker query `dashboard` returns `DashboardData {series: KpiSeriesReport, timeline: TimelineReport, yard: {id, fillPct}[]}` in one round trip. The store keeps it in `dashboardData` and refetches (the KPI poll timer, once a second) while the dashboard is open and the event count changed. `dashboardGroup`, `dashboardBucketing`, `dashboardTab` are store state; `dashboardRendered` is what the component has drawn (for `__tt.dashboard()`).
- **Pure layers (test through these):** `engine/kpi/timeline.ts` `buildTimeline(events, now)` (Gantt rows from the event log: anchorage, mooring, work, unmooring per vessel and one work package per crane-split assignment, closed at `now` while open; exported from `engine/index.ts`); `modules/dashboardModel.ts` (`KPI_GROUPS`, `groupsWithData`, `buildGroupCharts`, `downsampleEvery`, `buildYardHeatmap`, `blockFillPct`); `modules/dashboardOptions.ts` (ECharts option builders, `import type` only from echarts, formatting passed in as `ChartFormat` from `store.fmt`); `modules/dashboardPalette.ts`.
- **Charts:** one line per entity (at most 8, the palette size, the rest counted as "N more not shown"); `sampling: 'lttb'`, `downsampleEvery` caps points at `POINT_BUDGET`; inside + slider data zoom; every chart has an HTML "Table view" of whole-run totals. The yard heatmap is block x hour (`yard.fill-pct` hourly, one-hue blue ramp, 0 to 100 %) with a "now" fill per block from the engine's stacked boxes. The Gantt is a custom series (one series per phase); an HTML legend carries the phase names and textures.
- **Palette and accessibility:** `SERIES_COLOURS` are the dataviz skill's dark-surface categorical steps, validated with `validate_palette.js --mode dark` on `#1a1a19` (all checks pass: worst adjacent CVD dE 8.4, normal-vision 19.3, contrast >= 3:1). Do not reorder or recolour them without re-running the validator; the Gantt phases use the first five slots in order (validated as a set). State is never colour alone: every line slot also has its own marker symbol and dash (`SERIES_SYMBOLS`, `SERIES_DASHES`), a legend is always present, Gantt phases carry a texture as well as a colour, and the heatmap cells print their value. Charts are `role="img"` with `aria-label`; the aria option is on.
- **Catalogue:** all text is `dashboard.*` keys; each KPI title is `dashboard.kpi.<kpi id>` (`kpiLabelKey`). Adding a KPI to `KPI_DEFS` fails `tests/dashboard-model.test.ts` until it is in a group in `KPI_GROUPS` and has a title.
- **Dev API:** `await __tt.openDashboard({tab?, group?, bucketing?})` and `__tt.dashboard()`; `rendered` = `{chartLibLoaded, charts[{kpiId, lines, points, zoom, drawn}], heatmap{blocks, hours, values, liveFill}, gantt{rows, bars}}`.
- **Smoke:** `tests/browser/terminal-twin-dashboard.smoke.ts` (lazy chunk, 24 h run + wheel zoom, heatmap vs `yardBlocks`/`yardSlots`, Gantt vs `vessels`, report tab) and `terminal-twin-dashboard.prod.smoke.ts`.

## Horizontal transport: SHCs (TT-05)

- **Config** (all optional, so older fixtures are unchanged): `shcs: [{id}]`, `kinematics.shc` (`DEFAULT_SHC_KINEMATICS` [A]), `yard.blocks: [{id, x, wtpPads}]`, `apron` (lane geometry, `DEFAULT_APRON_LAYOUT`), `driverVariabilityPct`, `subsystems: {shc, asc}`. Builder: `.shcs(n, kin?)`, `.block(id, {x, wtpPads})`, `.driverVariability(pct)`, `.subsystems({...})`; `withShcFleet(config, n, kin?)` (setup dialog).
- **Lane graph** (`engine/laneGraph.ts`, pure, cached per config object): one continuous one-way (+X) STS lane per ground-position lane along the whole quay; **stations** every `stationSpacingM` (25 m) with a down spine (westbound apron → lanes, nodes `D<k>:<lane>`) and, 5 m further, an up spine (lanes → westbound apron, `U<k>:<lane>`); a westbound/eastbound apron loop (`AW@x`, `AE@x`, crossovers at every apron X); WTP pads as spurs off the eastbound lane (`AE → C:<padId> (clear position) → P:<padId>` and back); one parking spur per SHC (`S:<shcId>`) west of everything. Every edge is along X or Z. `laneAccess(graph, lane, x)` gives the lane walk for a box at x; `laneZonesAt` the zones a set-down covers. Pads: `<blockId>-WTP<n>`, centred on the block, boxes along Z.
- **Conflict zones and reservations** (`engine/reservations.ts`): zones are intersections (apron and lane/spine nodes), each STS lane section between two lane nodes (`L<lane>@<x>`), and each pad with its spur. A trip reserves `[t(enter − clearance), t(leave + clearance))` for every zone visit before it starts; if any window overlaps, **the whole trip departs later** (`earliestStart`). Vehicles therefore wait only where they rest (parking spot, pad clear position), which are not zones. With SHCs, the STS also reserves the lane sections under the box from the start of the carry until the box is down, and delays the carry if an SHC is still there. Windows are half-open; zero-length (instant) windows are not stored.
- **Jobs and dispatch:** `StsGrounded` releases a job (`J<n>`) into the pool. `maybeDispatch` asks one free SHC (available first, then parked, by id) per open job/free pad not already being asked about. The `shcDispatch` decision point replies `{jobId, wtpPadId}` (or nulls → the SHC parks). Strategies: `oldest-job` (default; FIFO, first free pad) and `nearest-job` (shortest route, nearest free pad). The engine **trusts** the reply; invariants catch a double claim or a double-occupied pad.
- **Trip:** the whole job is planned at once (straight runs rest-to-rest, stop at every turn; lock/lift/lower/unlock at the box and pad) and installed as `ShcState.motion` + `ShcState.plan`. Phase events chain (`ShcJobAssigned → ShcRoutingEmpty → ShcPositioningAtPickup → ShcLocking → ShcPicked → ShcRoutingLoaded → ShcPositioningAtDropoff → ShcLowering → ShcUnlocking → ShcDroppedAtWtp → ShcCleared`), each carrying the `segments` that led up to it. "Positioning" = the final straight run into the box/pad. Custody: GP → SHC at `ShcPicked`, SHC → pad at `ShcDroppedAtWtp`. Idle SHCs: `ShcRoutingToParking → ShcParked`.
- **Waiting:** a `null` ground-position reply → `StsWaitingForGroundPosition` (status `waiting-for-ground-position`); when an SHC picks a box off that crane's lane, `StsGroundPositionWaitEnded {waitedS}` fires and the STS asks again. KPI `horizontal.stsGroundPositionWaitS`.
- **Subsystem modes** (`SimulationOptions.subsystems` overrides `config.subsystems`; resolved into `SimState.subsystems`): SHC `real` (default with SHCs + blocks) / `instant` (same events, zero durations) / `off` (no jobs; boxes stay on ground positions). ASC `real` (default with SHCs + blocks) / `instant` (same events and the same `yardAllocation` decision, zero durations; the ASC still waits for `ShcCleared`) / `off` (no ASC: pads fill up). Fixture `shc-1sts-2shc-1wtp` pins ASC `instant` so it tests SHC transport on its own.
- **KPIs:** `kpiReport().horizontal` (only with SHCs): `boxesToWtp`, per SHC `jobs`, `emptyDistanceM`, `loadedDistanceM`, `reservationWaitS`, and `stsGroundPositionWaitS`. The CLI prints a `Horizontal:` block.
- **Invariants added:** `reservation.no-overlap`, `claim.single-holder`. Double occupancy of a ground position or pad surfaces as `custody.single-owner` with "… is double-occupied: X was set down on it" (a place holds one `containerId`).
- **Browser:** the worker diffs `ShcState.motion`/`status` like the STS and sends new reservations (`Delta.reservations`). `SceneModel.shcPose(id,t)` → `{x, z, lift, heading, yaw, steerRad, odometerM, travelling}`; `containerPose` adds a yaw (boxes on pads/SHCs heading Z lie along Z; a carried box takes the SHC's yaw). Overlays: `store.overlays` / `OverlayToggles.vue` (catalogue keys `overlays.*`) / `__tt.overlays()`; the O shortcut (`store.overlaysVisible`) is the master switch over them. The setup dialog edits SHC speeds in display units (km/h or mi/h, m/s² or ft/s²) and stores SI.

## ASC block storage (TT-06)

Imports now flow all the way from the vessel to a stack: vessel slot → STS → ground position → SHC → WTP pad → ASC → yard slot. Terms (block, row, bay, tier, slot, stack, claim, handover envelope) are in `GLOSSARY.md`.

- **Block geometry** (`engine/yardLayout.ts`, pure): a block lies perpendicular to the quay, centred on its X. 8 rows across X (`ROW_PITCH_M` 2.9, the 25.4 m ASC span), `bays` 20 ft bays along Z (`BAY_PITCH_M` 6.7), `tiers` high (`TIER_PITCH_M` 2.896). WTP pads sit at the waterside end (`wtpZ`), the first bay 8 m beyond; transfer stalls (TT-13) at the landside end. `BlockConfig` has optional `bays` (20), `tiers` (5), `transferStalls` (5); `ScenarioBuilder.block()` defaults 5 WTP pads. Pads and stalls must fit the span (at most 5 at the 5.5 m pitch; the setup dialog enforces this).
- **Slots**: 20 ft cells `<block>:<bay>-<row>-<tier>` (`yardSlotId`, `parseYardSlotId`). A 40 ft box covers two bays and is named by its lower bay. `SimState.yardSlots` holds the stacked boxes (`span` 1 or 2); `SimState.yardBlocks` holds per-stack `heights` (claimed boxes included) and `topVessels`.
- **Flow** (`engine/subsystems/asc.ts`): `ShcDroppedAtWtp` creates an `AscJob` and asks `yardAllocation`. The reply claims the slot (`claimSeq`). `ShcCleared` marks the pad clear. The block's ASC then takes the oldest allocated and cleared job, unless an older claim shares a stack with it (a lower box must land first). The whole cycle is planned at once: `AscJobAssigned → AscRoutingToPad → AscPositioningAtPad → AscLocking → AscPicked (custody pad → ASC) → AscRoutingToSlot → AscPositioningAtSlot → AscUnlocking → AscStacked (custody ASC → yard slot) → AscReady`. Each phase event carries the `segments` that led up to it (axes `gantry` = Z, `trolley` = X, `hoist` = box-bottom height). Gantry and trolley move together, the hoist alone; the hoist rises to travel height (`travelHoistM`) before any gantry/trolley move.
- **Handover**: the ASC reserves the pad zone (same `reservations.ts` as SHCs, holder = ASC id) from its arrival over the pad until the spreader has lifted clear. An SHC planned later waits for it; the ASC itself starts later if the pad zone is still reserved. Invariant `asc.wtp-handover` checks that the ASC is never inside a pad's lifting envelope (below travel height, over the pad footprint) while an SHC is on the pad.
- **`yardAllocation` decision point** (contract v1): request = block stacks (`heights`, `topVessels`, geometry) + the box (`containerId`, `size`, `full`, `line`, `vesselId`, `wtpPadId`) + `random` (the only randomness source for strategies, always drawn so swapping strategies keeps the RNG stream). `candidateSlots(request)` (exported) lists the legal slots: on top of a stack below the tier limit; a 40 ft box needs two neighbouring stacks of equal height. Reply `{slotId}`; `null` = block full (the box stays on its pad; `kpis.yard.allocationFailures`). The engine trusts a non-null reply (it only rejects slots outside the block); the invariants catch floating, over-high, double-occupied or overlapping choices. Strategies: `nearest-wtp` (default; plan distance plus a per-tier cost), `random`, `group-by-vessel`.
- **Invariants** (`engine/invariants.ts`): `yard.slot-bounds`, `yard.stack-height`, `yard.no-floating`, `yard.no-double-occupied`, `yard.no-mixed-length-overlap`, `asc.wtp-handover`. Tests break each one with a custom `yardAllocation` handler or a tampered snapshot (`tests/asc-yard-rules.test.ts`).
- **KPIs**: `kpiReport().yard` = `{boxesStacked, boxesInTransit, allocationFailures, blocks{boxes, cells, capacityCells, maxHeight}, ascs{jobs, gantryM, trolleyM, hoistM, padWaitS}}`.
- **Config**: `kinematics.asc` (`AscKinematics`, `DEFAULT_ASC_KINEMATICS` [A]), builder `.block()`, `.ascKinematics()`, `withYard(config, {blocks, asc})` (setup dialog).
- **Query**: `asc(id) ascs() ascJobs() yardBlock(id) yardBlocks() yardSlot(id) yardSlots(blockId?)`; worker query kinds `asc ascList yardBlocks yardSlots`. `ascPoseAt(asc, t)` (exported) gives the spreader pose from a plan.
- **Browser**: delta `motion` includes ASCs, entity kind `'asc'`. `SceneModel.ascPose(id, t)`, `blockOfAsc`, `blockList`; yard custody poses come from the slot id (`rowX`, `slotZ`, `tierBaseY`). `SceneRenderer` draws blocks (slab, ASC rails, row lines, bay marks, pads, transfer stalls) and procedural ASCs (portal, girder, trolley, ropes, spreader). Setup dialog "Yard blocks and ASC" fieldset (`setup.yard.*`, only for scenarios with blocks). Dev API: `load(name, {yard})`, `query('ascList' | 'yardSlots', blockId)`, `sceneState().ascs`. Smoke: `tests/browser/terminal-twin-asc.smoke.ts`.
- **Fixture**: `asc-1sts-10-boxes-1block` (feeder, 10 boxes of 20 ft and 40 ft, 2 SHCs, one block with 8 bays and 3 tiers, ends at 1800 s) + golden.
- **Not yet**: rehandles and retrieval (TT-10/13), transfer-stall work (TT-13). Two ASCs per block are in [Paired ASCs](#paired-ascs-tt-08).


## Paired ASCs (TT-08)

`yard.ascsPerBlock` is 1 (default: goldens of earlier fixtures are byte-identical) or 2. Ids: `<block>-ASC1` is the waterside ASC (starts at the WTP pads), `<block>-ASC2` the landside ASC (starts at the landside end). `ascIdOf(blockId, n)` and `ascIndexOf(ascId)` (engine exports) replace the old one-ASC assumption; `SceneModel.blockOfAsc` strips `-ASC<n>` and still works.

- **Rail model** (`engine/subsystems/ascRail.ts`, pure; geometry constants in `engine/yardLayout.ts`): the rail is cut into half-bay segments (zone `<block>:R<k>`, `railSegmentIds`). A crane's footprint is its position ±6 m (half of `ASC_MIN_SEPARATION_M` = 12 m = 8 m portal + 4 m gap). The rail extends `RAIL_MARGIN_M` (16 m) past the WTP pads and the last bay, so the waterside ASC can stand clear of a pad. [A] numbers: portal length, safe gap.
- **Trips reserve time windows**: `occupancyPieces` turns a trip's gantry plan into where the crane is over time (resting pieces and moving pieces), `pieceWindows` into per-segment windows. The same `reservations.ts` as SHCs does the work (`earliestStartAmong` is `earliestStart` over an explicit list, used to ignore the planner's own holds). The whole trip plus the pad window is reserved before departure; conflicts delay `departAt` (rail wait: `AscJobAssigned.railWaitS`, KPI `yard.ascs.<id>.railWaitS`).
- **Park holds**: when a trip ends the crane holds the segments around its final position until `PARK_UNTIL_S` (1e9 s: JSON-safe "never"); the next trip truncates the hold to its own start (`truncateParkHolds`). A job whose sweep conflicts with the other ASC's park hold gets a start time that is "never" (`isBlockedStart`): if the other ASC is idle it steps aside first (`AscYieldAssigned` → its `AscReady`, KPI `yields`), if it is busy the job cannot be served now.
- **Dispatch** (`maybeDispatchAsc` in `asc.ts`): one ASC → it takes the oldest ready box, no decision point (no events change). Two ASCs → the `ascDispatch` decision point (contract v1, `decisions/ascStrategies.ts`) picks among the idle ASCs. The request carries per candidate `canServe` and `needsYield` (computed by a dry-run `planJob`), the job (`kind: 'wtp'`; `'transfer'` is reserved for TT-13) and `minSeparationM`. Reply `{ascId|null}`: null leaves the box open until the block changes (ShcCleared, AscReady, allocation); an ASC of another block throws; a stale or unserviceable pick is ignored and asked again later. One request per block at a time (`AscJob.dispatch`). Strategies: `waterside-first` (default) and `balanced`.
- **Utilisation split**: with only WTP work (no transfer stalls until TT-13) `waterside-first` keeps the landside ASC idle, because every pad cycle sweeps the whole rail from the pad. `balanced` splits the jobs by stepping the other crane aside. `kpis.yard.ascs.<id>` of a twin block gains `railWaitS`, `busyS` (cycle and yield seconds, divide by elapsed time for utilisation) and `yields`; single-ASC blocks keep the old five fields.
- **Invariant** `asc.no-passing`: the waterside ASC stays waterside of the landside ASC and the centres stay at least 12 m apart, checked now and at every breakpoint of both planned motions (real mode only). `reservation.no-overlap` also covers the rail segments. Tests: `tests/asc-paired.test.ts` (an independent after-every-event monitor, tampered snapshot), `tests/asc-paired-dispatch.test.ts` (conflict fixture, strategies, custom handlers, single-ASC regression).
- **Fixture**: `asc-2asc-block-conflict` (30 boxes spread by `random` slots, `balanced` dispatch: overlapping rail needs, waits and step-asides) + golden.
- **Browser**: `OverlayState.ascRail` (button "ASC rail", `__tt.overlays({ ascRail: true })`) draws one strip per rail segment that is reserved or parked on at the display time, coloured by the holding ASC (waterside blue, landside red); `scene().reservedRailSegments` counts them. `SceneModel.railSegments(blockId)`. The setup dialog's "ASCs per block" radio (default 2) maps to `YardSetup.ascsPerBlock` / `withYard`. Smoke: `tests/browser/terminal-twin-paired-asc.smoke.ts`.
- **Not yet**: transfer-stall work for the landside ASC (TT-13), rehandles and retrieval (TT-10), a landside ASC that works the pads without the waterside ASC stepping to the rail end.

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
npm run tt:assets -- --only asc --python ...            # one group only (containers | shc | asc); the other groups' files are untouched
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
| `shc` | 11,016 (budget 12,000) | 2,532 (3,000); LOD2 342 (400) | 15 / 11 (budgets 16 / 12; LOD2 2 of 3) | ~147 KB |
| `asc` | 14,474 (budget 15,000) | 3,624 (4,000); LOD2 556 (600) | 9 / 5 (budgets 10 / 6; LOD2 3 of 3) | ~300 KB |

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

### SHC model (TT-25)

A red Kalmar-style shuttle carrier (`assets/models/shc/shc.glb`, sidecar `shc.meta.json`, previews `shc-{front,side,rear,three-quarter}.webp`), generated by `generators/tt_assets/shc.py` (geometry) and `shc_meta.py` (atlas and sidecar) through the same one-command pipeline. Proportions are [A]: no manufacturer drawing and no reference photos are in the repo (see the sidecar's provenance).

- **Look:** tall welded gantry on four legs with an open tunnel (clear 3.6 m wide between the tyres, 6.4 m high, open at both ends), dual tyres on four steered legs, engine/hoist assembly on top, glazed cab offset to the front -Z side, two ladders, handrails, white diagonal warning stripes on the lower legs, a telescopic 40 ft spreader with four twist-locks. A 40 ft box (12.19 m) is longer than the frame (8.2 m) and overhangs it fore and aft, as on a real SHC. Branding: a KALMAR wordmark and the unit number `SC 108` baked into a small swatch atlas (no operator branding).
- **Rig (names repeat in every animated LOD; the build strips the `@LODn` suffix Blender needs to keep object names unique):** `steer_fl|fr|rl|rr` (rotation about +Y, ±35°, pivot on the steer axis at axle height) with child `wheel_*` (rotation about +Z, pivot on the axle; a forward roll is negative about +Z); `hoist` (translation along +Y, 0 to −3.1 m; pivot = the container attach plane) with child `spreader` (0 to 0.35 m float) and its `twistlock_*` (0° unlocked, 90° locked). LOD0 has everything, LOD1 keeps wheels, steering, hoist and spreader, LOD2 is a static silhouette.
- **Attach point:** the sidecar's `container_attach` (child of `hoist`) is the centre of the twist-lock plane, i.e. the TOP of the carried box: 6.0 m above the ground at hoist 0. `hoist = (box bottom + box height) − 6.0`, and the engine's `lift` is the box bottom, so the carried box stays exactly under the spreader. The lowest travel (−3.1 m) puts the plane at 2.9 m, the top of a 40 ft high-cube standing on the ground.
- **Triangles / draw calls:** LOD0 11,016 / 15, LOD1 2,532 / 11, LOD2 342 / 2 (budgets in `budgets.json`, `shc` kind; `requiredNodes` lists the rig). One 1024² swatch atlas (WebP) is the only texture.
- **Renderer** (`modules/shcAssets.ts`, `SceneRenderer`): `loadShcModel()` loads the GLB once per page behind the procedural placeholder (kept until it loads). Each SHC gets a `ShcRig` (clones of the three LODs sharing geometry and material). `SHC_LOD_DISTANCES` [A]: LOD0 up to 110 m, LOD1 up to 380 m, LOD2 beyond (hysteresis ×1.15), chosen per SHC from the camera distance.
- **Animation, all from the scene model** (`SceneModel.shcPose`, pure and unit-tested in `tests/shc-pose.test.ts`):
  - *Wheel roll* = `−odometerM / tyre radius`. The odometer sums the distance driven along the heading, so reversing rolls backwards.
  - *Steering from path curvature:* each X/Z leg is stored with its heading on ingest. At a corner the body yaw swings through 2 s (shorter on short legs) with a smoothstep, and `steerRad` follows `sin(π·progress)` up to ±35°; the rear pairs steer the opposite way. A reversal of more than 135° is driven in reverse (no spin).
  - *Spreader/hoist:* carrying, it follows the engine's `lift` segments exactly (`lift + box height`). Empty, it is raised while driving or parked and lowered onto where a box would stand otherwise, eased at 1.5 m/s of display time so it never snaps. Twist-locks are locked while carrying.
  - `ShcPose` gained `yaw`, `steerRad`, `odometerM`, `travelling`; `ContainerPose` gained `carriedBy`, and a carried box takes the SHC's yaw.
- **Dev API:** `__tt.scene()` adds `shcLods {lod0, lod1, lod2}` and `shcAssets`; `__tt.sceneState().shcRigs[id]` = `{lod, steerRad, wheelRollRad, hoistM, carrying}` as last drawn.
- **Asset viewer** (`?viewer=shc`): sliders for every rig node, applied to every LOD; the reference is a 40 ft high-cube box hanging from the attach plane that follows the hoist slider; `stats().reference` reports `fitsTunnel` against the sidecar's clear width and height.
- **Tests:** `tests/shc-asset.test.ts` (committed GLB and sidecar: rig, attach point, tunnel fit, provenance), `tests/shc-pose.test.ts` (pose maths), `tests/browser/shc-model.smoke.ts` (LOD switching, carried box, rolling and steering, viewer).
- **Not done:** the TTI reference pack and reference photos are not in the repo, so the proportions are approximations tagged [A]; a reference-photo pass can re-tune the constants at the top of `shc.py` and regenerate. Per-unit numbers (`SC 108`) are baked into the atlas, not taken from the SHC id.

### ASC model (TT-24)

A blue ZPMC-style rail-mounted stacking crane (`assets/models/asc/asc.glb`, sidecar `asc.meta.json`, previews `asc-{front,side,rear,three-quarter}.webp`), generated by `generators/tt_assets/asc.py` (geometry) and `asc_meta.py` (atlas and sidecar). The shared `Part`/`Atlas` modelling vocabulary now lives in `tt_assets/parts.py` (moved out of `shc.py`; the SHC output is byte-identical). The 25.4 m rail span, 8 rows and 40 t rating are the spec's figures (tag `V`); every other proportion is `[A]` (no reference pack or photos in the repo; tune the constants at the top of `asc.py`).

- **Look:** twin box-beam bridge across the span on four vertical legs (two per rail) with X-bracing, sills and rail bogies with wheels; walkways with grating and handrails along both girders, two caged ladders with landings, head-beam decks, an e-house on the +X deck, a trolley with two machinery houses, drums, motors and rope openings, and a yellow telescopic 40 ft spreader with four twist-locks. Branding: a `ZPMC` wordmark on both bridge sides, a `40 t` mark on the trolley, the unit number `ASC 12`, and numbered bridge panels 1..8 over the eight rows (all baked into a 1024² atlas; no operator branding). It is 25.4 m between rail centres (29.2 m over the decks), 10.1 m along the rails (two ASCs fit the engine's 12 m minimum separation) and 24.7 m high; the bridge underside is 20.0 m.
- **Axes:** glTF X = across the rows (trolley), Z = along the block rails (gantry), Y up; the spreader's long axis is Z, like the boxes in the yard. The asset origin is on the ground at the span centre and the gantry centre, so the renderer places it at `(block.x, 0, 0)`.
- **Rig (names repeat in every LOD; the build strips `@LODn`):** `gantry` (translation +Z; the whole portal) > `trolley` (+X, ±11 m, pivot at the top of the bridge rails) > `ropes` (LOD0/1; no limit of its own: its scale along Y is `(ropeTopY − (attachY + 2.3)) / restLength`, from the sidecar's `derived` entry) and `hoist` (+Y, 0 to −15.1 m, pivot = the twist-lock plane at rest, raised to 18.0 m) > `spreader` (0 to 0.35 m float) > `twistlock_fl|fr|rl|rr` (0°–90°, LOD0 only). **LOD2 keeps `gantry`, `trolley`, `hoist` and `spreader`** (the spreader node is empty there, its box is merged into `hoist`), so far cranes still move.
- **Attach point:** `container_attach` (child of `hoist`) is the TOP of the carried box: 18.0 m above the ground at hoist 0. `hoist = (box bottom + box height) − 18.0`. The lowest travel (−15.104 m) puts the plane at 2.896 m, the top of a high-cube box on the ground. 18.0 m passes a box over a 5-high stack with the engine's 0.6 m travel clearance (stack top 14.48 m, carried box bottom 15.10 m).
- **Stack:** the sidecar's `stack` block records 8 rows at 2.9 m pitch, 24.3 m clear between the legs (0.9 m each side of the outer rows), `designTiers 5`, `underBridgeM 20.0`.
- **Triangles / draw calls:** LOD0 14,474 / 9, LOD1 3,624 / 5, LOD2 556 / 3 (budgets 15,000 / 4,000 / 600 and 10 / 6 / 3). One atlas (WebP), ~300 KB.
- **Renderer** (`modules/ascAssets.ts`, `modules/ascRig.ts`, `SceneRenderer`): `loadAscModel()` loads the GLB once per page behind the procedural placeholder. Each ASC gets an `AscRig` (three cloned LODs sharing geometry and material). LOD by camera distance: `ASC_LOD_DISTANCES` [A] 90 m / 300 m (hysteresis ×1.15). `ascRigValues()` (pure, in `ascRig.ts`) maps the scene model's `ascPose` (gantry Z, trolley X from the block centre, hoist = box bottom) and the carried box height to the rig: gantry Z and trolley X directly, hoist from the plane height, rope scale, twist-locks locked while a box hangs. Containers carried by an ASC now have `ContainerPose.carriedBy`. The engine's motion segments are the only input, so the animation matches them exactly (unit-tested over a whole fixture run: no clamping).
- **Taller blocks:** the model is built for 5 tiers. `ascScaleY(tiers)` stretches the whole rig vertically for blocks with more tiers (up to 8) so its raised plane covers the engine's top of travel; wheels and ladders stretch with it. Fewer tiers just use less of the hoist.
- **Picking:** `entityBounds` for an ASC uses `ASC_MODEL` (29.2 × 24.7 × 10.1 m, stretched like the model); the old `ASC` constants in `equipmentDims.ts` only size the procedural placeholder.
- **Dev API:** `__tt.scene()` adds `ascLods {lod0, lod1, lod2}` and `ascAssets`; `__tt.sceneState().ascRigs[id]` = `{lod, gantryZ, trolleyX, hoistM, ropeScale, scaleY, carrying}` as last drawn.
- **Asset viewer** (`?viewer=asc`): sliders for gantry, trolley, hoist, spreader and the twist-locks (applied to every LOD; the ropes follow the hoist), 8 rows of 40 ft high-cube reference boxes under the span with a stack-height slider (`__ttAssets.setStack(tiers)`), and a 40 ft box hanging from the spreader that follows the hoist and trolley. `stats().stack` reports `sideClearanceM`, `carryClearanceM`, `carriedBottomM` and `fits` (true at 5 tiers, false at 6).
- **Tests:** `tests/asc-asset.test.ts` (committed GLB and sidecar: rig, attach point, span, stack fit, branding, provenance), `tests/asc-rig.test.ts` (rig maths, scale, and a full engine run through the host with no clamping), `tests/browser/asc-model.smoke.ts` (paired ASCs with LOD switching, carried box and ropes, viewer sliders and stack fit).
- **Not done:** the reference pack and photos are not in the repo, so proportions are `[A]`; the TT-19 frame budget does not exist yet, so frame rate was not compared (worst case in a TTI-size yard: 2 × 32 ASCs, at most a handful at LOD0).

### Adding the next asset (STS, truck, vessels, …)

1. Add `generators/tt_assets/<kind>.py` (use `tt_assets/parts.py`: `Atlas` for the swatch/region atlas, `Part` for boxes, beams, plates and revolves), and wire a group into `build.py` (`GROUPS`) and `cli/assets/build.ts` (`GROUPS`).
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

## Vessels, berthing and the STS rail (TT-09)

- **Vessel table.** `config.vessels` holds vessel *calls*: `arrivalS`, `sizeClass`, `discharge`, `load`, `transshipment`, `maxSts`, optional `sizeMix`. Berth position and cranes are NOT in the config: decision points choose them. `config.containers` no longer exists.
- **Size classes** (`scenario/vesselClasses.ts`, all [A]): LOA, beam, 40 ft bays, rows, hold and deck tiers, hatch-cover height. Frame: `berthX` = stern; bay 0 aft; row 0 quay side; tier 0 = hold floor, tiers >= `holdTiers` on deck. A cell holds one 40 ft or two 20 ft (aft `a` / fore `f` half). Slot id `V001:BB-RR-TT[a|f]`. Engine, scene model and renderer use the same `slotX/slotZ/tierBaseY`.
- **Bay plan** (`planCargo(config, seed)`, own RNG stream): discharge boxes (ISO 6346 ids, weighted lines from `cargo.lines`, sizes from `sizeMix`, `emptyShare`) spread unevenly over bays, hold/deck in proportion, stacked bottom-up; 20 ft paired fore/aft. Load/transshipment slots are reserved empty (`purpose`). The scene model regenerates it from config + seed, so it never crosses the worker protocol. Query: `sim.query.vesselSlots(vesselId?)`.
- **Berth flow** (`subsystems/berth.ts`): `VesselArrived` → `berthAllocation` (one pending at a time, arrival order, strictly first come first served) → `BerthAllocated` (quay stretch taken) or `VesselAtAnchorage` (asked again at every `VesselDeparted`) → `mooringS` → `VesselBerthed` → `craneSplit` → STS work → `StsWorkComplete` per crane → `VesselWorkComplete` → `unmooringS` → `VesselDeparted`. Anchorage wait = allocation − arrival (`kpis.vessels.*.anchorageWaitS`, `kpis.quay`). The engine rejects (throws, so the run fails) berths off the quay or within `berthGapM` of another vessel.
- **Crane split:** the reply lists free cranes with ascending bay ranges in rail order, covering every work bay once. The engine rejects splits that would make cranes pass (`validateSplit`). No cranes → the vessel waits berthed and is asked about again whenever a crane is freed. Both strategies pick up to `maxSts` eligible free cranes nearest the vessel (eligible = no busy crane would have to pass them), then split the bays: `balanced-moves` (min-max moves, dynamic programming) or `equal-bays`.
- **Rail** (`subsystems/rail.ts`): each STS has a reservation `[railLo, railHi]` covering its current gantry motion; neighbours stay `quay.stsMinSpacingM` (27 m) apart. A move that needs the rail waits (`StsWaitingForRail`, status `waiting-for-rail`, `kpis.sts.*.railWaitS`), and `wakeRail` retries after every rail change. A free idle crane in the way is asked to step aside (`StsRepositionStarted/Completed`). Reservations shrink at `StsPicked`. The `sts.rail-order` invariant checks order, spacing and position-within-reservation after every event; `berth.no-overlap` checks vessels.
- **STS cycle:** the gantry move is part of `StsMoveStarted`'s plan (hoist up, gantry, trolley, hoist down). Work order per crane: bay ascending, deck before hold, top tier first, row ascending, aft before fore. **Twin-20** (`quay.twinLift`): the aft and fore halves of one cell are picked in one `StsPicked` (`payload.twin`); each gets its own ground-position decision, and they are set down one after the other (two `StsGrounded`, `payload.x` = set-down X) before the next cycle [A: sequential release]. KPIs: `moves` (boxes), `cycles`, `twinLifts`.
- **End:** with no end condition configured, the run ends when every vessel has departed.
- **Browser:** vessel entity deltas carry `berthX`. The scene places hulls (procedural per class: extruded outline, boot-top, hatch covers, bridge, funnel; livery from the line the vessel name starts with) at the berth or in an anchorage row offshore. Twin boxes on the spreader use `CustodyChange.dx`. Run-to compaction (`compactMotion`) keeps each entity's latest motion plan whole (an SHC trip is one multi-segment plan) plus the latest earlier segment of every axis that plan does not move. Setup dialog: quay length, STS count (`spreadSts` spreads them evenly), vessel table and generator → `ScenarioChoice.overrides` → `applyOverrides`; `__tt.load(name, { overrides })` does the same.

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

- SHC model: the rig node names repeat in every LOD. Three's GLTFLoader renames duplicates (`wheel_fl`, `wheel_fl_1`, …) and keeps the file's name in `userData.name`, so look nodes up by `userData.name` and animate every node of a name (the viewer and `ShcRig` do). The Blender object names carry `@LODn` and `build.py` strips it from the GLB's JSON; do not rename them in glTF tooling.
- SHC model: the hoist is driven by `lift` only while carrying. An empty SHC stops being a "stationary, spreader down" picture the moment it drives (it is eased up at 1.5 m/s), and a parked SHC has the spreader raised.
- SHC model: corners are visual only. The engine still plans rest-to-rest legs, so an SHC stops at each turn and the 2 s swing happens at the start of the next leg while it is already moving.

- Fixtures without SHCs give each STS enough ground positions for all its boxes (tracer 10, others 6–30) because nothing clears them; SHC fixtures use a realistic 3.
- Berth allocation is strictly first come, first served: a vessel that never fits (LOA > quay) blocks the queue for good (the setup dialog warns).
- A free crane steps aside only if its other neighbour leaves room (chains of free cranes move one after another). A busy crane is never pushed, so a waiting crane may idle until its neighbour finishes.
- `shc-1sts-2shc-1wtp` (3 ground positions, 2 SHCs, block B01 with 4 pads west of the crane) ends at `simDurationS 1800`, after every box is in the yard.
- ASC cycles are planned whole at job assignment, like SHC trips. After `AscStacked` the spreader still rises to travel height (`AscReady`), so the ASC takes its next job only then. A full block leaves boxes on the pads; nothing frees stack space until retrieval exists (TT-10/13), so a long run with a small block ends with SHCs idle and pads full (`yard.allocationFailures`). The handover invariant is checked at event instants; the reservations cover the time between.
- SHC trips are planned whole at dispatch; a later conflict never re-plans a trip, it only delays the next trip's departure. A vehicle waiting at a pad clear position holds no reservation, so another SHC approaching that same pad can pass through it visually (rare; dispatch is instant).
- STS lanes are continuous along the quay (cranes move, TT-09): an SHC enters a lane at the down spine before the box (stations every `stationSpacingM`, 25 m) and leaves at the up spine after it. The STS reserves the lane sections it sets a box down in, so traffic in that lane and the set-down never overlap.
- With SHCs, the STS lanes must stay clear of the apron: `validateLaneLayout` rejects ground-position counts whose last lane reaches the westbound apron lane (≥ 11 lanes with the default layout).
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
- Debugger: the engine runs ahead of the display while playing, so `query` and the inspector describe the engine's time, not the displayed instant, and a pause followed by Step jumps the display to the next unprocessed event.
- Debugger: a breakpoint can only stop events not yet processed; the feed and the inspector never show events later than the display time, except the one that hit a breakpoint (the display is moved to it).
- Debugger: the picking boxes are generous (cranes and hulls enclose everything under them); containers always win. A box on an SHC or inside a crane is picked, the carrier itself by clicking its frame.
- Shortcut `.` while playing pauses and steps the engine's next event, which is beyond the look-ahead, so the display jumps forward slightly. Pause first (Space/0) to step event by event.
- The `ScenarioEnded` and `InvariantViolated` events are committed directly. They are not queued and are not invariant-checked.
- Assets: run the generators only through `npm run tt:assets`; it replaces `assets/models/<group>/` wholesale, so hand edits to a committed GLB or sidecar are lost.
- Assets: the viewer and the twin share one cached `loadContainerAssets()` promise; never dispose its materials or textures from a renderer.
- Assets: container shadows need `shadow.normalBias` (0.35 in the twin) or the corrugation shows shadow acne.
- Fixture `liveries-mixed` (12 generated boxes, equal weights over all ten lines → 8 lines with seed 7, all three sizes) exists for the livery smoke test.

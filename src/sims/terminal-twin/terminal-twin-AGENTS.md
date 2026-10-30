# Terminal Twin — Agent Guide

## Overview

Per-topic detail lives in [`docs/`](docs/), reached through the topic pointers below. Reference packs the user uploaded (not committed): `docs/reference/` at the repo root.

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root — use its terms in code, tests and docs.

**Status:** all spec tickets (TT-01 to TT-28) are merged and the code-review fixes are in. The headless engine covers vessels and berthing, STS cranes, SHC transport, paired ASC block storage, export load, transshipment and empties, rehandles, landside trucks, the yard start modes, KPIs and end conditions, and the TOS decision points. The browser host has a Web Worker engine, a 3D scene with the Phase 2 GLB assets, debugger, dashboard, saves and rewind, and locale and units. Known limits are under [Known gaps](#known-gaps).

**Sim ID:** `terminal-twin`

**Topic docs** (read the one that matches what you are changing; each holds that topic's rules and gotchas):

- Background on the real terminal (hatch covers, ASC stacking, SHC dispatch, road trucks, which figures are unverified, and the sim's deliberate deviations): [knowledge-base/dk_ops__tti_algeciras_operations.md](../../../knowledge-base/dk_ops__tti_algeciras_operations.md).
- Changing berthing, crane split, the STS rail, hatch covers, SHC dispatch, lane graph or reservations: read [docs/quay-and-horizontal.md](docs/quay-and-horizontal.md).
- Changing ASC storage or rail, yard allocation, export load, transshipment, empties, rehandles, landside trucks, gate or yard start modes: read [docs/yard-and-landside.md](docs/yard-and-landside.md).
- Changing KPIs, end conditions, the final report, exports or the dashboard: read [docs/kpis-dashboard.md](docs/kpis-dashboard.md).
- Changing presets, layout derivation, scenario validation, saves, snapshots or rewind: read [docs/scenarios-and-persistence.md](docs/scenarios-and-persistence.md).
- Changing the worker host, playback, `SceneModel`, locale and units, shortcuts, the `window.__tt` dev API, the debugger or the inspector: read [docs/browser-host.md](docs/browser-host.md).
- Changing the Blender generators, budgets, sidecars, container liveries or `ContainerInstancer`: read [docs/assets-pipeline.md](docs/assets-pipeline.md).
- Changing the SHC, truck, STS, ASC, vessel hull or infrastructure models and their rigs: read [docs/equipment-models.md](docs/equipment-models.md).
- Changing graphics quality, the benchmark, lighting, the backdrop, sound or the home card: read [docs/scene-quality-atmosphere.md](docs/scene-quality-atmosphere.md).

## How to prove a change works

| Kind of change | Command | What "works" looks like |
|---|---|---|
| Anything | `pnpm run verify` | lint, build (incl. `vue-tsc` for engine, CLI and tests) and `pnpm test` all pass |
| Real frame rate | in-app browser, `dev` entry of `.claude/launch.json` (port 5174; it runs on the real GPU) | Open `/sim/terminal-twin`, wait for `window.__tt` (dev builds only), then `await __tt.load('TTI Algeciras baseline'); await __tt.runTo(4*3600); __tt.pause(); __tt.cameraTo('STS104', 1100); __tt.setQuality('high')` and average `__tt.perf().stats` over several 1 s samples per setting. Compare `stats.cpuMs` and `poseMs` with 16.7 ms: above it, fps quantises to 30 and the main thread, not the GPU, is the limit. Record numbers in `docs/scene-quality-atmosphere.md`. |
| Engine behaviour | `pnpm test` | all Vitest suites pass, including golden summaries |
| One scenario, by hand | `pnpm run tt:run --fixture tracer-1sts-10-boxes` | `Stopped: ended`, `0 violations`, `First error: none`, exit code 0 |
| Partial run | `pnpm run tt:run --fixture <name> --until time:600` (or `moves:5`, `vessels:1`, `event:StsPicked`) | stops at the condition |
| Another seed | `pnpm run tt:run --fixture <name> --seed 7` | runs to the end; hash differs from the golden |
| Inspect events | `pnpm run tt:run --fixture <name> --events /tmp/ev.jsonl --out /tmp/summary.json` | one JSON event per line; summary = golden format |
| Failure path | `pnpm run tt:run --fixture <name> --handlers broken-first-lane` | exit 1, first error names `custody.single-owner` at the offending event |
| Decision points / TOS latency | `pnpm run tt:run --fixture <name> --strategy stsGroundPosition=highest-free-lane --latency stsGroundPosition=exp:2000,timeout:10,error:10 [--async-mode pause]` | `TOS handlers:` block shows calls, fallbacks, latency, backlog, idle caused; invariants still 0 |
| Structured logs | `pnpm run tt:run --fixture <name> --log /tmp/run.log.jsonl --log-level "sts=debug,vessel=warn,*=info"` | one JSON object per line with `t`, `eventId`, `seq`, `subsystem`, `level`, `type`, `subjects` (+ `causedBy`, `payload` at `debug`); `grep '"subsystem":"sts"'` |
| Two strategies diverge where? | `pnpm run tt:diff --fixture <name> --b-handlers highest-free-lane` | exit 1; `First divergence at seq N`, differing fields, context and both payloads (exit 0 + `No divergence` if identical) |
| Two seeds | `pnpm run tt:diff --fixture <name> --a-seed 1 --b-seed 2` | same report |
| Two code versions | before: `pnpm run tt:run --fixture <name> --events /tmp/before.jsonl`; after your change: `… --events /tmp/after.jsonl`; then `pnpm run tt:diff /tmp/before.jsonl /tmp/after.jsonl` | first diverging event = first effect of your change |
| Reproduce a late bug | `pnpm run tt:run --fixture <name> --until time:50400 --snapshot /tmp/h14.json`, then `pnpm run tt:run --from-snapshot /tmp/h14.json --until time:54000 --events /tmp/win.jsonl --log /tmp/win.log.jsonl --log-level debug` | the window's events equal that window of the uninterrupted run; re-run the window as often as needed |
| Check goldens | `pnpm run tt:golden` (also part of `pnpm test`) | `<fixture>: match` per fixture, exit 0; drift prints `path: golden X → actual Y` per field and exits 1 |
| Intentional behaviour change | `pnpm run tt:golden --update` (or `UPDATE_GOLDEN=1 pnpm test`), then review the `*.golden.json` diff | the golden diff shows only the change you intended |
| Browser / UI / 3D view | `pnpm run test:smoke` | Playwright smoke tests in `tests/browser/*.smoke.ts` pass (dev server + a production build). Not part of `pnpm test`; CI runs them in the required `smoke` job (`--grep-invert @load`). Only the Auto-quality fps spec (`terminal-twin-perf.smoke.ts`, tagged `@load`: it needs a real frame rate) is advisory, in `smoke-load`. Write frame-based checks with `tests/browser/frameSampling.ts` (ratios over a minimum wall-clock window, never absolute frame counts). |
| Look at the 3D view | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('tracer-1sts-10-boxes').then(() => window.__tt.runTo(330)).then(() => window.__tt.pause())"` | PNG in `.screenshots/` shows the STS mid-cycle, no page errors |
| UI text, locale, units, shortcuts, keyboard camera | `pnpm test` (`keyboard-camera`, `display-format`, `display-settings`, `message-catalogue`) + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-display.smoke.ts` and `terminal-twin-keyboard-camera.smoke.ts` | catalogue audit lists no hard-coded strings; locale/units/shortcut smoke tests pass |
| Saves, snapshots, rewind | `npx vitest run src/sims/terminal-twin/tests/{saves,persistence-host,persistence-controller}.test.ts` + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-saves.smoke.ts` | formats and migration, replay-based restore and rewind give the original event-log hash; smoke covers reload, file round-trip, version mismatch, no IndexedDB |
| Debugger and inspector (breakpoints, step, cause chain, picking, follow, overlays) | `npx vitest run src/sims/terminal-twin/tests/{breakpoints,debugger-host,debugger-controller,event-feed,event-inspector,entity-inspector,picking}.test.ts` + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-debugger.smoke.ts` | Vitest proves the logic through the worker host and an in-process controller; the smoke spec clicks, steps, pauses at breakpoints and checks the overlays against `sceneState()` |
| Debugger in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 2500 --fail-on-error --eval "window.__tt.load('shc-1sts-2shc-1wtp').then(async () => { await window.__tt.addBreakpoint('eventType','ShcDroppedAtWtp'); await window.__tt.runTo(1e5); window.__tt.overlays({occupancy:true,labels:true}); window.__tt.select('SHC01'); window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'})) })"` | feed on the left with the breakpoint hit highlighted, inspector on the right (event, payload, cause chain), labels and pad plates in the scene |
| KPIs, end conditions, report, export | `pnpm run tt:run --fixture asc-1sts-10-boxes-1block --end moves:5 --kpi-csv /tmp/k.csv --kpi-json /tmp/k.json` + `npx vitest run src/sims/terminal-twin/tests/{kpi-*,end-*,cli-kpi}.test.ts` + `npx playwright test terminal-twin-kpi` | `Headline KPIs:` block, `Stopped: ended (moves >= 5)`; files parse; smoke shows the strip, the report and downloads |
| Dashboard (charts, heatmap, Gantt, lazy ECharts) | `npx vitest run src/sims/terminal-twin/tests/dashboard` + `npx playwright test dashboard` (dev and prod projects) | Vitest: timeline, palette, view models, options, host query, lazy-import scan; smoke: ECharts chunk absent until B, 24 h series zoom, heatmap = engine fill, Gantt windows = vessel state, final report tab |
| Grouped yard decking | `pnpm run tt:run --fixture yard-grouped` (and `--strategy yardAllocation=nearest-wtp` to compare) + `npx vitest run src/sims/terminal-twin/tests/yard-grouped.test.ts` | `yardAllocation  strategy:grouped`, 0 violations, `kpis.yard.grouping` counts; the test shows grouped breaking fewer preferences than nearest-wtp on the same boxes |
| Fixture definition change | `pnpm run tt:fixtures`, then `pnpm run tt:golden --update` | committed fixture JSON matches `definitions.ts` |
| Hatch covers | `pnpm run tt:run --fixture hatch-cover-cycle` (and `--fixture hatch-deck-only-no-open`) + `npx vitest run src/sims/terminal-twin/tests/hatch.test.ts` (3D: `tests/hatch-scene.test.ts`, `pnpm run test:smoke terminal-twin-hatch`, screenshot below) | `Hatch covers:` block with moves, STS time and lashing wait, `0 violations`; deck-only run has no `Hatch covers:` line; the test file proves event order and causality, laydown clear of the lane graph, KPIs and all seven `hatch.*` invariants on tampered snapshots |
| Berthing / anchorage | `pnpm run tt:run --fixture two-vessels-compete-for-berth` | V002 `anchorage` > 0 s, `Quay: 1 vessel(s) waited`; `tests/berthing.test.ts` |
| Crane split / rail order | `pnpm run tt:run --fixture crane-split-4sts --strategy craneSplit=equal-bays` (vs the default `balanced-moves`) | 4 STS lines with different move counts, 0 violations (`sts.rail-order` is checked after every event); `tests/crane-split.test.ts` |
| Twin-20 | `pnpm run tt:run --fixture twin-20-lift` | `4 moves in 2 cycles (2 twin-20)`; `tests/vessels.test.ts` |
| Vessels in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('crane-split-4sts').then(() => window.__tt.runTo(1500)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001'))"` | hull at its berth, four STS along it, deck boxes on the hatch covers |
| SHC transport | `pnpm run tt:run --fixture shc-1sts-2shc-1wtp` | `Horizontal: 10 boxes to WTP pads`, per-SHC jobs/distances/reservation wait/handovers and state time (TT-R11, 7 operational states), headline SHC empty travel, handovers and state time, `0 violations` |
| SHC dispatch and pad strategies | `pnpm run tt:diff --fixture shc-1sts-2shc-1wtp --b-handlers nearest-job` (nearest job + `wtpPadSelection` `nearest-box`; or `tt:run … --strategy shcDispatch=nearest-job` / `--strategy wtpPadSelection=nearest-box`) | first divergence at the first `wtpPadSelection` `DecisionResolved` (`payload.reply.wtpPadId`); `shcDispatch` replies only `{jobId}` |
| SHC queue areas / chained dispatch | `pnpm run tt:run --fixture shc-queue-chained` (then again with `--strategy shcDispatch=oldest-job`; `--events` files go to `pnpm run tt:diff`) | `Horizontal: ... N parking returns` is 0 with chained-nearest and about 19 with oldest-job; per-SHC queue arrivals; `0 violations`. Blue/orange queue bays visible in the 3D apron |
| SHC pre-dispatch | `pnpm run tt:run --fixture shc-prepositioning` (then again with `--strategy shcDispatch=chained-nearest`) | the `STS0n waited N s for a free ground position` lines drop with `predispatch`; `ShcRoutingToParking` events with `predicted` in the log; `0 violations` |
| SHC paired dispatch | `pnpm run tt:run --fixture shc-paired-dual-cycle` (then again with `--strategy shcDispatch=chained-nearest`) | `SHC empty travel` and the empty travel ratio are lower with `paired-dual-cycle` (about 7364 m vs 7665 m); `0 violations`; `lastJobKind` on `shcDispatch` requests in the event log |
| SHCs in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('shc-1sts-2shc-1wtp').then(() => window.__tt.runTo(300)).then(() => { window.__tt.pause(); window.__tt.overlays({ laneGraph: true, reservations: true }) })"` | SHCs on the apron, boxes on pads/yard, cyan lane graph, amber reserved zones |
| Hatch panels in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 4000 --fail-on-error --eval "window.__tt.load('hatch-cover-cycle').then(() => window.__tt.runTo(1000)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001:H00-0', 90))"` (`runTo(590)` for a panel in the air) | the two panels of bay 0 stacked on the quay between the STS legs, the bay a dark pit with its coaming, the other bays still covered; `sceneState().hatchRigs` has every panel drawn |
| Asset budgets (CI) | `pnpm run tt:assets:check` (also in `pnpm test`) | `ok` per GLB with LOD triangles/draw calls, `Budgets: pass`, exit 0 |
| Regenerate assets (needs bpy) | `pnpm run tt:assets --python <venv python>` | GLBs, sidecars, atlas, previews rewritten; budget check passes; `git diff` shows only intended changes |
| Generator is deterministic | `pnpm run tt:assets --check --python <venv python>` | `Regenerated assets are identical to the committed ones`, exit 0 |
| Assets in the real renderer | `pnpm run tt:assets:shots` | PNG per asset × LOD + `yard.png` in `.screenshots/assets/`, no page errors |
| Look at one asset | `pnpm run dev`, open `/sim/terminal-twin?viewer=container-40` (or `?viewer=yard`) | viewer with LOD buttons, livery picker, rig sliders, 20 ft reference box |

Never regenerate goldens to make a failing test pass unless the behaviour change is intended and explained in the commit. Without `--update` / `UPDATE_GOLDEN=1` nothing ever rewrites a golden. Two branches that both regenerate a golden conflict on merge: regenerate on the merged tree instead of hand-merging, and plan a change that moves every golden (a default flip) as its own ticket (`docs/agents/implementing.md`).

All three commands print usage with `--help`. Exit codes: `tt:run` 0 ok / 1 violation or error / 2 usage; `tt:diff` 0 identical / 1 diverged / 2 usage; `tt:golden` 0 all match / 1 drift or missing / 2 usage.


## Folder layout

```
terminal-twin/
├── terminal-twin-AGENTS.md   This guide
├── docs/                     Topic docs (see the pointers above)
├── engine/                   Headless engine — NO DOM/Vue/Three/Node imports (ESLint-enforced)
│   ├── index.ts              Public API barrel: `pnpm run lint` enforces that everything outside engine/ and scenario/ imports engine code only from here (eslint.config.js, no-restricted-imports). Exception, one line: scenario/ deep-imports a few leaf engine files because the engine imports scenario/ (barrel cycles)

│   ├── simulation.ts         createSimulation / restoreSimulation, run loop, snapshot, why, subscribe
│   ├── events.ts             Event envelope + EventPayloads catalogue
│   ├── context.ts            EngineContext + Reactor types (internal behaviour per event type)
│   ├── subsystems/berth.ts   Vessel calls: arrival, berth allocation, anchorage, mooring, crane split, departure
│   ├── subsystems/quay.ts    STS discharge cycle (gantry to bay, deck before hold, twin-20) + work order;
│   │                         ground-position wait/resume; lane reservation while setting down (with SHCs)
│   ├── hatch.ts              Hatch covers, pure: settings (class + `config.hatch`), laydown geometry and its lane-graph check, panel creation (TT-R09)
│   ├── subsystems/hatch.ts   Hatch reactors: lashing release, StsHatchStarted/HatchLifted/HatchSetInLaydown/HatchReplaced/HatchSecured, laydown claim, waits (TT-R09)
│   ├── subsystems/rail.ts    Shared STS rail: reservations, waiting for the rail, free cranes stepping aside
│   ├── subsystems/shc.ts     SHC jobs, pull dispatch, whole-trip planning, parking (TT-05)
│   ├── subsystems/asc.ts     ASC event reactors + phase chain; the subsystem's public exports (TT-06, split in V11-09)
│   ├── subsystems/ascStorage.ts      ASC stack storage: allocation/claim, stack lock, retrievable test, rehandle generation, slot add/remove, block/stall lookups
│   ├── subsystems/ascReservations.ts ASC trips (per job kind), rail/pad planning, partner step-aside commit, `ascPoseAt`
│   ├── subsystems/ascDispatch.ts     ASC job selection, ascDispatch decision, starting a planned job
│   ├── subsystems/ascRail.ts Shared ASC rail of twin blocks: occupancy pieces, rail-segment windows, park holds, step-aside target (TT-08)
│   ├── appointments.ts       Truck appointment windows: cap, booking plan (pure, TT-R15)
│   ├── yardLayout.ts         Block geometry, slot ids (`B01:03-5-2`), `candidateSlots` (pure)
│   ├── laneGraph.ts          Waterside one-way lane graph from config + shortest paths (cached per config)
│   ├── reservations.ts       Conflict-zone time-window reservations (earliestStart / reserve)
│   ├── handlers.ts           HandlerSet re-exports (TOS seams)
│   ├── decisions/            Decision-point framework
│   │   ├── types.ts          Request/reply catalogue, contract versions, HandlerSet, DecisionsConfig
│   │   ├── strategies.ts     Built-in strategy registry (1–3 per decision point) + defaultHandlers
│   │   ├── yardGrouping.ts   Group keys, break rules and the grouped-decking switch
│   │   ├── yardStrategies.ts Yard allocation (random, nearest-wtp, grouped)
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
│   ├── containerFactory.ts   makePlannedContainer / makeContainerState: the ONLY place a container is built (guarded by tests/containerFactory.test.ts); add new container properties here
│   ├── vesselGenerator.ts    generateVessels(...): "Generate N vessels"
│   ├── overrides.ts          Setup-dialog edits (quay length, STS count, vessel table) + validation
│   ├── presets.ts            Preset registry
│   └── fixtures/             definitions.ts → <name>.json (+ <name>.golden.json), index.ts
├── i18n/                     UI text and display formatting (no Vue): messages.ts (catalogue), format.ts, display.ts
├── definition.ts             Home card (keep light: eagerly imported)
├── TerminalTwin.vue          Root component; installs window.__tt in DEV
├── components/, composables/, modules/, store/twinStore.ts   Main-thread browser host (file map in docs/browser-host.md)
├── worker/                   Engine Web Worker (same ESLint bans as engine/)
├── dev/                      devApi.ts (window.__tt), AssetViewer.vue (?viewer=<asset>|yard)
├── assets/                   Phase 2 asset library: budgets.json, generators/ (bpy), models/<group>/ (docs/assets-pipeline.md)
├── cli/                      Node-only: run.ts→runCli.ts (tt:run), diff.ts→diffCli.ts (tt:diff),
│                             golden-cli.ts→golden.ts (tt:golden), handlerSets.ts, build-fixtures.ts, assets/ (tt:assets*)
├── persistence/              Saves: saves.ts (formats, migrations, planLoad), saveStore.ts (IndexedDB)
└── tests/                    Vitest suites (Node-only); tests/browser/*.smoke.ts = Playwright (pnpm run test:smoke)
```

`cli/`, `*.test.ts` and `*.smoke.ts` are type-checked by `tsconfig.tools.json` (Node types + DOM for `page.evaluate`); everything else by `tsconfig.app.json`.

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
const sim = createSimulation(config, handlers?, { seed?, asyncMode?, invariants?: { enabled?, failFast?, sweepEvery? },
                                                 log?: { verbosity?: 'sts=debug,*=warn', write(record) } })
sim.step(); sim.runUntil({ time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate? })
await sim.runUntilAsync(cond?) // same, but awaits async (Promise) handlers instead of stopping
sim.asyncMode               // 'keep-running' | 'pause'
sim.snapshot(); sim.restore(snap); restoreSimulation(snap, handlers?, options?)
// restore throws SnapshotCompatError (engine/schema version, not a snapshot); checkSnapshotCompat(snap) -> {ok:true} | {ok:false, reason, savedEngineVersion, currentEngineVersion} without throwing (planLoad reuses it)
sim.query.container(id) / .containers() / .vessel(id) / .vesselSlot(id) / .sts(id) / .groundPosition(id)
sim.why(eventId)            // [event, parent, …, ScenarioStarted]
sim.inject(type, at, subjects, payload) // schedule an external event as an extra root (causedBy null; dev API / tests)
sim.subscribe(fn, { types? }) // returns unsubscribe
sim.eventLog(); sim.eventLogHash(); sim.kpiReport(); sim.invariantReport(); sim.invariantStats(); sim.status; sim.firstError
summarizeRun(sim)           // RunSummary = CLI --out and golden format
diffEventLogs(logA, logB, { context? }) // { diverged, commonEvents, seq, a, b, differences, before, afterA, afterB }
parseLogVerbosity('asc=debug,*=warn'); toLogRecord(event, verbosity)
```

## Extending

- **Engine imports:** `pnpm run lint` enforces the barrel rule (`eslint.config.js`, `no-restricted-imports`): `engine/` and `scenario/` may deep-import, everything else (modules, components, store, tests) imports engine code from `engine/index.ts`.
- **New event type:** add it to `EventPayloads` in `events.ts`, and add its reactor to a subsystem `ReactorMap` listed in `REACTORS` (`simulation.ts`).
- **New subsystem:** create `engine/subsystems/<name>.ts` that exports a `ReactorMap`, then add it to `REACTORS`.
- **New custody owner kind:** extend `CustodyKind` and add its holders to `custodyHolders()` and `heldAt()` in `invariants.ts`.
- **New invariant:** append it to `INVARIANTS` with a dotted id and `reads` (the entity kinds it looks at: `container`, `yardSlot`, `vessel`, `equipment`, `reservation`, `time`), and add a test that uses a broken handler or reactor to trigger it. One that reads a lot of state should also set `scoped: true` and honour the `scope` argument (the containers, yard columns, equipment and vessels the last event touched); see the cost pitfall below.
- **New fixture:** add it to `scenario/fixtures/definitions.ts`, run `pnpm run tt:fixtures`, import the JSON in `fixtures/index.ts`, then `UPDATE_GOLDEN=1 pnpm test`.
- **Logging a new event type:** nothing to do if its name starts with its subsystem (`AscMoveStarted` → `asc`, level `info`). Otherwise, or for a `debug`/`warn`/`error` level, add it to `EVENT_LOG_META` in `engine/logging.ts`.
- **New CLI strategy for diffs:** add a named handler set to `cli/handlerSets.ts` (or, for one decision point, pass `--strategy <dp>=<name>`; `tt:run` takes the same flag).
- **New equipment kind** (crane, vehicle, …): write `modules/equipmentKinds/<kind>.ts` exporting an `EquipmentKindDef` (`types.ts`: ids, bounds, dev-API state and rig keys, inspector view, optional extra query, scene-renderer factory) and add it to `EQUIPMENT_KINDS` in `modules/equipmentKinds/index.ts`; that is the whole change. The scene renderer (`sceneRenderer.ts`), picking, labels, inspector, store and dev API (`sceneState()` and `view.rigs()`) iterate the registry, so no hub file is edited. Also add the `inspector.kind.<kind>` and `inspector.fact.*` catalogue keys, and keep `modules/equipmentDims.ts` in sync with the model. `tests/equipment-kinds.test.ts` checks the registry (`registrationProblems`) and fails on a half-registered kind. Registry order is the build and update order and the Labels overlay's priority at its cap.
- **New KPI:** append a row to `KPI_DEFS` and an `observe` case in `engine/kpi/collector.ts`, list it in `KPI_GROUPS` (`modules/dashboardModel.ts`) and add a `dashboard.kpi.<id>` catalogue key.
- **Hand-built `Delta` in a test:** start from `emptyDelta()` (`tests/delta.ts`) so a new Delta field never breaks it.
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
- **KPIs:** `kpiReport().handlers[dp]` holds calls, ok/fallbacks/timeouts/errors/lateReplies, pending/maxPending (backlog), sim latency and wall latency (mean/max; sync handlers count as 0 wall ms; also a time series, see below), and `equipmentIdleS` (sim latency × waiting equipment). The CLI prints them under `TOS handlers:`.

**Add a strategy:** add a named entry to `strategies.<dp>.strategies` in `decisions/strategies.ts`. Keep at most 3 per decision point. A strategy must be synchronous and pure, with no `Math.random`. Then add a test that selects it via `config.decisions.points.<dp>.strategy`.

**Add a decision point:**
1. `decisions/types.ts`: add its request to `DecisionRequests`, its reply to `DecisionReplies`, and its version to `DECISION_CONTRACT_VERSIONS`. Bump the version whenever the shape changes.
2. `decisions/strategies.ts`: register 1–3 strategies and a `default`, and add it to `defaultHandlers`.
3. In the asking reactor, call `ctx.requestDecision(dp, request, { equipment: [...] })`, set the equipment to a waiting status, and act on the reply in the subsystem's `DecisionResolved` reactor.
4. Test it in `tests/decisions.test.ts` style: strategy selection, a scripted handler, and a latency case. Then `UPDATE_GOLDEN=1 pnpm test` if fixtures use it.

## TOS module map

Documentation only (spec #106): the TOS is a set of **modules**, each a grouping of existing decision points and functions. No files move. To replace a module, swap its strategy or pass a custom handler (see below); nothing else changes.

| Module | Decision points and functions | Where |
|---|---|---|
| Yard | `yardAllocation` (where a box stacks), `rehandleTarget` (where a blocker goes) | `engine/decisions/strategies.ts`, `engine/yardStacks.ts`, `engine/subsystems/rehandle.ts` |
| Container Allocation | `emptyAllocation` (which empties a load package takes) | `engine/subsystems/empties.ts` |
| Vessel Planning | `craneSplit`, package creation and sequence (`createPackages`, `createLoadOrders`), hatch steps; later the `vesselPlanning.ordering` option | `engine/subsystems/workPackages.ts`, `engine/subsystems/berth.ts` |
| Move Scheduler | `workPackageRelease`, ASC pre-dispatch and pre-retrieval | `engine/subsystems/workPackages.ts`, `engine/subsystems/ascDispatch.ts` |
| Equipment | `berthAllocation`, `stsGroundPosition`, `shcDispatch`, `wtpPadSelection`, `ascDispatch`, `gateLaneAssignment`, `transferStallSelection` | `engine/decisions/`, the equipment subsystems |

## Stored container properties (spec #106, #108)

Every container carries `ContainerState.props` (`scenario/containerProps.ts`), set once at creation and never recomputed: transit direction (IMPORT / EXPORT / TRANSSHIPMENT / STORAGE), ISO type (`22G1`, `45R1`, ...), POL and POD (UN/LOCODEs), tare and cargo weight (kg; an empty box weighs its tare only) and weight class, planned departure (sim s), inbound and outbound carrier, reefer setpoint (reefers only), booking reference, `holds` (always `[]`, carried not enforced). Transit status, content status and dwell are not stored (#109 derives them).

- **Creators:** only `scenario/containerFactory.ts` builds containers. `makeContainerState` requires `props`; the bay plan assigns `PlannedContainer.props` in `assignProps` (end of `planCargo`); pre-filled imports (`prefill.ts`) and truck drops (`landside.ts newBox`) call `drawContainerProps` themselves. Direction by flow: discharge = IMPORT (TRANSSHIPMENT when discharged as such; an empty non-transshipment box is drawn IMPORT/STORAGE from `directionMix`), booked export or truck export = EXPORT, empty pool or truck-dropped empty = STORAGE.
- **Allocation:** when `emptyAllocation` resolves, `allocateEmptyProps` turns the empty into an EXPORT for the package's vessel (still empty, outbound = that vessel, planned departure = its ETD).
- **RNG:** `propsStream(seed, id)` is a stream keyed by seed and container id (like the reefer hash), so it consumes no engine or bay-plan stream and is independent of creation order. `SimState.propsSeed` carries the seed. Draw order inside `drawContainerProps` is fixed (direction, POL, POD, weight, setpoint, booking, dwell): do not reorder it.
- **Planned departure:** outbound vessel ETD (`vesselEtdS`, an estimate: arrival + moves at 25 per STS-hour + 30 min, [A]), else a truck appointment (`PropsInput.appointmentS`; no creator knows one yet), else arrival + expected dwell by direction.
- **Config** (`ScenarioConfig.containerProps`, all optional, defaults in `containerProps.ts`; scenario config only, not the setup dialog; builder `.containerProps()`): `portRotation {terminal, ports[]}` (default ESALG rotation, [A]); `directionMix` (IMPORT vs STORAGE for discharged empties, default 1:3); `cargoWeight` per size (lognormal median, sigma, max); `weightClassBands {lightMaxKg, mediumMaxKg}` (default 12 t / 24 t gross); `expectedDwell` per direction (`DwellDistribution`; imports 3-7 days, storage 5-20 days). `validateContainerProps` runs in `validateScenario`.
- **Inspector and tooltip:** `modules/entityInspector.ts` lists the properties as facts; `EntityView.tooltip` is the key subset, shown as the hover `title` of the selection heading. There is no 3D hover tooltip in the app.
- **Goldens:** unchanged (they hash events and KPIs, and props enter no event). `ENGINE_VERSION` not bumped. A snapshot restored from before #108 has no `props`; the inspector tolerates that.

## Known gaps

Deliberately not built, or built differently from the spec (the code review accepted these):

- **Extra shortcuts** E, I and P and the ASC yield moves go beyond the spec (accepted scope).
- **Hub files** `twinStore.ts` and `engine/subsystems/asc.ts` are large; splitting them was out of scope for the review pass. The per-kind renderer, dev-API and inspector wiring left the hubs in V11-01 (see Extending); `SetupDialog.vue` is a shell (V11-08, #68): `composables/useSetupDraft.ts` holds the draft and provides it, one `components/setup/Setup<Section>Section.vue` per section (layout, vessels, display, STS, landside, SHC, yard, modes, decisions) edits its part, and `components/setup/*Validation.ts` hold each section's readout and submit message (the shell runs them in order); the shell keeps the end-conditions fieldset inline because `tests/setup-inputs.test.ts` reads it from `SetupDialog.vue`, so a new setup section is a component plus a draft field plus a validator; the ASC subsystem split into `asc.ts` / `ascStorage.ts` / `ascReservations.ts` / `ascDispatch.ts` (+ pure `ascRail.ts`) in V11-09.
- **Code-review smells accepted for v1.1 (follow-up, not lost):**
  - Duplicated lock/unlock inputs and readout guards across `SetupStsSection`, `SetupShcSection` and `SetupYardSection`, and across the `*Validation.ts` files. Candidates: a shared `LockUnlockFields` component and a `kinematicsValid` helper.
  - The `sts.ts` and `asc.ts` subsystems repeat the same equipment-kind skeleton.
  - Unnamed magic numbers in `yardValidation.ts` and `shcValidation.ts` (for example 8 rows per bay, a nominal 300 m trip); name them as constants next to the rules they feed.
  - `sceneModel.ts` still has a kind chain (shc, truck, wtpPad, asc, yardSlot, vesselSlot, sts) beside the equipment registry.
  - `devApi.ts` builds the scene state with `state as unknown as SceneState`; give it a typed builder.

## Known behaviours and pitfalls

Gotchas specific to one feature sit in its topic doc. These hold across the engine:

- **`wtpPadSelection` (V11-11):** SHC dispatch (`shcDispatch` v2, reply `{jobId}`) picks a job; a discharge job is then held by the SHC (`waiting-for-pad`, no longer open) while `wtpPadSelection` (reply `{wtpPadId}`) answers; load jobs name their own pad and never ask. A `null` pad gives the job back and parks the SHC. Strategies `first-free` (default), `nearest-box`, `last-free`. With latency on it, two SHCs asking at once can get the same pad (a stale reply, like the other points): invariants flag it.
- **ASC pre-retrieval (TT-R17, ENGINE_VERSION 0.24.0):** the `pre-retrieval` `ascDispatch` strategy fetches an import box to the transfer stall before its truck arrives (stall reserved and trip planned, truck within 150 s, empty chassis, no drop leg); the ASC hovers over the stall until the truck is there. Opt-in by strategy, so only the new fixture `asc-pre-retrieval` has a new golden; `AscJobAssigned.early`. Details: [docs/yard-and-landside.md](docs/yard-and-landside.md).
- **SHC paired dispatch (TT-R14, ENGINE_VERSION 0.23.0):** `shcDispatch` strategy `paired-dual-cycle` (chained dispatch plus pairing): after a discharge delivery at a pad an SHC prefers a nearby open load pickup, after a load delivery at the quay a discharge pickup (within `PAIRING_RADIUS_M`, 150 m), so SHCs drive loaded more often; any SHC may serve any STS or block. Optional `lastJobKind` on `ShcDispatchRequest` / `ShcState` (set only under this strategy; existing goldens unchanged), fixture `shc-paired-dual-cycle`. Details: [docs/quay-and-horizontal.md](docs/quay-and-horizontal.md#paired-dischargeload-dispatch-tt-r14-engine_version-0230).
- **Grouped yard decking (spec #106, #111, opt-in):** `yardAllocation` has three strategies, `random`, `nearest-wtp` (still the default; the default flip is its own ticket) and `grouped`, which replaced `group-by-vessel` (no alias: a saved config naming it fails with the list of available names). Groups (`engine/decisions/yardGrouping.ts`): imports by line (a later planned departure above an earlier one counts as broken order), exports by outbound vessel and POD (heavier above lighter is broken order), transshipment by onward vessel and POD, storage empties by line, size and ISO type; reefers keep to powered rows through `candidateSlots`. `groupedSlot` prices every legal slot like nearest-wtp plus a mismatch cost (another group below 90, wrong order 45, opening a stack in a bay of other groups only 25, a bay already holding the group -10), so a mismatch never removes a slot. Request: optional `box` and `stackTops` (`YardBoxView`, from `props`; stack tops from `stackTopsOf`, claims included) are added only when the scenario's strategy is `grouped`, so every other run keeps its event log; the pre-fill (boxes do not exist yet) sends none and `grouped` then falls back to keeping a vessel together. KPI: `kpis.yard.grouping {placements, mixedStack, orderBroken, mixedBay}`, counted at slot claim, present only for `grouped`. Select with `decisions.points.yardAllocation.strategy: 'grouped'` or `--strategy yardAllocation=grouped`. Fixture `yard-grouped` (+ golden); `tests/yard-grouped.test.ts` runs it with the built-in and with a nearest-wtp handler over the same counters.
- **Reefers and powered rows (R19, ENGINE_VERSION 0.22.0):** `cargo.reeferShare` (default 0) flags full boxes as reefers by a hash of the container id (no RNG stream, so goldens do not move); `BlockConfig.poweredRows` lists the plugged rows. `YardStacks` gains optional `reefer` and `poweredRows` (fill them with `reeferFields(block, box.reefer)`), and `candidateSlots` offers a reefer only powered rows below tier 5 (`REEFER_MAX_TIERS` 4). New invariant `yard.reefer-powered`; fixture `reefer-powered-rows`; TTI presets carry unverified values. Details in [docs/yard-and-landside.md](docs/yard-and-landside.md#reefers-and-powered-rows-r19-engine_version-0220).
- **SHC pre-dispatch (TT-R13, ENGINE_VERSION 0.21.0):** `sim.predictedReady()` publishes predicted ready times (quay: in-flight set-downs exact, next boxes estimated incl. hatch cycle; ASC: planned pad set-downs exact). The `shcDispatch` strategy `predispatch` (chained-nearest plus engine-side sending) moves an idle SHC to the queue area of a box predicted ready within travel time + `queueAreas.predispatchMarginS` (default 15 s); it claims a queue spot, never a job, so nothing is collected early. Optional `predicted` on `ShcRoutingToParking`, `StsDrop.groundAt`, fixture `shc-prepositioning`; existing goldens unchanged. Details: [docs/quay-and-horizontal.md](docs/quay-and-horizontal.md#shc-pre-dispatch-on-predicted-ready-time-tt-r13-engine_version-0210).
- **SHC queue areas and chained dispatch (TT-R12, ENGINE_VERSION 0.20.0):** `config.queueAreas` adds queue spots (lane-graph nodes of kind `queue`) per STS and per block; loaded SHCs wait at a block spot for a free WTP pad, `chained-nearest` SHCs wait at the nearest spot instead of driving home while there is work. New statuses `queuing-for-pad` / `queuing-for-work`, events `ShcQueued` / `ShcQueueDeparted`, state `queueClaims`, invariant `shc.waiting-positions`, per-SHC KPIs `parkingReturns` / `queueArrivals`, fixture `shc-queue-chained`; TTI presets set the areas and the strategy. Goldens changed only by the two new KPI fields. Details: [docs/quay-and-horizontal.md](docs/quay-and-horizontal.md#shc-queue-areas-and-chained-dispatch-tt-r12-engine_version-0200).
- **Stall admission and holding (TT-R16, ENGINE_VERSION 0.19.0):** `landside.holding` makes the gate admit a truck only with a reserved stall or a reserved holding position; holding trucks wait on dead-end spurs off every road, overflow waits outside the gate. Opt-in, so only the new fixture `truck-holding-overflow` has a new golden; invariants `landside.stall-exclusive`, `landside.waiting-off-road`, `landside.leaves-complete`. Details: [docs/yard-and-landside.md](docs/yard-and-landside.md).
- **Truck turnaround metrics (TT-R18, ENGINE_VERSION unchanged at 0.19.0):** KPI fields only. `kpiReport().landside` gains `gateProcessingS`, `internalDriveS`, `totalTurnaroundS` (arrival to gate-out), `road`, `holding.utilisationPct` and `appointments.delayed`; the collector gains the matching `landside.*` series; the Landside dashboard group, its summary table, the exports and the CLI show them. Five landside goldens gained KPI fields (event hashes unchanged). Definitions and tests: [docs/yard-and-landside.md](docs/yard-and-landside.md) (last section).
- **Truck appointments (TT-R15, ENGINE_VERSION 0.18.0):** `landside.appointments` books 30-minute windows (capped by gate and stall capacity, bunching for peaks) instead of Poisson arrivals; absent config keeps every older golden. Only the new fixture `truck-appointment-windows` has a golden. Details: [docs/yard-and-landside.md](docs/yard-and-landside.md).
- **Hatch covers (TT-R09, ENGINE_VERSION 0.15.0):** each 40 ft bay has a hatch of N panels (`state.hatchPanels`, not containers); `hatch-remove` / `hatch-replace` work packages make the STS lift panels to a quay laydown and back, lashing release before and securing after, all counted as STS time and turnaround. On by default (`config.hatch.enabled: false` turns it off); with it on a crane works bay by bay (deck discharge, remove, hold discharge, hold load, replace, deck load) instead of all discharge first. The `workPackageRelease` contract is version 2. All presets run with it; every fixture except `hatch-cover-cycle` and `hatch-deck-only-no-open` sets `enabled: false`. Panel counts per class differ from the spec's example (feeder 2, ULCV 4) because a panel must fit the laydown bay. Details, invariants and gotchas: [docs/quay-and-horizontal.md](docs/quay-and-horizontal.md#hatch-covers-tt-r09-engine_version-0150). The 3D view draws the panels from engine state (TT-R10, rendering only: `Delta.hatch`, equipment kind `hatch`, hull opened under them; see the topic doc). It also fixed two latent same-instant races (empty `craneSplit` re-asked in a loop; two SHCs handed the same job or pad), see the topic doc.
- **No 20 on a 40 on board (R07, ENGINE_VERSION 0.14.0):** the bay plan stacks twin-20 cells first, then 40 ft cells or lone 20 halves, and `stowage.order` rejects a 20 over a 40 and a 40 over a single 20 half (detail in `docs/yard-and-landside.md`).
- **One length per yard stack (R06, ENGINE_VERSION 0.13.0):** `YardStacks.stackSpans` (derived by `stackSpansOf`, never stored) makes `candidateSlots` offer a 20 only on empty or 20 ft stacks and a 40 only on two empty or two 40-locked stacks of equal height; new invariant `yard.no-mixed-length-stack`; fixture `yard-no-mixed-length`. Any code that builds a `YardStacks` must fill `stackSpans`. Details in [docs/yard-and-landside.md](docs/yard-and-landside.md#asc-block-storage-tt-06).
- **Handler latency series (V11-16, ENGINE_VERSION 0.12.0):** `DecisionResolved.payload.wallLatencyMs` is the measured wall latency of the reply (injected delay + time an async handler took; also on the fallback's `DecisionResolved` after a timeout/error). It is absent when 0, so runs without latency keep their logs and goldens unchanged (no golden changed). In pause mode the log equals the no-latency run apart from this field. The KPI `handler.wall-latency-s` (mean wall latency of the replies resolved in each bucket) is derived from it and shown on the dashboard's TOS handlers tab; a real async handler makes the payload (and series) timing-dependent, as it must.
- **Truck exports in every start mode (V11-14, ENGINE_VERSION 0.12.0):** with a legacy or pre-filled start a truck-delivered export box is booked on arrival to a new `load` slot of its vessel's bay plan (`bookExtraExport` in `engine/subsystems/landside.ts`, cell from the pure `extraLoadCell` in `scenario/bayPlan.ts`: a stack with no discharge or empties slot, bottom-up, bays with the fewest slots first, a 20 ft box first completes a lone aft half). The slot is added to `state.vesselSlots` with `plannedContainerId`, `vessels[v].remainingLoad++`, and the `TruckArrived` leg carries `slotId`; the vessel has to be `scheduled` (so no work package exists yet) and have room, else it is not offered to export trucks. The KPI collector adds each booked leg to the vessel's moves, so `vessel.remaining-moves` ends at 0. The three landside goldens changed only in `eventLogHash` (leg `slotId`). Empty/warm-up starts still deliver the booked boxes. Test: `tests/truck-exports-booked.test.ts`.
- **STS ground wake-up (V11-15, ENGINE_VERSION 0.11.0):** an STS in `waiting-for-ground-position` (handler returned `null`) asks again on a freed position (SHC pick, `StsLoadPicked`) or after `layout.stsGroundRetryS` (default 30 s, 0 = timer off) via `StsGroundPositionWaitBackoff` -> `StsGroundPositionWaitEnded` -> a new `stsGroundPosition` request. A handler that always returns `null` keeps asking every back-off. No golden changed.
- **Pre-run phase (V11-13, ENGINE_VERSION 0.10.0):** a `prefilled` start places its boxes through the decision runtime before the scenario starts. `createSimulation` runs it to the end with a synchronous handler; with an async `yardAllocation` handler it stays in flight (`waiting-for-decision`; `runUntilAsync` completes it). Every pre-run `DecisionRequested`/`DecisionResolved`/`DecisionFailed` has `payload.preRun: true`, is at sim time 0 whatever latency is injected (the wall latency is still recorded in the handler KPIs), and comes before `ScenarioStarted` (which the last pre-run decision schedules). The KPI collector skips pre-run events (series, `yard.fill-pct` etc. start as before). Invariants are swept once at the end of the phase, not per event. A snapshot taken mid pre-run resumes (`state.prefill.replies`). Filter on `payload.preRun` when counting decisions. No fixture uses a pre-filled start, so no golden changed. Details: [docs/yard-and-landside.md](docs/yard-and-landside.md).
- **SHC cornering (V11-12, ENGINE_VERSION 0.9.0):** SHCs take right-angle turns at `min(vMax, sqrt(maxLateralAccel x cornerRadiusM))` (defaults 1.5 m/s², 12 m: about 4.2 m/s) and still stop for reversals, locks and pads. A motion segment carries optional `v0`/`v1` (entry/exit speed); the two runs at a turn share that speed, so every end time is still known at dispatch. `ShcKinematics.cornerRadiusM: 0` restores stop-at-every-turn. Trucks (landside) still stop at turns. All SHC fixture goldens changed on purpose: shorter trips, so one SHC now takes every box on `shc-1sts-2shc-1wtp`.
- **Maritime location notation (TT-R08, no ENGINE_VERSION change):** `modules/locationNotation.ts` (pure, `createLocationNotation(config)`, store `locations`) maps internal vessel and yard slot ids to `VESSEL.V01.04.02.82` / `YARD.B01.03.02.1` for display only; the inspector's "Held by" fact, custody history and a "Locations" list under an event payload use it (vessel locations carry the vessel name; a yard bay depends on the box size, so the payload list takes it from the payload's `containerId`). Engine ids, payload JSON, saves and goldens are unchanged. Rules in [GLOSSARY.md](../../../GLOSSARY.md); tests `tests/location-notation.test.ts`. Details in [docs/browser-host.md](docs/browser-host.md).
- **SHC operational states (TT-R11, no ENGINE_VERSION change):** seven states mapped from `ShcStatus` in `engine/shcStates.ts`, time per state and handovers as KPIs (collector, report, headline, CLI, exports), operational state in the inspector. Goldens changed only by the new `stateS` / `handovers` fields. Details in [docs/kpis-dashboard.md](docs/kpis-dashboard.md).
- `kpis.handlers` omits decision points that were never called (so fixtures without SHCs keep their goldens).
- Shortest paths are cached per lane graph (WeakMap on the config object) and the lane graph per config object: do not mutate a config after `createSimulation`.
- Every decision adds two events (`DecisionRequested`, `DecisionResolved`) to the log. The tracer golden went from 35 to 55 events in TT-03, with KPIs unchanged. Every run has berthAllocation and craneSplit pairs before the first STS move, so tests must filter on `payload.decisionPoint` (see `gpEvent`/`gpOfType` in `tests/decisions.test.ts`).
- An injected delay of at least `timeoutMs` (default 5 s) is a timeout. Raise `timeoutMs` when you inject long latencies.
- A reply computed at request time is delivered later in keep-running mode, so it can be stale. That is realistic: a reply with an invalid ground position surfaces as an invariant violation.
- **Invariant cost (V11-18):** invariants are checked incrementally. After an event `InvariantTracker.check` runs only the invariants whose `reads` overlap the event's subjects, and the scoped ones (custody, the six yard rules, reservations, ASC passing, landside segregation, stowage order) look only at the touched boxes, yard columns, equipment and vessels. The tracker remembers each box's last custody owner and yard columns, so a box that left a place still marks it. A full sweep runs on the first check, every `invariants.sweepEvery` events (default 1000, `DEFAULT_SWEEP_EVERY`) and at the end of every run. So an incremental check catches a violation at its exact event, but a violation in state the event did not name (a box changed without being a subject, or a rule broken by the passage of time alone) only surfaces at the next sweep and is attributed to the event where the sweep ran. **When an event changes a container's custody or yard slot, list the container in its `subjects.containers`**; `tests/invariants-incremental.test.ts` guards this on seven fixtures. `sim.invariantStats()` gives incremental checks, sweeps and wall ms; `tt:bench` prints invariant time on its own line.
- Snapshots embed the full event log. `--from-snapshot` runs write only the window's events/log lines, but KPIs and the event-log hash in the summary are cumulative from t = 0.
- `--until time:T` leaves `now = T`, so a snapshot taken there resumes at exactly `T`; events at `t ≤ T` are in the snapshot, the window holds `t > T`.
- Handlers are not in snapshots: pass the same `--handlers` when resuming a window.
- Logs are derived from committed events only; there is no free-text reactor logging yet.
- The `ScenarioEnded` and `InvariantViolated` events are committed directly. They are not queued and are not invariant-checked.
- Piping `tt:run` into `head` gives a harmless EPIPE stack trace.

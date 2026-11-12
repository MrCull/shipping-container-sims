# Terminal Twin, Agent Guide

## Overview

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root, use its terms in code, tests and docs. Background on the real terminal and the sim's deliberate deviations: [knowledge-base/dk_ops__tti_algeciras_operations.md](../../../knowledge-base/dk_ops__tti_algeciras_operations.md). Reference photos: `docs/reference/` at the repo root.

The headless engine covers vessels and berthing, STS cranes and hatch covers, SHC transport, paired ASC block storage, export load, transshipment and empties, rehandles, landside trucks, the yard start modes, KPIs and end conditions, and the TOS decision points. The browser host runs the engine in a Web Worker and adds a 3D scene (Blender-generated GLB assets), debugger, dashboard, saves and rewind, and locale and units.

**Sim ID:** `terminal-twin`. **Engine version:** `engine/simulation.ts#ENGINE_VERSION`.

## Docs

A full doc set for agents lives in [`docs/`](docs/): architecture, data structures, algorithms, every subsystem, decision point and invariant, the tooling, and three optimisation guides. Each file answers one question, cites code as `path#symbol`, and states the `ENGINE_VERSION` it was checked against. Start at the index: **[docs/README.md](docs/README.md)**.

Main entry points:

- [docs/architecture.md](docs/architecture.md): layers, folder map, data flow, determinism contract, public engine API, how to extend.
- [docs/engine-core.md](docs/engine-core.md): event queue, step loop, reactors and handlers, causality, RNG, motion, hashing, snapshots.
- [docs/state-model.md](docs/state-model.md): `SimState`, every entity, the derived indexes.
- [docs/decision-points.md](docs/decision-points.md): every TOS seam with its strategies and defaults (the main operational tuning lever).
- [docs/invariants.md](docs/invariants.md): every invariant and its cost.
- Optimising: [run speed](docs/optimising/run-speed.md), [terminal throughput](docs/optimising/terminal-throughput.md), [frame rate](docs/optimising/frame-rate.md).
- [docs/pitfalls-and-gaps.md](docs/pitfalls-and-gaps.md): known behaviours, pitfalls and gaps. Read before changing engine behaviour.

Which doc to read for a change:

| Changing | Read |
|---|---|
| Berthing, crane split, STS rail and cycle, hatch covers, work packages, vessel ordering, stow sequence, ROB bays | [docs/subsystems/quay.md](docs/subsystems/quay.md) |
| SHC dispatch, lane graph, reservations, WTP pads, queue areas | [docs/subsystems/horizontal.md](docs/subsystems/horizontal.md) |
| ASC storage, rail and dispatch, yard allocation, rehandles, load prep, transshipment, empties, yard start modes, yard deadlock | [docs/subsystems/yard.md](docs/subsystems/yard.md) |
| Trucks, gate, appointments, transfer points | [docs/subsystems/landside.md](docs/subsystems/landside.md) |
| KPIs, end conditions, summaries, goldens, exports, profiler | [docs/kpis-and-reports.md](docs/kpis-and-reports.md) |
| Presets, fixtures, layout derivation, validation, saves, snapshots, rewind | [docs/scenarios-and-persistence.md](docs/scenarios-and-persistence.md) |
| `tt:*` commands and helper scripts | [docs/cli-and-tooling.md](docs/cli-and-tooling.md) |
| Worker, playback, `SceneModel`, dashboard, debugger, inspector, bay viewer, colour by, locale, shortcuts, `window.__tt` | [docs/browser-host.md](docs/browser-host.md) |
| 3D scene, equipment rigs, hulls, quality tiers, lighting (sky environment, contact shadows), far tier, sound, scenery | [docs/rendering-3d.md](docs/rendering-3d.md) |
| Blender generators, budgets, sidecars, liveries, synthesized sounds | [docs/assets-pipeline.md](docs/assets-pipeline.md) | Hero container faces (`hero` group, dev viewer `?viewer=hero-box-40`): same doc. Hero level renderer (#258): `docs/rendering-3d.md` (Hero level), `modules/heroRenderer.ts`.

Measured runs (keep adding, do not rewrite): [docs/reports/](docs/reports/).

**Keep the docs in sync.** A change to engine behaviour, a strategy or its default, a KPI, an invariant, a CLI flag or a renderer updates the matching doc in the same PR and bumps that doc's `Checked against ENGINE_VERSION` line. New measurements go in a new section under `docs/reports/`.

## How to prove a change works

| Kind of change | Command | What "works" looks like |
|---|---|---|
| Anything | `pnpm run verify` | lint, build (incl. `vue-tsc` for engine, CLI and tests) and `pnpm test` all pass |
| Real frame rate | in-app browser, `dev` entry of `.claude/launch.json` (port 5174; it runs on the real GPU) | Open `/sim/terminal-twin`, wait for `window.__tt` (dev builds only), then `await __tt.load('TTI Algeciras baseline'); await __tt.runTo(4*3600); __tt.pause(); __tt.cameraTo('STS104', 1100); __tt.setQuality('high')` and average `__tt.perf().stats` over several 1 s samples per setting. Compare `stats.cpuMs` and `poseMs` with 16.7 ms: above it, fps quantises to 30 and the main thread, not the GPU, is the limit. Record numbers in `docs/optimising/frame-rate.md`. `pnpm run tt:baseline` (heavy) is the headless version: posing ms per frame at the Overview camera plus the engine's achieved rate per speed step; `stats.boxesPosed` and `stats.instanceBytes` are the per-frame counters. `tests/drawn-boxes.test.ts` pins which boxes are drawn and with which matrices (posing changes must keep `drawn-boxes.reference.json` identical). |
| Engine behaviour | `pnpm test` | all Vitest suites pass, including golden summaries |
| One scenario, by hand | `pnpm run tt:run --fixture tracer-1sts-10-boxes` | `Stopped: ended`, `0 violations`, `First error: none`, exit code 0 |
| Several variants at once | `scripts/proof-runner.sh "--fixture <name>" "--fixture <name> --seed 7"` | one table: exit code, wall seconds, moves, violations per variant (exit 0, `0` violations); one log per variant in the printed dir; runs under the heavy lock |
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
| Browser / UI / 3D view | `pnpm run test:smoke` | Playwright smoke tests in `tests/browser/*.smoke.ts` pass (dev server + a production build). Not part of `pnpm test`; CI runs them in the required `smoke` job (`--grep-invert @load`). Specs tagged `@load` need a real frame rate and never run in CI: run them locally. Write frame-based checks with `tests/browser/frameSampling.ts` (ratios over a minimum wall-clock window, never absolute frame counts). |
| Look at the 3D view | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('tracer-1sts-10-boxes').then(() => window.__tt.runTo(330)).then(() => window.__tt.pause())"` | PNG in `.screenshots/` shows the STS mid-cycle, no page errors |
| UI text, locale, units, shortcuts, keyboard camera | `pnpm test` (`keyboard-camera`, `display-format`, `display-settings`, `message-catalogue`) + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-display.smoke.ts` and `terminal-twin-keyboard-camera.smoke.ts` | catalogue audit lists no hard-coded strings; locale/units/shortcut smoke tests pass |
| Saves, snapshots, rewind | `npx vitest run src/sims/terminal-twin/tests/{saves,persistence-host,persistence-controller}.test.ts` + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-saves.smoke.ts` | formats and migration, replay-based restore and rewind give the original event-log hash; smoke covers reload, file round-trip, version mismatch, no IndexedDB |
| Debugger and inspector (breakpoints, step, cause chain, picking, follow, overlays) | `npx vitest run src/sims/terminal-twin/tests/{breakpoints,debugger-host,debugger-controller,event-feed,event-inspector,entity-inspector,picking}.test.ts` + `npx playwright test --project=dev src/sims/terminal-twin/tests/browser/terminal-twin-debugger.smoke.ts` | Vitest proves the logic through the worker host and an in-process controller; the smoke spec clicks, steps, pauses at breakpoints and checks the overlays against `sceneState()` |
| Debugger in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 2500 --fail-on-error --eval "window.__tt.load('shc-1sts-2shc-1wtp').then(async () => { await window.__tt.addBreakpoint('eventType','ShcDroppedAtWtp'); await window.__tt.runTo(1e5); window.__tt.overlays({occupancy:true,labels:true}); window.__tt.select('SHC01'); window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'})) })"` | feed on the left with the breakpoint hit highlighted, inspector on the right (event, payload, cause chain), labels and pad plates in the scene |
| KPIs, end conditions, report, export | `pnpm run tt:run --fixture asc-1sts-10-boxes-1block --end moves:5 --kpi-csv /tmp/k.csv --kpi-json /tmp/k.json` + `npx vitest run src/sims/terminal-twin/tests/{kpi-*,end-*,cli-kpi}.test.ts` + `npx playwright test terminal-twin-kpi` | `Headline KPIs:` block, `Stopped: ended (moves >= 5)`; files parse; smoke shows the strip, the report and downloads |
| Dashboard (charts, heatmap, Gantt, lazy ECharts) | `npx vitest run src/sims/terminal-twin/tests/dashboard` + `npx playwright test dashboard` (dev and prod projects) | Vitest: timeline, palette, view models, options, host query, lazy-import scan; smoke: ECharts chunk absent until B, 24 h series zoom, heatmap = engine fill, Gantt windows = vessel state, final report tab |
| Grouped yard decking | `pnpm run tt:run --fixture yard-grouped` (and `--strategy yardAllocation=nearest-wtp` to compare; the rollback) + `npx vitest run src/sims/terminal-twin/tests/yard-grouped.test.ts` | `yardAllocation  strategy:grouped` (the default since 0.25.0), 0 violations, `kpis.yard.grouping` counts; the test shows grouped breaking fewer preferences than nearest-wtp on the same boxes |
| Fixture definition change | `pnpm run tt:fixtures`, then `pnpm run tt:golden --update` | committed fixture JSON matches `definitions.ts` |
| Hatch covers | `pnpm run tt:run --fixture hatch-cover-cycle` (and `--fixture hatch-deck-only-no-open`) + `npx vitest run src/sims/terminal-twin/tests/hatch.test.ts` (3D: `tests/hatch-scene.test.ts`, `pnpm run test:smoke terminal-twin-hatch`, screenshot below) | `Hatch covers:` block with moves, STS time and lashing wait, `0 violations`; deck-only run has no `Hatch covers:` line; the test file proves event order and causality, laydown clear of the lane graph, KPIs and all seven `hatch.*` invariants on tampered snapshots |
| Vessel ordering (`pod-weight`) | `pnpm run tt:run --fixture vessel-ordering-pod-weight` (also `--fixture <any> --ordering pod-weight`) + `npx vitest run src/sims/terminal-twin/tests/vessel-ordering.test.ts` | `0 violations`; the test proves tier order (highest tier first on discharge, lowest first on load, #174), unchanged packages and hatch steps, unchanged packages and hatch steps, a load that completes with trucks delivering out of order, config/CLI selection and that `as-today` leaves the event-log hash alone |
| Berthing / anchorage | `pnpm run tt:run --fixture two-vessels-compete-for-berth` | V002 `anchorage` > 0 s, `Quay: 1 vessel(s) waited`; `tests/berthing.test.ts` |
| Crane split / rail order | `pnpm run tt:run --fixture crane-split-4sts --strategy craneSplit=equal-bays` (vs the default `balanced-moves`) | 4 STS lines with different move counts, 0 violations (`sts.rail-order` is checked after every event); `tests/crane-split.test.ts` |
| Twin-20 | `pnpm run tt:run --fixture twin-20-lift` | `4 moves in 2 cycles (2 twin-20)`; `tests/vessels.test.ts` |
| STS productivity (where crane time goes) | `pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:7200 --events /tmp/peak.jsonl` (about 1 to 4 minutes), then `pnpm run tt:sts /tmp/peak.jsonl --until 7200` | per crane and overall: moves, gross moves per hour and the share of time in `cycle`, `hatch`, `lashing`, `ground`, `box`, `rail`, `reposition`, `done`; `tests/sts-productivity.test.ts` |
| Where a run's time goes (profiler: hourly moves per STS, ASC and SHC idle share, box waits) | `pnpm run tt:profile mixed-discharge-then-load --until 2000 [--json /tmp/profile.json]` (or `pnpm run tt:profile "TTI Algeciras baseline" --until 600`; `--until` is sim seconds and required) + `npx vitest run src/sims/terminal-twin/tests/{box-waits,cli-profile,sts-productivity}.test.ts` | `Moves per clock hour` (one row per STS), `ASC idle share` and `SHC idle share` (per clock hour and for the run), the `STS time breakdown` (the same table as `tt:sts`), `Box waits` (mean seconds per box for discharge and load: `yard`, `horizontal`, `sts`) and `Top waits` (longest first, `open` if still waiting at the end). The box-wait test folds synthetic event logs and the CLI test checks every number against the KPI collector |
| Vessels in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('crane-split-4sts').then(() => window.__tt.runTo(1500)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001'))"` | hull at its berth, four STS along it, deck boxes on the hatch covers |
| SHC transport | `pnpm run tt:run --fixture shc-1sts-2shc-1wtp` | `Horizontal: 10 boxes to WTP pads`, per-SHC jobs/distances/reservation wait/handovers and state time (TT-R11, 7 operational states), headline SHC empty travel, handovers and state time, `0 violations` |
| SHC dispatch and pad strategies | `pnpm run tt:diff --fixture shc-1sts-2shc-1wtp --b-handlers nearest-job` (nearest job + `wtpPadSelection` `nearest-box`; or `tt:run … --strategy shcDispatch=nearest-job` / `--strategy wtpPadSelection=nearest-box`) | first divergence at the first `wtpPadSelection` `DecisionResolved` (`payload.reply.wtpPadId`); `shcDispatch` replies only `{jobId}` |
| SHC queue areas / chained dispatch | `pnpm run tt:run --fixture shc-queue-chained` (then again with `--strategy shcDispatch=oldest-job`; `--events` files go to `pnpm run tt:diff`) | `Horizontal: ... N parking returns` is 0 with chained-nearest and about 19 with oldest-job; per-SHC queue arrivals; `0 violations`. Blue/orange queue bays visible in the 3D apron |
| SHC pre-dispatch | `pnpm run tt:run --fixture shc-prepositioning` (then again with `--strategy shcDispatch=chained-nearest`) | the `STS0n waited N s for a free ground position` lines drop with `predispatch`; `ShcRoutingToParking` events with `predicted` in the log; `0 violations` |
| SHC paired dispatch | `pnpm run tt:run --fixture shc-paired-dual-cycle` (then again with `--strategy shcDispatch=chained-nearest`) | `SHC empty travel` and the empty travel ratio are lower with `paired-dual-cycle` (about 7364 m vs 7665 m); `0 violations`; `lastJobKind` on `shcDispatch` requests in the event log |
| SHCs in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('shc-1sts-2shc-1wtp').then(() => window.__tt.runTo(300)).then(() => { window.__tt.pause(); window.__tt.overlays({ laneGraph: true, reservations: true }) })"` | SHCs on the apron, boxes on pads/yard, cyan lane graph, amber reserved zones |
| Bay viewer | `pnpm run screenshot --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('crane-split-4sts').then(() => window.__tt.runTo(1500)).then(() => window.__tt.pause()).then(() => window.__tt.select('V001')).then(() => new Promise(r => setTimeout(r, 800))).then(() => document.querySelector('[data-testid=tt-open-bay-viewer]').click())"` + `npx vitest run src/sims/terminal-twin/tests/bay-view.test.ts` + `pnpm run test:smoke --project=dev --grep "bay viewer"` | popup top left: deck and hold of one bay, bay strip with progress, work packages with state, key; Vitest proves cells, states, colour modes, ROB cells and navigation, the smoke spec clicks the vessel, steps bays and sees a cell go planned to done |
| Colour by | `npx vitest run src/sims/terminal-twin/tests/colour-by.test.ts` + `pnpm run test:smoke --project=dev --grep "colour by"` | every mode colours every box and its legend lists the key; the menu changes 3D tints and bay viewer cells and closes on the pick, the ROB display (Show, Grey, Hide) draws the ROB boxes, reload (`.screenshots/colour-by.png`) |
| Hatch panels in 3D | `pnpm run screenshot --path /sim/terminal-twin --wait 4000 --fail-on-error --eval "window.__tt.load('hatch-cover-cycle').then(() => window.__tt.runTo(1000)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001:H00-0', 90))"` (`runTo(590)` for a panel in the air) | the two panels of bay 0 stacked on the quay between the STS legs, the bay a dark pit with its coaming, the other bays still covered; `sceneState().hatchRigs` has every panel drawn |
| Vessel covers with hatch covers off (#173) | `npx vitest run src/sims/terminal-twin/tests/hatch-scene.test.ts` (its GLB cases decode every hull LOD and check that no cover stands over a bay) + `pnpm run test:smoke --project=dev terminal-twin-hatch` | every hull LOD has its covers cut over every bay (`sceneState().vesselHulls[id].openHatchBays` lists them all); with hatch covers on only the panel bays are cut |
| Screenshot: fixture vessel mid-discharge, hatch off | `pnpm run screenshot --path /sim/terminal-twin --wait 4000 --fail-on-error --eval "window.__tt.load('tracer-1sts-10-boxes').then(() => window.__tt.runTo(330)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001'))"` | the holds open (dark pits inside the coamings, no cover plates), the STS lifting at the aft holds; committed as `docs/prototypes/173/hatch-off-hull-open-mid-discharge.png` |
| Scenery road ends at the land edge (#172) | `npx vitest run src/sims/terminal-twin/tests/scenery-road.test.ts src/sims/terminal-twin/tests/tti-road.test.ts` + `pnpm run screenshot --path /sim/terminal-twin --wait 8000 --fail-on-error --eval "window.__tt.load('TTI Algeciras baseline').then(() => window.__tt.runTo(1500)).then(() => window.__tt.pause()).then(() => window.__tt.viewPreset('overview'))"` | the road stops at the North Quay's water face with the sea channel beyond it, and joins the access road junction; the test proves the stand-in and the GLB (decoded, clipped on load) both end at `TTI_ROAD_NORTH_END_X` |
| Asset budgets (CI) | `pnpm run tt:assets:check` (also in `pnpm test`) | `ok` per GLB with LOD triangles/draw calls, `Budgets: pass`, exit 0 |
| Synthesized sounds (CI) | `pnpm run tt:sounds:check` (regenerate with `pnpm run tt:sounds`; also in `pnpm test`) | `Sounds are up to date.`, exit 0; drift names the file |
| Regenerate assets (needs bpy) | `pnpm run tt:assets --python <venv python>` | GLBs, sidecars, atlas, previews rewritten; budget check passes; `git diff` shows only intended changes |
| Generator is deterministic | `pnpm run tt:assets --check --python <venv python>` | `Regenerated assets are identical to the committed ones`, exit 0 |
| Assets in the real renderer | `pnpm run tt:assets:shots` | PNG per asset × LOD + `yard.png` in `.screenshots/assets/`, no page errors |
| Look at one asset | `pnpm run dev`, open `/sim/terminal-twin?viewer=container-40` (or `?viewer=yard`) | viewer with LOD buttons, livery picker, rig sliders, 20 ft reference box |

Never regenerate goldens to make a failing test pass unless the behaviour change is intended and explained in the commit. Without `--update` / `UPDATE_GOLDEN=1` nothing ever rewrites a golden. Two branches that both regenerate a golden conflict on merge: regenerate on the merged tree instead of hand-merging, and plan a change that moves every golden (a default flip) as its own ticket (`docs/agents/implementing.md`).

All three commands print usage with `--help`. Exit codes: `tt:run` 0 ok / 1 violation or error / 2 usage; `tt:diff` 0 identical / 1 diverged / 2 usage; `tt:golden` 0 all match / 1 drift or missing / 2 usage.


## Extending (checklist)

Full detail: [docs/architecture.md#extending](docs/architecture.md#extending) and, for strategies, [docs/decision-points.md](docs/decision-points.md).

- Engine imports go through `engine/index.ts` outside `engine/` and `scenario/` (lint enforces it).
- New event type: `EventPayloads` in `engine/events.ts` plus a reactor in a subsystem `ReactorMap` listed in `REACTORS` (`engine/simulation.ts`).
- New invariant: append to `INVARIANTS` with a dotted id, `reads` and (if it reads a lot) `scoped: true`; add a test that triggers it.
- New strategy: register it for its decision point. Note that some strategies (chained, paired, predispatch SHC dispatch, ASC pre-retrieval, grouped decking, ISO empties) are switched on in the engine by the configured strategy name, so a named handler set is not the same as choosing a strategy.
- New fixture: `scenario/fixtures/definitions.ts`, `pnpm run tt:fixtures`, import in `fixtures/index.ts`, `UPDATE_GOLDEN=1 pnpm test`.
- New KPI: `KPI_DEFS` and an `observe` case in `engine/kpi/collector.ts`, `KPI_GROUPS` in `modules/dashboardModel.ts`, a `dashboard.kpi.<id>` catalogue key.
- New equipment kind: one `modules/equipmentKinds/<kind>.ts` added to `EQUIPMENT_KINDS`.
- Any change that moves an event log: bump `ENGINE_VERSION`, update goldens deliberately, and update the docs.

# Terminal Twin — Agent Guide

## Overview

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root — use its terms in code, tests and docs.

**Status:** headless engine tracer (TT-01), the decision-point framework (TT-03) and headless debug tooling — structured logs, run diff, snapshot time windows, golden updates (TT-04). It also has the browser tracer (TT-02): a home card, a setup dialog shell, the engine in a Web Worker, a procedural 3D quay with time controls, and the dev-only `window.__tt` API. TT-09 added real vessel calls: five size classes, generated bay plans, a continuous quay with berth allocation and anchorage, STS cranes on one rail with a crane split, twin-20 lifts, and the setup dialog's vessel table and generator.

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
| Fixture definition change | `npm run tt:fixtures`, then `npm run tt:golden -- --update` | committed fixture JSON matches `definitions.ts` |
| Berthing / anchorage | `npm run tt:run -- --fixture two-vessels-compete-for-berth` | V002 `anchorage` > 0 s, `Quay: 1 vessel(s) waited`; `tests/berthing.test.ts` |
| Crane split / rail order | `npm run tt:run -- --fixture crane-split-4sts --strategy craneSplit=equal-bays` (vs the default `balanced-moves`) | 4 STS lines with different move counts, 0 violations (`sts.rail-order` is checked after every event); `tests/crane-split.test.ts` |
| Twin-20 | `npm run tt:run -- --fixture twin-20-lift` | `4 moves in 2 cycles (2 twin-20)`; `tests/vessels.test.ts` |
| Vessels in 3D | `npm run screenshot -- --path /sim/terminal-twin --wait 1500 --fail-on-error --eval "window.__tt.load('crane-split-4sts').then(() => window.__tt.runTo(1500)).then(() => window.__tt.pause()).then(() => window.__tt.cameraTo('V001'))"` | hull at its berth, four STS along it, deck boxes on the hatch covers |

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
│   ├── subsystems/quay.ts    STS discharge cycle (gantry to bay, deck before hold, twin-20) + work order
│   ├── subsystems/rail.ts    Shared STS rail: reservations, waiting for the rail, free cranes stepping aside
│   ├── handlers.ts           HandlerSet re-exports (TOS seams)
│   ├── decisions/            Decision-point framework
│   │   ├── types.ts          Request/reply catalogue, contract versions, HandlerSet, DecisionsConfig
│   │   ├── strategies.ts     Built-in strategy registry (1–3 per decision point) + defaultHandlers
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
├── definition.ts             Home card (keep light: eagerly imported)
├── TerminalTwin.vue          Root: TopBar, 3D host, SetupDialog, banner; installs window.__tt in DEV
├── components/               TopBar.vue (clock, speeds, Run to…, Reset, New Scenario), modals/SetupDialog.vue,
│                             setup/VesselTable.vue (vessel table + "Generate N vessels")
├── composables/useTwinScene.ts  Renderer/camera/OrbitControls + the frame loop (tick → sync → pose → render)
├── modules/                  Main-thread, non-reactive
│   ├── twinController.ts     Playback clock, look-ahead, Run to/runUntil/step, generation guard
│   ├── engineClient.ts       Promise wrapper over the worker (request ids)
│   ├── sceneModel.ts         Pure-TS timelines from worker deltas → poses/positions at any time
│   ├── sceneRenderer.ts      Three.js procedural quay, STS, vessel hulls, ONE InstancedMesh of containers
│   └── time.ts               Start date default (Mon 06:00), clock formatting
├── store/twinStore.ts        Pinia facade (small reactive UI state; controller/view kept raw)
├── worker/                   Engine Web Worker (same ESLint bans as engine/)
│   ├── engine.worker.ts      Entry; serialises requests
│   ├── engineHost.ts         Serves requests via the public engine API; builds compact Deltas
│   └── protocol.ts           Request/reply/Delta types (internal, not a public seam)
├── dev/devApi.ts             window.__tt (dev builds only)
├── cli/                      Node-only: run.ts→runCli.ts (tt:run), diff.ts→diffCli.ts (tt:diff),
│                             golden-cli.ts→golden.ts (tt:golden), handlerSets.ts, build-fixtures.ts
└── tests/                    Vitest suites (Node-only); tests/browser/*.smoke.ts = Playwright (npm run test:smoke)
```

`cli/`, `*.test.ts` and `*.smoke.ts` are type-checked by `tsconfig.tools.json` (Node types + DOM for `page.evaluate`); everything else by `tsconfig.app.json`.

## Browser host (TT-02)

- **Threads.** The engine runs in a Web Worker (`worker/engine.worker.ts`), driven only through the public engine API (`runUntilAsync`, `step`, `query`, `inject`, …). The main thread renders and runs the UI. The worker answers each request with a **Delta**: new motion plans per STS (diffed by `StsState.motion` identity), custody changes (with the grounding X for ground positions), STS/vessel status changes, the last 200 summarised events, and per-type counts. It also sends `EngineInfo` (engine time, status, end time, moves, hash).
- **Playback clock** (`TwinController`). `displayTime` advances by wall time × speed. It is clamped to the **engine horizon** (`info.now`) and to the scenario end. While playing, the controller keeps the engine a look-ahead ahead (`max(5 s, 1.5 s × speed)`) with `advance` requests, so the motion segments for the displayed instant are already known. That keeps animation smooth up to ×600. **While paused it does not run ahead**, so the scene and dev-API queries describe the same instant.
- **Flat-out runs.** "Run to…", `__tt.runUntil` and `__tt.step` send `run`/`step`. Rendering is skipped while `busy`. The delta is compacted to the latest plan, custody and status per entity, and the display jumps to the target (Run to…) or to the engine time (runUntil/step, which also pause).
- **Scene model.** `SceneModel` keeps per-axis segment lists and custody/status timelines and prunes history older than the display time. `positionAt` interpolates the crane, and a carried box follows the spreader. Display time never goes backwards, except on reset/load, which build a new model; a generation counter drops replies that belong to the old scenario.
- **Rendering.** All containers are one `InstancedMesh` (colour per shipping line). STS, hulls and the quay are shared low-poly boxes. Three.js objects never enter Vue reactivity; the store mirrors only the clock, speed, engine info and selection.
- **Setup dialog.** It lists fixtures plus the `presets` registry, with an editable seed (re-roll) and start date/time (default Monday 06:00 of the current week, local time). Start = `store.startScenario({ name, seed, startDateTime })`. The start date changes only the clock, not the run.

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
__tt.clock()       // { displayTime, speed, paused, busy, engine: EngineInfo }
__tt.scene()       // rendered { containers, sts, vessels, frames }
__tt.sceneState()  // what the scene shows: custody per box, status + pose per STS, status per vessel
```

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
- **Browser:** vessel entity deltas carry `berthX`. The scene places hulls (procedural per class: extruded outline, boot-top, hatch covers, bridge, funnel; livery from the line the vessel name starts with) at the berth or in an anchorage row offshore. Twin boxes on the spreader use `CustodyChange.dx`. Run-to compaction keeps the latest segment *per axis* (`compactMotion`). Setup dialog: quay length, STS count (`spreadSts` spreads them evenly), vessel table and generator → `ScenarioChoice.overrides` → `applyOverrides`; `__tt.load(name, { overrides })` does the same.

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

- Fixtures give each STS enough ground positions for all its boxes (tracer 10, others 6–30) because nothing clears them yet (SHCs arrive in TT-05). Lower them once SHCs clear ground positions.
- Berth allocation is strictly first come, first served: a vessel that never fits (LOA > quay) blocks the queue for good (the setup dialog warns).
- A free crane steps aside only if its other neighbour leaves room (chains of free cranes move one after another). A busy crane is never pushed, so a waiting crane may idle until its neighbour finishes.
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
- The `ScenarioEnded` and `InvariantViolated` events are committed directly. They are not queued and are not invariant-checked.

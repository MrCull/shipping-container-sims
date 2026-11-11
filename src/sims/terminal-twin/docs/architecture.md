# Architecture: layers, folders, data flow, determinism

Checked against ENGINE_VERSION 0.53.0.

Read this when you need to know where code belongs, what may import what, how a scenario becomes pixels on screen,
or what you must not break to keep runs reproducible. It is the map; the loop itself is in
[engine-core.md](engine-core.md) and the data in [state-model.md](state-model.md).

## Layers

| Layer | Folder(s) | Runs in | May import | Owns |
|---|---|---|---|---|
| Scenario | `scenario/` | anywhere | `engine/` leaf files, nothing UI | `ScenarioConfig` (SI units, `schemaVersion` 1), builder, presets, fixtures, bay plan, container factory, validation, layout derivation |
| Headless engine | `engine/` | Node, Web Worker | `engine/`, `scenario/` only | `createSimulation`, event loop, reactors (`engine/subsystems/`), `SimState`, invariants, KPIs, logging, diff |
| Decisions (TOS seams) | `engine/decisions/` | with the engine | engine | 12 decision points, built-in strategies, async/latency runtime |
| CLI | `cli/` | Node | `engine/index.ts`, `scenario/`, Node built-ins | `tt:*` commands, goldens, profiler, bench, asset and sound builds |
| Worker | `worker/` | Web Worker | `engine/index.ts`, `scenario/`, some pure `modules/` | one `Simulation`, request/reply protocol, compact `Delta` per request, checkpoints |
| Browser host | `store/`, `components/`, `composables/`, `modules/` | main thread | `engine/index.ts` only | playback clock, `SceneModel`, Three.js renderers, dashboard, debugger, inspector, setup dialog |
| Persistence | `persistence/` | main thread | `engine/index.ts` | save formats and migrations (pure), IndexedDB list |
| Terminals | `terminals/` | main thread | types only from engine | per-terminal constants, scenery, preset presentation |
| Assets | `assets/` | build time / browser | n/a | GLB models, budgets, Blender generators, sounds |

### Import rules (enforced by `eslint.config.js`, `pnpm run lint`)

- **Barrel only** (`ENGINE_BARREL_ONLY`): every Terminal Twin file outside `engine/` and `scenario/` imports engine
  code only from `engine/index.ts`. `scenario/` deep-imports a few leaf engine files (`engine/rng`,
  `engine/vesselOrdering`, `engine/yardLayout`, `engine/kinematics`, `engine/state` types,
  `engine/decisions/types`) because the engine imports `scenario/` and the barrel would cycle.
- **Engine purity** (`ENGINE_PURITY`): `engine/`, `scenario/` and `worker/` import no `vue`, `pinia`, `three`,
  Node built-ins, `@/*` or `cli/`. They may not touch the globals `window`, `document`, `localStorage`, `process`,
  and may not call `Math.random` (`no-restricted-properties`).
- **Type-checking:** `cli/`, `*.test.ts` and `*.smoke.ts` are checked by `tsconfig.tools.json` (Node types plus DOM
  for `page.evaluate`); everything else by `tsconfig.app.json`.

## Folder map

Every top-level folder of `src/sims/terminal-twin/`, then the engine in detail.

```
terminal-twin/
├── terminal-twin-AGENTS.md  Sim agent guide: overview, "How to prove a change works", pointers into docs/
├── definition.ts            Home card metadata (keep light: eagerly imported by the app)
├── TerminalTwin.vue         Root component; installs window.__tt in dev builds
├── skin.css                 Sim skin (#122): the --tt-* colour, font, radius and shadow tokens, scoped to .terminal-twin
├── docs/                    This doc set (index: docs/README.md); reports/ holds measurement records
├── engine/                  Headless engine (see below)
├── scenario/                Scenario config types, builder, presets, fixtures, bay plan, container factory, validation
├── worker/                  Engine Web Worker: engine.worker.ts (entry), engineHost.ts (serves requests), protocol.ts
├── store/                   Pinia: twinStore.ts (UI facade over the run), perfStore.ts (quality level, frame stats)
├── composables/             useTwinScene.ts (Three.js view, render loop), useTwinShortcuts.ts, useSetupDraft.ts
├── components/              Vue UI: top bar, KPI strip, dashboard, bay viewer, colour-by, final report; debug/, modals/, setup/, ui/
├── modules/                 Main-thread TS: controller, SceneModel, renderers, rigs, assets, quality, sound, dashboard models, inspector, i18n glue
├── persistence/             saves.ts (formats, migrations, planLoad), saveStore.ts (IndexedDB)
├── terminals/               types.ts, index.ts (registry), tti-algeciras/ (constants, scenery, profile)
├── i18n/                    messages.ts (catalogue), format.ts, display.ts, dateInput.ts (no Vue)
├── dev/                     devApi.ts (window.__tt), AssetViewer.vue + assetViewerScene.ts (?viewer=<asset>|yard)
├── cli/                     Node-only tt:* commands; assets/ (tt:assets*), sounds/ (tt:sounds*)
├── perf/                    baseline.json: engine benchmark baseline for tt:bench
├── assets/                  budgets.json, generators/ (Blender bpy), models/<group>/ (GLB + sidecars), sounds/, home-card.png
└── tests/                   Vitest suites (Node); tests/browser/*.smoke.ts (Playwright); tests/fixtures/ (save fixtures)
```

### engine/

```
engine/
├── index.ts            Public API barrel (the only import path for code outside engine/ and scenario/)
├── simulation.ts       createSimulation / restoreSimulation, step loop, commit, snapshot/restore, why, subscribe, ENGINE_VERSION
├── events.ts           Event envelope + EventPayloads catalogue (100 event types)
├── eventQueue.ts       Binary min-heap over a plain array, ordered (t, id)
├── context.ts          EngineContext, Reactor, ReactorMap
├── handlers.ts         HandlerSet re-exports + defaultHandlers
├── state.ts            SimState and every entity type; createInitialState; resolveSubsystemModes
├── query.ts            SimQuery: read-only live views (used by the API and by handlers)
├── rng.ts              mulberry32: seedState, nextRandom
├── hash.ts             Streaming cyrb53-style event-log hash
├── kinematics.ts       AxisProfile, MotionSegment, planSegment, positionAt, travelTime, cornerSpeedCap
├── cycleTime.ts        Nominal STS/SHC/ASC cycle readouts for the setup dialog
├── predictions.ts      predictedReady: when quay and pad boxes become collectable (SHC pre-dispatch)
├── reservations.ts     Conflict-zone time windows: earliestStart, reserve, mergeWindows, overlap checks
├── laneGraph.ts        Waterside one-way lane graph + shortest paths (cached per config)
├── landsideGraph.ts    Landside roads, gate lanes, stalls, holding positions (cached per config)
├── yardLayout.ts       Block geometry, slot ids, candidateSlots, ASC rail segments, transfer stalls (pure)
├── yardIndex.ts        Derived yard lookups (by block, by column), stackSpansOf, stackTopsOf
├── vesselSlotIndex.ts  Derived slots-per-vessel lookup
├── vesselOccupancy.ts  Derived occupied-cell map per vessel (stowage invariants)
├── hatch.ts            Hatch covers, pure: settings, panel creation, laydown geometry and lane-graph check
├── vesselOrdering.ts   Order of boxes inside a package (pod-weight, as-today), stow sequence
├── appointments.ts     Truck appointment windows and booking plan (pure)
├── prefill.ts          Pre-filled yard plan and placer (pure part of the pre-run phase)
├── transit.ts          Transit status, content status, dwell (pure, derived)
├── shcStates.ts        SHC operational states: 7-state view over ShcStatus
├── invariants.ts       INVARIANTS registry, InvariantTracker (incremental + sweeps), invariantDeadline
├── kpis.ts             KpiReport from SimState (rounded); summary.ts: RunSummary (golden format)
├── kpi/                collector.ts (hourly/shift series, KPI_DEFS), clock.ts, headline.ts, timeline.ts
├── export.ts           KPI report and event log as JSON/CSV
├── logging.ts          Structured log records, per-subsystem verbosity, EVENT_LOG_META
├── runDiff.ts          diffEventLogs, jsonDifferences
├── stsProductivity.ts  Crane time buckets from an event log (tt:sts, tt:profile)
├── boxWaits.ts         Per-box waits from an event log (tt:profile)
├── decisions/          types.ts (request/reply catalogue, contract versions), strategies.ts (registry),
│                       runtime.ts (dispatch, async, timeouts, KPIs), latency.ts (injector, own RNG stream),
│                       *Strategies.ts per area (quay, yard, asc, empty, rehandle, workPackage, landside), yardGrouping.ts
└── subsystems/         Reactor maps and their helpers:
    ├── berth.ts        Arrival, berth allocation, anchorage, mooring, crane split, departure
    ├── workPackages.ts Package creation, release decision, start/complete
    ├── hatch.ts        Lashing release, hatch moves, laydown, securing
    ├── quay.ts         STS discharge and load cycles, ground-position waits, predictedGroundings
    ├── rail.ts         Shared STS rail: reservations, waits, step-aside
    ├── loadPrep.ts     Export load preparation: load orders, pad staging ahead
    ├── shc.ts          SHC jobs, pull dispatch, whole-trip planning, queue areas, parking, pre-dispatch
    ├── asc.ts          ASC reactors and phase chain (hub); ascStorage.ts, ascReservations.ts, ascDispatch.ts, ascRail.ts
    ├── rehandle.ts     Blockers, boxesAbove, retrievalRanks (cached), rehandle room
    ├── empties.ts      Empty allocation for load packages
    ├── transshipment.ts Dwell then TransshipmentReady
    ├── landside.ts     Trucks: arrivals, gate, stall admission, holding, interchange, exit
    ├── prefill.ts      Pre-run driver of a pre-filled start
    └── warmUp.ts       Warm-up start: KPI restart at WarmUpEnded
```

Note: there is no `engine/subsystems/sts.ts` or `engine/yardStacks.ts`; the STS lives in `quay.ts` and `rail.ts`,
and the yard stack helpers in `yardLayout.ts`, `yardIndex.ts` and `subsystems/ascStorage.ts`.

## Data flow: scenario to pixels

```
preset / fixture ──composeScenario (scenario/compose.ts) + setup-dialog edits──> ScenarioConfig (SI, plain JSON)
        │
        ▼
createSimulation(config, handlers?, options?)          engine/simulation.ts
  assertValidScenario -> createInitialState (planCargo bay plan, exportYard, blocks, ASCs, SHCs, landside)
  [pre-filled start: pre-run phase places the yard box by box through yardAllocation]
  schedule ScenarioStarted (the root event)
        │  step(): pop -> reactors (subsystems + decision runtime) -> commit (seq, log, hash, KPI collector, listeners)
        │          -> invariants -> end conditions
        ├─────────────── CLI: summarizeRun -> RunSummary (stdout, --out, goldens); --events JSONL; --log JSONL
        ▼
worker/engineHost.ts  sim.subscribe(observe): per committed event, append to a Delta
  (new containers, custody changes, motion plans by reference change, entity status changes, reservations,
   hatch changes, last EVENT_SUMMARY_CAP events, event counts, breakpoint hit, checkpoints)
        │ postMessage WorkerReply { rid, result, delta, info: EngineInfo }
        ▼
modules/engineClient.ts -> modules/twinController.ts (playback clock, look-ahead) -> SceneModel.apply(delta)
        │                                                  (per-entity timelines: motion segments, custody, status)
        ▼
composables/useTwinScene.ts render loop -> SceneRenderer.update(displayTime, ...) poses every kind
  (modules/equipmentKinds registry, ContainerInstancer, vessel hulls, landside, overlays) -> Three.js
store/twinStore.ts mirrors the few fields the UI shows (phase, clock, speed, EngineInfo, KPIs)
```

- The engine is ahead of the display: `TwinController` keeps a look-ahead of
  `max(MIN_LOOKAHEAD_SIM_S (5), speed x LOOKAHEAD_WALL_S (1.5))` sim seconds (`modules/twinController.ts`), so the
  motion segments for the displayed instant are always known. The display never passes the engine horizon
  (`EngineInfo.now`).
- The browser engine runs with invariants on and default `sweepEvery` (`worker/engineHost.ts`,
  `createSimulation(config, {}, { seed })`).
- Saves and rewind are replay-based: restore runs the snapshot's config and seed for `snapshot.log.length` events so
  the `SceneModel` learns every motion plan, then calls `sim.restore(snapshot)`. Checkpoints every
  `DEFAULT_CHECKPOINT_S` (900 sim s) record `{ t, events, hash }`. Details:
  [scenarios-and-persistence.md](scenarios-and-persistence.md), [browser-host.md](browser-host.md).

## Determinism contract

Same `ScenarioConfig`, same seed, same handlers and same engine code give the same event log, byte for byte, in Node
and in any browser. Everything else (goldens, run diff, replay-based saves, rewind, checkpoints) relies on it.

| Rule | How it is kept |
|---|---|
| One seeded engine RNG | `ctx.random()` (mulberry32, `engine/rng.ts`), state in `SimState.rngState`; `Math.random` is lint-banned in `engine/`, `scenario/`, `worker/` |
| Separate streams for side processes | decision latency `state.decisions.rngState` (seed ^ `DECISION_RNG_SALT`), landside `state.landside.rngState` (seed ^ 0x5bd1e995), bay plan (seed ^ 0x9e3779b9, `scenario/bayPlan.ts`), pre-fill (seed ^ `PREFILL_SALT`), container props (`scenario/containerProps.ts#propsStream`, keyed by seed and container id), reefers (hash of the id, no stream). Adding draws to one stream never moves another |
| No wall clock in state | sim time is `state.now` only; `performance.now()` is used only for invariant cost stats and measured async wall latency, neither of which is hashed |
| Fixed processing order | queue ordered by `(t, id)`; `id` is the scheduling order; reactor maps run in the fixed `REACTORS` order (`engine/simulation.ts`) |
| Plain JSON state | `SimState` holds no Map, Set, class or function, so `structuredClone` snapshots are exact; derived indexes live outside it in `WeakMap`s |
| Event-log hash | every committed event's `JSON.stringify` is folded into `state.logHash` (`engine/hash.ts`); `wallLatencyMs` is left out |
| Goldens | `scenario/fixtures/<name>.golden.json` = `summarizeRun` (`RunSummary`: hash, KPIs, invariant checks and violations, status, end reason); checked by `pnpm run tt:golden` and `pnpm test` |
| Strategies are pure | built-in strategies are synchronous, read only the request and `SimQuery`, never `Math.random` |

Breaking any rule shows up as a hash drift on the same seed (`tt:golden`) or as `restore` and rewind giving a
different hash from the uninterrupted run. To prove a deliberate behaviour change:
`pnpm run tt:run --fixture <name> --events /tmp/before.jsonl` before, the same after, then
`pnpm run tt:diff /tmp/before.jsonl /tmp/after.jsonl` names the first diverging event; then
`pnpm run tt:golden --update` and review the golden diff. Never regenerate goldens to make a failing test pass
(terminal-twin-AGENTS.md, "How to prove a change works").

What may change without moving the hash: anything that only reads state (invariants, KPI collector, queries,
the worker's Delta), container `props` (no event carries them), derived indexes, caches. Invariant changes do move
`invariants.checks` in goldens.

## Public engine API (`engine/index.ts`)

```ts
const sim = createSimulation(config, handlers?, {
  seed?, asyncMode?,                                   // 'keep-running' (default) | 'pause'
  invariants?: { enabled?, failFast?, sweepEvery? },   // defaults true, true, DEFAULT_SWEEP_EVERY (1000)
  subsystems?,                                         // override config.subsystems
  log?: { verbosity?: 'sts=debug,*=warn', write(record) },
})
sim.step()                                   // one event, or null
sim.runUntil({ time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate? })
  // -> { reason: 'condition'|'ended'|'failed'|'idle'|'max-events'|'waiting-for-decision', eventsProcessed, now }
await sim.runUntilAsync(cond?)               // same, awaits async (Promise) handlers
sim.status; sim.now; sim.firstError; sim.asyncMode; sim.config; sim.seed
sim.snapshot(); sim.restore(snap, { adopt? }); restoreSimulation(snap, handlers?, options?, { adopt? })
checkSnapshotCompat(snap)   // {ok:true} | {ok:false, reason, savedEngineVersion, currentEngineVersion}; restore throws SnapshotCompatError
sim.query.container(id) / .containers() / .vessel(id) / .vesselSlot(id) / .sts(id) / .stsList() / .shc(id) /
          .shcJobs() / .asc(id) / .ascJobs() / .yardSlots(blockId?) / .reservations() / .workPackages(stsId?) /
          .loadOrders() / .trucks() / .hatchPanels(vesselId?) / .transferStalls() / .gateQueue() / .appointments() ...
sim.why(eventId)                             // [event, parent, ..., root]
sim.inject(type, at, subjects, payload)      // external root event (causedBy null; dev API, tests)
sim.subscribe(fn, { types? })                // returns unsubscribe
sim.eventLog(); sim.eventLogHash(); sim.kpiReport(); sim.kpiSeries(); sim.invariantReport(); sim.invariantStats()
sim.predictedReady()
summarizeRun(sim)                            // RunSummary: CLI --out and golden format
diffEventLogs(logA, logB, { context? })      // { diverged, commonEvents, seq, a, b, differences, before, afterA, afterB }
parseLogVerbosity('asc=debug,*=warn'); toLogRecord(event, verbosity)
```

The barrel also exports geometry (`yardLayout`, `laneGraph`, `landsideGraph`, `hatch`), kinematics, transit status,
the decision catalogue and strategy registry, KPI collector and report builders, exports, analysis folds
(`stsProductivity`, `boxWaits`, `buildTimeline`), derived indexes, validation (`validateScenario`) and cycle readouts.
Query results are live views: copy before keeping them.

## Extending

- **Engine imports:** outside `engine/` and `scenario/`, import from `engine/index.ts` (lint fails otherwise); export
  what you need from the barrel.
- **New event type:** add it to `EventPayloads` in `engine/events.ts`; add its reactor to a subsystem `ReactorMap`
  listed in `REACTORS` (`engine/simulation.ts`). Logging needs nothing if the name starts with its subsystem
  (`AscMoveStarted` -> `asc`, level `info`); otherwise, or for another level, add it to `EVENT_LOG_META`
  (`engine/logging.ts`).
- **New subsystem:** create `engine/subsystems/<name>.ts` exporting a `ReactorMap` and add it to `REACTORS` (order is
  behaviour: it decides which reactor sees the event first and the ids, so the tie-break order, of what they schedule).
- **New custody owner kind:** extend `CustodyKind` (`engine/state.ts`) and add its holders to `custodyHolders()` and
  `heldAt()` (`engine/invariants.ts`); decide whether it is terminal custody (`engine/transit.ts`).
- **New invariant:** append to `INVARIANTS` with a dotted id and `reads`; set `scoped: true` and honour the scope if it
  reads a lot of state; add a test with a broken handler or reactor ([invariants.md](invariants.md)).
- **New fixture:** add it to `scenario/fixtures/definitions.ts`, run `pnpm run tt:fixtures`, import the JSON in
  `scenario/fixtures/index.ts`, then `UPDATE_GOLDEN=1 pnpm test`.
- **New CLI strategy for diffs:** a named set in `cli/handlerSets.ts`, or `--strategy <dp>=<name>` on `tt:run`/`tt:diff`.
- **New decision point or strategy:** [decision-points.md](decision-points.md).
- **New container property:** add it in `scenario/containerFactory.ts` and `scenario/containerProps.ts` only
  ([state-model.md](state-model.md#stored-container-properties)).
- **New equipment kind** (renderer side): a `modules/equipmentKinds/<kind>.ts` exporting an `EquipmentKindDef`, added
  to `EQUIPMENT_KINDS`; add `inspector.kind.<kind>` and `inspector.fact.*` catalogue keys and keep
  `modules/equipmentDims.ts` in sync; `tests/equipment-kinds.test.ts` (`registrationProblems`) fails a half-registered
  kind. Registry order is build and update order ([rendering-3d.md](rendering-3d.md)).
- **New KPI:** a row in `KPI_DEFS` and an `observe` case in `engine/kpi/collector.ts`, list it in `KPI_GROUPS`
  (`modules/dashboardModel.ts`), add a `dashboard.kpi.<id>` catalogue key ([kpis-and-reports.md](kpis-and-reports.md)).
- **Hand-built `Delta` in a test:** start from `emptyDelta()` (`tests/delta.ts`).
- **Engine behaviour change:** bump `ENGINE_VERSION` (`engine/simulation.ts`) so old snapshots are refused, update
  goldens deliberately, and update the matching doc's "Checked against" line.

## Gotchas

- The worker detects motion changes by **reference**: reactors must assign a new `motion` array
  (`sts.motion = segments`), never push into the old one, or the scene never sees the new plan.
- The worker host's `observe` runs on every committed event and scans every STS, SHC, ASC and vessel (and trucks on
  `Truck*` events), plus `query.reservations()` (a filter of the whole list) and `vesselFirstMoveS` (all work
  packages). It is part of the browser's engine cost, not of headless runs.
- `scenario/` must not import the engine barrel (cycle); keep scenario-side engine imports to leaf files.
- Two branches that both regenerate a golden conflict: regenerate on the merged tree, do not hand-merge.

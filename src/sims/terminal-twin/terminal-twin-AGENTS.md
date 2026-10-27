# Terminal Twin — Agent Guide

## Overview

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root — use its terms in code, tests and docs.

**Status:** headless engine tracer (TT-01) plus headless debug tooling — structured logs, run diff, snapshot time windows, golden updates (TT-04). There is no `definition.ts` yet, so the sim is not on the home page; the browser host arrives with TT-02.

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
| Structured logs | `npm run tt:run -- --fixture <name> --log /tmp/run.log.jsonl --log-level "sts=debug,vessel=warn,*=info"` | one JSON object per line with `t`, `eventId`, `seq`, `subsystem`, `level`, `type`, `subjects` (+ `causedBy`, `payload` at `debug`); `grep '"subsystem":"sts"'` |
| Two strategies diverge where? | `npm run tt:diff -- --fixture <name> --b-handlers highest-free-lane` | exit 1; `First divergence at seq N`, differing fields, context and both payloads (exit 0 + `No divergence` if identical) |
| Two seeds | `npm run tt:diff -- --fixture <name> --a-seed 1 --b-seed 2` | same report |
| Two code versions | before: `npm run tt:run -- --fixture <name> --events /tmp/before.jsonl`; after your change: `… --events /tmp/after.jsonl`; then `npm run tt:diff -- /tmp/before.jsonl /tmp/after.jsonl` | first diverging event = first effect of your change |
| Reproduce a late bug | `npm run tt:run -- --fixture <name> --until time:50400 --snapshot /tmp/h14.json`, then `npm run tt:run -- --from-snapshot /tmp/h14.json --until time:54000 --events /tmp/win.jsonl --log /tmp/win.log.jsonl --log-level debug` | the window's events equal that window of the uninterrupted run; re-run the window as often as needed |
| Check goldens | `npm run tt:golden` (also part of `npm test`) | `<fixture>: match` per fixture, exit 0; drift prints `path: golden X → actual Y` per field and exits 1 |
| Intentional behaviour change | `npm run tt:golden -- --update` (or `UPDATE_GOLDEN=1 npm test`), then review the `*.golden.json` diff | the golden diff shows only the change you intended |
| Fixture definition change | `npm run tt:fixtures`, then `npm run tt:golden -- --update` | committed fixture JSON matches `definitions.ts` |

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
│   ├── subsystems/quay.ts    Vessel berthing + STS discharge cycle reactors
│   ├── handlers.ts           Decision-point HandlerSet (TOS seams) + defaults
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
├── cli/                      Node-only: run.ts→runCli.ts (tt:run), diff.ts→diffCli.ts (tt:diff),
│                             golden-cli.ts→golden.ts (tt:golden), handlerSets.ts, build-fixtures.ts
└── tests/                    Vitest suites (Node-only)
```

`cli/` and `*.test.ts` are type-checked by `tsconfig.tools.json` (Node types, no DOM); everything else by `tsconfig.app.json`.

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
const sim = createSimulation(config, handlers?, { seed?, invariants?: { enabled?, failFast? },
                                                 log?: { verbosity?: 'sts=debug,*=warn', write(record) } })
sim.step(); sim.runUntil({ time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate? })
sim.snapshot(); sim.restore(snap); restoreSimulation(snap, handlers?, options?)
sim.query.container(id) / .containers() / .vessel(id) / .vesselSlot(id) / .sts(id) / .groundPosition(id)
sim.why(eventId)            // [event, parent, …, ScenarioStarted]
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
- **New CLI strategy for diffs:** add a named handler set to `cli/handlerSets.ts` (TT-03 replaces this with its strategy registry).
- **New decision point:** add it to `HandlerSet` and `defaultHandlers`. TT-03 will replace this with the request/reply framework.

## Known behaviours and pitfalls

- The tracer fixture gives STS01 **10 ground positions** because nothing clears them yet (SHCs arrive in TT-05).
- If the ground-position handler returns `null`, the STS raises `StsWaitingForGroundPosition` and idles for good. Nothing wakes it yet.
- Invariants are checked over the whole state after every event (O(state)), which is fine at tracer scale. Revisit before the TTI preset (TT-19).
- Snapshots embed the full event log. `--from-snapshot` runs write only the window's events/log lines, but KPIs and the event-log hash in the summary are cumulative from t = 0.
- `--until time:T` leaves `now = T`, so a snapshot taken there resumes at exactly `T`; events at `t ≤ T` are in the snapshot, the window holds `t > T`.
- Handlers are not in snapshots: pass the same `--handlers` when resuming a window.
- Logs are derived from committed events only; there is no free-text reactor logging yet.
- The `ScenarioEnded` and `InvariantViolated` events are committed directly. They are not queued and are not invariant-checked.

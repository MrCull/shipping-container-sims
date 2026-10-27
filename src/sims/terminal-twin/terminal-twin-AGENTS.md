# Terminal Twin — Agent Guide

## Overview

**Terminal Twin** is an event-driven digital twin of a large automated container terminal (reference: TTI Algeciras), built as a TOS test bench. Spec: GitHub issue #24. Vocabulary: [`GLOSSARY.md`](../../../GLOSSARY.md) at the repo root — use its terms in code, tests and docs.

**Status:** headless engine tracer (TT-01), the decision-point framework (TT-03) and headless debug tooling — structured logs, run diff, snapshot time windows, golden updates (TT-04). There is no `definition.ts` yet, so the sim is not on the home page; the browser host arrives with TT-02.

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
const sim = createSimulation(config, handlers?, { seed?, asyncMode?, invariants?: { enabled?, failFast? },
                                                 log?: { verbosity?: 'sts=debug,*=warn', write(record) } })
sim.step(); sim.runUntil({ time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate? })
await sim.runUntilAsync(cond?) // same, but awaits async (Promise) handlers instead of stopping
sim.asyncMode               // 'keep-running' | 'pause'
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

- The tracer fixture gives STS01 **10 ground positions** because nothing clears them yet (SHCs arrive in TT-05).
- Every decision adds two events (`DecisionRequested`, `DecisionResolved`) to the log. The tracer golden went from 35 to 55 events in TT-03, with KPIs unchanged.
- An injected delay of at least `timeoutMs` (default 5 s) is a timeout. Raise `timeoutMs` when you inject long latencies.
- A reply computed at request time is delivered later in keep-running mode, so it can be stale. That is realistic: a reply with an invalid ground position surfaces as an invariant violation.
- If the ground-position handler returns `null`, the STS raises `StsWaitingForGroundPosition` and idles for good. Nothing wakes it yet.
- Invariants are checked over the whole state after every event (O(state)), which is fine at tracer scale. Revisit before the TTI preset (TT-19).
- Snapshots embed the full event log. `--from-snapshot` runs write only the window's events/log lines, but KPIs and the event-log hash in the summary are cumulative from t = 0.
- `--until time:T` leaves `now = T`, so a snapshot taken there resumes at exactly `T`; events at `t ≤ T` are in the snapshot, the window holds `t > T`.
- Handlers are not in snapshots: pass the same `--handlers` when resuming a window.
- Logs are derived from committed events only; there is no free-text reactor logging yet.
- The `ScenarioEnded` and `InvariantViolated` events are committed directly. They are not queued and are not invariant-checked.

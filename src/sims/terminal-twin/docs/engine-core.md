# Engine core: the discrete-event loop

Checked against ENGINE_VERSION 0.53.0.

Read this when you change or debug how events are scheduled, processed, hashed, logged, snapshotted or replayed;
when you add an event type or reactor; or when you hunt headless run time per event. The state the loop mutates is
in [state-model.md](state-model.md); the TOS seams it calls are in [decision-points.md](decision-points.md).

## The loop at a glance

```
createSimulation(config, handlers, options)          engine/simulation.ts#createSimulation
  validate -> createInitialState -> (pre-filled start: pre-run phase) -> schedule ScenarioStarted at t=0

step():                                              engine/simulation.ts (inner function step)
  decisions.drain()           apply settled async replies (schedule their DecisionResolved/DecisionFailed)
  decisions.waiting()?        -> return null (pause mode with a pending decision, or only async replies left)
  invariantDeadline           a time-based invariant due before the next event: move the clock there, sweep
  duration end reached?       -> closing sweep, commit ScenarioEnded, status 'ended'
  ev = heapPop(state.queue);  state.now = ev.t
  react(ev)                   every ReactorMap that has a reactor for ev.type, in fixed order
  commit(ev)                  seq, log, byId, KPI collector, log hash, listeners
  endConditionMet()           vesselsCompleted / moves / all vessels departed
  checkInvariants(ev)         incremental, or a full sweep every sweepEvery events and on the last event
  end condition met?          -> commit ScenarioEnded, status 'ended'
```

There are no fixed time steps: the clock jumps from event to event. Motion between events is implicit in
`MotionSegment`s ([Kinematics](#kinematics-and-cycle-times)).

## Event envelope

`engine/events.ts#EventEnvelope`: `{ id, seq, t, type, causedBy, subjects, payload }`.

| Field | Set when | Meaning |
|---|---|---|
| `id` | scheduling (`state.nextEventId++`) | unique; also the tie-break order |
| `seq` | commit (`state.nextSeq++`), `-1` while queued | processing order, 0-based; `tt:diff` reports it |
| `t` | scheduling | sim seconds from scenario start (float) |
| `causedBy` | scheduling | id of the event whose reactor scheduled it; `null` for roots |
| `subjects` | scheduling | `{ containers?, equipment?, vessels?, jobs? }`: ids for filtering, `why`, breakpoints and incremental invariant scope |
| `payload` | scheduling | per type, from `EventPayloads` |

Equipment payload convention: `segments` is the motion that **led up to** this event (planned when it was scheduled),
so `t === max(segments.t1) + fixed handling time`. The live plan is also kept in state (`StsState.motion`,
`ShcState.motion`, `AscState.motion`, `TruckState.motion`) for renderers.

## Event queue

`engine/eventQueue.ts`: a binary min-heap over a plain array (`state.queue`, so it is JSON and snapshots with the
state). `heapPush` and `heapPop` are O(log n).

- **Order:** by `t`, then by `id`. Same-time events run in scheduling order (FIFO). An event a reactor schedules at
  `now` runs after every event already queued at `now`.
- **No past events:** `schedule` throws `Cannot schedule <type> at <t> before now` when `t < state.now`.
- **Exact float ties matter.** Two events tie only on identical `t`; computed times that differ by 1e-12 do not tie,
  and their order then follows `t`, not scheduling. Keep time arithmetic identical between code paths that must stay
  in step.
- `ScenarioEnded` and `InvariantViolated` are never queued: they are committed directly and never invariant-checked.

## Reactors, handlers and the context

- **Reactors** (`engine/context.ts#Reactor`, grouped in a `ReactorMap` per subsystem under `engine/subsystems/`) are
  the engine's own physics and flow. One reactor per event type per map; several maps may react to the same type.
- **Handlers** (`HandlerSet`, `engine/handlers.ts`) are TOS decisions, swappable through
  `createSimulation(config, handlers)`. A reactor never calls a handler directly: it calls `ctx.requestDecision` and
  acts on the reply in its own `DecisionResolved` reactor, narrowing on `e.payload.decisionPoint`.
- **Map order** (`react` in `engine/simulation.ts`): the decision runtime's bookkeeping reactors, then `REACTORS` =
  `berth, workPackages, hatch, quay, loadPrep, shc, asc, empties, transshipment, landside, warmUp`, then the pre-fill
  driver. 13 maps, looked up once each per event. Order is behaviour: a later map sees the earlier maps' mutations,
  and what it schedules gets later ids.

`EngineContext` (built fresh for every event by `makeContext`):

| Member | Does |
|---|---|
| `state`, `config`, `query`, `current` | the live state, the scenario, a read-only `SimQuery`, the event being processed |
| `schedule(type, at, subjects, payload)` | new event with `causedBy = current.id`; throws if `at < now` |
| `requestDecision(dp, request, subjects, { preRun? })` | schedules `DecisionRequested` at `now`, returns the correlation id `<dp>-<n>`; `subjects.equipment` is what idles while waiting (idle-time KPI) |
| `random()` | uniform [0, 1) from `state.rngState` |
| `transferCustody(containerId, to)` | sets `box.custody` and appends a `CustodyRecord { t: now, owner, eventId: current.id }`. The caller must update the physical holder (slot, `sts.carrying`, ground position, pad) in the same reactor |

**Reactor errors:** a throw inside `react` still commits the event, then sets `status = 'failed'` and `firstError`
(`{ eventId, t, message }`). Mutations made by earlier reactors of the same event stay. Nothing further runs.

## Decisions inside the loop

A synchronous built-in strategy costs two extra events and no sim time: `DecisionRequested` (its reactor calls the
handler) and `DecisionResolved` at the same `t`. With latency injection in `keep-running` mode the reply is scheduled
`delay/1000 x scale` sim seconds later; in `pause` mode no sim time passes. Failures go `DecisionRequested ->
DecisionFailed -> DecisionResolved { outcome: 'fallback' }`. Async (Promise) replies arrive through `drain()` at the
sim time the engine has reached, and are scheduled with `causedBy` = the `DecisionRequested` id. Full model:
[decision-points.md](decision-points.md).

## Run control

`runUntil(cond)` (`engine/simulation.ts#RunCondition`) loops `step()` and stops on the first of: status `ended` or
`failed`; `maxEvents` processed in this call; `waiting-for-decision`; `time` (stops once every event at or before it
is processed and sets `now = time`, unless the run's duration end comes first); `eventType` or `predicate` matched
(stops right after that event); `vesselsCompleted` or `moves` reached; an empty queue (`idle`). In `keep-running`
mode with a `time` condition the clock may pass an in-flight async reply (how the worker shows TOS latency).
`runUntilAsync` repeats `runUntil` and awaits `decisions.nextSettled()` whenever it returns `waiting-for-decision`.

End conditions (`config.endConditions`): `vesselsCompleted`, `moves`, `simDurationS` (counted after a warm-up). None
set: the run ends when every vessel has departed. A warm-up start counts nothing until `WarmUpEnded`.

## Event catalogue

100 types in `engine/events.ts#EventPayloads`. "Reacts" lists the reactor maps that handle the type (decision
runtime = `engine/decisions/runtime.ts`). Log subsystem = lower-cased first word of the type unless
`EVENT_LOG_META` says otherwise.

| Group | Types | Reacts |
|---|---|---|
| Run | `ScenarioStarted` (root; `{scenario, seed}`), `ScenarioEnded` (committed directly), `WarmUpEnded`, `InvariantViolated` (committed directly, log subsystem `invariants`, level `error`) | berth, landside, warmUp |
| Decisions | `DecisionRequested`, `DecisionFailed` (level `warn`), `DecisionResolved` (union per decision point, `request` + `reply`, `outcome`, `handler`, optional `wallLatencyMs`, `preRun`) | decision runtime; `DecisionResolved` also berth, workPackages, quay, loadPrep, shc, asc, empties, landside, pre-fill driver |
| Vessel and berth | `VesselArrived`, `VesselAtAnchorage`, `BerthAllocated`, `VesselBerthed`, `VesselWorkComplete`, `VesselDeparted` | berth (shc also on `VesselWorkComplete`) |
| Work packages | `WorkPackageReleased`, `WorkPackageStarted`, `WorkPackageCompleted` | workPackages |
| STS discharge | `StsMoveStarted` (level `debug`), `StsPicked`, `StsGrounded`, `StsWaitingForGroundPosition` (level `warn`), `StsGroundPositionWaitBackoff`, `StsGroundPositionWaitEnded`, `StsWorkComplete` | quay (shc also on `StsMoveStarted`, `StsGrounded`; berth on `StsWorkComplete`) |
| STS rail | `StsWaitingForRail`, `StsRepositionStarted`, `StsRepositionCompleted` | quay |
| STS load | `StsLoadStarted`, `StsWaitingForBox`, `StsBoxWaitEnded`, `StsLoadPicked`, `StsLoaded` | quay |
| Hatch covers | `StsHatchStarted`, `StsWaitingForHatch`, `HatchLashingReleased`, `HatchLifted`, `HatchSetInLaydown`, `HatchReplaced`, `HatchSecured` | hatch (shc also on `StsHatchStarted`) |
| SHC trip | `ShcJobAssigned`, `ShcRoutingEmpty`, `ShcPositioningAtPickup`, `ShcLocking`, `ShcPicked`, `ShcPickedAtWtp`, `ShcRoutingLoaded`, `ShcPositioningAtDropoff`, `ShcLowering`, `ShcUnlocking`, `ShcDroppedAtWtp`, `ShcDroppedAtGround`, `ShcCleared` | shc (asc on `ShcDroppedAtWtp`, `ShcCleared`) |
| SHC idle | `ShcRoutingToParking` (with `predicted` for a pre-dispatch), `ShcParked`, `ShcQueued`, `ShcQueueDeparted` | shc |
| ASC stacking (pad to slot) | `AscJobAssigned`, `AscRoutingToPad`, `AscPositioningAtPad`, `AscLocking`, `AscPicked`, `AscRoutingToSlot`, `AscPositioningAtSlot`, `AscUnlocking`, `AscStacked`, `AscReady` | asc (shc and landside also on `AscJobAssigned`; empties, transshipment, landside on `AscStacked`) |
| ASC retrieval (slot to pad) | `AscRoutingToStack`, `AscPositioningAtStack`, `AscRetrieved`, `AscRoutingToWtp`, `AscPositioningAtWtp`, `AscDroppedAtWtp` | asc (empties on `AscRetrieved`) |
| ASC truck interchange | `AscRoutingToTruck`, `AscPositioningAtTruck`, `AscPickedFromTruck`, `AscRoutingToStall`, `AscPositioningAtStall`, `AscDroppedAtStall` | asc, landside |
| Yard extras | `RehandleRequired`, `AscYieldAssigned` | asc |
| Empties and transshipment | `EmptiesRequired`, `EmptiesAllocated`, `TransshipmentReady` | empties, transshipment |
| Landside | `TruckArrivalDue`, `TruckArrived`, `TruckGateStarted`, `TruckGateIn`, `TruckStallReserved`, `TruckHoldingAssigned`, `TruckHeldOutside`, `TruckRoutingToHolding`, `TruckAtHolding`, `TruckWaitingForStall`, `TruckReachedGateHead`, `TruckStallAssigned`, `TruckRoutingToStall`, `TruckAtStall`, `TruckInterchangeDone`, `TruckRoutingToExit`, `TruckGateOut`, `TruckDeparted` | landside |

Phase chains: equipment plans a whole cycle at once and keeps the remaining phase events in `plan`
(`ShcState.plan`, `AscState.plan`, `TruckState.plan`); each phase event's reactor schedules the next. So one SHC trip
is about 11 events and one ASC stacking cycle about 10. By this count a discharged import box costs roughly 32 events
from `StsMoveStarted` to `AscReady` (STS 3 plus a `stsGroundPosition` pair, SHC 11 plus `shcDispatch` and
`wtpPadSelection` pairs, ASC 10 plus a `yardAllocation` pair), more with twin-ASC dispatch, parking or rehandles.

Not every event exists in every run: subsystems in `off` mode never schedule theirs, hatch events need
`hatch.enabled`, queue-area events need `config.queueAreas`, holding events need `config.landside.holding`.

## Causality

- `causedBy` is set automatically: whatever a reactor schedules points at the event being processed.
- **Roots** (`causedBy: null`): `ScenarioStarted` in an ordinary start; in a pre-filled start the first pre-run
  `DecisionRequested` (and `ScenarioStarted` is then caused by the last pre-run `DecisionResolved`); every
  `sim.inject` event; a duration-end `ScenarioEnded`.
- `InvariantViolated` is caused by the offending event; an event-ended `ScenarioEnded` by the event that met the
  condition.
- `sim.why(eventId)` walks `byId` (a `Map` rebuilt from the log on restore) from the event to its root:
  `[event, parent, ..., root]`. The debugger's cause chain and `tt:run` failure reports use it.

## RNG

`engine/rng.ts`: mulberry32. `seedState(seed)` = `seed >>> 0`; `nextRandom(state)` returns `[value, nextState]`,
pure, so every stream is one uint32 in plain JSON. The engine stream is `state.rngState`, drawn only through
`ctx.random()` (STS move variation, SHC driver variability, and any reactor randomness). Side streams (decision
latency, landside, bay plan, pre-fill, per-container props) are listed in
[architecture.md](architecture.md#determinism-contract). Note: the decision-latency stream and the landside stream
start from the same state (both use salt 0x5bd1e995); they are consumed independently, so this does not break
determinism, but their draws are correlated.

## Kinematics and cycle times

`engine/kinematics.ts`, pure, SI units:

- `AxisProfile { vMax, accel, decel }`; `planSegment(entityId, axis, from, to, t0, profile, v0?, v1?)` returns a
  `MotionSegment` whose `t1` is exact: trapezoidal profile, or triangular when the distance is too short to reach
  `vMax` (`vPeak < vMax`). `v0`/`v1` let a vehicle corner at speed; `cornerSpeedCap(turnAngleRad, corner)` caps it
  (`sqrt(lateralAccel x radius)` for a right angle, less for sharper turns, 0 for a reversal).
- `positionAt(seg, t)` interpolates (clamped); renderers and `ascPoseAt`/`truckPositionAt` use it. A zero-length
  (instant mode) segment is at `to` from `t0` on.
- `travelTime(distance, profile)` is rest to rest.
- Axes: `gantry`, `trolley`, `hoist` (cranes), `x`, `z`, `lift` (vehicles). Each crane move plans one segment per
  axis; the event is scheduled at the end of the last one plus lock/unlock time.
- Instant subsystem mode sets `t1 = t0` (same events, zero durations).

`engine/cycleTime.ts` gives the setup dialog's nominal readouts with no variation and no waiting:
`stsNominalCycle` (lock, unlock, two loaded and two empty hoists between `stsSafeHoistM` and the pick and ground
heights, two trolley runs; `stsCycleGeometry` uses the middle row of the first vessel's class, mid tier),
`shcNominalCycle(k, distanceM = 300)`, `ascNominalCycle(k, alongM = 40, acrossM = 12, liftM = 8.7)`;
`perHour = 3600 / cycleS`. The STS readout is within 15 % of the measured single-crane average
(`tests/cycle-readout.test.ts`; it ignores gantry moves, so reads a few % low).

## Predictions

`engine/predictions.ts#predictedReady` merges `predictedGroundings` (`engine/subsystems/quay.ts`: planned set-downs
of boxes in flight, exact; the next boxes of each crane's packages, estimated from the nominal cycle plus the hatch
cycle) and `predictedPadReady` (`engine/subsystems/asc.ts`: planned set-downs of retrieved export boxes, exact),
sorted by `readyAt` then owner id. SHC pre-dispatch reads them to drive to a queue area early; it never claims a job
from a prediction. `sim.predictedReady()` exposes them. Details: [subsystems/horizontal.md](subsystems/horizontal.md).

## Hashing

`engine/hash.ts`: cyrb53-style streaming hash over two uint32 (`state.logHash`, seed `HASH_SEED`).
`commit` folds `JSON.stringify(event)` of every committed event into it, so the hash covers type, time, ids, causes,
subjects and full payloads (including motion segments). `DecisionResolved.wallLatencyMs` is removed before hashing (a
measured wall time is not reproducible). `hashDigest` gives 14 hex digits; `sim.eventLogHash()` returns it.
Because JSON key order is insertion order, building a payload with keys in a different order changes the hash even
when the values are the same.

## Snapshots and replay

- `sim.snapshot()` = `structuredClone({ kind: 'terminal-twin-snapshot', schemaVersion: SNAPSHOT_SCHEMA_VERSION (1),
  engineVersion: ENGINE_VERSION, config, seed, status, firstError, invariants, state, log })`. `structuredClone`, not
  JSON, because a large run passes the about 512 MB string limit. The CLI writes big snapshots piecewise
  (`cli/snapshotFile.ts`).
- `sim.restore(snap, { adopt? })`: `checkSnapshotCompat` (kind, `engineVersion`, `schemaVersion`) or throw
  `SnapshotCompatError`; copy the snapshot (or adopt it when `adopt: true`; the caller must not reuse it); replace
  state and log; rebuild `byId`; reset the invariant tracker (next check is a full sweep), the decision runtime
  (re-sends in-flight async requests) and the pre-fill driver (rebuilt from `state.prefill.replies`); rebuild the KPI
  collector by feeding it the whole log. Handlers, options and subscribers are kept; handlers are never in a snapshot,
  so pass the same ones when resuming.
- `restoreSimulation(snap, handlers?, options?)` creates a simulation from the snapshot's config and seed with
  `skipPreRun` and restores into it.
- **Equivalence:** a run resumed from a snapshot at `T` produces the same events after `T` as the uninterrupted run
  (`--until time:T` leaves `now = T`; events at `t <= T` are in the snapshot). Prove a late bug window with
  `tt:run --until time:T --snapshot f.json` then `tt:run --from-snapshot f.json --until time:T2 --events win.jsonl`.
- **Browser replay:** saves and rewind re-run the config for `log.length` events and then `restore`
  ([scenarios-and-persistence.md](scenarios-and-persistence.md)); injected events are not replayed.

## Logging

`engine/logging.ts`. `createSimulation(..., { log: { verbosity, write } })` subscribes a logger that turns each
committed event into at most one `LogRecord { t, eventId, seq, subsystem, level, type, subjects }` plus `causedBy`
and `payload` at `debug`. Verbosity is `parseLogVerbosity('sts=debug,vessel=warn,*=info')` (a bare level sets the
default, `info` if absent; levels `off|error|warn|info|debug`). Subsystem and level come from `EVENT_LOG_META`
(`StsMoveStarted` debug, `StsWaitingForGroundPosition` warn, `DecisionFailed` warn, `InvariantViolated`
`invariants`/error), else the first word of the type at `info`. Logs derive from committed events only; there is no
free-text reactor logging.

## Run diff

`engine/runDiff.ts#diffEventLogs(a, b, { context = 3 })` compares two logs in `seq` order by full JSON envelope
(ignoring `wallLatencyMs`) and returns the first diverging event (`seq`, `a`, `b`), the leaf paths that differ
(`jsonDifferences`, e.g. `payload.groundPositionId`), `context` identical events before and the next ones per run.
`pnpm run tt:diff` wraps it (exit 0 identical, 1 diverged). The first diverging event is the first effect of a
change, so diff before and after logs to locate a behaviour change.

## ENGINE_VERSION

`engine/simulation.ts#ENGINE_VERSION` ("0.53.0"): bump it when engine behaviour changes in a way that invalidates
snapshots, in practice any change that moves an event log. `restore` refuses a snapshot whose `engineVersion`
differs; the browser offers "Restart from its config" instead. Changes that move no event (container props, derived
statuses, invariant or KPI reads) have shipped without a bump. `SNAPSHOT_SCHEMA_VERSION` (1) is the snapshot shape.
The docs' "Checked against ENGINE_VERSION" lines follow it.

## Per-event cost walk-through

What one `step()` does, in order, and what its cost scales with. Measured baseline (`perf/baseline.json`, TTI
baseline 24 h, invariants on, `sweepEvery` 1000): 38,164 events in 24.7 s wall, of which 11.7 s (0.31 ms per event,
47 %) in invariant checks. The CPU profile in
[reports/throughput-and-speed-report.md](reports/throughput-and-speed-report.md) (0.5 peak day, before the #226 and
#237 speed-ups) put invariants at 54 % inclusive, GC 20 %, the event-log hash 2.8 %, decisions 1.2 %, KPI collection
0.3 %.

| # | Work | Scales with |
|---|---|---|
| 1 | `decisions.drain()`, `decisions.waiting()` (`Object.values(pending)`) | pending decisions (usually 0 to a few) |
| 2 | `invariantDeadline` (when invariants are on): every truck at a stall, plus a yard-deadlock scan when the queue is empty | trucks |
| 3 | `heapPop` | log2 of queued events |
| 4 | `makeContext`: one object and five closures | constant (GC pressure) |
| 5 | `react`: 13 map lookups, then the reactors. This is the subsystem logic: dispatch scans (SHC jobs, ASC jobs), `candidateSlots`, rehandle helpers, gate pumping, reservations (`earliestStart` filters the whole reservation list per plan) | the subsystem and the state it scans; `DecisionResolved` runs up to 9 reactors that each narrow on `decisionPoint` |
| 6 | `commit`: `log.push`, `byId.set`, `feed` (KPI collector `ingest`; a shifted copy during a warm-up), `JSON.stringify` + char-by-char hash, listeners (logger, worker `observe`) | payload size (segments arrays), listeners |
| 7 | `endConditionMet` | constant |
| 8 | invariants: skipped for `STATE_NEUTRAL_EVENTS` (`DecisionRequested`) and inside the pre-run phase; otherwise `InvariantTracker.check` runs the invariants whose `reads` overlap the event's subjects (scoped ones only over touched containers, yard columns, equipment, vessels), or a full `sweep` every `sweepEvery` events and on the last event | subjects touched; a sweep scales with the whole state |

Memory grows with the run: the full log and `byId` are kept for `why`, the hash, snapshots and replay, and a snapshot
copies all of it. `state.reservations` is pruned only when a new reservation is made.

## Optimisation levers

- **Invariants** are the largest per-event cost: `options.invariants.enabled: false` or a larger `sweepEvery` for
  speed-only runs (the hash does not move; `invariants.checks` in summaries does). Making a heavy invariant `scoped`
  or index-backed is the structural fix ([invariants.md](invariants.md), [optimising/run-speed.md](optimising/run-speed.md)).
- **Fewer events** per box (merging phase events, avoiding decision pairs) is the biggest lever but moves every hash
  and golden: plan it as its own ticket.
- **Payload size** feeds `JSON.stringify` in the hash and the worker Delta; keep `segments` to the motion that led up
  to the event.
- **Derived indexes** ([state-model.md](state-model.md#derived-indexes)) replace whole-state scans; any new scan in a
  reactor or invariant on a TTI-size yard (about 28,000 slots) is a red flag.
- Snapshots are free unless taken; `--snapshot` copies once at the end.

## Gotchas

- Everything a reactor does must go through `ctx`: `ctx.random()` not `Math.random`, `ctx.schedule` not a direct
  heap push (it sets `causedBy`), `ctx.transferCustody` plus the physical holder update in the same reactor.
- `SimState` must stay plain JSON (no Map, Set, class or function); snapshots and restore assume it. Derived lookups
  go in a `WeakMap` keyed by a state object, never in the state.
- A new reactor map placed earlier in `REACTORS` changes event ids and thus same-time order: expect hash changes.
- Reactors that early-return on `state.subsystems.<x> === 'off'` are how off modes work; a new reactor in a
  subsystem must do the same.
- Piping `tt:run` into `head` prints a harmless EPIPE stack trace.
- Proving a change: `pnpm run tt:golden` for drift, `tt:diff` before/after logs for the first divergence,
  `pnpm run verify` before handing back (terminal-twin-AGENTS.md, "How to prove a change works").

# Optimising headless run speed

Checked against ENGINE_VERSION 0.53.0.

Read this when a headless run (`tt:run`, `tt:profile`, `tt:bench`, the test suite) is too slow or uses too much memory, or
before changing anything on the per-event path (`engine/simulation.ts`, `engine/invariants.ts`, the indexes). It says
where wall time goes, which levers exist, what has been tried, what must not move and how to measure. Simulated
throughput (moves per hour) is [terminal-throughput.md](terminal-throughput.md); browser frame rate is [frame-rate.md](frame-rate.md).

## Where wall time goes

Measured in [../reports/throughput-and-speed-report.md](../reports/throughput-and-speed-report.md) (#221) on ENGINE_VERSION
0.52.0, `TTI_MOVES_SCALE` 0.5, peak day `--until vessels:5` (296,635 events, 263,377 checks, hash `0c67d35d6d90b8`),
CPU profile, before the speed-ups of spec #220:

| Cost | Share of profile | Where |
|---|---|---|
| Invariant checks | 54 % inclusive (47.5 % self in `engine/invariants.ts`: `check` 33 %, `slotsToCheck` 3 %, `sharedCells` 1.4 %) | `engine/simulation.ts#createSimulation` (`checkInvariants`), one call per event |
| Garbage collection | 20.4 % self | temporary arrays, sets and maps in the invariant sweeps and the yard helpers (`retrievalRanks` 3.2 %, `reservedStacksOf` 1.7 %) |
| Everything else | about 25 %: landside 5.7 %, rehandle 4.2 %, SHC 3.8 %, event-log hash 2.8 %, decision points 1.2 %, KPI collection 0.3 % | `step` is 79.5 % inclusive, invariants included |

State cloning and snapshots are 0 % in a plain `tt:run` (a snapshot is taken once at the end, only with `--snapshot`).
KPI collection and decision-point calls together are 1.5 %: not worth chasing.

Per-invariant cost (#233, same report, scale 0.1 peak day, 86,946 incremental checks and 96 sweeps): the invariant
functions are 93.9 % of tracker time, tracker bookkeeping (scope sets and maps per event) 6.1 %. Top costs then:
`stowage.no-floating` 19.3 %, `landside.waiting-off-road` 13.0 %, `stowage.cell-free` 10.4 %, `landside.segregation`
8.4 %, `asc.wtp-handover` 6.1 %, `landside.stranded-truck` 5.9 %, `custody.single-owner` 5.7 %. The three stowage
invariants were fixed afterwards (#234, #237, below); the unscoped `time` invariants were not.

### After the speed-ups (ENGINE_VERSION 0.53.0)

From [../reports/realistic-volume-reports.md](../reports/realistic-volume-reports.md) ("Step: TTI_MOVES_SCALE 1"), idle machine, one run at a time:

| Run | Events | Checks | Wall | Hash |
|---|---|---|---|---|
| baseline 0.5 (0.52.0) | 151,282 | 115,601 | 112 s (was 130 s) | `084b735c5113f9` |
| peak day 0.5 (0.52.0) | 296,635 | 228,281 | 318 s (was 438 s) | `0c67d35d6d90b8` |
| baseline 1 | 267,585 | 216,734 | 222 s (was 279 s) | `168e78e8241a57` |
| peak day 1, `--until vessels:5` | 489,566 | 399,379 | 554 s (9 min 14 s) | `10e8cbb0541010` |

- Wall per event is about 1.1 ms (1.07 ms at 0.5, 1.13 ms at 1): close to linear in events.
- The spec #220 criterion is a full-size peak day under 10 minutes. The margin is 46 s (8 %): one new unscoped invariant
  or a slower per-event path can break it.
- No CPU profile exists at 0.53.0 / scale 1. Treat the shares above as the pre-fix picture; re-profile before choosing a lever.

## How a step costs

`engine/simulation.ts#createSimulation` builds the closure; `step` does, per event:

```
decisions.drain()                       resolve async replies that arrived
invariantDeadline(...)                  time-based invariant due before the next event? move clock, full sweep
heapPop(state.queue)                    binary heap (engine/eventQueue.ts)
react(ev)                               makeContext (one object per event) + every reactor map for ev.type
commit(ev)                              log.push, byId.set, KPI collector, hashUpdate(JSON.stringify(ev)), listeners
endConditionMet()
checkInvariants(ev, forceSweep)         skipped for STATE_NEUTRAL_EVENTS unless a sweep is forced
```

- **Event-log hash** (`engine/hash.ts#hashUpdate`): cyrb53-style over the event's full `JSON.stringify` (`hashedJson`
  drops `wallLatencyMs` from `DecisionResolved`). Cost is one stringify plus a char loop per event (2.8 % at 0.5).
  The hash state is two uint32 in `state.logHash`, so it survives snapshot and restore.
- **Memory**: the whole event log stays in memory (`log` array plus the `byId` map) for the run, and snapshots embed
  it. Memory therefore grows linearly with events. A 0.25 peak-day snapshot at sim 7,200 s is 1.4 GB; the earlier
  scale-1 attempt ran with `NODE_OPTIONS=--max-old-space-size=6000`. `sim.snapshot()` uses `structuredClone` (not
  `JSON.stringify`, which hits the ~512 MB string limit) and `cli/snapshotFile.ts#writeJsonFile` / `readJsonFile`
  stream the file in pieces; `--from-snapshot` adopts the parsed object (`restoreSimulation(..., {adopt: true})`).
- **Invariants** (`engine/invariants.ts#InvariantTracker`; full catalogue in [../invariants.md](../invariants.md)):
  - `check` builds the set of touched kinds from `ev.subjects`: `container` (and `yardSlot`) when containers are named,
    `vessel`, `equipment` (equipment or jobs). `reservation` and `time` are touched by **every** checked event, so every
    invariant whose `reads` includes `time` or `reservation` runs after every event.
  - Invariants with `scoped: true` get an `InvariantScope` (touched containers, yard columns before and after, custody
    owners with their recorded boxes, equipment, vessels, reservations since the last check) and look only at those.
    Unscoped ones scan their whole collection (all trucks, all ASCs, all SHCs, all STS).
  - A full `sweep` (every invariant over the whole state, plus rebuilding the tracker's custody and column memory) runs
    on the first check, every `DEFAULT_SWEEP_EVERY` (1000) events, at an end condition, at the end of the pre-run phase,
    and at a time deadline (`invariantDeadline`, `yardNoProgressDeadline`).
  - `STATE_NEUTRAL_EVENTS` (today only `DecisionRequested`) skips the per-event check. It cut checks 13 %
    (0.1 peak day 100,464 to 87,028).
  - The pre-run phase of a `prefilled` start is not checked per event; it is swept once at its end.
- **Yard index** (`engine/yardIndex.ts#yardIndexOf`): slots per block and per column (`columnKey` = `${blockId}|${bay}-${row}`),
  cached in a `WeakMap` keyed on the `state.yardSlots` object. Kept current by `indexYardSlotAdded` /
  `indexYardSlotRemoved` (called from `placeInStack` / `removeFromStack` in `engine/subsystems/ascStorage.ts` and the
  pre-fill). It also holds the `retrievalRanks` cache, keyed on a per-block `stackVersion` and a global `planVersion`
  (`notePlanChanged`). `engine/subsystems/rehandle.ts#retrievalRanks` is the cached form, `computeRetrievalRanks` the uncached one.
- **Vessel indexes**: `engine/vesselSlotIndex.ts#vesselSlotsOf` (slots per vessel, same `WeakMap` pattern) and
  `engine/vesselOccupancy.ts#vesselOccupancyOf` (occupied cells per vessel, numeric `cellKey(bay, row, tier)` =
  `(bay * 128 + row) * 128 + tier`, built by one scan on first use). The stowage invariants ask the occupancy map first
  and run the original scan only for a vessel that violates, so messages and order are unchanged.
- **Other caches**: lane graph per config (`engine/laneGraph.ts`, `WeakMap` on the config) and shortest paths per graph;
  landside road zones per graph (`engine/invariants.ts#roadZonesOf`, it once was half of the peak-day run time, TT-176).
  All are keyed on object identity: never mutate a config after `createSimulation`.

## What has been done (do not redo)

| Change | Effect | Commit |
|---|---|---|
| `STATE_NEUTRAL_EVENTS` skips `DecisionRequested` (#226) | 13 % fewer checks; check counts in goldens regenerated in #222 | e1e8832 |
| `retrievalRanks` cached per block (#228) | removed a 3.2 % hot spot; `headsWithoutPad` (`engine/subsystems/loadPrep.ts`) could not be cached (it depends on load-order stages) but finds every crane's head in one pass | 41869ee |
| Vessel slot index for stowage invariants (#234) | iterate only touched vessels' slots | fc050cc |
| Vessel occupancy map (#237) | stowage invariants 32.2 s to 5.7 s CPU; the real gain of spec #220 | f15bf48 |
| Earlier: skip vessel-slot scan when no vessel touched; allocation-free pickup feasibility pass; reservation scans only of the needed zones | pre-report | 5192ab4, e8f4463, 823a96e |
| Road zones cached (`roadZonesOf`, TT-176) | landside invariant made cheap | pre-report |

Event-log hashes did not move for any of these: they read state only.

## Levers not yet pulled

Ordered by expected gain from the #233 per-invariant table (which predates #234 and #237, so the stowage share has gone):

1. **Unscoped `time` invariants** (`landside.waiting-off-road`, `landside.stranded-truck`, `landside.stall-exclusive`,
   `landside.leaves-complete`: 22.2 % of invariant time at 0.1). They scan every truck after every event. Keep a count
   or list of trucks per status and return early when none is in a status the rule cares about; `waiting-off-road` also
   allocates a `new Set([...])` of statuses per call (hoist it). Same messages, event log unchanged.
2. **`asc.wtp-handover` and `asc.no-passing`** (9.5 %): per event they call `ascPoseAt` and `blockSpecsById(config)` /
   `laneGraphOf(config)` lookups for every ASC. Hoist the lookups and bail when no SHC is inside a pad envelope
   (`PAD_HALF_X_M` 1.6, `PAD_HALF_Z_M` 6.5).
3. **Allocation (GC was 20 %)**: the tracker builds a `Set`, a `Map` and an `InvariantScope` per event; `columnKey`
   builds strings. Reuse buffers, numeric keys. Expect GC to fall with every invariant fix.
4. **Sweep frequency**: `DEFAULT_SWEEP_EVERY` 1000. A larger value saves sweeps but delays detection of violations in
   state an event did not name (they are attributed to the sweep's event). `tt:bench --sweep-every N` measures it;
   `tt:run` has no flag for it (programmatic `createSimulation(config, h, {invariants: {sweepEvery}})`).
5. **More state-neutral event types**: add a type to `STATE_NEUTRAL_EVENTS` only if its reactors and handlers change
   nothing any invariant reads. Changes the check count (goldens), not the event log.
6. **Hashing**: stringify per event is unavoidable while the hash is over JSON; a cheaper hash input would change every
   golden hash, so it is a format change, not a speed fix.
7. **Memory**: the in-memory log is the main growth term. Dropping `byId` or the log would break `tt:diff`, the
   debugger and snapshots; not a free lever.

## Constraints that must hold

- **Determinism and identical event log**: a speed change must leave `Event-log hash` identical on the reference runs
  (state is plain JSON, iteration order is `Object.values` order; a cache must return exactly what the scan returned,
  in the same order). Caches are derived, never stored in `SimState`.
- **Goldens**: `pnpm run tt:golden` must print `match`. Only the `invariants.checks` count may legitimately change (and
  only when the check schedule changes); regenerate then with `pnpm run tt:golden --update` and explain it.
- **Invariants still detect**: a planted violation must still be found. `tests/invariants-incremental.test.ts` (seven
  fixtures) and the per-invariant tests with tampered snapshots guard this; an event that changes a container's custody
  or yard slot must list it in `subjects.containers`.
- **Index upkeep**: code that adds, replaces or deletes `state.vesselSlots` entries after start must call
  `indexVesselSlotAdded` / `indexVesselSlotRemoved`; code that sets or clears a slot's `containerId` must call
  `occupancySlotFilled` / `occupancySlotCleared`; a yard slot add or remove must go through `indexYardSlotAdded` /
  `indexYardSlotRemoved`; setting a `plannedContainerId` after start must call `notePlanChanged`. Tests:
  `tests/vessel-slot-index.test.ts`, `tests/vessel-occupancy.test.ts`, `tests/retrieval-ranks-cache.test.ts`.
- Callers must treat `retrievalRanks` maps and index lists as read-only.

## How to measure

Never run two heavy jobs at once: the report figures were 50 to 75 % slower when four runs shared four cores. Start any
peak-day run with `scripts/bg.sh run --heavy <log> <command>` and wait with `scripts/bg.sh wait <log>` (it queues
behind the machine-wide lock).

| Goal | Command |
|---|---|
| Wall time of one run | `scripts/bg.sh run --heavy /tmp/pd.log bash -c 'time pnpm run tt:run --preset "TTI Algeciras, peak day" --until vessels:5'` (`tt:run` prints no wall time; `/usr/bin/time` is not installed in cloud containers). Check `Event-log hash` and `Invariants: N checks, 0 violations`. Peak memory: `tt:bench` (RSS) |
| Quick regression check | `pnpm run tt:run --preset "TTI Algeciras baseline" --until time:20000` before and after, same hash |
| CPU profile | `node --cpu-prof --cpu-prof-dir /tmp/prof --import tsx src/sims/terminal-twin/cli/run.ts --preset "TTI Algeciras, peak day" --until vessels:5`, then sum self time per function and file from the `.cpuprofile` with a throwaway script outside the repo |
| Benchmark against baseline | `pnpm run tt:bench [--preset "TTI Algeciras, peak day"] [--hours 24] [--sweep-every N]`: events/sec, wall-ms per sim-hour, invariant ms and us/event, peak RSS; regression flag above 20 % (`REGRESSION_THRESHOLD`). `perf/baseline.json` was recorded on older engines and other machines: re-record with `--update-baseline` on your machine before comparing |
| Invariant time inside a run | `sim.invariantStats()` (incremental checks, sweeps, wall ms) |
| Several variants in parallel | `scripts/proof-runner.sh "--fixture <a>" "--fixture <a> --seed 7"`: one table of exit, wall s, moves, violations, under the heavy lock. Variants are split on spaces, so preset names (which contain spaces) cannot be passed: use `scripts/bg.sh` for presets |

Proof for a speed change: same `Event-log hash` and move count on the 0.5 or 1 peak day (or a bounded `--until time:`
run for a quick loop), same `checks` unless the schedule changed on purpose, wall before and after on an idle machine,
`pnpm run verify` green. The engine version and goldens stay untouched when the log does not move.

## Gotchas

- Shares from a shared machine are usable, absolute seconds are not.
- `tt:profile` runs the scenario once more; profiling a 9 minute run costs another 9 minutes.
- Invariant wall time counts in `checkInvariants`, not the tracker alone: deadline sweeps and the closing sweep are full sweeps.
- A per-event cost that is O(entities) grows with `TTI_MOVES_SCALE` twice: more events and bigger collections (per-event
  cost rose 1.1 to 1.7 ms from 0.25 to 1 before the fixes).

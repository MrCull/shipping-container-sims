# KPIs, end conditions and reports

Checked against ENGINE_VERSION 0.53.0.

Read this when you need to measure a run (moves per hour, waits, utilisation), stop a run at a condition, read or change
a golden summary, export KPIs or events, or find out where crane and box time goes (`tt:profile`, `tt:sts`). The dashboard
and final-report UI are in [browser-host.md](browser-host.md). Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## Two KPI sources

| Source | Where | What | Stored? |
|---|---|---|---|
| **KpiReport** (`Simulation#kpiReport()`) | `engine/kpis.ts#buildKpiReport` over `SimState` (`state.kpis` counters kept by the subsystems) | run totals, rounded to 3 dp: moves, vessels, per STS, per vessel, quay, TOS handlers, horizontal, yard, work packages, ordering, hatch, landside, dwell | counters are in `SimState` (in snapshots, part of goldens) |
| **KPI series** (`Simulation#kpiSeries()`) | `engine/kpi/collector.ts#createKpiCollector`, a pure fold over committed events | every KPI as hourly, per-shift and whole-run series | never stored: rebuilt by replaying the log after a restore; does not touch the hash or goldens |

The headline KPIs (`engine/kpi/headline.ts#headlineKpis`) and highlights (`#highlightsOf`) are pure functions of both, so the
CLI, the worker and the UI show the same numbers for the same run (`tests/kpi-host.test.ts`).

Gotcha: the two sources define some rates differently. `KpiReport.sts[id].grossMovesPerHour` = moves x 3600 / (last move
end minus first move start). The series `sts.gross-moves-per-hour` (and the headline, which sums it over cranes) =
moves / (window minus time waiting for work). Example: `tracer-1sts-10-boxes` prints 24.188 on the STS line and 23.903 in
the headline.

## The collector (`engine/kpi/`)

- `collector.ts`: `Simulation#commit` feeds every committed event to `ingest` (warm-up events are dropped; measured events
  are shifted to the measured clock; `WarmUpEnded` starts a fresh collector). `observe` turns events into per-hour
  **components** in an `Acc` (sums: counts, seconds, metres; gauges: values carried forward). Intervals that span hours
  are split across buckets (`Acc#interval`).
- Each KPI is `value(window)` over the summed components of a window (hour, shift, run), so ratios and means are exact at
  every level, never averages of averages. Open states (a crane waiting, an ASC mid-cycle, an SHC in a state) are closed
  at `now` on a copy when a report is built.
- `clock.ts`: hours are cut on the scenario clock (a 06:30 start gives a half-hour first bucket); shifts are 3 x 8 h of
  whole hours from `DEFAULT_SHIFT_START_HOUR` = 6 (06 to 14, 14 to 22, 22 to 06; a night shift belongs to the day it
  starts). Clock from `config.kpi { startTimeOfDayS?, shiftStartHour? }`, default `startDateTime` read in UTC (machine
  independent). The browser's `runConfigFor` sets `startTimeOfDayS` from the local start time so shifts match the screen.
- Report shape: `KpiSeriesReport { clock, elapsedS, hours: HourBucket[], shifts: ShiftBucket[], series[id] = { id, unit,
  entityKind, entities[entity] = { hourly[], shifts[], total } } }`; null = no data (nothing to divide by).
- Groups exist only with their subsystem (`defApplies`): `shc.*`/`wtp.*` need SHCs, `asc.*`/`yard.*` need blocks,
  `landside.*` need a landside and blocks (`holding-*` and `appointments-*` need those configs).
- `engine/timeline.ts#buildTimeline(events, now)`: Gantt rows from the log (anchorage, mooring, work, unmooring per vessel; one
  work package per crane-split assignment), used by the dashboard.

## Every KPI series (`engine/kpi/collector.ts#KPI_DEFS`)

Units: count, moves/h, s, pct, ratio, m. "Per" is the entity kind.

| Id | Per | Definition |
|---|---|---|
| `sts.moves` | sts | boxes grounded (discharge, `StsGrounded`) or loaded (`StsLoaded`); hatch moves excluded |
| `sts.gross-moves-per-hour` | sts | moves / hours on a vessel (window minus `sts.wait-work-s`) |
| `sts.net-moves-per-hour` | sts | moves / (hours on a vessel minus SHC wait minus rail wait) |
| `sts.wait-shc-s` | sts | seconds waiting for a free ground position (discharge) or for the export box (load) |
| `sts.wait-work-s` | sts | seconds with no work: from the start (or `StsWorkComplete`) to the next move start |
| `sts.wait-rail-s` | sts | seconds waiting for the rail (a neighbour closer than `stsMinSpacingM`) |
| `wp.released`, `wp.completed` | sts | work packages released / completed |
| `wp.lead-time-s` | sts | mean release to start of work (the yard's look-ahead) |
| `berth.moves-per-hour` | terminal | all crane moves / hours with a vessel berthed and working |
| `vessel.remaining-moves` | vessel | gauge: discharge boxes not yet picked |
| `vessel.turnaround-s` | vessel | berthed to departed, in the hour of departure |
| `vessel.anchorage-wait-s` | vessel | arrival to berth allocation, in the hour of allocation |
| `shc.loaded-pct`, `shc.empty-pct`, `shc.idle-pct` | shc | share of the window driving loaded / empty / neither |
| `shc.empty-travel-ratio` | shc | empty m / (empty + loaded m) |
| `shc.empty-distance-m`, `shc.loaded-distance-m` | shc | metres |
| `shc.state.<state>-s` | shc | seconds in each of the 7 operational states (`engine/shcStates.ts#SHC_OPERATIONAL_STATES`, TT-R11) |
| `shc.handovers` | shc | `ShcPicked`, `ShcPickedAtWtp`, `ShcDroppedAtWtp`, `ShcDroppedAtGround` (one per box up, one per box down) |
| `shc.jobs`, `shc.cycle-time-s` | shc | cycles (`ShcCleared`) and mean cycle time |
| `wtp.dwell-s` | block | mean seconds a box stands on a WTP pad (SHC drop to ASC pick) |
| `asc.utilisation-pct` | asc | busy share of the window |
| `asc.jobs`, `asc.cycle-time-s` | asc | jobs and mean cycle time |
| `yard.rehandles-per-move` | block | rehandles / productive moves |
| `yard.fill-pct` | block | gauge: 20 ft cells in use / bays x rows x tiers |
| `landside.trucks-in`, `landside.trucks-out` | terminal | gate-ins, gate-outs |
| `landside.truck-turn-s` | terminal | mean gate-in to gate-out |
| `landside.gate-queue` | terminal | gauge: trucks queued at the gate |
| `landside.gate-wait-s`, `landside.gate-processing-s`, `landside.stall-wait-s`, `landside.internal-drive-s`, `landside.total-turnaround-s` | terminal | means (TT-R18; total = gate arrival to gate-out) |
| `landside.road-trucks` | terminal | time-weighted mean trucks on internal roads |
| `landside.holding-utilisation-pct` | terminal | occupied holding position-seconds / positions x window |
| `landside.appointments-delayed` | terminal | booked trucks that passed the gate after their window |
| `handler.calls`, `handler.fallbacks`, `handler.failures` | handler | per decision point |
| `handler.mean-latency-s` | handler | mean sim latency of decisions resolved in the bucket |
| `handler.wall-latency-s` | handler | mean wall latency, from `DecisionResolved.payload.wallLatencyMs` (works after a load or rewind) |
| `handler.backlog` | handler | gauge: pending decisions |
| `handler.equipment-idle-s` | handler | sim latency x waiting equipment (from the `DecisionResolved` subjects) |

Cross-checks against the engine counters: `tests/kpi-collector.test.ts`; buckets: `tests/kpi-buckets.test.ts`.

## Headline KPIs and highlights

`HeadlineKpis` (`engine/kpi/headline.ts`): `movesDone`, `vesselsDone`; `grossMovesPerHour`, `netMovesPerHour` (sum over
cranes of the run totals); `shcEmptyTravelRatio`, `shcBusyPct` (loaded + empty), `shcStateS` (mean per SHC),
`ascUtilisationPct`, `yardFillPct`, `wtpDwellS` (means over entities); `shcEmptyDistanceM`, `shcHandovers` (sums);
`truckTurnaroundS` (KpiReport landside mean, after the first gate-out). Null where the subsystem is absent.

Highlights: hardest-working crane (most `sts.moves`, with its net rate), busiest block (highest `asc.utilisation-pct`),
busiest SHC (most `shc.jobs`), longest wait (anchorage, ground-position wait or rail wait).

## KpiReport fields (`engine/kpis.ts#KpiReport`)

| Field | Content |
|---|---|
| `simTimeS`, `eventsProcessed`, `movesCompleted`, `vesselsCompleted` | measured period (after a warm-up: from its end); `warmUp { durationS, ended }` only for a warm-up start (TT-14) |
| `sts[id]` | `moves, cycles, twinLifts, grossMovesPerHour, railWaitS` |
| `vessels[id]` | `sizeClass, arrivedAtS, anchorageWaitS, berthX, berthedAtS, departedAtS, turnaroundS` (berthed to departed), `sts[]` |
| `quay` | `vesselsWaited`, `anchorageWaitS { total, mean, max }` |
| `handlers[dp]` | see [decision-points.md](decision-points.md); decision points never called are omitted |
| `horizontal` | `boxesToWtp`; per SHC `jobs, emptyDistanceM, loadedDistanceM, reservationWaitS, stateS, handovers, parkingReturns, queueArrivals`; `stsGroundPositionWaitS` per STS |
| `yard` | `boxesStacked, boxesInTransit, allocationFailures`, `grouping { placements, mixedStack, orderBroken, mixedBay }` (only with `grouped`), `rehandles { total, productiveMoves, perProductiveMove, failures }`, per block and per ASC (gantry/trolley/hoist m, pad wait, rail wait, busy, yields) |
| `workPackages` | `released, started, completed, leadTimeMeanS, leadTimeMaxS, boxesLoaded` |
| `ordering` | broken ordering preferences (only with `pod-weight`, the default): discharge `groupSplits`; load `podOnEarlier`, `heavyOnLight` |
| `hatch` | only once a hatch move started (TT-R09): `moves = removes + replaces`, `stsTimeS`, `waitS` (lashing/securing), per STS |
| `landside` | trucks in/out/inside, gate queue, turn, gate wait, processing, internal drive, total turnaround, road use, stall alloc wait, stall wait, service, transactions, boxes dropped/picked, `appointments`, `holding` |
| `dwell[direction]` | `{ count, departed, meanS, maxS }` arrival to departure from terminal custody (or to now), `engine/transit.ts#dwellS`; directions with no arrived box omitted; boxes without `props` (old snapshots) skipped |

Hatch moves are not in `sts.moves` or the rates, but the crane's last move end includes them, so hatch time lowers gross
moves per hour and lengthens turnaround. Hatch totals and dwell are report fields only (no series, no dashboard tile).
`parkingReturns` and `queueArrivals` are engine counters, not series.

## End conditions and stop conditions

Two different things:

| | End condition | Stop condition |
|---|---|---|
| Config | `config.endConditions { vesselsCompleted?, simDurationS?, moves? }` (`scenario/types.ts#EndConditions`) | `RunCondition { time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate? }` passed to `runUntil` |
| CLI | `tt:run --end moves:<n> \| vessels:<n> \| time:<s>` (repeatable; replaces the scenario's own) | `tt:run --until end \| time:<s> \| moves:<n> \| vessels:<n> \| event:<Type>` |
| Effect | the run **ends**: a `ScenarioEnded { reason }` event is committed (in the hash); status `ended` | the call returns with reason `condition`; nothing is logged, the run can continue |
| Printed | `Stopped: ended (moves >= 5)` | `Stopped: condition` |

- None set: the run ends when every scheduled vessel has departed (`vesselsCompleted >= N`, minus vessels completed during
  a warm-up). The first condition met ends the run (`simulation.ts` `endConditionMet`; `tests/end-conditions.test.ts`).
- Reasons: `vesselsCompleted >= n`, `moves >= n`, `simDurationS >= s`. `simDurationS` counts the measured period, so a
  warm-up comes first; at the duration the closing invariant sweep runs, then `ScenarioEnded`.
- A warm-up counts toward nothing.
- Other stop reasons (`engine/simulation.ts#StopReason`): `ended`, `failed`, `idle` (empty queue), `max-events`,
  `waiting-for-decision`.
- UI: the setup dialog's "End conditions" (`modules/endConditions.ts`) replaces the scenario's only once edited; vessels
  blank means all scheduled. `--from-snapshot` refuses `--end` (conditions come from the snapshot).

## Run summary, golden summaries and the event-log hash

`engine/summary.ts#summarizeRun(sim)` returns `RunSummary { scenario, seed, status, endReason, eventLogHash, kpis
(KpiReport), invariants { enabled, checks, violations, first }, firstError }`. `tt:run --out <file>` writes it.

**Golden summaries**: every fixture in `scenario/fixtures/` has `<name>.json` (the scenario) and `<name>.golden.json` (its
`RunSummary` run to the end with default handlers, pretty JSON). `cli/golden.ts#checkFixtureGolden` compares field by field
(`engine/runDiff.ts#jsonDifferences`) and prints `path: golden X → actual Y`.

- `pnpm run tt:golden` (also in `pnpm test`, `tests/golden.test.ts`): exit 0 all match, 1 drift or missing, 2 usage.
- `pnpm run tt:golden --update` or `UPDATE_GOLDEN=1 pnpm test`: rewrite; nothing else ever rewrites a golden.
- Never regenerate to make a failing test pass unless the change is intended and explained. Two branches that both
  regenerate conflict: regenerate on the merged tree. A change that moves every golden (a default flip) is its own ticket.
- What moves goldens: any event change (hash), any KpiReport counter, and `invariants.checks` (even without an event
  change). KPI series do not appear in goldens.

**Event-log hash** (`engine/hash.ts`): a streaming cyrb53-style 53-bit hash, state two uint32s in `SimState.logHash`
(seed `HASH_SEED`), so it survives snapshot and restore and is identical in Node and browsers. `commit()` feeds
`JSON.stringify(event)` (with `DecisionResolved.payload.wallLatencyMs` removed) to `hashUpdate`; `hashDigest` prints 14 hex
characters. `InvariantViolated` and `ScenarioEnded` events are hashed like any other. Cost: about 2.8 % of peak-day wall
time ([reports/throughput-and-speed-report.md](reports/throughput-and-speed-report.md)).

To find the first effect of a change: write `--events before.jsonl` and `--events after.jsonl`, then
`pnpm run tt:diff before.jsonl after.jsonl` (first diverging `seq`).

## Export (`engine/export.ts`)

| Kind | Builder | Content | CLI flag | File suffix (UI) |
|---|---|---|---|---|
| `kpi-json` | `kpiReportJson` | `{ format: 'terminal-twin-kpi-report', scenario, seed, status, eventLogHash, kpis, series, headline, highlights }` | `--kpi-json <file>` | `kpi-report.json` |
| `kpi-csv` | `kpiReportCsv` | long form, header `kpi,unit,entityKind,entity,bucket,index,startS,endS,value`; bucket `hour`, `shift` or `total`; plus a `landside.appointments-rejected` total row when appointments exist | `--kpi-csv <file>` | `kpi-series.csv` |
| `events-json` | `eventLogJson` | the event log as one JSON array | `--events-json <file>` | `events.json` |
| `events-csv` | `eventLogCsv` | `id,seq,t,type,causedBy,subjects,payload` (subjects and payload as JSON cells) | `--events-csv <file>` | `events.csv` |

CSV cells follow RFC 4180. `exportRun(sim, kind)` dispatches; the worker's `export` request and `__tt.exportRun(kind)`
use it. `tt:run --events <file>` (JSON lines, one event per line) is the format `tt:diff`, `tt:sts` and replay read.

## CLI summary (`tt:run`)

`cli/runCli.ts` prints, in order: scenario and seed, `Started`, `Stopped` (with end reason), `Async mode`, `Sim time`,
`Event-log hash`, `Moves completed`, `Vessels done`, one line per STS and per vessel, `Quay:`, `Hatch covers:` (if any),
`Horizontal:` (per SHC jobs, distances, reservation wait, handovers, parking returns, queue arrivals, state time;
ground-position waits), `Headline KPIs:`, `Landside:` (if on), `TOS handlers:`, `Invariants:`, `First error:`. Dwell,
yard, work package and ordering totals are not printed: read them from `--out` or `--kpi-json`. Exit 0 ok, 1 violation or
error, 2 usage.

## Box waits (`engine/boxWaits.ts`)

`boxWaits(events, endS, { top = 10 })` folds the log into the time each box waited for the next machine. A box is ready
when the handing-over machine put it down (export retrieval: when its ASC job was assigned) and taken when the next one
picks it up; carrying time is not a wait. The wait is charged to the machine that was to take it.

| Path | Stage | Ready | Taken |
|---|---|---|---|
| discharge | `sts` | `StsWaitingForGroundPosition` | `StsGroundPositionWaitEnded` |
| discharge | `horizontal` | `StsGrounded` | `ShcPicked` |
| discharge | `yard` | `ShcDroppedAtWtp` | `AscPicked` |
| load | `yard` | `AscJobAssigned` (export retrieval) | `AscRetrieved` |
| load | `horizontal` | `AscDroppedAtWtp` | `ShcPickedAtWtp` |
| load | `sts` | `ShcDroppedAtGround` | `StsLoadPicked` |

An export retrieval is an ASC job whose first move is `AscRoutingToStack` (rehandle and truck jobs are not). A box counts
on a path when it enters it (discharge: STS picks it from the vessel; load: STS starts its load). Waits open at `endS` are
cut there and marked `open`. `BoxWaitReport { endS, paths[path] { boxes, totalS[stage], meanS[stage] }, top[] }`.

## STS productivity (`engine/stsProductivity.ts`)

`stsProductivity(events, endS)` splits each crane's window (first work package start to `endS`) into exactly one bucket
at a time (`STS_TIME_BUCKETS`):

| Bucket | Starts on | Meaning |
|---|---|---|
| `cycle` | `StsMoveStarted` / `StsLoadStarted`, end of any wait | hoisting, trolleying, landing; also gaps between packages |
| `hatch` | `StsHatchStarted` | hatch cover work |
| `lashing` | `StsWaitingForHatch` | cover still lashed or hatch not yet secured |
| `ground` | `StsWaitingForGroundPosition` | discharge: no free ground position (horizontal too slow) |
| `box` | `StsWaitingForBox` | load: export box not on its ground position yet |
| `rail` | `StsWaitingForRail` | a neighbour is closer than `stsMinSpacingM` |
| `reposition` | `StsRepositionStarted` | stepping aside for another crane |
| `done` | `StsWorkComplete` | no more work on its vessel |

`StsProductivityReport { endS, rows[{ stsId, startS, windowS, buckets, moves, grossMovesPerHour }], total, share }`;
`formatStsProductivity` prints it. Command: `pnpm run tt:sts <events.jsonl> [--until <s>]` (default: last event time;
exit 2 without a file). Make the log with
`pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:7200 --events /tmp/peak.jsonl` (1 to 4 minutes).
Tests: `tests/sts-productivity.test.ts`.

## Profiler (`tt:profile`)

`pnpm run tt:profile <preset|fixture> --until <seconds> [--json <file>]` (`cli/profileCli.ts`; `--until` sim seconds,
required). Runs with default handlers to `--until` or the scenario's end and prints:

1. `Moves per clock hour` (one row per STS plus `ALL`, a column per clock hour and `run`), from `sts.moves`.
2. `ASC idle share` (100 minus `asc.utilisation-pct`) and `SHC idle share` (`shc.idle-pct`) per hour and for the run.
3. `STS time breakdown` (the `tt:sts` table over 0 to the end).
4. `Box waits` (mean seconds per box for discharge and load: `yard`, `horizontal`, `sts`) and `Top waits` (10 longest,
   `open` if still waiting).

`--json` writes `ProfileReport { format: 'terminal-twin-profile', scenario, seed, until, endS, stopped, hours, sts, asc,
shc, stsProductivity, boxWaits }`. Exit 0, 1 on an engine error, 2 usage. Example:
`pnpm run tt:profile mixed-discharge-then-load --until 2000`. Tests: `tests/{box-waits,cli-profile,sts-productivity}.test.ts`.

## Final report and dashboard (pointer)

The final report panel (`components/FinalReport.vue`: end reason, highlights, headline, cranes, vessels, TOS-handler
table, export buttons), the KPI strip (`components/KpiStrip.vue`, `modules/kpiStrip.ts`) and the dashboard tab (charts per
`modules/dashboardModel.ts#KPI_GROUPS`, yard heatmap, Gantt from `buildTimeline`, lazy ECharts) are documented in
[browser-host.md](browser-host.md). The worker queries are `kpiSeries`, `kpiHeadline`, `dashboard` and the `export`
request; dev API `__tt.report()`, `__tt.exportRun(kind)`, `__tt.openDashboard()`.

## Add a KPI

Append a row to `KPI_DEFS` (id, unit, entity kind, entities, `value(window)`), add the components it needs in `observe`
(`collector.ts`), list it in a group in `KPI_GROUPS` (`modules/dashboardModel.ts`) and add a `dashboard.kpi.<id>`
catalogue key; `tests/dashboard-model.test.ts` fails until both exist. A collector KPI changes no hash and no golden. A new
`KpiReport` field moves every golden that has it: run `pnpm run tt:golden --update` and review.

## Optimisation levers

- **Measuring throughput**: compare `sts.net-moves-per-hour` and the `tt:sts` shares (`ground` and `box` say the
  horizontal or yard side starves the cranes; `rail` says crane split; `lashing`/`hatch` say hatch work), then `Box waits`
  to see which stage holds boxes. Strategy levers: [decision-points.md](decision-points.md);
  [optimising/terminal-throughput.md](optimising/terminal-throughput.md).
- **Run speed**: KPI collection is about 0.3 % of wall time and the hash about 2.8 %; the KPI report is built on demand.
  Do not add per-event scans of the whole state to `observe`.
- **Must not break**: the collector stays a pure fold of the log (no state reads), so restore and rewind rebuild it
  exactly; KPI timing never comes from wall time except `wallLatencyMs`, which is kept out of the hash.

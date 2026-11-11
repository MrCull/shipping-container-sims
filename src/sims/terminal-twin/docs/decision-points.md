# Decision points (TOS seams)

Checked against ENGINE_VERSION 0.53.0.

Read this when you want to change how the terminal decides (which job, which pad, which slot, which crane, which lane),
compare strategies, plug in an external TOS, inject TOS latency, or add a strategy or a decision point. It is the main
doc for improving operational throughput through strategies. Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## The seam model

Every TOS decision goes through `engine/decisions/`. A reactor never calls a handler directly. It calls
`ctx.requestDecision(dp, request, subjects)` (`engine/context.ts#EngineContext`), sets the waiting equipment to a waiting
status, and acts on the reply in its own `DecisionResolved` reactor (narrowed on `e.payload.decisionPoint`; the payload
carries both `request` and `reply`).

```
asking reactor: ctx.requestDecision(dp, request, { equipment: [waitingId], ... })
  -> DecisionRequested   runtime builds the message, draws latency, calls the handler
  -> [DecisionFailed]    timeout or error: the fallback strategy answers
  -> DecisionResolved    runtime bookkeeping, then the asking subsystem's reactor acts on payload.reply
```

- **Message** (`engine/decisions/types.ts#DecisionRequestMessage`): `{ correlationId, decisionPoint, version, t, payload }`.
  Plain JSON. `correlationId` is `<dp>-<n>` (n counts per run, `SimState.decisions.nextCorrelation`). `version` comes from
  `DECISION_CONTRACT_VERSIONS` (all 1 except `shcDispatch` and `workPackageRelease`, which are 2).
- **Handler** (`engine/decisions/types.ts#DecisionHandler`): `(message, query) => reply | Promise<reply>`. `query` is a live read-only
  `SimQuery` (a remote TOS would not have it; built-in strategies use only the payload). The shape is message-like on
  purpose: an ActiveMQ request/reply or REST adapter is just an async handler, no engine change.
- **Subjects**: the `equipment` in the request's subjects is the equipment idling while it waits; it is copied to the
  outcome events and drives the `equipmentIdleS` KPI. Pre-run decisions also carry `containers` so invariants see them.
- **State**: everything is plain JSON in `SimState.decisions` (`engine/decisions/runtime.ts#DecisionState`: `nextCorrelation`, `rngState`,
  `pending`, `kpis`), except in-flight Promises, which live only in the runtime. A restore re-sends pending async requests
  (`DecisionRuntime#reset`).
- **Pre-run decisions**: the yard pre-fill asks `yardAllocation` with `{ preRun: true }` (`engine/subsystems/prefill.ts`).
  They always resolve at the same sim time whatever the latency, and their events are not invariant-checked one by one.

## Runtime (`engine/decisions/runtime.ts`)

`createDecisionRuntime` resolves every decision point's handler and fallback up front, so a bad strategy name throws at
`createSimulation`, not mid-run (`getStrategy` lists the available names). Resolution order per decision point:

1. a handler passed to `createSimulation(config, handlers)` (labelled `custom` in events and KPIs);
2. else `config.decisions.points.<dp>.strategy` (labelled `strategy:<name>`);
3. else the decision point's `default` in `strategies.ts`.

The fallback is `points.<dp>.fallbackStrategy`, else the default strategy (labelled `fallback:<name>`). A fallback must be
synchronous (an async one throws).

Timing of the outcome event relative to the request:

| Handler | Injected delay d ms | keep-running | pause |
|---|---|---|---|
| sync | none | same sim time, same event step | same |
| sync | d | `now + d/1000 * simSecondsPerWallSecond` | `now` (clock frozen while pending) |
| async (Promise) | any | at the sim time the engine has reached when the Promise settles and `drain()` runs | same, but the clock cannot pass `now` while anything is pending |

- **Async modes** (`engine/decisions/types.ts#AsyncMode`, `config.decisions.asyncMode` or the `asyncMode` option): `keep-running` (default):
  other events keep processing and the waiting equipment idles. `pause`: `DecisionRuntime#waiting` blocks the step loop while
  any decision is pending and the next event is later than `now`.
- **Built-in strategies are synchronous and pure**, so they resolve in the same step and both modes give identical logs.
- **Async handlers**: `runUntil` returns `waiting-for-decision` (`engine/simulation.ts#StopReason`) when it cannot proceed;
  `runUntilAsync` awaits `nextSettled()` and continues. With `runUntil({ time })` in keep-running mode the clock advances past
  an in-flight reply; this is how the paced worker host shows TOS latency.
- **Failures** (all become `DecisionFailed { failure: 'timeout'|'error', message, fallback }` then
  `DecisionResolved { outcome: 'fallback' }` from the fallback strategy): injected timeout, injected delay at least
  `timeoutMs`, injected error, handler throws, Promise rejects, async reply slower than `timeoutMs` wall time. A late async
  reply is discarded and counted in `lateReplies`.
- **Timeout default**: `engine/decisions/types.ts#DEFAULT_DECISION_TIMEOUT_MS` = 5000 ms, per point `points.<dp>.timeoutMs`.
- **Hash**: `DecisionResolved.payload.wallLatencyMs` (present only when > 0) is excluded from the event-log hash
  (`simulation.ts` `hashedJson`), so measured wall time never changes a hash.

## Latency injector (`engine/decisions/latency.ts`)

Configured per point as `points.<dp>.latency: LatencySpec { delay?, timeoutPct?, errorPct? }`.

| `delay.kind` | Draw (wall ms) |
|---|---|
| `none` (default) | 0 |
| `fixed` | `ms` |
| `uniform` | `minMs + r * (maxMs - minMs)` |
| `exponential` | `-ln(1 - r) * meanMs` |

`drawInjection` order: timeout first (`r * 100 < timeoutPct` gives `{ kind: 'timeout' }`), then error, then the delay; a
delay at or above `timeoutMs` also becomes a timeout. No spec means no draws at all. Draws come from a separate stream
(`SimState.decisions.rngState`, seeded `seed ^ 0x5bd1e995`), never the main RNG, so injecting latency in pause mode leaves
the event log identical to the no-latency run, and in keep-running mode only the reply times move.

Per-handler counters (`engine/decisions/runtime.ts#HandlerKpiCounters`, reported as `kpiReport().handlers[dp]`, `engine/kpis.ts#HandlerKpiReport`):

| Field | Meaning |
|---|---|
| `calls`, `resolved`, `ok`, `fallbacks`, `timeouts`, `errors`, `lateReplies` | counts |
| `pending` / `maxPending` | backlog now and its peak (all decision points pending at once, counted when a request arrives) |
| `simLatencyS {mean,max}` | sim seconds from request to resolution |
| `wallLatencyMs {mean,max}` | injected delay plus measured async time (sync handlers count 0) |
| `equipmentIdleS` | sum of sim latency x number of waiting equipment ("idle caused") |

The CLI prints these under `TOS handlers:` (one block per decision point that was called; never-called points are omitted
from the report). Series versions are in [kpis-and-reports.md](kpis-and-reports.md) (`handler.*`).

## Every decision point

Strategy registry: `engine/decisions/strategies.ts#strategies`. Default marked **(default)**. "Asked from" is the asking
function. Shapes are abbreviated; full types are in `engine/decisions/types.ts`.

| Decision point | When it is asked | Request (key fields) | Reply | Strategies | Strategy code | Asked from |
|---|---|---|---|---|---|---|
| `stsGroundPosition` | an STS holds a discharged box and needs a ground position; or (`direction: 'load'`) an export box is fetched and needs one | `stsId, containerId, direction?, groundPositions[{id, lane, occupiedBy}]` in lane order | `{ groundPositionId \| null }` (null: STS waits) | **`lowest-free-lane`** (default, nearest the quay); `highest-free-lane` | inline in `strategies.ts` | `engine/subsystems/quay.ts#requestGroundPosition`, `subsystems/loadPrep.ts` |
| `shcDispatch` | a free SHC pulls its next job while open jobs exceed SHCs already asking (`engine/subsystems/shc.ts#maybeDispatch`) | `shcId, nodeId, x, z, lastJobKind?, jobs[{jobId, readyAt, x, z, kind?, padId?, distanceM}], wtpPads[]` | `{ jobId \| null }` (null: SHC parks) | **`oldest-job`** (default, FIFO by `readyAt`); `nearest-job`; `chained-nearest`; `paired-dual-cycle`; `predispatch` | inline | `engine/subsystems/shc.ts#requestDispatch` |
| `wtpPadSelection` | dispatch picked a discharge job; the SHC holds it while asking (load jobs carry their pad and never ask) | `shcId, jobId, containerId, x, z, wtpPads[{id, blockId, occupiedBy, claimedBy}], blockLoad{fill, queued}` | `{ wtpPadId \| null }` (null: SHC releases the job and parks) | **`first-free`** (default); `nearest-box`; `balanced`; `last-free` | `engine/decisions/strategies.ts#balancedPad` | `engine/subsystems/shc.ts#requestPadSelection` |
| `yardAllocation` | a box stands on a WTP pad or a truck at a transfer stall and needs a slot in that block; also the pre-fill (pre-run) | `YardStacks` (per-stack heights) `+ containerId, size, full, line, vesselId, wtpPadId, stallId?, box?, stackTops?, sameGroupOnly?, random` | `{ slotId \| null }` (null: block full, box stays) | `random`; `nearest-wtp`; **`grouped`** (default) | `yardStrategies.ts`, `yardGrouping.ts` | `engine/subsystems/ascStorage.ts#requestAllocation`, `subsystems/prefill.ts` |
| `ascDispatch` | a two-ASC block has an open job and an idle ASC (one request per block at a time); a one-ASC block asks only for an early pick (`pre-retrieval`) | `blockId, job{kind: wtp\|transfer\|retrieve\|rehandle, early?, padZ, slotZ}, candidates[{ascId, side, gantryZ, jobs, busyS, canServe, needsYield}], ascs[], minSeparationM` | `{ ascId \| null }` (null: left open, asked again when the block changes) | **`waterside-first`** (default); `pre-retrieval`; `balanced` | `ascStrategies.ts` | `engine/subsystems/ascDispatch.ts#maybeDispatchAsc` |
| `berthAllocation` | a vessel arrives, and again when the quay frees | `vesselId, sizeClass, loaM, quayLengthM, berthGapM, occupied[{fromX, toX}], arrivedAtS` | `{ berthX \| null }` (null: anchorage) | **`first-fit`** (default, lowest stern X); `best-fit` (least unused gap) | `quayStrategies.ts` | `subsystems/berth.ts` `tryAllocateBerth` |
| `craneSplit` | a vessel is berthed and needs cranes; again when a crane becomes free | `vesselId, berthX, maxSts, stsMinSpacingM, bays[{bay, x, moves}], cranes[{stsId, railIndex, gantryX, vesselId, vesselBerthX}]` | `{ assignments[{stsId, bays[]}] }` contiguous, rail order = bay order, every work bay once; empty list: wait | **`balanced-moves`** (default); `equal-bays` | `quayStrategies.ts` | `subsystems/berth.ts` `trySplit` |
| `workPackageRelease` | a crane is assigned to a vessel, and on every `WorkPackageStarted` / `WorkPackageCompleted` | `stsId, vesselId, k, packages[{packageId, kind, section, bay, moves, status}]` | `{ packageIds[] }` (must release something when the crane has none released) | **`keep-k-ahead`** (default); `just-in-time` | `workPackageStrategies.ts` | `engine/subsystems/workPackages.ts#askRelease` |
| `emptyAllocation` | a released load package needs `count` empties of size and line, once at least `count` candidates exist (retried on `EmptiesRequired`, `AscStacked`, `AscRetrieved`) | `packageId, size, line, count, isoType?, matchLine?, candidates[{containerId, slotId, distanceM, yardSince, boxesOnTop?, blockRank?, adjacentAllocated?}]` | `{ containerIds[] }` exactly `count`, in load order | `nearest-wtp`; `oldest-first`; **`iso-type-best-position`** (default) | `emptyStrategies.ts` | `subsystems/empties.ts` `tryAllocate` |
| `rehandleTarget` | an export retrieval is blocked: where does the top blocker go in the same block | `blockId, jobId, containerId, size, from{slotId,...}, retrieval, blockersLeft, retrievalRank, candidates[{slotId, soonestRank, ...}], random` | `{ slotId \| null }` (null: retrieval stays blocked) | **`nearest-valid`** (default); `min-future-rehandles` | `rehandleStrategies.ts` | `subsystems/ascStorage.ts` `requestRehandleTarget` |
| `gateLaneAssignment` | the truck at the head of the gate queue and at least one free inbound lane | `truckId, transaction, queueLength, waitedS, lanes[{laneId, index, free, processed}]` | `{ laneId \| null }` (null: stays queued) | **`lowest-free-lane`** (default); `least-used-lane` | `landsideStrategies.ts` | `subsystems/landside.ts` |
| `transferStallSelection` | a truck is through the gate and at least one stall is free | `truckId, transaction, legs[{kind, purpose, blockId}], stalls[{stallId, blockId, occupiedBy, distanceM}], blockLoad, blockFill?` | `{ stallId \| null }` (null: held at the gate) | **`nearest-to-box`** (default); `spread-drops`; `least-loaded-block` | `landsideStrategies.ts` | `subsystems/landside.ts` `askStall` |

### Strategy notes and tuning constants

- **stsGroundPosition**: lowest lane is nearest the quay. A wrong reply (occupied position) breaks custody and is caught by
  `custody.single-owner` (the `broken-first-lane` set proves it).
- **shcDispatch**: all five sort the `jobs` list; four of them differ only in engine-side behaviour that the engine switches
  on by the configured strategy **name** (`engine/subsystems/shc.ts#isChained`, `#isPaired`, `#isPredispatch`):
  - `nearest-job`: nearest by lane-graph route length (`distanceM`), ties `readyAt` then id.
  - `chained-nearest` (TT-R12): nearest job; after a delivery the SHC asks again at once and, with no job, waits at the
    nearest queue area while there is work, parking only when there is none. Needs `queueAreas`. The TTI presets use it.
  - `predispatch` (TT-R13): chained-nearest plus idle SHCs sent to the queue area of a box predicted ready within their
    travel time plus `queueAreas.predispatchMarginS` (default `scenario/types.ts#DEFAULT_PREDISPATCH_MARGIN_S` = 15 s). Claims a queue spot, never a job.
  - `paired-dual-cycle` (TT-R14): chained-nearest; after a discharge delivery prefer an open load pickup and vice versa
    when within `engine/decisions/strategies.ts#PAIRING_RADIUS_M` = 150 m [assumed], else the nearest job. Only this strategy sends
    `lastJobKind`, so other event logs are unchanged.
- **wtpPadSelection**: pads of a block with no room are offered as claimed (`claimedBy: 'block-full'`;
  `engine/subsystems/shc.ts#blockRoom` keeps `BLOCK_FREE_RESERVE` = 0.1 of a block's cells free for rehandles and load, #165).
  `balanced` (#207) cost = plan distance + `BALANCED_FILL_M` (6000 m) x block fill + `BALANCED_QUEUED_M` (60 m) x queued ASC
  jobs; the TTI presets use it (the nearest pad sent every box to the blocks by the cranes).
- **yardAllocation**: every strategy picks from `engine/yardLayout.ts#candidateSlots(request)` (legal slots; reefers only in
  powered rows). `nearest-wtp` cost = distance + `TIER_COST_M` (6 m) per tier + bay pairing (`MISALIGNED_40_COST_M` 30,
  `BREAK_EMPTY_PAIR_COST_M` 12) + `POWERED_ROW_COST_M` (60) for a plain box in a powered row. `grouped` (#106, #111) adds
  `MIXED_STACK_COST_M` 90, `ORDER_BROKEN_COST_M` 45, `FOREIGN_BAY_COST_M` 25, `OWN_BAY_BONUS_M` -10; groups are
  `engine/decisions/yardGrouping.ts#yardGroupKey` (imports by line, exports and transshipment by outbound vessel and POD, storage empties by
  line, size, ISO type). The `box` and `stackTops` fields are sent only when `grouped` is selected
  (`engine/decisions/yardGrouping.ts#yardGroupingOn`); without them (old pre-fill) it falls back to keeping a vessel's boxes together.
  Randomness only from `request.random` (engine RNG).
- **ascDispatch**: `waterside-first` gives WTP work to the waterside ASC and transfer work to the landside ASC; the other
  helps only when no step-aside is needed. `pre-retrieval` (TT-R17) is the same function, but only when it is the configured
  name does the engine offer early truck picks (`job.early`, `subsystems/landside.ts` checks the name). `balanced`: fewest
  jobs, ties nearest the pad, may step the other aside.
- **craneSplit**: both choose up to `maxSts` consecutive eligible free cranes whose mean gantry X is nearest the work centre
  (`engine/decisions/quayStrategies.ts#eligibleCranes`), then a linear partition (minimise heaviest group, then sum of squares) weighted by
  moves (`balanced-moves`) or 1 per bay (`equal-bays`).
- **workPackageRelease**: `k` = `config.workPackages.releaseAhead` (default 2); `keep-k-ahead` keeps k + 1 open
  (released or active) packages. `just-in-time` gives the yard no look-ahead.
- **emptyAllocation**: `iso-type-best-position` (#106) ranks fewest boxes on top, then block rank 0 (serving the vessel),
  distance, adjacency to other allocated empties, id; replies in load order (higher boxes first). Only with this strategy
  does the engine send ISO type and buried candidates; `config.emptyAllocation.matchLine` (CLI `--match-line`) restricts to
  the requesting line.
- **rehandleTarget**: `nearest-valid` cost = distance x 1000 + tier x 100 + bay x 10 + row. `min-future-rehandles` avoids
  burying a box retrieved sooner than the blocker (`soonestRank`), else buries the one needed latest.
- **transferStallSelection**: `spread-drops` (#188): pick trucks as `nearest-to-box`; drop-only trucks take the lowest
  road distance + `SPREAD_FILL_M` (6000 m) x block fill + `SPREAD_TRUCK_M` (60 m) x trucks of the block. The TTI presets
  use it (blocks near the gate reached 90 % while far ones stood at 77 %).

### What the TTI presets select

`scenario/presets.ts` `terminal()` sets `shcDispatch: chained-nearest`, `wtpPadSelection: balanced`,
`transferStallSelection: spread-drops`; every other point runs its default. Fixtures run defaults unless their definition
says otherwise (`scenario/fixtures/definitions.ts`).

## Selecting strategies

| Mechanism | Effect | Label in KPIs |
|---|---|---|
| `config.decisions.points.<dp>.strategy` | built-in by name; engine-side switches (chained, paired, predispatch, pre-retrieval, grouped, iso-type) follow the name | `strategy:<name>` |
| `createSimulation(config, handlers)` | custom handler per point, overrides the configured strategy | `custom` |
| `tt:run --strategy <dp>=<name>` (repeatable) | merged over the scenario's `points` (`cli/runCli.ts` `decisionsFromArgs`); unknown names are usage errors (exit 2) | `strategy:<name>` |
| `tt:run --handlers <set>` | a named handler set from `cli/handlerSets.ts#handlerSets` passed as custom handlers | `custom` |
| `tt:run --latency <dp>=<spec>` | `none \| fixed:<ms> \| uniform:<min>-<max> \| exp:<mean>`, then optional `,timeout:<pct>`, `,error:<pct>`, `,timeoutMs:<ms>` | |
| `tt:run --async-mode keep-running\|pause` | overrides `decisions.asyncMode` | |
| `tt:diff --a-handlers` / `--b-handlers <set>` | compare two handler sets event by event (`tt:diff` has no `--strategy`; for a named strategy write two `tt:run --events` files and diff them, see [cli-and-tooling.md](cli-and-tooling.md)) | |

`--from-snapshot` refuses `--async-mode`, `--strategy` and `--latency`: decision settings come from the snapshot.

Named handler sets (`cli/handlerSets.ts`):

| Set | Contents | Use |
|---|---|---|
| `default` | none (configured strategies) | normal runs |
| `highest-free-lane` | `stsGroundPosition` = `highest-free-lane` | valid alternative for diffs |
| `nearest-job` | `shcDispatch` = `nearest-job`, `wtpPadSelection` = `nearest-box` | valid alternative SHC dispatch |
| `broken-first-lane` | `stsGroundPosition` always answers lane 1, even occupied | proves the invariant checker: exit 1, first error `custody.single-owner` |

Gotcha: a handler set installs the strategy **function** as a custom handler, so engine-side behaviour keyed on the
configured name is not switched on. `--handlers nearest-job` is not `--strategy shcDispatch=chained-nearest`; use
`--strategy` for `chained-nearest`, `predispatch`, `paired-dual-cycle`, `pre-retrieval`, `grouped`, `iso-type-best-position`.

Example: `pnpm run tt:run --fixture <name> --strategy stsGroundPosition=highest-free-lane --latency stsGroundPosition=exp:2000,timeout:10,error:10 [--async-mode pause]`
shows calls, fallbacks, latency, backlog and idle caused under `TOS handlers:`; invariants must still be 0.

## TOS module map

Documentation only (spec #106): the TOS is a set of modules, each a grouping of existing decision points and functions.
No files move. To replace a module, swap its strategies or pass custom handlers; nothing else changes.

| Module | Decision points and functions | Where |
|---|---|---|
| Yard | `yardAllocation` (where a box stacks), `rehandleTarget` (where a blocker goes) | `engine/decisions/strategies.ts`, `engine/yardLayout.ts#candidateSlots`, `engine/subsystems/rehandle.ts`, `engine/subsystems/ascStorage.ts` |
| Container Allocation | `emptyAllocation` (which empties a load package takes) | `engine/subsystems/empties.ts` |
| Vessel Planning | `craneSplit`, package creation and sequence (`engine/subsystems/workPackages.ts#createPackages`, `#createLoadOrders`), hatch steps, the `vesselPlanning.ordering` option (`engine/vesselOrdering.ts`, CLI `--ordering pod-weight\|as-today`, default `pod-weight`) | `engine/subsystems/workPackages.ts`, `engine/vesselOrdering.ts`, `engine/subsystems/berth.ts` |
| Move Scheduler | `workPackageRelease`, SHC pre-dispatch (`engine/subsystems/shc.ts#maybePredispatch`) and ASC pre-retrieval | `engine/subsystems/workPackages.ts`, `engine/subsystems/shc.ts`, `engine/subsystems/ascDispatch.ts` |
| Equipment | `berthAllocation`, `stsGroundPosition`, `shcDispatch`, `wtpPadSelection`, `ascDispatch`, `gateLaneAssignment`, `transferStallSelection` | `engine/decisions/`, the equipment subsystems |

## Add a strategy

1. Add a named entry `{ description, handler }` to `strategies.<dp>.strategies` in `engine/decisions/strategies.ts`
   (put a non-trivial body in the point's `*Strategies.ts` file). Keep it to a handful per point (the registry comment says
   1 to 3; `shcDispatch` has 5, `wtpPadSelection` 4).
2. It must be synchronous and pure: payload in, reply out. No `Math.random` (use `request.random` where the request has
   it), no reading `query` for anything a remote TOS could not know.
3. If it needs data the request lacks, add an optional field sent only when this strategy is selected (the pattern of
   `lastJobKind`, `box`/`stackTops`, `isoType`), so every other run's event log and golden stays unchanged; bump the
   point's `DECISION_CONTRACT_VERSIONS` entry if the shape changes.
4. Test it by selecting it through `config.decisions.points.<dp>.strategy` (see `tests/decisions.test.ts`), then compare
   two runs: `tt:run --fixture <name> --events a.jsonl` and `tt:run --fixture <name> --strategy <dp>=<name> --events b.jsonl`,
   then `tt:diff a.jsonl b.jsonl` (or add a handler set and use `tt:diff --b-handlers`).
5. Making it the default changes every golden that uses that point: plan it as its own change and run
   `pnpm run tt:golden --update`, review the diff.

## Add a decision point

1. `decisions/types.ts`: request in `DecisionRequests`, reply in `DecisionReplies`, version in `DECISION_CONTRACT_VERSIONS`.
2. `decisions/strategies.ts`: register strategies and a `default`, add it to `defaultHandlers`.
3. Asking reactor: `ctx.requestDecision(dp, request, { equipment: [...] })`, set the equipment to a waiting status, and
   handle the reply in the subsystem's `DecisionResolved` reactor. Handle a stale reply (the world moved during latency):
   re-check and ask again, as `engine/subsystems/ascDispatch.ts#resolveDispatch` and `engine/subsystems/ascStorage.ts#resolveRehandleTarget` do.
4. Test strategy selection, a scripted handler and a latency case (`tests/decisions.test.ts` style), then
   `UPDATE_GOLDEN=1 pnpm test` if fixtures use it. Add a KPI collector entity automatically (the `handler.*` series iterate
   `DECISION_POINT_IDS`).

## Optimisation levers

- **Throughput (moves/hour)**: the biggest strategy levers measured so far are SHC dispatch (`chained-nearest`,
  `paired-dual-cycle`, `predispatch`), pad selection (`balanced`), stall selection (`spread-drops`), yard decking
  (`grouped` vs `nearest-wtp`) and rehandle targets (`min-future-rehandles`). Measure with `tt:profile` and `tt:sts`
  ([kpis-and-reports.md](kpis-and-reports.md)) and see [optimising/terminal-throughput.md](optimising/terminal-throughput.md).
- **Run speed**: decision points cost about 1.2 % of wall time on the peak day
  ([reports/throughput-and-speed-report.md](reports/throughput-and-speed-report.md)). A strategy that sorts large lists per
  call (every open job, every pad, every candidate slot) is the place to look if that grows.
- **Must not break**: determinism (no `Math.random`, no wall clock in a reply), the empty-request-field convention (new
  fields only for the strategy that needs them), invariants (a strategy reply that breaks custody or rail order fails the
  run), and the golden summaries. Prove a change with `pnpm run tt:golden` and `tt:diff` (first divergence shows the first
  `DecisionResolved` whose reply differs).

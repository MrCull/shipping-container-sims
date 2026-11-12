# Yard: ASC blocks, allocation, rehandles and yard starts

Checked against ENGINE_VERSION 0.53.0.

Read this when you change how boxes are stacked, retrieved or dug out of an ASC block, touch ASC dispatch or the
twin-ASC rail, tune a yard strategy (`yardAllocation`, `rehandleTarget`, `ascDispatch`, `emptyAllocation`), work on
export load preparation, transshipment, empties or the yard start modes, or chase a `yard.no-progress` violation.
Trucks, the gate and stall choice are in [landside.md](landside.md). Terms: [GLOSSARY.md](../../../../../GLOSSARY.md).

## Where the code is

| Concern | File#symbol |
|---|---|
| Block geometry, slot ids, `candidateSlots`, reserve, rail segments, stalls | `engine/yardLayout.ts` |
| Per-block and per-column slot index, `stackSpansOf`, `stackTopsOf`, rank cache | `engine/yardIndex.ts` |
| ASC event reactors and phase chain | `engine/subsystems/asc.ts#ascReactors` |
| Allocation, claims, stack lock, rehandle pump, `reopenFullJobs` | `engine/subsystems/ascStorage.ts` |
| Trip building, rail planning, step-aside | `engine/subsystems/ascReservations.ts#planJob` |
| Rail pure helpers (pieces, park holds, yield target) | `engine/subsystems/ascRail.ts` |
| Job priority and the `ascDispatch` decision | `engine/subsystems/ascDispatch.ts#maybeDispatchAsc` |
| Blockers, rehandle candidates, room packing | `engine/subsystems/rehandle.ts` |
| Load preparation and pad staging | `engine/subsystems/loadPrep.ts#pumpLoadPrep` |
| Transshipment dwell | `engine/subsystems/transshipment.ts#transshipmentReactors` |
| Empties requirement and allocation | `engine/subsystems/empties.ts` |
| Pre-fill computation / pre-run driver | `engine/prefill.ts#prefillSteps`, `engine/subsystems/prefill.ts#createPrefillDriver` |
| Legacy start | `scenario/exportYard.ts#planExportYard` |
| Warm-up | `engine/subsystems/warmUp.ts#resetCounters` |
| Transit status and dwell (derived, never stored) | `engine/transit.ts#transitStatus`, `#dwellS` |
| Strategies | `engine/decisions/{yardStrategies,yardGrouping,rehandleStrategies,ascStrategies,emptyStrategies}.ts` |
| Deadlock detection | `engine/invariants.ts#stuckYardBlocks`, `#invariantDeadline` |

`asc.ts` keeps only the reactors; storage, trips and dispatch were split out (V11-09).

## Block layout

A block lies perpendicular to the quay, centred on its X. Z grows landside.

```
  WTP pads (z = wtpZ)  ->  8 m gap  ->  bays 1..N along Z  ->  transfer stalls (last bay + 15 m)
  rows 1..8 across X, rail on both sides; the trolley spans the rows and the pads
```

| Constant (`engine/yardLayout.ts`) | Value | Meaning |
|---|---|---|
| `BLOCK_ROWS` | 8 | rows across X (25.4 m ASC span) |
| `ROW_PITCH_M` | 2.9 | row pitch |
| `BAY_PITCH_M` | 6.7 [A] | one 20 ft bay |
| `TIER_PITCH_M` | 2.896 [A] | high-cube height: basis of the travel clearance only, not a tier grid |
| `FIRST_BAY_GAP_M` | 8 | WTP strip to bay 1 |
| `DEFAULT_BLOCK_BAYS` / `DEFAULT_BLOCK_TIERS` | 20 / 5 | `BlockConfig.bays` / `tiers` |
| `DEFAULT_WTP_PADS` / `DEFAULT_TRANSFER_STALLS` | 5 / 5 | at most 5 fit the span at the 5.5 m pitch (`STALL_PITCH_M`) |
| `REEFER_MAX_TIERS` | 4 | reefers stack at most this high |
| `travelHoistM(block)` | tiers x 2.896 + 0.6 | spreader travel height (a clearance: all high cubes) |

- **Box height in a stack (#267):** a box rests on the boxes under it (2.591 m for 20 and 40, 2.896 m for 40HC,
  `CONTAINER_HEIGHT_M`); there is no fixed tier grid. Its bottom is the highest top of the boxes one tier below in the
  columns it covers (a staggered 40 rests on the taller column): `engine/subsystems/ascStorage.ts#yardSlotBaseY`
  (from placed boxes, recursive through box tops), `SimQuery.yardSlotBaseY`, and the pure `yardLayout.ts#yardBaseY`
  (column sums) and `#yardBaseHeights` (a placement list, the scene model's initial yard). It is fixed while the box
  stands in its slot (boxes under a set-down are stacked first, `blockedByOlderClaim`; only the top box leaves). The
  ASC picks and sets down at it; the worker sends it on the yard custody change (`CustodyChange.baseY`) and the scene
  model poses from it (pose cache key `slot|size|baseY`: a slot id is reused over a different stack).
- **Slot id** `<block>:<bay>-<row>-<tier>` (bay zero-padded to 2): `yardSlotId`, `parseYardSlotId`. A 40 ft box covers
  two bays and is named by its lower bay (`cellsOf`, `boxSpan`).
- **State:** `SimState.yardSlots` holds stacked boxes (`span` 1 or 2). `SimState.yardBlocks[id]` holds per-stack
  `heights` and `topVessels` (bay-major index `stackIndex = (bay-1)*rows + (row-1)`), claimed slots included, and
  `progressAt` (last ASC job start, for `yard.no-progress`). Data structures: [state-model.md](../state-model.md).
- **Yard index** (`engine/yardIndex.ts#yardIndexOf`): slots by block and by column, cached per `yardSlots` object.
  Every add or delete of a `yardSlots` entry MUST call `indexYardSlotAdded` / `indexYardSlotRemoved` (`placeInStack`
  and `removeFromStack` do). Setting a vessel slot's `plannedContainerId` after start MUST call `notePlanChanged`
  (it keys the `retrievalRanks` cache, #228).
- **ASC ids:** `<block>-ASC1` (waterside, starts at the pads) and `<block>-ASC2` (landside, starts at the last bay):
  `engine/state.ts#ascIdOf`, `#ascIndexOf`, `engine/yardLayout.ts#ascStartZ`. `config.yard.ascsPerBlock` is 1 (default)
  or 2; the TTI presets use 2.
- **Kinematics** `DEFAULT_ASC_KINEMATICS` (`scenario/builder.ts`) [A]: gantry 4 m/s (accel 0.4, decel 0.5), trolley
  1 m/s (0.4/0.4), hoist loaded 0.5 m/s (0.3/0.3), hoist empty 1 m/s (0.5/0.5), lock 2 s, unlock 2 s. Override with
  `kinematics.asc` or builder `.ascKinematics()`.

## Stacking rules: `candidateSlots`

`engine/yardLayout.ts#candidateSlots(stacks: YardStacks)` is the single definition of a legal slot. Every strategy,
the pre-fill, the legacy start, rehandle candidates and the stall room check call it. A slot is legal when:

1. the stack is below `tiers`;
2. the stack is not reserved (`reservedStacks`; a 40 ft box needs both stacks unreserved);
3. a reefer goes only to a `poweredRows` row and only below `REEFER_MAX_TIERS` + 1 (R19);
4. **one length per stack (R06):** the stack is empty or holds the box's length (`stackSpans`: 0 empty, 1 = 20 ft,
   2 = 40 ft-locked);
5. a 40 ft box needs two neighbouring stacks (same row, bay and bay+1) of equal height, both empty or both
   40-locked. Two different 40s side by side count; they need not be one aligned pair.

`stackSpans` is derived, never stored: `stackSpansOf(state, blockId, without?)` reads the tier-1 box of every stack,
stacked or claimed (a stacking job's `yardSlotId`, a rehandle's `targetSlotId`). `without` leaves a blocker out, so
lifting a tier-1 blocker empties its stack for the target search. Any code that builds a `YardStacks` must fill
`stackSpans` and spread `reeferFields(block, reefer)` and (except rehandles) `reserveFields(block)`.

Invariants: `yard.slot-bounds`, `yard.stack-height`, `yard.no-floating`, `yard.no-double-occupied`,
`yard.no-mixed-length-overlap`, `yard.no-mixed-length-stack`, `yard.reefer-powered`, all scoped per touched column.
The engine trusts a non-null reply (it only rejects a slot outside the block, `engine/subsystems/ascStorage.ts#claimSlot`); these
invariants catch a handler that ignores the candidates. Detail: [invariants.md](../invariants.md).

## ASC cycle (discharge box from a pad)

```
ShcDroppedAtWtp -> AscJob {allocation: 'waiting'} -> pumpAllocation -> yardAllocation decision
  -> reply: claimSlot (heights/topVessels raised, claimSeq) | null: allocation 'full'
ShcCleared -> job.cleared = true -> maybeDispatchAsc
AscJobAssigned -> AscRoutingToPad -> AscPositioningAtPad -> AscLocking -> AscPicked (pad -> ASC)
  -> AscRoutingToSlot -> AscPositioningAtSlot -> AscUnlocking -> AscStacked (ASC -> yard slot) -> AscReady
```

- The whole cycle is planned at assignment (`engine/subsystems/ascReservations.ts#AscTrip`): hoist to travel height first, gantry and
  trolley together, hoist alone. Each phase event carries the `segments` that led to it (`gantry` = Z, `trolley` = X,
  `hoist` = box-bottom height). After `AscStacked` the spreader rises again; the ASC takes its next job only at
  `AscReady`. Mode `instant` keeps the events with zero durations; `off` leaves boxes on the pads. Yard mode wins
  (`engine/state.ts#resolveSubsystemModes`): yard `off` forces ASC `off`, and yard `instant` turns an ASC set to
  `real` into `instant` (only an explicit `off` survives).
- **Pad handover:** the ASC reserves the pad zone (`engine/reservations.ts`, holder = ASC id) from arrival over the
  pad until the spreader is clear (`padFrom` to `padTo`). An SHC planned later waits; the ASC starts later if the
  zone is held (`padWaitS`). Invariant `asc.wtp-handover`: an ASC never inside a pad's lifting envelope (below travel
  height over the pad footprint) while an SHC is on the pad.
- **One allocation request per block at a time** (`pumpAllocation`, oldest `waiting` job), so each reply sees the
  stacks the previous one claimed. A slow TOS therefore serialises a block's discharge.
- **Stacks fill bottom-up:** a stacking job is held while an older claim shares one of its columns
  (`blockedByOlderClaim`).

### `yardAllocation` request (contract v1)

Block geometry (`bays rows tiers blockX firstBayZ`), origin `wtpX/wtpZ` (the pad, or the stall for a truck drop),
`heights` (from `withoutPendingPickups`: stacks holding a box a truck is coming for read full), `topVessels`,
`stackSpans`, the box (`containerId size full line vesselId wtpPadId`, `stallId` for truck drops), reefer and
reserve fields, `random` (always drawn, so swapping strategies keeps the RNG stream), and only while the
configured strategy is `grouped` (`yardGroupingOn`) `box` (`YardBoxView`) and `stackTops`. Reply `{slotId}`;
`null` = no room: `allocation: 'full'`, `kpis.yard.allocationFailures++` (each refused retry counts again), and for
a truck drop `engine/subsystems/landside.ts#dropMetFull`. Shapes: [decision-points.md](../decision-points.md).

### Allocation strategies (`engine/decisions/yardStrategies.ts`)

| Strategy | Rule |
|---|---|
| `grouped` (default since 0.25.0) | nearest-wtp cost plus group cost (below). `sameGroupOnly` (pre-fill only) drops slots on another group |
| `nearest-wtp` (rollback) | `distanceM` + `TIER_COST_M` 6 per tier above 1 + pairing cost + powered-row cost |
| `random` | `candidates[floor(random x n)]`; pinned by `rehandle-random-yard` and `asc-2asc-block-conflict` |

Costs are metres of plan distance and are preferences only; every legal slot stays offered.

- Pairing: a 40 anchored on an even bay +`MISALIGNED_40_COST_M` 30; a 20 opening an empty stack whose pair-mate
  (bays 1-2, 3-4, ...) is also empty +`BREAK_EMPTY_PAIR_COST_M` 12. So 20 ft and 40 ft areas form naturally.
- Powered rows: a non-reefer in a powered row +`POWERED_ROW_COST_M` 60.
- Grouped: on a box of another group +`MIXED_STACK_COST_M` 90; same group, wrong order +`ORDER_BROKEN_COST_M` 45;
  opening a stack in a bay of other groups only +`FOREIGN_BAY_COST_M` 25; in a bay already holding the group
  -`OWN_BAY_BONUS_M` 10. A request without `box`/`stackTops` falls back to `vesselGroupedSlot` (own-vessel bay, then
  empty bay, then shared bay, then nearest-wtp; plain boxes keep out of powered rows while anything else fits).
- **Groups** (`engine/decisions/yardGrouping.ts#yardGroupKey`): imports `IMP|line`; exports `EXP|outboundVessel|POD`;
  transshipment `TRX|onwardVessel|POD`; storage empties `STO|line|size|isoType`. `yardGroupBreak`: `order` when an
  import with a later planned departure stands on an earlier one, or a heavier export on a lighter one.
- KPI `kpis.yard.grouping {placements, mixedStack, orderBroken, mixedBay}`, counted at claim, present only with
  `grouped`. `nearest-wtp` keeps the shortest ASC trips: pick it for a pure cycle-time comparison (several SHC
  fixtures pin it to isolate dispatch).

## Twin ASCs: rail and passing

`engine/subsystems/ascRail.ts` (pure) plus `engine/subsystems/ascReservations.ts#planJob`. Only in `real` ASC mode; instant ASCs jump.

- **Rail segments:** half-bay zones `<block>:R<k>` (`RAIL_SEGMENT_M` 3.35, `railSegmentIds`). A crane's footprint is
  its centre +/- 6 m (half of `ASC_MIN_SEPARATION_M` 12 = `ASC_LENGTH_M` 8 + `ASC_SAFE_GAP_M` 4, both [A]). The rail
  runs `RAIL_MARGIN_M` 16 m past the pads and the last bay.
- **Trip windows:** `occupancyPieces` turns the gantry plan into resting and moving pieces, `pieceWindows` into
  per-segment windows. The whole trip plus the pad window is reserved before departure through the same
  `reservations.ts` as SHCs (`earliestStartAmong` ignores the planner's own holds). A conflict delays departure
  (`AscJobAssigned.railWaitS`, KPI `ascs.<id>.railWaitS`).
- **Park holds:** after a trip the crane holds the segments around its end position until `PARK_UNTIL_S` (1e9 s,
  JSON-safe "never"); its next trip truncates them (`truncateParkHolds`).
- **Step-aside:** a plan whose start is "never" (`isBlockedStart`) hits the partner's park hold. If the partner is
  idle, `planYield` moves it to `yieldTarget` (sweep edge + 12 + 3.35 m, landside or waterside of the sweep;
  null if the rail is too short) and `commitYield` emits `AscYieldAssigned` (KPI `yields`). If the partner is busy,
  `planJob` returns null: the job cannot be served now.
- **Invariant `asc.no-passing`:** ASC1 stays waterside of ASC2, centres at least 12 m apart, checked now and at every
  breakpoint of both planned motions. `reservation.no-overlap` covers the rail segments too.
- Twin-block KPIs add `railWaitS`, `busyS` (cycle plus yield seconds; divide by elapsed time for utilisation) and
  `yields`; single-ASC blocks keep `jobs gantryM trolleyM hoistM padWaitS`.

## ASC dispatch and job priority

`maybeDispatchAsc(ctx, blockId)` runs on every change that could free work (`AscReady`, `ShcCleared`, allocation and
rehandle replies, `AscRetrieved` with a reopened job, truck events). It returns at once without an idle ASC, then
calls `pumpRehandle` and builds `candidateJobs` in priority order:

1. stacking jobs: `cleared`, claimed, by `claimSeq`, not `blockedByOlderClaim` (pad drops and truck drops alike);
2. rehandles that have a target, not `blockedByOlderClaim`;
3. truck picks ready now (`truckReadyForPick`: truck at its stall, free chassis, every drop leg done), box on top
   (`isRetrievable`), no rehandle open for that box;
4. the next pad retrieval: oldest open one whose box is on top with no open rehandle; it takes the free pad of the
   block nearest the box's row (`freePadFor`); if no pad is free, no pad retrieval is offered;
5. early truck picks (only with the `pre-retrieval` strategy, see [landside.md](landside.md#asc-pre-retrieval)).

- **One ASC:** it takes the first candidate, no decision point (an early pick still asks `ascDispatch`).
- **Two ASCs:** one `ascDispatch` request per block at a time (`AscJob.dispatch = 'asked'`). With the landside on, the
  job offered is the first that some idle ASC can serve (a pad job blocked by the waterside crane does not hold the
  landside crane's truck work); otherwise the first candidate. The request lists each idle ASC with `canServe` and
  `needsYield` from a dry-run `planJob`, the job (`kind` `wtp` | `retrieve` | `rehandle` | `transfer`, `early`),
  and `minSeparationM`.
- **Reply** `{ascId|null}`: null leaves the job open until the block changes; an ASC of another block throws; a stale
  reply (ASC busy, box no longer on top, pad taken, chassis not ready) re-runs `maybeDispatchAsc`, picking a new pad
  when only the pad changed.
- **Strategies** (`engine/decisions/ascStrategies.ts`): `waterside-first` (default: pad work to ASC1, transfer work
  to ASC2; the other helps only if no step-aside is needed), `balanced` (fewest jobs so far, ties nearest the pad,
  then waterside; steps the partner aside when needed), `pre-retrieval` (as `waterside-first`, and the only one
  offered early picks). With only pad work, `waterside-first` leaves ASC2 idle because every pad cycle sweeps the
  rail from the pad; `balanced` splits the work.
- `startJob` sets `YardBlockState.progressAt`, claims the pad for a pad retrieval (`WtpPadState.claimedBy`), locks the
  source stack for a retrieval or rehandle, reserves windows and park holds, adds KPIs and emits `AscJobAssigned`
  (with `rehandle`, `targetSlotId`, `stallId`, `truckId`, `early` when they apply).

## Retrieval (export, transshipment, empties to a pad)

`AscJob {kind: 'retrieve'}` created by load prep (`loadPrep.ts`). Events: `AscRoutingToStack -> AscPositioningAtStack
-> AscLocking -> AscRetrieved (slot -> ASC; heights lowered) -> AscRoutingToWtp -> AscPositioningAtWtp -> AscUnlocking
-> AscDroppedAtWtp (ASC -> pad) -> AscReady`. `AscDroppedAtWtp` creates the SHC load job (`createLoadShcJob`) or,
for a staged box, sets the order to `padded`. `kpis.yard.productiveMoves` counts `AscStacked` (non-rehandle),
`AscDroppedAtWtp` and `AscDroppedAtStall`.

- **Stack lock** (`engine/subsystems/ascStorage.ts#lockStack`): from job start (and for a rehandle blocker from target claim) the
  source stack's `heights` read `tiers` until `AscRetrieved`, so no slot is allocated above a box that is leaving.
  Handlers see such stacks as full.
- `AscRetrieved` is the only place a box leaves a stack. It calls `reopenFullJobs` (see below), `stallRoomAppeared`
  and `engine/subsystems/shc.ts#padRoomMayHaveRisen`.

## Rehandles

A buried box cannot be lifted; every blocker is moved first, so poor allocation costs ASC time.

```
maybeDispatchAsc -> pumpRehandle -> (first time) RehandleRequired {jobId, containerId, yardSlotId, blockerIds}
  -> rehandle AscJob {kind:'rehandle', yardSlotId: blocker, forJobId, targetSlotId:null}
  -> rehandleTarget decision -> resolveRehandleTarget claims the target (claimSeq, lockStack on the blocker)
  -> AscJobAssigned {rehandle:true} ... AscRetrieved {rehandle:true} ... AscStacked {rehandle:true} -> next blocker
```

- **`pumpRehandle`** (`ascStorage.ts`): at most one rehandle job per block at a time. It walks open retrievals in
  job order and skips: one already taken or with `dispatch: 'asked'`, one marked `rehandle: 'full'`, and a truck pick
  whose truck holds no stall (#215: digs for queued trucks took promised room and shuttled boxes). A non-truck
  retrieval that is already free on top stops the pump (it runs before any later dig, else two digs bury each
  other's boxes). A retrieval whose blocker finds no candidate is marked `full` and the pump goes on to the next.
- **Blockers** (`engine/subsystems/rehandle.ts#blockersOf`): the boxes on the box and transitively on those (a 40 ft box across two
  stacks drags in its other bay), top first. `nextBlocker` takes the highest one that is physically stacked, free on
  top, and not itself a retrieval that is taken or asked (#188 race fix).
- **Candidates** (`rehandleCandidates`): `candidateSlots` on the block as it looks once the blocker is lifted
  (`stackSpansOf(..., blocker)`, no reserve fields, so only rehandles use the reserve), excluding every column of the
  box being dug out and its blockers, and the stacks of boxes that a truck **holding a stall** is coming for (#183:
  queued trucks do not count, see [Silent yard deadlock](#silent-yard-deadlock-and-yardno-progress)). Each candidate
  carries `soonestRank` (rank of the soonest-retrieved export in that stack).
- **Request** (`rehandleTarget` v1): blocker, `from`, `retrieval`, `blockersLeft`, `retrievalRank` (0 = next, null =
  never; vessel order then `loadSequenceKey`, from `retrievalRanks`, cached per block on stack and plan versions),
  `candidates`, `random`. Reply must be one of the candidates (else an error); null = `rehandle: 'full'`. A target
  taken while the reply travelled is asked again; a blocker that got a box on top meanwhile restarts.
- **Strategies:** `nearest-valid` (default: shortest move, then low tier, bay, row) and `min-future-rehandles` (a slot
  burying nothing retrieved sooner than the blocker; else bury the box needed latest; then low tier, nearest).
- A rehandled box's retrieval follows it (`AscStacked` rewrites `yardSlotId`). KPIs: `yard.rehandles {total,
  productiveMoves, perProductiveMove, failures}`, per block `rehandlesPerProductiveMove`, series
  `yard.rehandles-per-move`. ASC `jobs` and `busyS` include rehandles; `boxesStacked` does not.
- **`rehandle: 'full'` and allocation `full` retry** (`reopenFullJobs`, #175): on every `AscRetrieved` in the block,
  `full` allocations go back to `waiting` and `full` rehandles back to `required` (no second `RehandleRequired`).
  Room that appears without a lift (or a null reply arriving after room appeared) is NOT retried: an unproven gap.
- **Room promise for picks** (`rehandleRoomFor`, `admittedPicksKeepRoom`, `placesFor`, #185, #215): used by stall
  legality in [landside.md](landside.md#stall-legality). A greedy packing under the stacking rules (40 ft first, a
  stack takes its bottom box's length, a 40 needs two equal-height stacks) of this truck's blockers plus the blockers
  of every pick whose truck holds a stall in the block, outside the columns being dug. Not a reservation.

## Export load preparation

`engine/subsystems/loadPrep.ts`. Work packages and the STS load cycle: [quay.md](quay.md).

- Releasing a load package creates one `LoadOrder` per box (`engine/subsystems/workPackages.ts#createLoadOrders`). `pumpLoadPrep`
  asks `stsGroundPosition` (`direction: 'load'`), one box per crane at a time, in load sequence, and on the reply
  creates the retrieval job (`retrieveJobFor`); the ground position is claimed (`claimedBy`).
- **Deadlock rules:** a crane's load boxes are fetched only after its discharge packages before that box are complete
  (`dischargeDone`), and at most as many orders per crane are staged as it has ground positions (`STAGED` set). An
  earlier empties package not yet allocated holds back later orders. A cell still holding its discharge box
  (`cellIsEmpty`, #203) waits. A box not yet in a stack (empty start) or a transshipment box without `readyAt` waits.
- **Release-ahead** (`config.yard.loadReleaseAhead`, 0 to `MAX_LOAD_RELEASE_AHEAD` 20, default 0; TTI
  `TTI_LOAD_RELEASE_AHEAD` 4, #186): `stageAhead` retrieves up to N next load boxes to pads while the crane still
  discharges (stage `staging`, then `padded`); they take no ground position. A block keeps
  `free pads - waiting retrievals - reserve >= 2`, where `reserve` (#213, `headsWithoutPad`) is 0 for the crane's head
  box and otherwise counts other cranes whose head box is `released` and stacked in this block (or whose block is
  unknown yet). Once discharge is done a padded box asks for a ground position and gets its SHC job at once.

## Transshipment

Planning (`scenario/bayPlan.ts#linkTransshipment`): each TS-load box is matched to a box an earlier vessel discharges
as transshipment, same size, first come first served, if `arrival(A) + dwell <= arrival(B)`. Matched boxes carry
`onwardVesselId/onwardSlotId/dwellS`. Dwell: `config.transshipment.dwell`, default lognormal median 2 days
(`scenario/dwell.ts#DEFAULT_TRANSSHIPMENT`). Unmatched TS slots keep a placeholder box in the yard at t = 0;
unmatched discharged TS boxes stay like imports.

`transshipment.ts`: `AscStacked` sets `yardSince`, and for a linked box schedules `TransshipmentReady` at
`+dwellS`, which sets `readyAt` and pumps load prep. Load prep keeps strict sequence: it does not pass a TS box
without `readyAt`. Needs blocks and SHCs (`scenario/bayPlan.ts#loadFlowEnabled`). Fixture `transshipment-a-to-b`.

## Empties and empty allocation by ISO type

- Empties slots (`VesselSlotState.emptyReq`) go after all other load boxes of a vessel, one bay per requirement,
  loaded last in their bay section, as their own packages (`WorkPackage.emptyReq {index,size,line,count,slotIds,
  stage}`; `packageMoves(pkg)` is the count). `EmptyRequirement.isoType` defaults to the dry-box code of `size`
  (`scenario/containerProps.ts#isoTypeOf`).
- Release raises `EmptiesRequired {count, available}`. `tryAllocate` asks `emptyAllocation` (v1) for the first
  released package with at least `count` candidates; one request pending at all (`state.emptiesAsking`). Too few:
  it waits and retries on `AscStacked` / `AscRetrieved`. The crane waits (`prepareNextPackage` returns `waiting`).
- Reply must be exactly `count` distinct candidates (else an error). `EmptiesAllocated` books them to `slotIds` in
  reply order, sets `allocatedTo`, redraws props for the vessel (`allocateEmptyProps`), creates load orders.
- **Candidates** (`emptyCandidates`): not full, not allocated, no `truckClaim`, custody still the yard slot.
  Old strategies: same size and line, on top only. `iso-type-best-position` (`isoAllocation(ctx)` true): same ISO
  type, line only with `config.emptyAllocation.matchLine` (builder `.emptyAllocation({matchLine})`, CLI
  `--match-line`), buried empties included; candidates gain `isoType line boxesOnTop blockRank adjacentAllocated` and
  the request `isoType matchLine`. With another strategy, payloads and goldens stay byte-identical; a custom handler
  gets the old shape.
- **Strategies** (`emptyStrategies.ts`): `iso-type-best-position` (default since 0.25.0): greedy, fewest
  `boxesOnTop`, then `blockRank` (0 = block whose X is nearest the crane's gantry), then `distanceM` to that block's
  pads, then most neighbouring allocated or picked empties (same block, row +/-1, bay +/-2), then id; reply ordered
  fewest boxes on top first, so a pick standing on another loads first. `nearest-wtp` (distance, tier) and
  `oldest-first` (`yardSince`; pool boxes negative) are rollbacks (`--strategy emptyAllocation=nearest-wtp`).
- Buried picks are dug out by the usual rehandle flow. Empties allocated to a package can still be buried by later
  stacking. Fixtures `empties-load-4-of-16`, `empty-allocation-iso`.
- **Empty pool** (`config.emptyPool {count, sizeMix?, lines?, maxAgeS?}`): `flow 'pool'` boxes, `vesselId 'POOL'`,
  `yardSince = -ageS`, placed after the exports. Discharged empties (`cargo.emptyShare`) join after they are stacked.

## Yard reserve

`config.yard.reserveShare` (builder `.yardReserve`, 0 to `MAX_YARD_RESERVE` 0.5, default 0; TTI `TTI_YARD_RESERVE`
0.1, #184). `reservedStacksOf(bays, rows, share)` marks `round(share x stacks)` stacks as neighbouring-bay pairs in
one row (so a 40 ft blocker fits), spread evenly over the bay-major index; a one-bay block gets single stacks.
`BlockSpec.reserved` holds the flags. Discharge, truck drops, `blockTakes`, pre-fill and the legacy start carry
`reservedStacks` and skip them; rehandle requests never do. `yardCapacityCells` (and so the pre-fill target) exclude
reserved cells. Separate from this, `engine/subsystems/shc.ts#blockRoom` keeps `BLOCK_FREE_RESERVE` 10 % of a block's cells free of
new discharge (#165). Without a reserve no field is added and logs are unchanged.

## Yard start modes

`config.yardStart {mode: 'prefilled' | 'warmup' | 'empty', targetPct? (60, DEFAULT_YARD_TARGET_PCT), warmUpS? (48 h,
DEFAULT_WARM_UP_S), mix?}`. **Absent = legacy start**: `planExportYard` places booked exports (reverse load sequence)
then the pool (oldest first), each in the first block with a slot: lowest tier, highest bay, lowest row. Older
fixtures and goldens rely on it. The setup dialog defaults to pre-filled 60 %. Validation and dialog:
[scenarios-and-persistence.md](../scenarios-and-persistence.md).

### Pre-filled (`engine/prefill.ts#prefillSteps`)

Placement order: (1) booked export and TS-load boxes in reverse load sequence (under `grouped`: group by group,
heavy first), (2) empty pool oldest first, (3) filler boxes until `round(yardCapacityCells x targetPct / 100)`
cells. Fillers are imports by default; `yardStart.mix {import, export, transshipment}` sets shares (#149). Booked
boxes are always placed, even above the target (no room throws). A 40 ft filler with no slot retries as a 20; the
first filler with no slot ends the fill.

- **Every box asks the selected `yardAllocation` handler** (custom handler, else configured strategy, else default)
  through the decision runtime in the **pre-run phase** (`subsystems/prefill.ts`): requests at sim time 0 with
  `payload.preRun: true`, `wtpPadId: ''`, the block's centre and `wtpZ` as origin, `random` from its own seeded
  stream (`PREFILL_SALT`). A reply that does not sit on its stack fails the run. The last reply schedules
  `ScenarioStarted`. A sync handler finishes inside `createSimulation`; an async one stays in flight until
  `runUntilAsync`. Latency, fallbacks and handler KPIs apply; KPI series skip pre-run events; invariants are swept
  once at the end of the phase. A mid pre-run snapshot replays `state.prefill.replies`; `restoreSimulation` skips the
  phase. Filter on `payload.preRun` when counting decisions.
- **Block order per box:** a grouped box first tries blocks that already hold its group while `fill < 0.9`
  (`GROUP_BLOCK_MAX_FILL`) and within `GROUP_BLOCK_FILL_BAND` 0.08 of the emptiest block, and (booked exports) while
  the vessel has under `max(EXPORT_BLOCK_MIN_CELLS 10, ceil(cells x EXPORT_BLOCK_SHARE_X 1 / blocks))` cells there
  (#207); then fewest vessel cells, lowest fill, block order. A null reply moves to the next block, so one box can
  cost several requests. Under `grouped` the first pass sends `sameGroupOnly`; a booked box retries without it.
- **Mixed lines (#163):** a filler import's grouping view has line `'*'` (`prefillView`), so import stacks mix lines;
  `prefillBlockKey` lets empties share blocks by size and ISO type (each stack still one line). The run-time
  `grouped` strategy keeps imports by line, so a later import on a pre-filled stack counts as `mixedStack`.
- Filler imports: ids from serial `IMPORT_SERIAL0` 700000, `vesselId 'POOL'`, `full`, `yardSince = -age`,
  `pickupReadyAt = dwell - age` (dwell from `landside.importDwell`, else the default; age uniform in the dwell).
  Pool boxes get `pickupReadyAt` at state init. Same config, seed and strategy give an identical yard. The scene
  model calls `planPrefill` (default strategy, synchronous) so the 3D view agrees with the engine.

### Empty and warm-up

No stacked boxes and no pool. Booked exports exist with custody `external`; trucks deliver them
(`engine/subsystems/landside.ts#undeliveredBookings`, last in load sequence first, so the first-loaded box ends on top). Load prep waits
until a booked box is stacked; the vessel completes once its exports arrived and loaded. Needs `config.landside` and
the landside on (`createInitialState` throws otherwise).

**Warm-up** (`warmUp.ts`): `WarmUpEnded` at `warmUpS` runs `resetCounters`: every number under `state.kpis` and the
decision-handler KPIs is zeroed, except keys ending in `Since`; `firstMoveStartS`/`lastMoveEndS` become null. This
includes `state.kpis.landside`. End conditions are ignored during the warm-up; `simDurationS` counts the measured
period; the "all vessels" end counts vessels not completed at warm-up end. The collector is rebuilt on a clock moved
by `warmUpS` (gauge starts from `warmUp.cellsAtEnd`). `kpiReport().warmUp {durationS, ended}`.

## Silent yard deadlock and `yard.no-progress`

A block can hold claimed work with every ASC idle and nothing able to move it; before 0.36.0 that ended the run as a
quiet `idle`. Cause found on the peak day (#183): `rehandleCandidates` forbade the stacks of every open truck pick,
queued trucks included, so with a queue of picks no stack was a target, retrievals went `rehandle: 'full'`, and
`reopenFullJobs` waited for a lift that never came. Rule now: only a truck that holds a stall forbids its stack.

**Invariant `yard.no-progress`** (`engine/invariants.ts#stuckYardBlocks`, reads `time`): a block is stuck when all hold:

1. it has a claimed open job (`allocation: 'claimed'`, `ascId` null);
2. it has been idle longer than `STALL_STRAND_LIMIT_S` 1800 s [A], counted from the later of
   `YardBlockState.progressAt` and the `gateInAt` of the oldest claimed pick truck (#209: a pick truck still in the
   queue or a lane counts for nothing; a block whose only claimed work is such a truck is skipped);
3. every ASC of the block is idle;
4. no job is `asked`, `waiting` or has `dispatch: 'asked'`;
5. no open job is startable (`jobStartable` mirrors `candidateJobs`, read without side effects);
6. no queued event names its ASCs, jobs, boxes, trucks or stalls.

It never fires for a block with a working ASC. **Deadline check** (`invariantDeadline`, called from
`engine/simulation.ts#step`): before each event, at the run end or on an empty queue, the clock runs to the next time
a stall wait, exit wait or (empty queue) yard deadlock reaches its limit and the invariants are checked there. Only
the clock moves, nothing is scheduled, so a clean run's event log is unchanged.

Diagnose: dump state at the violation (`--until time:T --snapshot`), then for the block list open jobs by `kind`,
`allocation`, `rehandle`; check `rehandleCandidates` for the first `full` retrieval; check which trucks hold stalls.
Proof tests: `tests/yard-no-progress.test.ts`, `tests/pick-admission.test.ts`, `tests/stranded-trucks.test.ts`.

## Known gaps

- Rehandle target choice can leave every row with unequal stack heights, so no 40 ft blocker has a pair to go to and
  no pick may be admitted (seed 4 of the "drop-only head" test in `tests/pick-admission.test.ts`: a layout dead end).
- Allocation does not avoid stacking above a stack being dug out (it creates a fresh blocker); buried boxes are not
  fetched early; no plug monitoring or reefer handling times.
- A landside ASC cannot work the pads without the waterside ASC stepping to the rail end.
- `yardAllocation` and `rehandleTarget` requests carry arrays of bays x 8 per request: large at TTI scale.

## Optimisation levers and gotchas

- **Throughput:** `grouped` cut rehandles sharply in busy fixtures but lengthens gantry travel; `nearest-wtp` gives
  the shortest cycles. `min-future-rehandles` reduces later digs. `balanced` ASC dispatch uses the landside crane on
  pad-only work; `pre-retrieval` shortens stall service. `loadReleaseAhead` lets loads start sooner. Reserve 0.1 and
  `balanced` pad selection plus the pre-fill spread (#207) kept the TTI presets out of yard saturation. Levers and
  numbers: [terminal-throughput.md](../optimising/terminal-throughput.md).
- **Run speed:** `retrievalRanks` is cached (#228); `stackSpansOf` and `stackTopsOf` scan all ASC jobs per call;
  `emptyCandidates` and `eligiblePickups` scan all yard slots. The yard invariants are scoped per touched column.
  See [run-speed.md](../optimising/run-speed.md).
- **Determinism:** strategies must be pure and draw only `request.random`. The pre-fill and landside have their own
  RNG streams. Any change to request shape, claim order or priority moves event-log hashes; `UPDATE_GOLDEN=1 pnpm test`
  only after you have checked why. Prove with the table in
  [terminal-twin-AGENTS.md](../../terminal-twin-AGENTS.md#how-to-prove-a-change-works).
- Realistic-volume failure modes seen and fixed (block saturation near 90 %, 40 ft-locked blocks with no pair for a
  blocker, pads held by staged loads not at their crane's head, the rehandle race): measured in
  [realistic-volume-reports.md](../reports/realistic-volume-reports.md). A fix that only works at 0.1 scale may still
  deadlock at 0.5 or 1.
- A stall-holding pick's stack is never a rehandle target and reads full to `yardAllocation`; keep both rules in
  step (`rehandleCandidates`, `withoutPendingPickups`, `rehandleRoomFor`) or digs will bury the next truck's box.

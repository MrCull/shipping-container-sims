# Throughput and speed report (#221, spec #220)

A measuring step (measured before #222 raised the scale to 1; the figures below are the 0.5 state): no engine code changed, `ENGINE_VERSION` 0.52.0, `TTI_MOVES_SCALE` 0.5. Event-log hash of the 0.5 peak day (`--until vessels:5`): **0c67d35d6d90b8** (5 of 5 vessels, 4,583 moves, 296,635 events, sim day 3 04:58:35, 263,377 checks, 0 violations), the same run as the figures in [realistic-volume-reports.md](realistic-volume-reports.md).

How measured: `node --cpu-prof --import tsx src/sims/terminal-twin/cli/run.ts --preset "TTI Algeciras, peak day" --until vessels:5`, summarised by a throwaway script (self time per function and file, and inclusive time of stacks containing a subsystem file; kept outside the repo). Sim-time numbers: `pnpm run tt:profile "TTI Algeciras, peak day" --until 400000`. The profiled run took 685 s wall because it shared the 4 cores with three other runs (clean 0.5 run: 438 s); shares are of profile time, not of the clean wall time.

## Wall-time costs (CPU profile, 0.5 peak day)

| # | Cause | Share | Where |
|---|---|---|---|
| 1 | Invariant checks | 54 % inclusive (47.5 % self in `engine/invariants.ts`: `check` 33 %, `slotsToCheck` 3 %, `sharedCells` 1.4 %) | `checkInvariants` in `engine/simulation.ts`, one call per event (263,377 checks for 296,635 events) |
| 2 | Garbage collection | 20.4 % self | allocation, mostly under the invariant sweeps and the yard index helpers (`reservedStacksOf` 1.7 %, `retrievalRanks` 3.2 %) |
| 3 | Event loop and subsystem logic (what is left) | about 25 %: landside 5.7 %, rehandle 4.2 %, SHC 3.8 %, event-log hash 2.8 % (`hashedJson`, `hash.ts`), decision points 1.2 %, KPI collection 0.3 % | `simulation.step` is 79.5 % inclusive, invariants included |

State cloning and the snapshot are 0 % (a plain `tt:run` never snapshots; `--snapshot` copies once at the end, see #216). KPI collection and decision-point calls are not costs worth chasing (1.5 % together).

- **1, invariants:** smallest fix: skip the per-event `check` for event types that cannot change what it reads (or run it every N events and on the last), keeping the full sweep on `--until` end; it does not move the event log (it reads state), but it changes the check count in goldens and summaries.
- **2, GC:** smallest fix: stop building temporary arrays and maps in `check` and `slotsToCheck` (reuse buffers); it does not move the event log. Expect it to fall with cause 1.
- **3, rest:** smallest fix: cache `retrievalRanks` and `headsWithoutPad` per block until a stack changes; it does not move the event log if the cache is exact, and the hash proves it.

## Simulated throughput losses (`tt:profile`, 0.5 peak day)

| # | Cause | Share | Code path |
|---|---|---|---|
| 4 | STS rail wait and repositioning | `rail` 17 % and `reposition` 25 % of crane window over all 8 STS (rail: STS106 58 %, STS107 26 %, STS102 18 %; reposition: STS102 62 %, STS105 45 %, STS104 and STS108 35 %); `cycle` 26 %, `done` 27 %; 7.5 moves/h per crane | `engine/subsystems/rail.ts` (`askToYield`), crane moves in `quay.ts` and `workPackages.ts` |
| 5 | Idle SHCs | mean idle 91 % over 23 SHCs; 14 of 23 at 99 % or more; jobs: SHC01 33 % idle, SHC02 56 %, SHC03 70 %, SHC13 and SHC14 100 % (0 jobs); ASCs 87 % idle on average (B03 76 %, B16 92 %) | `shcDispatch` strategy `chained-nearest` (`decisions/`, `engine/subsystems/shc.ts`): jobs chain to the lowest-numbered free SHC |
| 6 | Anchorage waits | V003 187,826 s, V004 187,127 s, V005 232,604 s (mean of the 3 waiting 121,511 s; the run is 277,115 s long) | `berthAllocation` strategy `first-fit` (`subsystems/berth.ts`); a berth frees only when a vessel finishes, and the late load boxes wait for the horizontal move (mean 696 s per load box, longest 65,594 s) |

- **4:** smallest fix: stop assigning a package to a crane that must yield its rail to a neighbour (look ahead in `workPackages` release), or split the work by rail segment; it moves the event log (different crane order).
- **5:** smallest fix: change the `shcDispatch` tie-break from lowest id to least loaded SHC (the strategy file only); it moves the event log (different jobs per SHC), and it changes the horizontal wait, so run the 0.1 KPI comparison.
- **6:** smallest fix: let `first-fit` take a berth that will free in under the vessel's wait (berth look-ahead), or start the next vessel's cranes before the previous one leaves; it moves the event log. Its share is a consequence of 4 and 5 (moves per hour), so fix those first.

## Wall time and scale

| Run | Events | Checks | Wall, clean (earlier, in the guide) | Wall, measured here (4 jobs at once) |
|---|---|---|---|---|
| 0.25, `--until vessels:5` (hash 1cfab0ac37bef1, 2,293 moves, sim day 1 15:13) | 193,029 | 161,103 | 216 s | about 450 s |
| 0.5, `--until vessels:5` (hash 0c67d35d6d90b8, 4,583 moves) | 296,635 | 263,377 | 438 s | 685 s (profiled) |
| 1, `--until time:100000` (hash 1534c411c3cff2, 3,451 moves, 1 of 5 vessels, sim day 1 03:46:40) | 238,418 | 209,267 | 411 s | about 770 s |

Per event the cost grows: 1.1 ms (0.25), 1.5 ms (0.5), 1.7 ms (1, clean figures). The 0.25 CPU profile gives the same split (invariants 50.5 % inclusive, GC 20.7 %). A projection: scale 1 to the end of the peak day is at least twice the 0.5 events (the 0.5 day needs 2.0 sim days for half the moves) at 1.7 ms or more each, so well over 1,500 s wall, past the 10 minute criterion; invariants and GC are 75 % of it.

## Proposed tickets (each 15 minutes, one headless proof)

Status after spec #220: ticket 1 landed as #226 (only `DecisionRequested` is state-neutral, 13 % fewer checks) and its real gain came from #237 (the stowage invariants ask a per-vessel occupancy map first, 32.2 s to 5.7 s CPU); ticket 2 (buffers) folded into #237; ticket 3 landed as #228 (`retrievalRanks` cached; `headsWithoutPad` could not be); tickets 4 to 6 were tried and did not land (#229 split and #240 package look-ahead left the 0.5 run identical, #230 SHC tie-break spread the work but left the load-box wait flat, #231 withdrawn).

1. Invariants: run the per-event `check` only for event types that touch what it reads; proof: 0.1 peak day hash unchanged, check count and wall time before and after.
2. GC: reuse buffers in `check` and `slotsToCheck` (no allocation per call); proof: same hash at 0.1, profile shows GC share down.
3. Cache `retrievalRanks` and `headsWithoutPad` per block with a stack-change key; proof: same hash at 0.1, 0.25 wall time.
4. Rail and reposition: do not release a package to a crane that must yield; proof: 0.1 peak day, rail plus reposition share from `tt:profile` down, 0 violations (moves the log; new golden later).
5. SHC dispatch: least-loaded tie-break in `chained-nearest`; proof: `tt:profile` at 0.1 shows jobs spread over more SHCs and the horizontal wait down.
6. Berth look-ahead for `first-fit`; proof: peak day at 0.1 or 0.25, anchorage wait max down; blocked by 4 and 5.

## Per-invariant cost (0.1 peak day, #233)

Measured, not fixed: no engine change, no ENGINE_VERSION bump, and the 0.1 peak day event log hash is unchanged (`06ce35a7276076`). `TTI_MOVES_SCALE` was set to 0.1 by a temporary uncommitted edit (reverted). A throwaway wrapper (scratchpad, not committed) timed every `Invariant.check` call with `performance.now()` (`tt:run --preset "TTI Algeciras, peak day" --until vessels:5`, 86,946 incremental checks and 96 sweeps). The machine was shared with another run, so read the shares, not the wall seconds (the instrumented run took 173 s of wall).

The per-invariant times sum to 98.8 s. `InvariantTracker.check` and `sweep` took 105.2 s in all, so the invariant functions are 93.9% of it (within 10%); the other 6.4 s (6.1%) is the tracker's own scope building (custody and column bookkeeping, sets and maps per event). "Calls" counts incremental checks plus sweeps; "scoped" is how many of those got a scope (so did less than a full scan).

| Invariant | ms | Share | Calls (scoped) | What it scans |
|---|---|---|---|---|
| stowage.no-floating | 19,086 | 19.3% | 52,780 (52,684) | every vessel slot (`Object.values(state.vesselSlots)`), filtered to touched vessels; builds a string-keyed map of occupied cells |
| landside.waiting-off-road | 12,846 | 13.0% | 87,042 (0) | every truck, with a road-zone point test for each waiting one |
| stowage.cell-free | 10,280 | 10.4% | 52,780 (52,684) | every vessel slot, filtered to touched vessels; string-keyed cell map |
| landside.segregation | 8,294 | 8.4% | 83,804 (83,708) | trucks and lanes (scoped to equipment) |
| asc.wtp-handover | 6,003 | 6.1% | 87,042 (0) | every ASC, then pads, then SHC positions |
| landside.stranded-truck | 5,841 | 5.9% | 87,042 (0) | every truck at a stall, then the open jobs of its block |
| custody.single-owner | 5,588 | 5.7% | 52,496 (52,400) | touched custody owners |
| yard.no-double-occupied | 3,782 | 3.8% | 52,496 (52,400) | touched yard columns |
| asc.no-passing | 3,373 | 3.4% | 83,804 (83,708) | ASCs of the touched equipment |
| yard.no-mixed-length-overlap | 3,341 | 3.4% | 52,496 (52,400) | touched yard columns |
| landside.stall-exclusive | 2,530 | 2.6% | 83,804 (0) | all trucks and stalls |
| yard.no-floating | 2,490 | 2.5% | 52,496 (52,400) | touched yard columns |
| yard.no-mixed-length-stack | 2,260 | 2.3% | 52,496 (52,400) | touched yard columns |
| reservation.no-overlap | 2,211 | 2.2% | 87,042 (86,946) | reservations made since the last check |
| yard.no-progress | 1,325 | 1.3% | 87,042 (0) | yard blocks (idle deadlock) |
| yard.reefer-powered | 1,205 | 1.2% | 52,496 (52,400) | touched yard columns |
| yard.slot-bounds | 1,109 | 1.1% | 52,496 (52,400) | touched yard columns |
| stowage.order | 1,045 | 1.1% | 52,780 (52,684) | touched vessels |
| shc.waiting-positions | 1,009 | 1.0% | 83,804 (0) | all SHCs |
| yard.stack-height | 854 | 0.9% | 52,496 (52,400) | touched yard columns |
| hull.profile | 837 | 0.8% | 52,780 (52,684) | every vessel slot, filtered to touched vessels |
| sts.rail-order | 701 | 0.7% | 87,042 (0) | all STS gantries |
| landside.leaves-complete | 690 | 0.7% | 83,804 (0) | all trucks |
| claim.single-holder | 688 | 0.7% | 83,804 (0) | all claims |
| hatch.laydown-stack-limit | 545 | 0.6% | 83,804 (0) | all laydown bays |
| hatch.no-removal-with-boxes-on-top | 268 | 0.3% | 83,804 (83,708) | touched hatch panels |
| hatch.no-hold-access-through-closed-hatch | 202 | 0.2% | 83,804 (83,708) | touched hatch panels |
| hatch.no-deck-load-on-missing-hatch | 153 | 0.2% | 52,496 (52,400) | touched boxes |
| hatch.replace-own-hatch | 89 | 0.1% | 83,804 (83,708) | touched hatch panels |
| hatch.no-lift-before-lashing-release | 83 | 0.1% | 83,804 (83,708) | touched hatch panels |
| berth.no-overlap | 56 | 0.1% | 2,064 (0) | on-quay vessels |
| hatch.no-departure-open | 19 | 0.0% | 2,064 (1,968) | touched vessels |

Reading it: three vessel-stowage invariants (no-floating, cell-free, hull.profile) are 30.5% even though they skip untouched vessels, because they still walk every slot of every vessel to find the filled slots of the touched one. The landside and ASC invariants that read `time` run on every event with no scope (waiting-off-road, stranded-truck, wtp-handover, stall-exclusive: 27.8% together). The yard invariants, which are scoped by column, cost 15.2% together.

### Proposed tickets (each 15 minutes, one headless proof)

1. **Vessel-slot index for the stowage invariants** (stowage.no-floating, stowage.cell-free, hull.profile, 30.5% of the invariant cost): iterate only the slots of the touched vessels (a per-vessel slot id list, or a filled-slot set per vessel built once in `SimState`/the tracker) instead of `Object.values(state.vesselSlots)` filtered by vessel, and share one numeric cell key instead of building a string per slot. Reports the same messages in the same order, so the event log does not move. Proof: `tt:run` on the 0.1 peak day gives the same `eventLogHash` (`06ce35a7276076`) and invariant check count, with the three invariants' timing down.
2. **Early exits for the time-read landside invariants** (landside.waiting-off-road, landside.stranded-truck, landside.stall-exclusive, landside.leaves-complete, 22.2%): skip the truck scan when no truck is in the statuses the invariant cares about (keep a count or list of trucks per status), and look at whether `roadZonesOf(graph)` is built per call and cache it per config. Same messages, event log unchanged. Proof: same hash and `checks` on the 0.1 peak day, plus the existing invariant tests (a planted violation is still found by the sweep).
3. **Cheap guard for asc.wtp-handover and asc.no-passing** (9.5%): skip an ASC whose spreader is at travel height or whose planned motion cannot reach a pad (the `pose.hoistY >= travel` test already does this per ASC, so the saving is the per-event `ascPoseAt` and block-spec lookups: hoist `blockSpecsById` and `laneGraphOf` out of the per-event path and bail when no SHC is within a pad envelope). Event log unchanged. Proof: same hash on the 0.1 peak day and the asc invariant tests.

The tracker's own overhead (6.1%, sets and maps per event) is not a ticket: it is smaller than any of the three above.

## Crane and load-box waits at 0.5 (#229 measuring slice)

Run: `pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:40000` (scale 0.5, seed 99): 903 moves, 118,121 events, 0 violations, event-log hash `1bf340c1f57635` (engine at integration tip f2b2bf1). Counted from the event log and `pnpm run tt:profile` of the same bounded run. Open waits are cut at 40,000 s (the KPI `railWaitS` counts closed waits only, so STS106 shows 0 s there).

### Crane waits (rail 36 %, reposition 7 % of crane windows; cycle 36 %)

Only 7 `StsWaitingForRail` and 3 `StsRepositionStarted` events occur. Total rail wait about 88,000 crane-seconds, two causes:

1. **Neighbour works a long package and cannot yield, 62 %.** STS103 (bay 8, x 139) waits 17,639 s (1,800 s to 19,439 s) for STS102 (bay 7, x 125, 14 m away, spacing 27 m); STS106 (bay 18, x 498) waits 16,286 s for STS105 (bay 16, 161-move package), then 21,011 s more (to the end of the run, 0 moves) for STS107 (bay 19, x 512, 212-move package). The blocker is mid-package and carries boxes, so `yieldable` refuses. Parked start positions matter little: STS106 started at x 584 and its one reposition took 135 s.
2. **Chained behind a waiting crane, 38 %.** STS107 (16,422 s) and STS108 (16,702 s) wait on STS106, which itself waits; they start only when STS106 steps aside at 18,853 s.
Reposition is a small cause here: 3 moves, 162 s of motion in total (STS102 54 % in the profile is the bucket after its work completes, not travel).

Smallest change: make the `balanced-moves` crane split give one crane every bay closer than `stsMinSpacingM` to a bay of another crane's range (bays 18 and 19 are 14 m apart, 7 and 8 are 14 m apart), so no two cranes are assigned bays they cannot work together. Strategy file only; it moves the event log (different cranes per bay). The #229 look-ahead in `prepareNextPackage` cannot help: the wait starts at the first package.

### Load-box waits (horizontal stage, `AscDroppedAtWtp` to `ShcPickedAtWtp`)

313 load boxes dropped at a pad; mean horizontal wait 456 s (profile: 472 s over 302 boxes entering the path; sts stage 333 s, yard 41 s). Split per box:

1. **Waiting for an SHC job claim (`ShcJobAssigned`), 90 % of the wait.** 93 boxes wait over 60 s for it; during those waits 1,902 discharge jobs and 1,252 load jobs are assigned, so SHC capacity goes to other boxes first. Only 8 distinct SHCs got a job in this window. Hours 2 to 4 show 0 s, hours 5 to 8 and 1 show 400 to 1,600 s. The 4 longest (21,287 s, 9,689 s, 9,557 s, 9,327 s) are still unassigned at 40,000 s.
2. **SHC travel to the pad, pickup and lock, 9.5 %.** Conflict-zone hold (`departAt` after assignment) is 0.2 %: pad and zone availability are not a cause.
Not split (no time): why the claim does not come, between all assigned SHCs busy and the dispatch order (`chained-nearest`, lowest id first). #230 ruled out idle SHCs at 0.25.

Smallest change: have `shcDispatch` claim the oldest waiting pad box before a new discharge job when an SHC frees (strategy file only); it moves the event log.

### Proposed tickets (proof: this bounded 0.5 run, `--until time:40000`; compare hash, moves, rail share, load-box horizontal mean)

1. Crane split keeps bays at least `stsMinSpacingM` apart per crane: rail share down from 36 %, STS106 gets moves.
2. Why are most SHCs unused (8 got jobs) and four load boxes unclaimed after 9,000 s: log, per ShcJobAssigned, the SHC states at each long wait (measure only, 15 min).
3. `shcDispatch` oldest-pad-box-first: load-box horizontal mean down from 456 s.

## Why a pad box waits for an SHC job claim at 0.5 (#239 measuring slice)

Run: the same bounded run (`--until time:40000`, scale 0.5, seed 99), twice on tip 02063df: 903 moves, event-log hash `1bf340c1f57635` both without and with a temporary read-only logging hook (reverted, not committed). The hook logged, for every open load job that waited over 1,800 s, each SHC's state (status, job, node, route cost to the pad, how many open jobs are nearer) and the job's eligibility (`padWait`), and logged every load-job claim with the job's `readyAt`.

**Result: the premise did not hold. The SHCs are not the cause.** The hook logged 0 open load jobs waiting more than 1,800 s. Of 313 boxes dropped at a pad (`AscDroppedAtWtp`), 304 were claimed, every one in the same sim second its `ShcJob` was created (open-job wait 0 s for all 304), and 9 had no job at 40,000 s. So the "wait for `ShcJobAssigned`" of the section above is the wait for the job to exist: a box staged ahead of its ground position (#186, `loadReleaseAhead`, stage `padded`) gets its job only when `pumpLoadPrep` has asked `stsGroundPosition` and the crane's discharge packages are complete (`dischargeDone` in `engine/subsystems/loadPrep.ts`; job created in `loadPrepReactors.DecisionResolved`).

| Pad boxes waiting over 1,800 s (drop to claim) | Count | Share | Wait | SHC states / reason class |
|---|---|---|---|---|
| Box on pad, job created later when its crane finishes discharge, claimed at once | 11 | 73 % | 1,843 s to 5,250 s (e.g. 5,250 s to STS108 at 29,504 s; 3,829 s to STS102 at 9,096 s) | never offered: no job existed; an SHC was free at each claim (0 s open wait) |
| Box on pad, no job at 40,000 s | 4 | 27 % | 9,327 s to 21,287 s (open at the end) | never offered: no job existed (crane discharge not done, see the rail waits above) |
| All SHCs busy / ranked last by the strategy / box not eligible | 0 / 0 / 0 | 0 % | none | the hook never saw an open load job older than 1,800 s |

The 15 boxes over 1,800 s carry 85,787 s, 67 % of the 128,850 s total drop-to-claim time over all 313 boxes; 100 % of it is before the job exists, 0 s is SHC wait. The earlier "8 distinct SHCs got a job" only reflects that load jobs appear one at a time and a free SHC takes each at once. Which crane held each of the 4 unclaimed boxes was not checked (time box).

Smallest fix: none in `shcDispatch` (`engine/subsystems/shc.ts`) or the strategies (`chained-nearest`, `predispatch`, `paired-dual-cycle`): there is no SHC wait to remove, so the "oldest pad box first" ticket above is withdrawn. The change is the measurement: start the load-box horizontal stage at job creation (`ShcJob.readyAt`, from `createLoadShcJob`) instead of `AscDroppedAtWtp`, so the load-box wait reads about 0 s; it changes the KPI only, not the event log. The long pre-job waits shrink only with earlier crane discharge (the #229 crane-split fix) or a smaller `loadReleaseAhead`, which moves the log.

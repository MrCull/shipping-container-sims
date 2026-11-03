# Throughput and speed report (#221, spec #220)

A measuring step: no engine code changed, `ENGINE_VERSION` 0.52.0, `TTI_MOVES_SCALE` 0.5. Event-log hash of the 0.5 peak day (`--until vessels:5`): **0c67d35d6d90b8** (5 of 5 vessels, 4,583 moves, 296,635 events, sim day 3 04:58:35, 263,377 checks, 0 violations), the same run as the figures in [realistic-volume-reports.md](realistic-volume-reports.md).

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

1. Invariants: run the per-event `check` only for event types that touch what it reads; proof: 0.1 peak day hash unchanged, check count and wall time before and after.
2. GC: reuse buffers in `check` and `slotsToCheck` (no allocation per call); proof: same hash at 0.1, profile shows GC share down.
3. Cache `retrievalRanks` and `headsWithoutPad` per block with a stack-change key; proof: same hash at 0.1, 0.25 wall time.
4. Rail and reposition: do not release a package to a crane that must yield; proof: 0.1 peak day, rail plus reposition share from `tt:profile` down, 0 violations (moves the log; new golden later).
5. SHC dispatch: least-loaded tie-break in `chained-nearest`; proof: `tt:profile` at 0.1 shows jobs spread over more SHCs and the horizontal wait down.
6. Berth look-ahead for `first-fit`; proof: peak day at 0.1 or 0.25, anchorage wait max down; blocked by 4 and 5.

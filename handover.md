# Handover: spec #220 (throughput and engine speed toward scale 1), on claude/stoic-hypatia-tk68z1 from main c1e53e2

Fast mode, budgets in minutes per ticket (scripts/timebox.sh). Ticket bodies: scratchpad impl220/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #221 | profile the 0.5 peak day (measure only) | none | merged in branch (docs only): wall 54% invariant checks, 20% GC; throughput rail 17%, reposition 25%, 14 of 23 SHCs idle | |
| #226 | per-event invariant check only for relevant event types | none | merged in branch (partial: only DecisionRequested skipped, checks -13%, hashes unchanged at 0.1; no wall or profile numbers; goldens and cli test red on the check count until #222) | |
| #232 | finer event-type map for the invariant check | #226 | NOT MERGED, closed as superseded: WIP on tt/232-invariant-event-map; the skip map proved unsafe (ShcCleared, TruckArrivalDue, AscDroppedAtWtp); CPU before: invariants.ts self 37.1%, GC 16.9% | |
| #233 | per-invariant CPU cost on the 0.1 peak day (measure only) | none | merged in branch (docs): stowage 30.5%, landside time-read 22.2%, asc 9.5% of the invariant cost; hash 06ce35a7276076 unchanged | |
| #234 | per-vessel slot index for the stowage invariants | none | merged in branch: hashes unchanged at 0.1; the three invariants 36.7 s to 31.7 s CPU (about 2.6% of total CPU); remaining cost is the per-call string-keyed cell map -> #237 | |
| #237 | stowage invariants: per-vessel occupancy map, numeric keys | none | merged in branch: the three invariants 32.2 s to 5.7 s CPU, GC 15.8% to 9.0%, total CPU 187 s to 175 s at 0.1; hashes unchanged | |
| #238 | truck-status index for the landside invariants | none | NOT MERGED, closed: hashes unchanged, no CPU saving (27.3 s to 30.3 s, noisy); branch tt/238-truck-status-index kept | |
| #235 | early exits for the landside invariants | none | NOT MERGED, closed: hashes unchanged but no CPU saving (30.7 s before, 34 to 36 s after, noisy); branch tt/235-landside-invariant-exits kept | |
| #236 | asc invariants index | none | closed not planned (small share) | |
| #227 | invariant check reuses buffers (GC 20%) | #237 | folded into #237 | |
| #228 | cache retrievalRanks per block (headsWithoutPad not cacheable: depends on load-order stages) | none | merged in branch: hashes unchanged at 0.1 and 0.25; wall gain small and noisy (0.25: 137 s to 110 s, 0.1 peak day no gain) | |
| #229 | crane split spacing | none | NOT MERGED, closed: balanced-moves prefers cuts at least stsMinSpacingM apart but the 0.5 run is identical (hash 1bf340c1f57635, 903 moves, rail 36%); bays are contiguous at 14 m so no cut gives 27 m; branch tt/229-crane-split-spacing kept; replaced by #240 | |
| #230 | SHC dispatch tie-break to the least loaded | none | NOT MERGED, closed: all 23 SHCs work (8 of 23 before at 0.25) but load-box wait flat (764 s to 810 s), moves 543 to 545; moved the log and forced a test assertion out; branch tt/230-shc-least-loaded kept | |
| #239 | why a pad box waits for an SHC job claim at 0.5 (measure only) | none | merged in branch (docs): premise did not hold, 0 open jobs waited over 1,800 s; 304 of 313 boxes were claimed in the same second their job was created; the wait is for the job to exist (staged-ahead loads get a job when the crane finishes discharge); hash 1bf340c1f57635 unchanged | |
| #240 | stagger neighbouring cranes (package look-ahead at 0.5) | none | NOT MERGED, closed: hash 1bf340c1f57635 and 903 moves identical, rail share unchanged; waits start at each crane first package; branch tt/240-stagger-boundary-cranes kept (guide note only) | |
| #241 | shcDispatch oldest pad box first | #239 | WITHDRAWN: no SHC dispatch cause (the wait is for the job to exist). Optional KPI-only fix: start the load-box horizontal stage at ShcJob.readyAt | |
| #231 | berth look-ahead for first-fit | #229, #230 | closed not planned (premise failed) | |
| #222 | final: measure 0.5 and scale 1 on an idle machine, goldens once, verify, smoke with SMOKE_WORKERS=2, review, PR | all | blocked by #218 and #191 | |

Tickets for the top causes are added under #220 after #221 reports.

## Small tickets beside #220 (decided 2026-11-03)

| Ticket | Title | Budget | Status | Claimed by |
|---|---|---|---|---|
| #223 | bay view: ROB cells always grey (#168), closes #192 | 10 min | merged in branch (12 min used; 3D unchanged; other smoke specs for the diff to run in #222) | |
| #191 | x3600 spec: functional check stays, 600 floor moves to an @load spec | 10 min | claimed | agent |
| #218 | prove each room-rising path unparks an SHC job (test-only) | none | closed not planned: no stuck park in a 21,600 s run sampled every 10 s; no test could be built (premise did not hold) | |
| #224 | SMOKE_WORKERS=2 trial | 15 min | folded into #222 (its dev smoke run uses two workers and compares with the 52.6 min one-worker baseline) | |

Standing rule: merge a PR I opened when CI is green and the review has no blocking finding, then fast-forward and start the next work.

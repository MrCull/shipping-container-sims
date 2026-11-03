# Handover: spec #220 (throughput and engine speed toward scale 1), on claude/stoic-hypatia-tk68z1 from main c1e53e2

Fast mode, budgets in minutes per ticket (scripts/timebox.sh). Ticket bodies: scratchpad impl220/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #221 | profile the 0.5 peak day (measure only) | none | merged in branch (docs only): wall 54% invariant checks, 20% GC; throughput rail 17%, reposition 25%, 14 of 23 SHCs idle | |
| #226 | per-event invariant check only for relevant event types | none | merged in branch (partial: only DecisionRequested skipped, checks -13%, hashes unchanged at 0.1; no wall or profile numbers; goldens and cli test red on the check count until #222) | |
| #232 | finer event-type map for the invariant check | #226 | NOT MERGED, closed as superseded: WIP on tt/232-invariant-event-map; the skip map proved unsafe (ShcCleared, TruckArrivalDue, AscDroppedAtWtp); CPU before: invariants.ts self 37.1%, GC 16.9% | |
| #233 | per-invariant CPU cost on the 0.1 peak day (measure only) | none | merged in branch (docs): stowage 30.5%, landside time-read 22.2%, asc 9.5% of the invariant cost; hash 06ce35a7276076 unchanged | |
| #234 | per-vessel slot index for the stowage invariants (30.5%) | none | claimed | agent |
| #235 | early exits and cached road zones for the landside invariants (22.2%) | none | claimed | agent |
| #236 | cheap guard for asc.wtp-handover and asc.no-passing (9.5%) | none | to do | |
| #227 | invariant check reuses buffers (GC 20%) | #234, #235, #236 | blocked | |
| #228 | cache retrievalRanks per block (headsWithoutPad not cacheable: depends on load-order stages) | none | merged in branch: hashes unchanged at 0.1 and 0.25; wall gain small and noisy (0.25: 137 s to 110 s, 0.1 peak day no gain) | |
| #229 | rail waits: where STS106, STS102 and STS105 wait at 0.5 (rescoped to measure, 20 min) | none | first slice no engine change (look-ahead changed nothing at 0.1; rail 0% there; waits come from parked start positions); guard test and note merged; measuring slice to do | |
| #230 | SHC dispatch tie-break to the least loaded | none | NOT MERGED, closed: all 23 SHCs work (8 of 23 before at 0.25) but load-box wait flat (764 s to 810 s), moves 543 to 545; moved the log and forced a test assertion out; branch tt/230-shc-least-loaded kept | |
| #231 | berth look-ahead for first-fit (moves the log) | #229, #230 | blocked | |
| #222 | final: scale 1 or best scale, goldens, smoke | #226 to #231 | blocked | |

Tickets for the top causes are added under #220 after #221 reports.

## Small tickets beside #220 (decided 2026-11-03)

| Ticket | Title | Budget | Status | Claimed by |
|---|---|---|---|---|
| #223 | bay view: ROB cells always grey (#168), closes #192 | 10 min | merged in branch (12 min used; 3D unchanged; other smoke specs for the diff to run in #222) | |
| #191 | x3600 spec: functional check stays, 600 floor moves to an @load spec | 10 min | to do | |
| #218 | prove each room-rising path unparks an SHC job (test-only) | 15 min | to do | |
| #224 | measure SMOKE_WORKERS=2 on the dev suite (heavy runs: start after #221 ends) | 15 min | to do | |

Standing rule: merge a PR I opened when CI is green and the review has no blocking finding, then fast-forward and start the next work.

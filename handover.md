# Handover: spec #220 (throughput and engine speed toward scale 1), on claude/stoic-hypatia-tk68z1 from main c1e53e2

Fast mode, budgets in minutes per ticket (scripts/timebox.sh). Ticket bodies: scratchpad impl220/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #221 | profile the 0.5 peak day (measure only) | none | merged in branch (docs only): wall 54% invariant checks, 20% GC; throughput rail 17%, reposition 25%, 14 of 23 SHCs idle | |
| #226 | per-event invariant check only for relevant event types (wall 54%) | none | claimed | agent |
| #227 | invariant check reuses buffers (GC 20%) | #226 | blocked | |
| #228 | cache retrievalRanks and headsWithoutPad per block | none | to do | |
| #229 | no package for a crane that must yield its rail (moves the log) | none | to do | |
| #230 | SHC dispatch tie-break to the least loaded (moves the log) | none | to do | |
| #231 | berth look-ahead for first-fit (moves the log) | #229, #230 | blocked | |
| #222 | final: scale 1 or best scale, goldens, smoke | #226 to #231 | blocked | |

Tickets for the top causes are added under #220 after #221 reports.

## Small tickets beside #220 (decided 2026-11-03)

| Ticket | Title | Budget | Status | Claimed by |
|---|---|---|---|---|
| #223 | bay view: ROB cells always grey (#168), closes #192 | 10 min | claimed | agent |
| #191 | x3600 spec: functional check stays, 600 floor moves to an @load spec | 10 min | to do | |
| #218 | prove each room-rising path unparks an SHC job (test-only) | 15 min | to do | |
| #224 | measure SMOKE_WORKERS=2 on the dev suite (heavy runs: start after #221 ends) | 15 min | to do | |

Standing rule: merge a PR I opened when CI is green and the review has no blocking finding, then fast-forward and start the next work.

# Handover: Terminal Twin phase 3 (run on claude/stoic-hypatia-tk68z1, from main 7628ff2)

Phase 2 and specs #193 and #201 merged in #210. Fast mode (lint, build, test:related per ticket; full verify at the end). Ticket bodies: scratchpad impl210/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #188 | scale 0.5 then 1 (0.25 done) | #212 to #216 | merged in branch (0.52.0): 0.5 committed and green (baseline 2,312 moves 130 s; peak day 4,583 moves 438 s, 0 violations); scale 1 baseline completes (279 s), peak day only bounded (not required) | |
| #192 | round 4 follow-ups (all but the #168 ROB colour, an owner decision) | none | merged in branch (smoke specs for its diff not run yet; #187 tier stow not done, root cause open; #170 atlas needs Blender) | |

## Spec #211 (TTI presets at 0.5, finish #188), same branch, fast mode. Ticket bodies: scratchpad impl211/<N>.md

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #212 | three-crane rail yield | none | merged in branch (0.48.0); 0.5 peak day passes the 89,151 s rail stop (bounded to 100,000 s, 1 of 5 vessels, 0 violations) | |
| #213 | release-ahead keeps a WTP pad for each crane head box | none | merged in branch (0.49.0); bounded 0.5 baseline passes the B14 stop at 81,017 s (2 of 4 vessels at 90,000 s, 0 violations) | |
| #214 | retry a rehandle-full retrieval when its block gains room | none | NOT DELIVERED: the retry already exists (reopenFullJobs, TT-175); gaps unproven; the fixture found a zero-time loop, filed as #218. Stays open | |
| #218 | SHC dispatch and pad selection zero-time re-ask loop when every pad is block-full | none | merged in branch as a guard only (0.51.0): the loop was NOT reproduced, tests never red; stays open until #188 at 0.5 confirms. Separate: landside.stranded-truck at about sim 5600 on a full block (not chased) | |
| #215 | stall legality counts room promised to admitted picks | none | merged in branch (0.50.0); TT-184 drop-only head test passes seeds 1,2,3,5 to 9; seed 4 is a rehandle-target layout dead end (equal-height pairs), truck turnaround +106 s baseline, +51 s peak day at 0.1 | |
| #216 | tt:run --snapshot on large runs | none | merged in branch (no ENGINE_VERSION change; snapshot 1.4 GB at 0.25 sim 7200 s, resume may need NODE_OPTIONS=--max-old-space-size) | |
| #188 | scale 0.5 then 1 (0.25 done) | #212 to #216 | merged in branch (0.52.0): 0.5 committed and green (baseline 2,312 moves 130 s; peak day 4,583 moves 438 s, 0 violations); scale 1 baseline completes (279 s), peak day only bounded (not required) | |
| #217 | final: smoke suite and goldens | all | claimed | agent |

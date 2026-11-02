# Handover: Terminal Twin phase 3 (run on claude/stoic-hypatia-tk68z1, from main 7628ff2)

Phase 2 and specs #193 and #201 merged in #210. Fast mode (lint, build, test:related per ticket; full verify at the end). Ticket bodies: scratchpad impl210/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #188 | TTI presets at realistic volume, 0.25 then 0.5 then 1 | none | PARTIAL, merged in branch (0.47.0): 0.25 committed and green; 0.5 floor not reached (peak day: three-crane rail wait at 89,151 s; baseline: yard.no-progress in B14 at 81,017 s). Stays open | |
| #192 | round 4 follow-ups (all but the #168 ROB colour, an owner decision) | none | merged in branch (smoke specs for its diff not run yet; #187 tier stow not done, root cause open; #170 atlas needs Blender) | |

## Spec #211 (TTI presets at 0.5, finish #188), same branch, fast mode. Ticket bodies: scratchpad impl211/<N>.md

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #212 | three-crane rail yield | none | claimed | agent |
| #213 | release-ahead keeps a WTP pad for each crane head box | none | claimed | agent |
| #214 | retry a rehandle-full retrieval when its block gains room | none | to do | |
| #215 | stall legality counts room promised to admitted picks | none | to do | |
| #216 | tt:run --snapshot on large runs | none | merged in branch (no ENGINE_VERSION change; snapshot 1.4 GB at 0.25 sim 7200 s, resume may need NODE_OPTIONS=--max-old-space-size) | |
| #188 | scale 0.5 then 1 (0.25 done) | #212 to #216 | blocked | |
| #217 | final: smoke suite and goldens | #188, #212 to #216 | blocked | |

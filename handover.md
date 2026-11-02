# Handover: spec #178 phase 2 (run on claude/stoic-hypatia-tk68z1, from main c2982eb)

Phase 1 merged in #190. Fast mode (lint, build, test:related per ticket; full verify, goldens once, smoke in #189). Ticket bodies: scratchpad impl178/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #184 | engine: yard reserve, gate bypass, exit road, drop reroute | none | merged in branch (0.42.0): peak day at 0.1 green (5 of 5, 916 moves, 0 violations) | |
| #185 | engine: pick-only trucks admitted when rehandles have room | none | merged in branch (ENGINE_VERSION 0.37.0) | |
| #186 | engine: load boxes staged on WTP pads ahead of the crane | #184 | merged in branch (0.39.0) | |
| #187 | engine: tier stow sequence keeps twin-20 pairing | #186 | merged in branch (0.40.0), partly: 24 moves and 3 twin-20 lifts in 90 min, wanted 26 and 4 | |
| #188 | TTI presets at realistic volume, 0.25 then 0.5 then 1 | #184 to #187 | moved out of phase 2: blocked by #207, #208, #209, #206 | |
| #189 | smoke run and regressions (phase 2) | #184 to #187 | to do | |

Open: peak day at 0.1 (#183 parked) is expected to be fixed by #184.

- Peak day at 0.1: green after the exit road zones, drop reroute and wider gate bypass (0.42.0). #183 and #184 acceptance now met; both close with the phase 2 PR.

## Spec #193 (faster agent loops), same branch, fast mode

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #194 | heavy-run lock in bg.sh | none | merged in branch | |
| #195 | merge script resolves ENGINE_VERSION-only conflicts | none | merged in branch (0c9490c) | |
| #196 | brief rules (scale first, snapshots, absolute paths) | none | merged in branch | |
| #197 | smoke timing report | none | merged in branch | |
| #198 | Chromium cache in CI | none | merged in branch | |
| #199 | parallel proof runner | #194 | merged in branch | |
| #200 | final: CI workflow_dispatch check | #194 to #199 | run 170 timed out at 40 min (test 130 of 163, no report, no cache saved); fixed: timeout 75, cache saved right after install; re-run pending | |

## Spec #201 and follow-ups (same branch, fast mode). Ticket bodies: scratchpad impl201/<N>.md

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #202 | invariant stowage.cell-free | none | merged in branch (fast-forward fff82d5) | |
| #207 | engine: yard allocation spreads across blocks | none | merged in branch (0.43.0), AC2 only marginal at 0.1; slow rehandle on B02 (pick-admission seed 3) worth a look | |
| #208 | engine: gate-queue bypass only at queue head | none | merged in branch (0.45.0), peak day at 0.1 ends 04:33 (was 06:57); follow-up: stallLegal ignores room promised to admitted picks (TT-184 drop-only head test on seed 7) | |
| #203 | shared cells: planner and engine | #202 | merged in branch (0.44.0); peak day at 0.1 needs #207 (yard.no-progress at B02 without it) | |
| #204 | late-booked exports take the lowest free cell | #203 | merged in branch (tests only, #203 already did it, 0.44.0 unchanged) | |
| #205 | bay viewer and 3D view show shared cells in both plans | #203 | merged in branch; terminal-twin.smoke x3600 fails on load (also on base, see #191) | |
| #209 | invariant: yard.no-progress wait from gate-in | none | merged in branch (no ENGINE_VERSION change) | |

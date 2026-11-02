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
| #197 | smoke timing report | none | claimed | implementer |
| #198 | Chromium cache in CI | none | to do | |
| #199 | parallel proof runner | #194 | claimed | implementer |
| #200 | final: CI workflow_dispatch check | #194 to #199 | to do | |

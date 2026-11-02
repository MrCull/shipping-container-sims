# Handover: spec #178 phase 2 (run on claude/stoic-hypatia-tk68z1, from main c2982eb)

Phase 1 merged in #190. Fast mode (lint, build, test:related per ticket; full verify, goldens once, smoke in #189). Ticket bodies: scratchpad impl178/<N>.md. Delete this file before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #184 | engine: yard reserve (and gate bypass) | none | merged in branch (0.38.0), partly: peak day at 0.1 still red | |
| #185 | engine: pick-only trucks admitted when rehandles have room | none | merged in branch (ENGINE_VERSION 0.37.0) | |
| #186 | engine: load boxes staged on WTP pads ahead of the crane | #184 | merged in branch (0.39.0) | |
| #187 | engine: tier stow sequence keeps twin-20 pairing | #186 | merged in branch (0.40.0), partly: 24 moves and 3 twin-20 lifts in 90 min, wanted 26 and 4 | |
| #188 | TTI presets at realistic volume, 0.25 then 0.5 then 1 | #184 to #187 | to do | |
| #189 | smoke run and regressions (phase 2) | #184 to #188 | to do | |

Open: peak day at 0.1 (#183 parked) is expected to be fixed by #184.

- Peak day at 0.1: exit chain fixed (outbound road cut to 40 m zones, ENGINE_VERSION 0.41.0, merged), still red on yard capacity: drop-only trucks meet a full stall (stranded-truck at 21,145 s with reserve 0.1) or picks wait behind a drop-only head (yard.no-progress at 38,752 s without). Next: reroute a drop to another block when it meets full, and let bypassBlockedHead skip a head with no free legal stall. Implementer in progress.

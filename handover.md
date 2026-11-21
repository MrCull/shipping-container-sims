# Handover: spec #320, fast CI

Integration branch: `claude/hopeful-hawking-s9i8uh`. Delete this file before the PR merges to `main`.

| Ticket | Title | Blocked by | Status | Claimed by |
| --- | --- | --- | --- | --- |
| #321 | 01 Retries, failure cap, durable timings, 30 s flag, fast-job timeout | none | merged to main (PR #341) | |
| #322 | 02 `?quality=`, `?render=off`, `__tt.renderOnce()` | none | merged to main (PR #341) | |
| #323 | 06 Smoke build | none | merged to main (PR #341) | |
| #324 | 19 Unit-test speed-up | none | merged to main (PR #341) | |
| #325 | 03 `openTwin` helper, first migration | #322 | merged to main (PR #341) | |
| #326 | 18 Rendering-budget guard | #322 | merged to main (PR #341) | |
| #327 | 08 Six balanced shards | #321, #323 | merged to main (PR #341) | |
| #328 | 04 Migrate remaining specs | #325 | merged to main (PR #341) | |
| #329 | 05 One page per worker | #328 | merged in branch (d66d065) | |
| #330 | 07 Groups, tags, selection script | #328 | merged in branch (c81dd49) | |
| #331 | 11 Headless scene, parity, vessel moves | #328 | merged in branch (67fdfde) | |
| #332 | 14 Component tests | #328 | merged in branch (10a14e3) | |
| #333 | 16 Engine fixtures to unit tests | #328 | merged in branch (35683a6) | |
| #334 | 17 Smallest fixture | #328 | merged in branch (a1fe7f9) | |
| #335 | 09 CI selection and triggers, red main opens an issue | #330, #327, #346 | merged in branch (6970177) | |
| #336 | 12 Yard moves | #331 | merged in branch (8d82563) | |
| #337 | 13 Equipment moves | #331 | merged in branch (3c9669b), partly done: GLB rig checks stay in smoke | |
| #338 | 15 Remaining component moves | #332 | merged in branch (7b90ecd) | |
| #339 | 10 Docs and review rules | #325, #335, #348 | merged in branch (c3c1093) | |
| #344 | 21 Smoke build as the local default | none | merged in branch (f170cab) | |
| #345 | 22 Asset viewer honours URL switches | none | merged in branch (0e0f5fd) | |
| #346 | 23 Shards balanced by recorded test time | none (blocks #335) | merged in branch (fa0ccaf) | |
| #347 | 24 bg.sh cleans up its process group | none | merged in branch (3adfcf9) | |
| #348 | 25 CI smoke per merge, frame-loop review rule, doc fixes | none (blocks #339) | merged in branch (7cafd11) | |
| #340 | 20 Final smoke run and timing report | all | in progress | session 3 implementer |

## Next steps

- Open PR for this phase: #349 (`claude/hopeful-hawking-s9i8uh` into `main`). Phase 1 (#321 to #328) merged to `main` in PR #341. Do not merge #349 until the phase is done; delete this file first and add `Closes #N` for each finished ticket.
- Merged in branch this phase: #330, #331, #348, #344, #345, #346, #332, #333, #334, #347, #335, #329, #339, #336, #337 (partial), #338, plus `main` (#343) at cb4047e. Label `merged-in-branch` set on all of them.
- CI after each merge (the #348 rule: start `pr-checks.yml` with workflow_dispatch on this branch, read the merged `SMOKE:` line before the next merge):
  - after #330: green (run 44932418994);
  - after #331 + #348: green, `SMOKE: 189 passed, 0 failed, 0 flaky` (run 44933311179);
  - after #344 + #345: green, `SMOKE: 187 passed, 0 failed, 2 flaky` (run 44936225573); shard test steps 3:45, 4:04, 1:07, 1:28, 2:00, 2:45 (count-based shards);
  - after #346: green, `SMOKE: 189 passed, 0 failed, 0 flaky` (run 44937334219); time-balanced shard test steps 2:19, 2:50, 2:15, 2:25, 2:48, 2:59 (within about 30 %), whole run 4 min 40 s;
  - after #332: green, `SMOKE: 185 passed, 0 failed, 0 flaky` (run 44938348036);
  - after #333: green, `SMOKE: 173 passed, 0 failed, 0 flaky` (run 44939175719);
  - after #334: green, `SMOKE: 173 passed, 0 failed, 0 flaky` (run 44940091330);
  - after #347: green, `SMOKE: 172 passed, 0 failed, 1 flaky` (run 44949388411);
  - after #335: green, `SMOKE: 173 passed, 0 failed, 0 flaky` (run 44950271579, auto shard count: 5 shards);
  - after #329: green, `SMOKE: 171 passed, 0 failed, 3 flaky` (run 44951105589);
  - after #339: green, `SMOKE: 173 passed, 0 failed, 1 flaky` (run 44951985194);
  - after #336: green, `SMOKE: 164 passed, 0 failed, 3 flaky` (run 44952922747);
  - after #337: RED, `SMOKE: 162 passed, 1 failed, 3 flaky` (run 44953776611): `gantry-alarm.smoke.ts:66` read the gain once mid camera ease; fixed in 81e9bae (poll), green `SMOKE: 163 passed, 0 failed, 3 flaky` (run 44954571390);
  - after #338: running.
- In progress: #340 (final full smoke run, fix the flakes below; ticket file in the session scratchpad). #338 merged with all 9 panels and the dashboard `fresh: true` fix.
- Flaky since #329 (found in runs 44951105589 and 44952922747): `terminal-twin-dashboard.smoke.ts:35` and `:220` (shared page keeps loaded chunks in Chromium's module map, so chunk counts read 0 and `route.abort` never fires; fix: `fresh: true`, sent with #338); `vessel-hulls.smoke.ts:45` (`vesselHulls.V001` undefined, maybe stale scene state); `terminal-twin-keyboard-camera.smoke.ts:20` (float noise in `toEqual` on a pose: use `toBeCloseTo`); `hero-equipment.smoke.ts:224` (`heroEquipment` 0, timing). #340 must end with these gone.
- #337 is partly done: SHC spawn yaw and gantry beacons moved to `tests/headless-scene-equipment.test.ts`; every other equipment check reads GLB rig state the headless scene does not build (it loads no GLBs in Node). Follow-up: load committed GLBs in Node (`GLTFLoader.parse` from disk) or expose per-crane spreader mode in `sceneState`, then move LOD, ropes, wheel roll, hero choice. Keep #337 open (no `Closes`) unless that lands.
- #335 owner tasks (no tool here can do them): create labels `smoke:core`, `smoke:shell`, `smoke:camera`, `smoke:setup`, `smoke:analysis`, `smoke:vessel`, `smoke:equipment`, `smoke:yard`, `smoke:engine` (colour 1d76db); make `Browser smoke tests (Terminal Twin)` a required check on `main`. GitHub checks still to do: a bay-viewer-only PR runs core + vessel with the comment, a docs-only PR passes as a no-op, the `smoke` label runs all groups, first push to `main` runs all groups (red-main issue via `node scripts/smoke-ci.mjs red-main --dry-run`).
- #329 notes: local shuffled run (`--shuffle 329`) 156 of 166 passed, all failures the sandbox proxy console error except one load-sensitive KPI export test that passed on re-run; shared page 37.8 s vs 45.0 s fresh on a 15-test sample; `SMOKE_FRESH_PAGES=1` turns it off; IndexedDB is not reset (saves spec uses a fresh page).
- Next: #340 last (full smoke locally twice and in CI, fix the flakes above, timing report on #320).
- At most two implementers at once (4-core box). Ticket files for implementers live in the session scratchpad (lost with the container): rewrite them from the issues (`docs/agents/issue-tracker.md`, Ticket bodies).
- #346 follow-up: `scripts/smoke-timings.jsonl` (fallback timings) is an estimate and still lists times for specs #333 deleted; CI uses the last green run's artifact first, so refresh the file from a green run's `smoke-report` when convenient.
- #332 note: the colour-by smoke wiring tests check console errors strictly, so they fail locally in the sandbox on `ERR_TUNNEL_CONNECTION_FAILED` (proxy blocks an external fetch); CI is the check.

## Open points

- Native GitHub issue dependencies cannot be set from cloud sessions; blockers are in each ticket's `## Blocked by` and `## Blocks` sections. Dependency summary comments on #320.
- #331 follow-ups: the headless scene does not load GLBs in Node, so `vessel-hulls.smoke.ts` (52 to 62 s) stays in the browser; bay viewer, bay plan switch and crane plan specs are DOM checks, candidates for #332/#338 component tests; some colour-by test titles still say "3D".
- #330 follow-ups: asc/shc/truck path patterns also add `engine`/`camera` for asset-only files (conservative); a group tag must sit on the same line as `test(`. The scene path (`sceneDriver`, `sceneState`, `useTwinScene`) was mapped to `all` at the #331 merge.
- Some hero and close-up specs call `setQuality` or `setAutoRung` after boot without a one-line reason comment (#328 partial miss).
- #327's "shards within about 30 %" criterion is not met; it moved to #346 (first run: 7.2, 4.6, 1.5, 2, 1.5, 1.6 min of test time).
- CI still sets `SMOKE_SERVER: build` explicitly; harmless after #344.

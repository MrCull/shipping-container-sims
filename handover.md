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
| #329 | 05 One page per worker | #328 | open | |
| #330 | 07 Groups, tags, selection script | #328 | merged in branch (c81dd49) | |
| #331 | 11 Headless scene, parity, vessel moves | #328 | merged in branch (67fdfde) | |
| #332 | 14 Component tests | #328 | in progress | session 3 implementer |
| #333 | 16 Engine fixtures to unit tests | #328 | open | |
| #334 | 17 Smallest fixture | #328 | open | |
| #335 | 09 CI selection and triggers, red main opens an issue | #330, #327, #346 | open | |
| #336 | 12 Yard moves | #331 | open | |
| #337 | 13 Equipment moves | #331 | open | |
| #338 | 15 Remaining component moves | #332 | open | |
| #339 | 10 Docs and review rules | #325, #335, #348 | open | |
| #344 | 21 Smoke build as the local default | none | merged in branch (f170cab) | |
| #345 | 22 Asset viewer honours URL switches | none | merged in branch (0e0f5fd) | |
| #346 | 23 Shards balanced by recorded test time | none (blocks #335) | merged in branch (fa0ccaf) | |
| #347 | 24 bg.sh cleans up its process group | none | open | |
| #348 | 25 CI smoke per merge, frame-loop review rule, doc fixes | none (blocks #339) | merged in branch (7cafd11) | |
| #340 | 20 Final smoke run and timing report | all | open | |

## Next steps

- Open PR for this phase: #349 (`claude/hopeful-hawking-s9i8uh` into `main`). Phase 1 (#321 to #328) merged to `main` in PR #341. Do not merge #349 until the phase is done; delete this file first and add `Closes #N` for each finished ticket.
- Merged in branch this phase: #330, #331, #348, #344, plus `main` (#343) at cb4047e. Labels `merged-in-branch` set on #330, #331, #348; **#344 still needs the label** (session stopped before it).
- CI after each merge (the #348 rule: start `pr-checks.yml` with workflow_dispatch on this branch, read the merged `SMOKE:` line before the next merge):
  - after #330: green (run 44932418994);
  - after #331 + #348: green, `SMOKE: 189 passed, 0 failed, 0 flaky` (run 44933311179);
  - after #344: **not run yet**. Start one first thing.
- **#345 is complete but not merged** (it reported after the session stopped): branch `tt/345-viewer-url-switches` (pushed to origin), tip 01f3934, worktree `.claude/worktrees/agent-a91b4af6722734e60`, verify green (2370 tests). Next session: `scripts/merge-ticket.sh --push tt/345-viewer-url-switches`, label #345 `merged-in-branch`, remove the worktree, start a CI run. Viewer calls live on `window.__ttAssets` (`renderOnce()`, `frames()`), not `__tt`, since the viewer has no `__tt`. Viewer smoke `SMOKE: 6 passed`; container viewer 224.1 s to 20.1 s, yard 51.1 s to 23.8 s, ASC/SHC/STS/truck viewers 6 to 15 s to 2 to 3 s each. The yard spec opts in to High so its budget frame keeps the shadow pass; budget unchanged (26 calls, 1,055,442 triangles).
- #344's worktree `.claude/worktrees/agent-a504b8c16b0f012fc` is merged; remove it with `scripts/remove-worktree.sh agent-a504b8c16b0f012fc`.
- PR #349 body lists #330, #331, #348; add #344 (smoke build is now the local default, `SMOKE_SERVER=dev` opts in to the Vite dev server; `scripts/test-smoke-server.mjs` 7 of 7; sample `SMOKE: 12 passed`) and the CI results above.
- Unblocked next, in order: #346 (time-balanced shards, best after #345), then #332, #333, #334, #347; #329 needs two full smoke runs, so run it when nothing else is testing. #346 must land before #335; #348 is done, so #339 waits only on #335.
- At most two implementers at once (4-core box). Ticket files for implementers were in the session scratchpad (lost with the container): rewrite them from the issues (`docs/agents/issue-tracker.md`, Ticket bodies).

## Open points

- Native GitHub issue dependencies cannot be set from cloud sessions; blockers are in each ticket's `## Blocked by` and `## Blocks` sections. Dependency summary comments on #320.
- #331 follow-ups: the headless scene does not load GLBs in Node, so `vessel-hulls.smoke.ts` (52 to 62 s) stays in the browser; bay viewer, bay plan switch and crane plan specs are DOM checks, candidates for #332/#338 component tests; some colour-by test titles still say "3D".
- #330 follow-ups: asc/shc/truck path patterns also add `engine`/`camera` for asset-only files (conservative); a group tag must sit on the same line as `test(`. The scene path (`sceneDriver`, `sceneState`, `useTwinScene`) was mapped to `all` at the #331 merge.
- Some hero and close-up specs call `setQuality` or `setAutoRung` after boot without a one-line reason comment (#328 partial miss).
- #327's "shards within about 30 %" criterion is not met; it moved to #346 (first run: 7.2, 4.6, 1.5, 2, 1.5, 1.6 min of test time).
- CI still sets `SMOKE_SERVER: build` explicitly; harmless after #344.

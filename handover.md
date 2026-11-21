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
| #332 | 14 Component tests | #328 | open | |
| #333 | 16 Engine fixtures to unit tests | #328 | open | |
| #334 | 17 Smallest fixture | #328 | open | |
| #335 | 09 CI selection and triggers, red main opens an issue | #330, #327, #346 | open | |
| #336 | 12 Yard moves | #331 | open | |
| #337 | 13 Equipment moves | #331 | open | |
| #338 | 15 Remaining component moves | #332 | open | |
| #339 | 10 Docs and review rules | #325, #335, #348 | open | |
| #344 | 21 Smoke build as the local default | none | in progress | implementer-344 |
| #345 | 22 Asset viewer honours URL switches | none | in progress | implementer-345 |
| #346 | 23 Shards balanced by recorded test time | none (blocks #335) | open | |
| #347 | 24 bg.sh cleans up its process group | none | open | |
| #348 | 25 CI smoke per merge, frame-loop review rule, doc fixes | none (blocks #339) | merged in branch (7cafd11) | |
| #340 | 20 Final smoke run and timing report | all | open | |

## Next steps

- Phase 1 (#321 to #328) merged to `main` in PR #341 (a28a9bc). This branch restarted from that merge.
- First full sharded CI run: `SMOKE: 190 passed, 0 failed, 1 flaky`, workflow 9 min 11 s. Shards are uneven (about 7, 4.6, 1.5, 2, 1.5, 1.6 min of tests): a few slow tests dominate.
- Unblocked next: #329, #332, #333, #334, and the retro tickets #344 to #348 (no blockers). Order: #348 and #344 first, #345 before #346, #346 before #335, #347 when a slot is free. At most two at a time; #329 needs two full smoke runs, so it runs when nothing else is testing.

## Open points

- Native GitHub issue dependencies cannot be set from cloud sessions; blockers are in each ticket's `## Blocked by` and `## Blocks` sections.
- The `?viewer=yard` asset viewer ignores `?quality=` and `?render=`, so its 18,000-box test (container-assets) still draws every frame, about 259 s. Fold into #334 or a small follow-up.
- Some hero and close-up specs call `setQuality` or `setAutoRung` after boot without a one-line reason comment (#328 partial miss).
- One test was flaky in run 44929542332; the merged smoke report artifact names it.
- #327's "shards within about 30 %" criterion is not met yet; re-measure after #329 and #334.

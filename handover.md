# Handover: spec #320, fast CI

Integration branch: `claude/hopeful-hawking-s9i8uh`. Delete this file before the PR merges to `main`.

| Ticket | Title | Blocked by | Status | Claimed by |
| --- | --- | --- | --- | --- |
| #321 | 01 Retries, failure cap, durable timings, 30 s flag, fast-job timeout | none | merged in branch (1741e27) | |
| #322 | 02 `?quality=`, `?render=off`, `__tt.renderOnce()` | none | in progress | implementer (tt/322-url-switches) |
| #323 | 06 Smoke build | none | open | |
| #324 | 19 Unit-test speed-up | none | open | |
| #325 | 03 `openTwin` helper, first migration | #322 | open | |
| #326 | 18 Rendering-budget guard | #322 | open | |
| #327 | 08 Six balanced shards | #321, #323 | open | |
| #328 | 04 Migrate remaining specs | #325 | open | |
| #329 | 05 One page per worker | #328 | open | |
| #330 | 07 Groups, tags, selection script | #328 | open | |
| #331 | 11 Headless scene, parity, vessel moves | #328 | open | |
| #332 | 14 Component tests | #328 | open | |
| #333 | 16 Engine fixtures to unit tests | #328 | open | |
| #334 | 17 Smallest fixture | #328 | open | |
| #335 | 09 CI selection and triggers, red main opens an issue | #330, #327 | open | |
| #336 | 12 Yard moves | #331 | open | |
| #337 | 13 Equipment moves | #331 | open | |
| #338 | 15 Remaining component moves | #332 | open | |
| #339 | 10 Docs and review rules | #325, #335 | open | |
| #340 | 20 Final smoke run and timing report | all | open | |

## Next steps

- Frontier now: #321, #322 running (at most two implementers at once); #323, #324 next.

## Open points

- Native GitHub issue dependencies cannot be set from cloud sessions; blockers are in each ticket's `## Blocked by` and `## Blocks` sections.

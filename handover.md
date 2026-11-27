# Handover: per-sim test scoping (#375) and Yardshift phase 1 (#374)

Branch: `claude/modest-heisenberg-0sesmy` (PR #376). Delete this file before merging.

Spec and ticket bodies: `/tmp/claude-0/-home-user-shipping-container-sims/10ca5d08-595a-56c1-8fa5-b7344d6b5ae1/scratchpad/spec-<n>.md` and `/tmp/claude-0/-home-user-shipping-container-sims/10ca5d08-595a-56c1-8fa5-b7344d6b5ae1/scratchpad/tickets/ticket-<n>.md` (scratchpad; re-fetch from GitHub if
the container was replaced). Ticket branches are `tt/<N>-<slug>`, merged with `scripts/merge-ticket.sh`.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #377 | Per-sim vitest projects and test:sim | none | merged in branch (bf5c7e4) | |
| #378 | Smoke selection anchoring, home-wall only | none | merged in branch (b9c62f0) | |
| #379 | Scoped verify and verify:all | #377 | merged in branch (c7830c6) | |
| #380 | CI unit tests use the selection | #379 | merged in branch (4ad3c15) | |
| #381 | Y1 tracer: tutorial won by taps | #377 | merged in branch (47105c7) | |
| #382 | Y2 13 levels, heavy rule, solver | #381 | in progress | session 1 |
| #383 | Y3 clocks, overtime, crane animation | #381 | in progress | session 1 |
| #384 | Y4 incoming trucks and receipts | #382, #383 | open | |
| #385 | Y5 score, combo, queue colours, bonus | #383 | open | |
| #386 | Y6 progress, picker, results, undo | #384, #385 | open | |
| #387 | Y7 drag, keyboard, urgency, coaching | #384 | open | |
| #388 | Y8 audio cues and crane sounds | #384, #385 | open | |
| #389 | Y9 phone layout, cover, sim guide | #386, #387 | open | |
| #390 | Y10 background music | #388 | open | |
| #391 | Y11 smoke suite and regressions | all | open | |

## Open points

- V20 unlocks levels 1 to 4 and `?test` unlocks all in any build; the spec wins (level 1 only, `?unlock=all` in dev and smoke builds).
- box-empire and container-stack have no unit tests, so they are not vitest projects (`simIdsWithTests()` in `scripts/vitest-projects.mjs`).
- Implementers run `pnpm run verify <integration-branch>`: with no base, verify compares with `origin/main` and covers the whole branch.
- Y1 seam: `input(ui, event, state)` takes state as a third argument (needed to tell a collect tap from a select tap); `window.__ys.hitRegions()` gives page coordinates for smoke taps. PR needs `smoke:yardshift`.

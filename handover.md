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
| #382 | Y2 13 levels, heavy rule, solver | #381 | merged in branch (99f4614) | |
| #383 | Y3 clocks, overtime, crane animation | #381 | merged in branch (b8c8648) | |
| #384 | Y4 incoming trucks and receipts | #382, #383 | merged in branch (3598431) | |
| #385 | Y5 score, combo, queue colours, bonus | #383 | merged in branch (3436249) | |
| #386 | Y6 progress, picker, results, undo | #384, #385 | merged in branch (dbbcd25) | |
| #387 | Y7 drag, keyboard, urgency, coaching | #384 | merged in branch (9d56b4f) | |
| #388 | Y8 audio cues and crane sounds | #384, #385 | merged in branch (c2454ec) | |
| #389 | Y9 phone layout, cover, sim guide | #386, #387 | in progress | session 1 |
| #390 | Y10 background music | #388 | merged in branch (0d739ef) | |
| #391 | Y11 smoke suite and regressions | all | open | |

## Open points

- V20 unlocks levels 1 to 4 and `?test` unlocks all in any build; the spec wins (level 1 only, `?unlock=all` in dev and smoke builds).
- box-empire and container-stack have no unit tests, so they are not vitest projects (`simIdsWithTests()` in `scripts/vitest-projects.mjs`).
- Implementers run `pnpm run verify <integration-branch>`: with no base, verify compares with `origin/main` and covers the whole branch.
- Y1 seam: `input(ui, event, state)` takes state as a third argument (needed to tell a collect tap from a select tap); `window.__ys.hitRegions()` gives page coordinates for smoke taps. PR needs `smoke:yardshift`.
- #382 put receipt rules in the engine early (solver needs them): levels 4, 6, 8, 9, 10, 13 start with a waiting truck the UI cannot serve until #384. Tutorial fixture rehandles #4 before collecting #1 (optimal, not the coached order).
- #383: intro and player pause are in the engine but unused until #386 modals; receipts have no crane animation yet (#384); the gantry beam runs past the left edge at 390 px (phase 2 visual).
- #384: arrival announcement does not pause clocks (spec allows either); tutorial smoke spec runs 10 to 11.6 s, over its 10 s target (Y11 to trim).
- #387: U emits `{type: "undo"}` (`UiAction` in types/presentation.ts); until #386 the store shows "Undo is not available yet". #386 must wire the store `undo()` to `dispatch`. No drag or keyboard smoke spec yet (Y11 may add one).
- #386: undo also allowed after a "Yard blocked" failure (V20), never after timeout; a hidden tab freezes clocks but does not open the pause menu; tutorial smoke spec now 10.5 to 11.1 s.
- #388: no sound was listened to in a browser (owner checks audio quality in the phase 2 playtest); added overtime-end and undo cues not in V20.
- #390 added a fourth smoke spec (yardshift-music.smoke.ts); the spec says exactly three, so the review fix folds it into a unit test or an existing spec. Music licence: available-media records none (same as other sims); owner to confirm before a public release.

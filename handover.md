# Handover: spec #116 (Terminal Twin polish)

**Work halted (out of credits). All 16 tickets are built and merged; only the code-review fixes and the PR wrap-up remain.**

Integration branch: `claude/zen-galileo-tp4owk` ([PR #132](https://github.com/MrCull/shipping-container-sims/pull/132)), pushed and level with the remote; its CI (lint, build, unit tests) is green. Orchestration steps: `docs/agents/implementing.md`.
Progress view: tickets merged into the branch carry the issue label `merged-in-branch` (issues close only when PR #132 merges). #117–#133 all have it.
The scratchpad (`/tmp/claude-0/.../scratchpad/`, holds `spec-116.md` and `ticket-<n>.md`) exists only in the old container: a new session re-fetches them from GitHub issues #116–#133.

## What is left (in order)

1. **Finish the review fixes.** Commit `ed87a71` is already on the integration branch (fast-forwarded and pushed so it is not lost; it was never run through `pnpm run verify` locally). **Check PR #132's CI on the latest head first**: if "Lint, build and test" is red, fix that before anything else; if green, still run `pnpm run verify` once. It covers findings 1, 2, 3 and 5; finding 4 is still to do:
   1. Plates: each ISO type group gets its own plate row [A], and a type without a row shows no weights (it used to fall back to the dry G1 plate). Done in `ed87a71`.
   2. Check digit: markings use the id's own ISO 6346 check digit. Done in `ed87a71`.
   3. Palette drift guard test for `DATA_PALETTE` and `RAMP_PALETTE` in `colourBy.ts` against `skin.css`. Done in `ed87a71`.
   4. **Not started:** the vessel countdown label disappears at berthing (`berthedAt`), but the ticket says once operations start (first work). Check `modules/vesselCountdownLabels.ts` and `modules/vesselStatus.ts`; key it to the first move and update the unit and smoke spec (`terminal-twin-vessel-status`).
   5. Audio popover themed for the light Terminal Twin page (`--audio-popover-*` variables overridden in `skin.css`; other sims unchanged). Done in `ed87a71`.
2. Commit any follow-up on the integration branch directly (no ticket branch needed now). Run `scripts/smoke-specs-for.sh origin/main HEAD` only if finding 4 changes the countdown, and run that one spec (`pnpm run test:smoke --project=dev terminal-twin-vessel-status`).
3. Delete this file (`handover.md`), push, mark PR #132 ready for review (not draft). The PR body must say `Closes #116` and `Closes #117` … `Closes #133` (GitHub closes only those listed).
4. Remove the leftover worktrees: `scripts/remove-worktree.sh <agent-id>` for each under `.claude/worktrees/` (or `git worktree remove`).
5. Optional: a final full `pnpm run test:smoke --project dev --grep-invert @load` on an idle machine if the fixes touch UI (the #133 run passed 135 of 136 before them).

## Decisions for the user

- **North Quay position:** it is placed at +x, but +x is south in the scenery axes and the reference photo has the quay at the north end (#123).
- **`shc-paired-dual-cycle` fixture seed** changed from 42 to 48 in #131, because its paired-beats-chained result depended on the plan.
- **Outer 3D hull skin** is unchanged (the V shows in the bay viewer and the hold liner only); it needs Blender `bpy`, which is not installed in the container (#131).
- **Text wordmarks** KALMAR, TTI ALGECIRAS and ZPMC are on the SHC, STS and ASC models (text only, no logos). Keep or drop?
- **Rock** does not show from the Quay and Overview camera presets (#120).
- **Volume slider** only affects Terminal Twin; the other sims honour the shared mute but not the level (#118).
- **`special` colour mode** can only show reefer or standard: the sim has no hazardous or out-of-gauge boxes (#130).
- **SUPER HEAVY** on container faces keys off the HEAVY weight class, and the line name uses the livery text colour (#119).
- **Not verified:** the sounds were never listened to, no perf reading of audio cost, the truck wing guards barely show and have no in-app screenshot, the colour-by frame-time proof is a unit check only.
- **Peak-day waterside** (#117): diagnosed, no engine change. Possible follow-ups: let a vessel that fits overtake the anchorage queue, fetch load boxes earlier, leave a bay gap at crane-split boundaries.
- **Smell-level review findings left alone** (refactor risk this late): shared `AudioControls`/`SimPage.vue` edits for a Terminal Twin feature, scenery duplication between `backdrop.ts` and `terminals/tti-algeciras/scenery.ts`, LOD parameters travelling together, files edited for several tickets.

## Gotchas

- `golden-update.test.ts`, `invariants-incremental.test.ts` and the `@load` perf spec time out or fail under load: re-run alone before calling them real. `@load` never runs in CI.
- Load-sensitive smoke specs: `terminal-twin.smoke` "Run to… popup", `terminal-twin-debugger` follow camera, `terminal-twin-kpi` end condition, `container-closeup` (pinned to high quality now). They passed on an idle machine.
- A container restart killed background runs twice; re-run checks by hand and push.
- Reference photos exist only in the old container (`docs/reference/tti-algeciras/`, git-ignored): a new session needs `tti1.zip` re-uploaded for any further model work.
- Smoke runs once per spec, as its last ticket (#133), not per merge (`implementing.md`); `merge-ticket.sh --smoke` or `--smoke-all` stay available.
- After a merge by hand (conflict), the script's auto-push does not run: push yourself once `pnpm run verify` is green.

# Handover: spec #116 (Terminal Twin polish)

Integration branch: `claude/zen-galileo-tp4owk` (PR #132, ready for review once the tickets land; the PR body must say `Closes #116` and every finished ticket). Orchestration steps: `docs/agents/implementing.md`.
Scratchpad (this container only): `/tmp/claude-0/-home-user-shipping-container-sims/7cb06fff-bd34-5157-967c-2d516a65c2e7/scratchpad/` holds `spec-116.md` and `ticket-<n>.md`. A new session re-fetches them from GitHub issues #116–#131.

## State when work was halted

| Ticket | Blocked by | Status |
|---|---|---|
| #117 throughput | none | merged, pushed (diagnosis only; no engine change) |
| #118 volume + FPS | none | merged, pushed |
| #119 close-up containers | none | merged, pushed |
| #121 SHC model | none | merged and pushed (`155fc54`). Verified by lint, build, 1265 unit tests and the SHC smoke specs (`shc-model`, `terminal-twin-shc`: 8 of 8 pass; the LOD spec timed out once under load and passed alone in 38 s). The generic smoke run was stopped at 67 passed, 0 failed, by decision. The steering spec's window was widened 6 s to 14 s and not compared with the base |
| #120 folder + Rock | none | merged, pushed (conflict in `scene-quality-atmosphere.md` resolved by keeping both sides). Follow-up: Rock not visible from the Quay and Overview cameras |
| #125 gantry alarm | #118 | merged, pushed. Smoke: `terminal-twin.smoke` "Run to… popup" fails under load (also on the commit before #125), passes when quiet |
| #122 skin + landing | #118 | NOT merged: `terminal-twin-debugger` "follow camera tracks a moving SHC smoothly" fails after it (camera jump 44 m vs 40 m limit, quiet machine; passes on 76890a9). Agent a355271 was asked to find the per-frame cost (likely `backdrop-filter` blur) and fix the skin. Merge it FIRST: `tt/123` and `tt/129` were built on its merge (eb45ad3) and carry its commits |
| #123 surroundings | #120 | built, awaiting merge: `tt/123-algeciras-surroundings` (e8383be). Open question: North Quay is at +x but +x is south in the scenery axes and the photo shows the quay at the north end |
| #124 STS model | #121 | built, awaiting merge: `tt/124-sts-crane-model` (1b86326). Follow-up: move #125's STS beacon offsets onto the model's `beaconMounts` |
| #126 vessel countdown | #122 | not started |
| #127 paired bays | #122 | not started |
| #128 ASC + truck | #124 | not started |
| #129 sounds rest | #125 | implementer running (`tt/129-positional-sounds`) |
| #130 colour by + hide ROB | #122, #127 | not started |
| #131 V holds | #117, #127 | not started |

Merge order: #122 (after its fix), then #124, #123, #129. Then start the newly unblocked tickets (#123, #124, #129, then #126/#127 and onward), at most three agents at a time.

## Open decisions for the user

- SHC model carries KALMAR and TTI ALGECIRAS text wordmarks (#121): keep or drop?
- #120: the Rock does not show from the Quay and Overview camera presets. Follow-up.
- #117 follow-ups (modelling choices, not defects): let a vessel that fits overtake the head of the anchorage queue; fetch load boxes earlier; leave a bay gap at crane-split boundaries.
- #125: beacon lamp positions are approximate for the GLB models; check once the close-up models land.
- #119: the line name on the container face uses the livery text colour; SUPER HEAVY shows for the HEAVY weight class. Say if either should change.

## Gotchas seen this run

- `golden-update.test.ts`, `invariants-incremental.test.ts` and the `@load` perf spec ("Auto steps quality down under sustained load") time out or fail under load. Re-run them alone before calling them real. The `@load` spec never runs in CI.
- A container restart killed one `merge-ticket.sh` run mid-smoke. The merge commits stayed local: re-run verify and smoke by hand, then push.
- Reference photos exist only in this container at `/home/user/shipping-container-sims/docs/reference/tti-algeciras/` (git-ignored). A new session needs `tti1.zip` re-uploaded; briefs must name that absolute path. See `docs/reference/README.md`.
- Worktrees for #117 and #121 (and #122, #125 while their agents live) are locked; remove them later with `scripts/remove-worktree.sh`.
- `.merge-ticket.log` is the merge script's log; its last line is `EXIT <code>`.

## Test speed-up (done, unreleased until pushed)

- `scripts/merge-ticket.sh` now runs only the smoke specs for the paths a merge changed (`scripts/smoke-specs-for.sh`, map in `scripts/smoke-map.txt`). `--smoke-all` runs the whole suite (about 40 minutes on a quiet 4-core machine). Check the map names the specs a new ticket adds.
- `implementing.md`: implementers run lint, build, their own unit tests and the specs listed for their diff, not the whole suite; concurrency is two implementers plus one merge.
- Still open: `golden-update` and `invariants-incremental` time out under load on the per-merge path (retro item 3), and the `hud` smoke spec costs about 6 minutes (item 5).

## Resume steps

1. `git fetch`, read the `handover.md` diff, `pnpm install`.
2. Merge #120, #125, #122 with `scripts/merge-ticket.sh --push <branch>` in the background.
3. Start newly unblocked tickets; keep to three agents.
4. When all tickets are in: `/code-review` the branch, fix findings in one implementer, mark PR #132 ready, remove worktrees, delete this file.

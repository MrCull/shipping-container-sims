# Handover: spec #116 (Terminal Twin polish)

Integration branch: `claude/zen-galileo-tp4owk` (PR #132, ready for review once the tickets land; the PR body must say `Closes #116` and every finished ticket). Orchestration steps: `docs/agents/implementing.md`.
Scratchpad (this container only): `/tmp/claude-0/-home-user-shipping-container-sims/7cb06fff-bd34-5157-967c-2d516a65c2e7/scratchpad/` holds `spec-116.md` and `ticket-<n>.md`. A new session re-fetches them from GitHub issues #116–#131.

## State when work was halted

| Ticket | Blocked by | Status |
|---|---|---|
| #117 throughput | none | merged, pushed (diagnosis only; no engine change) |
| #118 volume + FPS | none | merged, pushed |
| #119 close-up containers | none | merged, pushed |
| #121 SHC model | none | `tt/121-shc-model` (04a7731): merged locally as `155fc54`; `scripts/merge-ticket.sh --push` was **still running** (52 smoke specs passed, none failed, no `EXIT` yet), so **not yet pushed**. Check `.merge-ticket.log`: `EXIT 0` means it pushed. Otherwise the 3 local commits need `pnpm run verify` and the smoke specs re-run by hand, then `git push` |
| #120 folder + Rock | none | built, awaiting merge: `tt/120-terminal-folder-rock` (c05ed2d) |
| #125 gantry alarm | #118 | built, awaiting merge: `tt/125-gantry-alarm` (5c85877) |
| #122 skin + landing | #118 | implementer was still running, had not reported: `tt/122-professional-skin` has commits, tip `e83cda6` (worktree `agent-a355271414bb882d0`, locked). Its verify result is unknown |
| #123 surroundings | #120 | not started |
| #124 STS model | #121 | not started |
| #126 vessel countdown | #122 | not started |
| #127 paired bays | #122 | not started |
| #128 ASC + truck | #124 | not started |
| #129 sounds rest | #125 | not started |
| #130 colour by + hide ROB | #122, #127 | not started |
| #131 V holds | #117, #127 | not started |

Merge order: #121 (finish or redo), #120, #125, then #122 once it reports. Then start the newly unblocked tickets (#123, #124, #129, then #126/#127 and onward), at most three agents at a time.

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

## Planned, NOT done: speed up per-merge testing

Agreed with the user ("yeah go for it"). Do it after the current merge finishes, then update this section to say done:

- Make `scripts/merge-ticket.sh` run only the unit tests and smoke specs for the paths a merge touches. Run the full suite once at the end of the spec, or in the PR's CI.
- Move the load-sensitive tests (`golden-update`, `invariants-incremental`) off the per-merge path or shrink them. Keep `@load` specs out of local merges.
- Tell implementers to run only their own tests and lint.
- Cap concurrency at two agents plus one merge.
- Keep lint, typecheck, build, goldens, invariants and `scripts/check-tracked-files.mjs`.

## Resume steps

1. `git fetch`, read the `handover.md` diff, `pnpm install`.
2. Check `.merge-ticket.log` for #121 (see the table), then merge #120, #125, #122 with `scripts/merge-ticket.sh --push <branch>` in the background.
3. Start newly unblocked tickets; keep to three agents.
4. When all tickets are in: `/code-review` the branch, fix findings in one implementer, mark PR #132 ready, remove worktrees, delete this file.

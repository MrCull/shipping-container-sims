# Implementing a spec with subagents

For the orchestrator running `/implement-spec`, and the brief each **implementer** subagent receives. Terminal Twin (spec #24, tickets #25–#52) was built this way.

## Orchestrator

`handover.md` is a per-run tracking file at the repo root, not a permanent doc: create it when a run may span sessions (a ticket table with a Claimed by column, the next steps, open points), keep it current after every merge, and delete it before the PR merges to `main`. Terminal Twin's last version is in git history (`git log --diff-filter=D -- handover.md`).

0. **Push the branch.** Before spawning anything, `git push -u origin <integration-branch>` even when it equals `main`; without a remote branch the stop hook counts every commit as unpushed.
1. **Resume first.** Another session may have pushed. `git fetch`, read `git log HEAD..origin/<integration-branch>` and the `handover.md` diff, pull, `pnpm install`, then work from the merged state. Claim a ticket in `handover.md` (commit and push) before starting it.
2. **Frontier.** Read the spec once (it can be 30 KB) into a scratchpad file `spec-<n>.md`, save each ticket body beside it, and re-read those files, not the issue, after a compaction. Name their paths in the brief: implementers have no GitHub access. Check that every file a ticket's brief names under `docs/reference/` exists (see `docs/reference/README.md`); if not, ask the user to re-upload before spawning. Worktrees do not contain these git-ignored files, so name the main checkout's absolute path in the brief. Start one implementer per unblocked ticket, in its own worktree (`isolation: worktree`) on `tt/<issue>-<slug>`, in the background. Keep to at most three running at once, counting any still running while you merge: each worktree carries its own `node_modules`, builds and browser artefacts, and the container's disk is shared.
3. **Merge.** When one reports, run `scripts/merge-ticket.sh --push tt/<N>-<slug>` (in the background; it logs to `.merge-ticket.log`, whose last line is `EXIT <code>` when done): it merges the branch, stops on a conflict, runs `pnpm run verify` (which also fails on leftover conflict markers), and runs the smoke specs when the merge touches UI code. Keep both sides of additive conflicts (decision-point registries, fixture lists, guide sections), then `git add`, commit and re-run verify. Update the `handover.md` table, push, then free the disk with `scripts/remove-worktree.sh <agent-id>`.
4. **Warn.** A ticket that changes the engine contract (decision-point shapes, event payloads, `ENGINE_VERSION`) gets a `SendMessage` to the agents still running so they merge the tip early. Each such ticket takes the next minor above the tip's `ENGINE_VERSION` when it merges the tip before reporting; the orchestrator resolves collisions by keeping the highest. `scripts/merge-ticket.sh` runs `scripts/check-engine-version.sh`, which fails when a merge lowers the version.
5. **Rate limits** end agents mid-ticket with work uncommitted. Resume the same agent with `SendMessage` after the reset rather than starting a new one; its worktree keeps the work.
6. **Finish.** `/code-review` the integration branch, fix the findings in one implementer, and make the PR body say `Closes #<n>` for the spec and every ticket the branch finishes (GitHub closes only those on merge), mark the draft PR ready (a spec that asks for one PR per slice while the session may push only the integration branch gets one PR; tell the user), remove the remaining worktrees with `scripts/remove-worktree.sh`, delete `handover.md`.

## Implementer brief

- **Read first:** the spec and ticket files named in your brief, the sim guide and `GLOSSARY.md`, and the notes the earlier tickets left (`handover.md`, the sim guide's topic docs).
- **Base:** `git merge-base --is-ancestor <integration-branch> HEAD`; if not, `git reset --hard <integration-branch>`. Then `git checkout -b tt/<N>-<slug>`.
- **Build test-first** with the `tdd` skill, through the public seams the spec names (engine API, decision-point handlers, `window.__tt`, asset outputs). Meet every acceptance criterion; say exactly why if one is impossible here.
- **Prove it:** `pnpm run verify`; UI tickets also a screenshot you look at, and `pnpm run test:smoke` for every spec that goes through what you changed, not only the specs you edited: grep `tests/browser/` for the test ids, labels and helpers (`scenarioPicker.ts`) of the UI you touched. Moving a shared control (the setup dialog, the scenario picker) breaks specs elsewhere.
- **Commit early**, as soon as verify passes, and again at the end. An implementer that stops (rate limit, disk) with uncommitted work costs a full re-triage. Do not push and do not touch GitHub; the orchestrator does that.
- **Before reporting:** merge the current integration tip, re-run `pnpm run verify`, update the sim guide and `GLOSSARY.md` for what you added.
- **Report** (at most 12 lines): branch, tip SHA, worktree path, verify result, unmet criteria and follow-ups.

## Gotchas no check enforces

- Run anything longer than about a minute in the background with its output in a log file. A foreground command past the tool timeout leaves no output.
- Each `pnpm run test:smoke` picks free ports itself (`playwright.config.ts`), so parallel agents never share one; leave `SMOKE_DEV_PORT` and `SMOKE_PROD_PORT` unset. Stop only processes you started, with `kill <pid>`; never `pkill -f` or `fuser -k`.
- Disk is shared: a worktree with `node_modules` is about 1.2 GB. Implementers delete their worktree's `node_modules`, `.smoke-dist` and `.smoke-results` before reporting; the orchestrator removes the worktree after the merge. Remove worktrees with `git worktree remove` (never a blanket `rm -rf`, which the permission classifier blocks).
- Vitest's timeout is 60 s (`vitest.config.ts`), so `pnpm run verify` runs green on a busy machine; a timeout failure there is a real hang once it reproduces alone (`invariants-incremental.test.ts` has timed out under three parallel agents and passed alone).
- Regenerate goldens only on purpose (`UPDATE_GOLDEN=1 pnpm test`) and say why in the commit. A golden holds an event-log hash, so two tickets that both regenerate the same golden always conflict: resolve by regenerating on the merged tree (`merge-ticket.sh` says how), never by hand. When planning tickets, give a change that moves every golden (a default flip) a ticket of its own, blocked by the tickets whose behaviour it turns on, instead of running such tickets in parallel.
- Never commit `.blend` files or reference photos.

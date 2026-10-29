# Terminal Twin — implementation handover

Handover for the agent continuing the Terminal Twin build (the `/implement-spec` workflow). Delete this file before the PR merges to `main`.

## On resume (read first)

Another session may have pushed while you were stopped. Two sessions once built the same tickets in parallel. Before you spawn, resume or message any agent:

1. `git fetch origin claude/fervent-dijkstra-cmzk4u` and `git log HEAD..origin/claude/fervent-dijkstra-cmzk4u`.
2. Read what changed: `git diff HEAD...origin/claude/fervent-dijkstra-cmzk4u -- handover.md`, then the commit list.
3. Pull (`git pull --ff-only`), run `npm install`, and compare the status table below with the merged tickets. Work from the merged state.
4. Tell every agent you resume or start to do the same: fetch the branch, read this file's diff and the new commits, and merge the tip before carrying on.
5. Claim a ticket before you start it: put your session in the Claimed by column, commit and push this file. Skip tickets another session has claimed or merged.

## Known engine bug (open)

Small preset at 50% fill (and a few other seeds/layouts) deadlocks: both ASCs of a twin block sit idle with retrieve/rehandle jobs open, `planJob` returns null and `resolveDispatch` does not retry. Repro is in the sim guide (TT-15 section). Presets use 30% fill for Small. Owner: TT-08/TT-12 code (`engine/subsystems/asc.ts`). Fix in the review pass if not earlier.

## Where things are

- **Spec:** MrCull/shipping-container-sims#24. **Tickets:** #25–#52 (each has `## Blocked by`).
- **Integration branch:** `claude/fervent-dijkstra-cmzk4u`. **Draft PR:** #54. It closes #24–#52 and stays a draft until every ticket is in and the code review is done.
- **Sim code:** `src/sims/terminal-twin/`. **Sim guide:** `src/sims/terminal-twin/terminal-twin-AGENTS.md` (read first; has "How to prove a change works" and "Extending"). **Ticket notes:** `src/sims/terminal-twin/ticket-notes.md`. **Glossary:** `GLOSSARY.md`. **Reference packs (not committed):** `docs/reference/`.
- **Checks:** `npm run verify` (lint, build, Vitest; 4 old box-empire lint warnings are expected). `npm run test:smoke` is the Playwright suite; CI runs it as an advisory job.

## Ticket status

Updated 2026-10-28. Merged: #25–#51. Remaining: #52, then the code-review pass. Open tickets are not yet commented or closed on GitHub; resolve them (comment, then close) when PR #54 is marked ready.

| Ticket | Issue | State | Claimed by |
|---|---|---|---|
| TT-13 landside | #45 | MERGED | |
| TT-14 yard start modes | #46 | MERGED | |
| TT-26 truck/chassis models | #47 | MERGED | |
| TT-15 presets/layout | #48 | MERGED | |
| TT-17 persistence | #49 | MERGED | |
| TT-19 performance | #50 | MERGED (real-GPU fps still to be read: key P overlay, record in guide) | |
| TT-21 atmosphere/polish | #51 | MERGED | |
| TT-28 infrastructure models | #52 | in progress | session_0155BNjwYFnoWyKFHuSZhUEE |

Obsolete: the first session's worktrees under `.claude/worktrees/agent-*` (local to its container; its tickets were merged or redone as `-v2` branches). Remove them at the end with `git worktree remove --force`.

### Dependency graph (ticket ← blockers)

```
45←39,43  46←43,45  47←32,45
48←46  49←48  50←48  51←48  52←32,45,51
```

Frontier: #45. Then #46 and #47; then #48; then #49, #50, #51; then #52.

## Process

1. **Concurrency: at most 3 implementers at once.** Six at once hit the 5-hour usage limit three times and left half-done work. Blender and smoke runs share the CPU, so more agents also run slower.
2. One implementer per frontier ticket, each in its own worktree (`isolation: worktree`) on `tt/<issue>-<slug>`, in the background, given the brief below plus the ticket number.
3. When it reports, merge its branch into the integration branch, run `npm run verify`, update the status table, commit and push. Most merges fast-forward, because the implementer merges the tip first.
4. A ticket that lands with breaking engine changes: message the running agents so they merge the tip early.
5. Duplicate or empty hand-backs: stop the agent with `TaskStop` at once; each repeat costs context.
6. Near the session's usage limit, spawn no new agents. Finish and merge what exists, and update this file.
7. When every ticket is in: run the `code-review` skill, fix the findings in one pass, fix any stale smoke tests (below), mark PR #54 ready, resolve the tickets, remove the worktrees.

### Implementer brief (give this to each subagent)

- **Read first:** issue #24, the ticket issue, the sim guide, `ticket-notes.md` sections for the tickets you depend on, and `GLOSSARY.md`. If the GitHub MCP server fails, read issues with `gh api repos/MrCull/shipping-container-sims/issues/<n>`.
- **Resume check:** if you are resumed or start late, `git fetch origin claude/fervent-dijkstra-cmzk4u`, read the new commits and the `handover.md` diff, and merge the tip before carrying on.
- **Branch:** confirm the worktree is based on the integration tip, then create `tt/<N>-<slug>`.
- **Build:** `npm install`, then call the `tdd` skill and build test-first through the public seams: the engine API, decision-point handlers, the browser dev API `window.__tt`, and asset outputs.
- **Isolation:** keep everything inside `src/sims/terminal-twin/`. Update the sim guide and glossary, and add a `### ticket-<N>` section to `ticket-notes.md` (only what later tickets need).
- **Verify:** `npm run verify` must pass. UI tickets also run `SMOKE_DEV_PORT=$((5200+RANDOM%500)) SMOKE_PROD_PORT=$((5800+RANDOM%500)) npm run test:smoke > <unique-file> 2>&1` (it is slow; wait for completion) and check `npm run screenshot -- --path /sim/terminal-twin`.
- **Worktree hygiene:** unique names for scratch files (agents share the scratchpad); one command per shell call.
- **Commits:** commit early with the session's attribution trailer. Don't push and don't touch issues; the orchestrator does that.
- **Report once, at most 25 lines:** branch, final commit, verify result, problems. Stop background jobs first. Notes for later tickets go in `ticket-notes.md`, not in the report.

### Standing rules

- **UI text:** all of it goes through the message catalogue (`src/sims/terminal-twin/i18n/`) and the shared formatter. A Vitest check fails on hard-coded strings in `.vue` files.
- **Hotkey:** `useGodModeHotkey` is banned in Terminal Twin by an ESLint rule (clashes with D/O).
- **Smoke specs:** `tests/browser/*.smoke.ts`; prod-only specs are `*.prod.smoke.ts`.
- **Goldens:** regenerate only on purpose (`UPDATE_GOLDEN=1 npm test` or `npm run tt:golden -- --update`), and say why in the commit.
- **Assets:** never commit `.blend` files or reference photos. `npm run tt:assets -- --python <bpy python>` regenerates GLBs (needs `pip install bpy`). The CI budget check reads only committed GLBs and sidecars.
- **Reference pack:** the TTI Algeciras pack is not in the repo. Look in `docs/reference/`; if empty, ask the user. The spec (#24) carries the key figures.
- **After a merge:** the checkout needs `npm install` before `npm run verify` (verify tells you if it is missing).

## Open follow-ups

- **Failing/flaky smoke tests (fix in the final review pass):** `terminal-twin-debugger.smoke.ts` "clicking a container in 3D selects it" fails at the final empty-sky click; `container-assets.smoke.ts` 18k-yard budget sees 26 draw calls vs limit 20 (cause unconfirmed, possibly SHC models); the ×600 frame-count test is load-flaky.
- **SHC cornering:** SHCs stop at every turn instead of cornering at speed.
- **WTP pad choice:** part of the `shcDispatch` reply; no separate decision point.
- **Container orientation:** position plus optional yaw only.
- **Frame rate:** an 18k-box yard is unconfirmed on real GPU hardware (TT-19).
- **Invariant cost:** invariants scan the whole state after every event. Revisit in TT-19.
- **Date pickers:** `datetime-local` inputs show the browser locale, not the chosen one.
- **Not done from the retro:** the per-ticket split of the sim guide to cut merge conflicts, and a per-kind renderer registry in `sceneRenderer.ts`/`devApi.ts`/`twinStore.ts` (hub files that conflict on most merges). `tests/equipment-kinds.test.ts` guards kind registration meanwhile.

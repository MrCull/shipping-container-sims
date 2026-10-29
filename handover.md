# Terminal Twin — implementation handover

Handover for the agent picking up Terminal Twin after the `/implement-spec` build. Delete this file before the PR merges to `main`.

## On resume (read first)

Another session may have pushed while you were stopped. Two sessions once built the same tickets in parallel. Before you spawn, resume or message any agent (details in `docs/agents/implementing.md`):

1. `git fetch origin claude/fervent-dijkstra-cmzk4u` and `git log HEAD..origin/claude/fervent-dijkstra-cmzk4u`.
2. Read what changed: `git diff HEAD...origin/claude/fervent-dijkstra-cmzk4u -- handover.md`, then the commit list.
3. Pull (`git pull --ff-only`), run `npm install`, and compare the status table below with the merged tickets. Work from the merged state.
4. Tell every agent you resume or start to do the same: fetch the branch, read this file's diff and the new commits, and merge the tip before carrying on.
5. If work remains, claim it here (name your session, commit and push this file) before you start, and skip anything another session has claimed.

## v1.1 work (spec #60, tickets #61-#79) — read this first

Integration branch: `claude/cool-maxwell-6dmsl9` (based on PR #54's tip `2d077cc`; PR #54 is still open, so the v1.1 PR targets `claude/fervent-dijkstra-cmzk4u`). Orchestration steps: `docs/agents/implementing.md` (use `/implement-spec`). Max 3 implementers at once; spawn nothing near the usage limit. Claim a ticket here (commit and push) before starting it. Resume protocol above applies to branch `claude/cool-maxwell-6dmsl9`.

| Ticket | Issue | State | Claimed by |
|---|---|---|---|
| V11-01 registry | #61 | merged | |
| V11-02 HUD | #62 | merged | |
| V11-03 daylight + masts | #63 | merged | |
| V11-04 camera | #64 | merged | |
| V11-05 view presets | #65 | merged | |
| V11-06 follow next truck | #66 | merged | |
| V11-07 load-proof smoke | #67 | in progress (also triages the full smoke suite; terminal-twin-kpi "end condition" highlights test already fails on PR #54 tip) | session_018sev (agent) |
| V11-08 split setup dialog | #68 | open | |
| V11-09 split ASC | #69 | merged | |
| V11-10 subsystem modes | #70 | merged | |
| V11-11 wtpPadSelection | #71 | done on `tt/71-wtp-pad-selection` (ENGINE_VERSION 0.8.0, shcDispatch v2), not merged | session_018sev (agent) |
| V11-12 SHC cornering | #72 | merged (engine 0.9.0, SHC goldens regenerated) | |
| V11-13 pre-fill decisions | #73 | merged (engine 0.10.0 pre-run phase) | |
| V11-14 truck exports | #74 | in progress | session_018sev (agent) |
| V11-15 STS ground wake-up | #75 | merged (engine 0.11.0 after merge; adds StsGroundPositionWaitBackoff) | |
| V11-16 latency series | #76 | in progress | session_018sev (agent) |
| V11-17 locale dates | #77 | blocked by 68 | |
| V11-18 incremental invariants | #78 | merged (perf/baseline.json to re-record on a quiet machine) | |
| V11-19 real-GPU fps (human) | #79 | blocked by 62, 63, 78 | |

Start order: #61, #62, #63 first (prefactor and visible fixes), then the rest of the frontier by conflict risk. #79 needs a human with a GPU.

## State of PR #54 (updated 2026-10-29)

**Every ticket (#25–#52) is merged on `claude/fervent-dijkstra-cmzk4u`, the code review is done and its fixes are in, and PR #54 is marked ready for review.** `npm run verify`: 0 lint errors (4 old box-empire warnings), build OK, 619 Vitest tests. Nothing is claimed or in progress.

- **Spec:** MrCull/shipping-container-sims#24. **Tickets:** #25–#52 (the PR body has `Closes #24` to `#52`; they close when it merges; none has been commented or closed individually).
- **Sim code:** `src/sims/terminal-twin/`. **Sim guide:** `terminal-twin-AGENTS.md` (entry point; has "How to prove a change works", "Extending", "Known gaps"). **Topic docs:** `src/sims/terminal-twin/docs/` (pointers in the guide). **Glossary:** `GLOSSARY.md`. **Reference packs (not committed):** `docs/reference/`.
- **Implementing with subagents:** `docs/agents/implementing.md` (orchestrator steps, implementer brief, gotchas, resume protocol).

### Still to do

1. **Delete `handover.md`** before PR #54 merges to `main` (its useful content is in the sim guide, topic docs and `docs/agents/implementing.md`).
2. **Read the real frame rate** (TT-19 target 60 fps on the TTI preset): this build environment has no GPU. On a mid-range laptop (4 cores, integrated GPU) open the stats overlay (key P) and record the numbers in `docs/scene-quality-atmosphere.md`.
3. **Check CI on PR #54.** Browser smoke is now a required job (`--grep-invert @load`, retried twice on CI); `@load` specs run in an advisory job. Neither has run on GitHub yet. If the required job is red for load reasons, tag the offending spec `@load`. Known flaky under CPU load: `container-assets.smoke` asset viewer test, `truck-model.smoke` box-on-attach-point test.
4. **Local-only branches** (`tt/*`, `worktree-agent-*`, including halted WIP from the first session) exist only in the original container and were never pushed. All worktrees are removed.

### Changes since the code review (retro)

- ESLint: the engine-purity `no-restricted-imports` rule had been silently overridden by a later block; every block now lists all its patterns. New rule: outside `engine/` and `scenario/`, import engine code only through `engine/index.ts`.
- Playwright picks free ports by default (`SMOKE_DEV_PORT` / `SMOKE_PROD_PORT` still pin them); the sim guide was split into topic docs; `ticket-notes.md` removed; root `AGENTS.md` trimmed.

## Open follow-ups

Logged as GitHub issues on 2026-10-29 (not in PR #54): #55 real-GPU frame rate, #56 HUD panels overlap the KPI strip, #57 per-kind renderer registry, #58 known gaps (cornering, WTP pad decision, subsystem modes), #59 load-proof x600 smoke test. The 18k-yard draw-call failure is fixed: the viewer's total included the shadow pass (container layers use 6 calls), so the spec now checks `containerDrawCalls < 20` and the total `< 40`.

- **Known gaps (accepted, also in the sim guide):** subsystem modes real/instant/off for quay, berth and yard (story 104); no separate WTP pad-selection decision point (story 61); extra shortcuts E/I/P and ASC yield moves; yard pre-fill bypasses the decision runtime (no async handler); handler wall latency has no time series; `SetupDialog.vue`, `twinStore.ts`, `asc.ts` not split.
- **SHC cornering:** SHCs stop at every turn instead of cornering at speed.
- **Container orientation:** position plus optional yaw only.
- **Frame rate:** an 18k-box yard is unconfirmed on real GPU hardware (TT-19).
- **Invariant cost:** done in V11-18 (incremental checks plus periodic sweeps).
- **Date pickers:** `datetime-local` inputs show the browser locale, not the chosen one.
- **Per-kind renderer registry** (#57): `tests/equipment-kinds.test.ts` guards kind registration meanwhile.

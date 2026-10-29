# Implementing a spec with subagents

For the orchestrator running `/implement-spec`, and the brief each **implementer** subagent receives. Terminal Twin (spec #24, tickets #25–#52) was built this way.

## Orchestrator

1. **Resume first.** Another session may have pushed. `git fetch`, read `git log HEAD..origin/<integration-branch>` and the `handover.md` diff, pull, `npm install`, then work from the merged state. Claim a ticket in `handover.md` (commit and push) before starting it.
2. **Frontier.** Start one implementer per unblocked ticket, in its own worktree (`isolation: worktree`) on `tt/<issue>-<slug>`, in the background. Keep to about three at once: each worktree carries its own `node_modules`, builds and browser artefacts, and the container's disk is shared.
3. **Merge.** When one reports, merge its branch into the integration branch (fast-forward when possible, otherwise a merge commit; a handover commit in between forces a merge commit), `npm install`, `npm run verify`, push. Keep both sides of additive conflicts (decision-point registries, fixture lists, guide sections).
4. **Warn.** A ticket that changes the engine contract (decision-point shapes, event payloads, `ENGINE_VERSION`) gets a `SendMessage` to the agents still running so they merge the tip early.
5. **Rate limits** end agents mid-ticket with work uncommitted. Resume the same agent with `SendMessage` after the reset rather than starting a new one; its worktree keeps the work.
6. **Finish.** `/code-review` the integration branch, fix the findings in one implementer, mark the draft PR ready, remove worktrees (`git worktree remove --force`), delete `handover.md`.

## Implementer brief

- **Read first:** the spec issue, your ticket issue, the sim guide and `GLOSSARY.md`, and the notes the earlier tickets left (`handover.md`, the sim guide's topic docs).
- **Base:** `git merge-base --is-ancestor <integration-branch> HEAD`; if not, `git reset --hard <integration-branch>`. Then `git checkout -b tt/<N>-<slug>`.
- **Build test-first** with the `tdd` skill, through the public seams the spec names (engine API, decision-point handlers, `window.__tt`, asset outputs). Meet every acceptance criterion; say exactly why if one is impossible here.
- **Prove it:** `npm run verify`; UI tickets also `npm run test:smoke` for the specs you touched and a screenshot you look at.
- **Commit early**, as soon as verify passes, and again at the end. An implementer that stops (rate limit, disk) with uncommitted work costs a full re-triage. Do not push and do not touch GitHub; the orchestrator does that.
- **Before reporting:** merge the current integration tip, re-run `npm run verify`, update the sim guide and `GLOSSARY.md` for what you added.
- **Report** (at most 12 lines): branch, tip SHA, worktree path, verify result, unmet criteria and follow-ups.

## Gotchas no check enforces

- Run anything longer than about a minute in the background with its output in a log file. A foreground command past the tool timeout leaves no output.
- Never `pkill -f`; free a port with `fuser -k <port>/tcp`.
- On finish, remove your worktree's `node_modules`, `.smoke-dist` and `.smoke-results` if disk is short.
- Regenerate goldens only on purpose (`UPDATE_GOLDEN=1 npm test`) and say why in the commit.
- Never commit `.blend` files or reference photos.

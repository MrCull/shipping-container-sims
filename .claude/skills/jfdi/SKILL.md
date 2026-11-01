---
name: jfdi
description: "Run a whole workload unattended: grill with recommended answers, spec, tickets, implement, review, retro."
disable-model-invocation: true
---

The owner is **away**. Run the whole pipeline on the request in the arguments without waiting for them: every question you would put to the owner takes your recommended answer, and you record it. The finish line is a PR ready for review plus one summary; the owner merges.

The stage skills below are user-invoked, so the Skill tool cannot launch them: **Read each `SKILL.md` and follow it in place**, with the overrides here.

## Owner-away rules (every stage)

- **Recommended answer, recorded.** Wherever a skill says ask, check with or wait for the user (grilling rounds, to-spec's seam check, prototype choices), take your recommended answer and append it to a running decision log in the scratchpad.
- **Hand back the irreversible.** Merging to `main`, deleting branches or issues, changing CI, force-pushing someone else's branch: list these for the owner instead of deciding them.
- **Fast mode** (`docs/agents/implementing.md`, section "Fast mode"), at most two implementers at once, last ticket is the smoke run.
- **Rate limits:** resume the same agent with SendMessage after the reset; its worktree keeps the work.
- **Handover on stop:** if the session must stop early, write `handover.md` at the repo root (status, next steps, decisions) and push it.

## Steps

1. **Grill.** Read `.claude/skills/grilling/SKILL.md`. Work the design tree round by round, sub-agents finding facts, each question answered with your recommendation. Post each round with its answers in chat as you go. Done when the frontier is empty.
2. **Spec.** Follow `.claude/skills/to-spec/SKILL.md`. Add a section "Decisions taken without the owner" holding the full decision log, so the owner can overrule any line.
3. **Tickets.** Follow `.claude/skills/to-tickets/SKILL.md`, ending with the smoke-run ticket (`AGENTS.md`, "Implementing a spec").
4. **Implement.** Follow `.claude/skills/implement-spec/SKILL.md` and `docs/agents/implementing.md`. Done when every ticket is merged and labelled, the smoke ticket is green, and `/code-review` findings are fixed.
5. **PR.** Set the PR body to close the spec and every ticket, mark it ready for review. Do not merge.
6. **Retro.** Follow `.claude/skills/retro/SKILL.md` on this session. Apply the small candidates that touch only docs, scripts or tests, commit and push them; list the rest.
7. **Summary.** One message to the owner: decisions taken (link the spec section), what was built (PR link), what is left for them (merge, decisions to overrule, larger retro items, irreversible actions handed back).

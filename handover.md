# Handover: Terminal Twin round 4 (spec #166)

Per-run tracking for `/implement-spec #166`, see `docs/agents/implementing.md`. Delete before the PR merges to `main`.

Integration branch `claude/stoic-hypatia-tk68z1`, restarted from `main` (8494e8e) after PR #152 merged. Fast mode: per ticket lint, build, test:related; the full verify, goldens and smoke run once in #177.

Ticket texts for implementers: `scratchpad/tickets-r4.md` (scratchpad of the orchestrating session); spec: `scratchpad/spec-r4.md`.

| Ticket | Subject | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #167 | tt:profile | none | merged in branch (10982ae) | |
| #168 | ROB switch, popup closes | none | merged in branch | |
| #169 | Esc order incl. inspector | #168 | merged in branch (36b967a) | |
| #170 | livery and corrugation at distance, no roof text | none | to do | |
| #171 | daylight start, mute on entry | none | to do | |
| #172 | scenery road stops at land edge | none | to do | |
| #173 | no hatch covers when hatch ops off | none | to do | |
| #174 | no floating box, tier stow sequence | none | merged in branch | |
| #175 | trucks never stranded at ASC transfer points | none | merged in branch | |
| #176 | realistic volumes: blockers measured (narrowed by #178) | | merged in branch (a4f3827) | |
| #179 | worktrees start on the integration branch (#178) | none | merged in branch (747ec1f) | |
| #180 | workflow docs: ticket files, committed screenshots, profile first, commit attribution (#178) | none | in progress | implementer (wave 3) |
| #181 | test:related and tt:golden checks (#178) | none | merged in branch (90d6ccc) | |
| #182 | dead worktree cleanup, merge updates handover (#178) | #179 | merged in branch (47de117) | |
| #183 | engine: no silent yard deadlock, peak day finishes at 0.1 (#178) | none | in progress | implementer (wave 1) |
| #177 | smoke run and regressions | #170 to #173, #183 | to do | |

Phase 2 of #178 (#184 to #189, realistic volumes) starts on a fresh integration branch after the round 4 PR merges; not tracked here.

Owner rules still in force: no em dash; never commit `.blend`; `docs/reference/` photos are committed on purpose; no merge to `main` without the owner asking.

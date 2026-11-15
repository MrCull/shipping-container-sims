# Handover: hero equipment (#273, #275; tracking issue #245)

Per-run tracking file (`docs/agents/implementing.md`); delete before the PR merges to `main`.

Integration branch: `claude/optimistic-babbage-b6gk9n`. #275 was requested; it is blocked by #273, so both are built here.
Each ticket is split into slices (S rows); a ticket row is done when its last slice is merged.

| Ticket | Slice | Branch | Status | Claimed by |
| --- | --- | --- | --- | --- |
| S1 | #273 spreader generator, GLBs, budgets, asset test | `tt/s1-hero-spreader-assets` | in progress | session 0155BNjy |
| S2 | #273 selection, quality fields and rung, stats field (+ `heroShc`) | `tt/s2-hero-equipment-quality` | in progress | session 0155BNjy |
| #273 | loader, `HeroEquipmentLevel`, kind hooks, smoke, docs (after S1, S2) | `tt/273-hero-equipment-level` | not started | |
| S4 | #275 `hero_shc.py`, `hero-shc.glb`, budget, asset test (after S1) | `tt/s4-hero-shc-asset` | not started | |
| #275 | `ShcRig.setHeroBody`, `shc-body` offers, smoke, docs (after #273, S4) | `tt/275-hero-shc-body` | not started | |

## Next steps

1. Merge each slice with `scripts/merge-ticket.sh --push <branch>`; set S rows by hand.
2. After #275: run the smoke specs both tickets name, `/code-review`, fix, open the PR (`Closes #273`, `Closes #275`).

## Open points

- #276 (truck chassis) and #274 (human, real GPU) are not part of this run.

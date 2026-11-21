# Handover: spec #297 (STS booms, crane classes, boom visuals)

Integration branch: `claude/wizardly-gates-dyv0lu`. Per-run tracking file; delete before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #298 | Booms raise and lower around berthing | none | merged in branch (543fefb) | |
| #299 | Forestays and boom-hoist ropes stay attached | none | merged in branch (9274f54) | |
| #300 | Boom side plate and detail within budget | #299 | merged in branch (ecc1445) | |
| #301 | Inspector, productivity, picking, shadows follow the boom | #298 | merged in branch (98d8166) | |
| #302 | Raise to pass a vessel's bridge | #298 | merged in branch (525e657) | |
| #303 | Super Post-Panamax class for cranes 101 to 103 | #298, #300 | merged in branch (103e79f) | |
| #304 | Frame-rate proof | #299 to #303 | merged in branch (49d83e7) | |
| #305 | Browser smoke suite and regressions | #298 to #304 | paused: waits for spec #320 (Fast CI) to land on main | |

## Next steps


- #300 and #302 running; #301 next when a slot frees.

## Open points

- #304 needs one real-GPU `__tt.perf()` run by the owner.
- #302 limits: only work-cycle gantry moves check the bridge (step-aside repositions do not); with `canGantryWithBoomRaised: false` a blocked crane stays idle with no retry, so its vessel never finishes (default true, TTI unaffected).
- For #305: `terminal-twin-atmosphere.smoke.ts` "a departure shows a banner that does not block clicks" failed once alone after the #301 merge (line 173: computed `pointerEvents` was `""`, i.e. the banner was likely detached between the visible check and evaluate). Unknown whether it is a regression: check against main 0207d27 or bisect. "entering with sound on shows muted" passed alone.
- #301 follow-up: bridge-passage boom time counts only the boom turns, not the boom-up gantry between them.

- #305 paused (owner, 21 Nov): spec #320 restructures the smoke suite; rerun #305 on the new harness once its remaining tickets are on main. origin/main merged (Fast CI phase 1); `sts-boom-frames.smoke.ts` moved to `openTwin`. When #330 lands, tag it (`equipment` group) and map it.
- Old-harness partial dev run (84 of 178, stopped): failed `gantry-alarm.smoke.ts:53`, `terminal-twin-atmosphere.smoke.ts:166` (departure banner), `terminal-twin-debugger.smoke.ts:246` (follow camera SHC). Not yet checked against main.
- Code review done early (21 Nov) while #305 waits for #320: findings in scratchpad `review-297.md`; implementer on `tt/review-297` (75 min budget).
- Review fixes merged (tt/review-297 at 3cab1a9): all 14 items, ENGINE_VERSION 0.58.0, goldens boom-berthing and boom-bridge regenerated (new park pose). Remaining: #305 on the #320 harness, then PR ready.

# Handover: spec #297 (STS booms, crane classes, boom visuals)

Integration branch: `claude/wizardly-gates-dyv0lu`. Per-run tracking file; delete before the PR merges.

| Ticket | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #298 | Booms raise and lower around berthing | none | merged in branch (543fefb) | |
| #299 | Forestays and boom-hoist ropes stay attached | none | merged in branch (9274f54) | |
| #300 | Boom side plate and detail within budget | #299 | merged in branch (ecc1445) | |
| #301 | Inspector, productivity, picking, shadows follow the boom | #298 | merged in branch (98d8166) | |
| #302 | Raise to pass a vessel's bridge | #298 | merged in branch (525e657) | |
| #303 | Super Post-Panamax class for cranes 101 to 103 | #298, #300 | open | implementer-303 |
| #304 | Frame-rate proof | #299 to #303 | open | |
| #305 | Browser smoke suite and regressions | #298 to #304 | open | |

## Next steps

- #300 and #302 running; #301 next when a slot frees.

## Open points

- #304 needs one real-GPU `__tt.perf()` run by the owner.
- #302 limits: only work-cycle gantry moves check the bridge (step-aside repositions do not); with `canGantryWithBoomRaised: false` a blocked crane stays idle with no retry, so its vessel never finishes (default true, TTI unaffected).

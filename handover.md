# Handover: spec #82 (Terminal Twin realism and usability pass)

Per-run tracking file (see `docs/agents/implementing.md`). Delete before the PR merges to `main`.

Integration branch: `claude/zen-galileo-tp4owk`. Ticket branches: `tt/<N>-<slug>`. #83 (CI pnpm) is already closed.
Engine base version: `0.12.0`. Each engine-changing ticket gets its own `ENGINE_VERSION` below.

| Ticket | Title | Blocked by | ENGINE_VERSION | Claimed by | Status |
|---|---|---|---|---|---|
| #84 | R02 Fixed-width KPI strip | | n/a | wave 2 | merged |
| #85 | R03 Keyboard camera | | n/a | wave 1 | merged |
| #86 | R04 Scenario picker | | n/a | | todo |
| #87 | R05 TTI research KB | | n/a | | todo |
| #88 | R06 Yard no mixed 20/40 | | 0.13.0 | wave 1 | merged (ee888ee) |
| #89 | R07 Vessel no 20 on 40 | #88 | 0.14.0 (merged as 0.18.0 tip) | wave 2 | merged |
| #90 | R08 Maritime locations | | n/a | | todo |
| #91 | R09 Hatch covers engine | | 0.15.0 | wave 1 | merged |
| #92 | R10 Hatch covers 3D | #91 | n/a | | todo |
| #93 | R11 SHC states and metrics | | n/a (KPI fields only) | wave 3 | in progress |
| #94 | R12 SHC queue areas, chaining | #93 | 0.16.0 | | todo |
| #95 | R13 SHC pre-dispatch | #94, #91 | 0.17.0 | | todo |
| #96 | R14 Paired dispatch | #94 | n/a | | todo |
| #97 | R15 Truck appointments | | 0.18.0 | wave 1 | merged |
| #98 | R16 Stall admission, holding | #97 | 0.19.0 | wave 2 | merged |
| #99 | R17 ASC pre-retrieval | #98 | 0.20.0 | | todo |
| #100 | R18 Truck metrics | #98 | n/a (KPI fields only) | | todo |
| #101 | R19 Reefers | #87, #88 | 0.21.0 | | todo |

## Notes

- The spec asks for one PR per slice; this session may only push to the integration branch, so everything lands in one PR. Raise this with the user at the end.
- Dependencies beyond the issues' own text: R10 needs R09; R13 should follow R09 (hatch time in predictions); R19 follows R05 (KB) and R06.
- `gh` is unauthenticated in this container; use the GitHub MCP tools for issues and PRs.

## Status at pause (budget limit; no new tickets started)

- Merged and pushed: #88, #85, #97, #89, #98, #91, #84.
- Reported, merge pending: #100 (`tt/100-truck-metrics`, 20cb3bf, KPI fields only, ENGINE_VERSION stays 0.19.0).
- Still running when paused: #93 (branch `tt/93-shc-states-metrics`). When they report, merge with `scripts/merge-ticket.sh`, update this table, push, then `scripts/remove-worktree.sh <agent-id>`.
- Not started: #86, #87, #90, #92 (unblocked by #91), #94-#96 (after #93), #99 (after #98, now unblocked), #101 (after #87).
- Deviations to review: #91 uses 2 panels (feeder) and 4 (ULCV), not 1 and 3, because panels must fit the laydown strip (about 15 m across); SHC scenarios with more than 3 ground positions per STS throw at start unless `hatch.enabled` is false. Hatch moves count in turnaround and `kpiReport().hatch`, not in STS moves or gross moves/h.
- Open follow-ups: setup-dialog fields for hatch and holding; 2D plan preview lacks holding positions; gate queue is strictly FIFO; KPI_DEFS series row for hatch time; #84 gross/net tiles reserve 15ch. `invariants-incremental.test.ts` timed out once in a parallel run (passes alone and in verify).
- Next ENGINE_VERSION numbers: tip is 0.19.0. #94 0.16.0, #95 0.17.0, #99 0.20.0, #101 0.21.0 were pre-assigned; on merge keep the highest number on the tip.

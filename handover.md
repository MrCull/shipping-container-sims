# Handover: spec #82 (Terminal Twin realism and usability pass)

Per-run tracking file (see `docs/agents/implementing.md`). Delete before the PR merges to `main`.

Integration branch: `claude/zen-galileo-tp4owk`. Ticket branches: `tt/<N>-<slug>`. #83 (CI pnpm) is already closed.
Engine base version: `0.12.0`. Each engine-changing ticket gets its own `ENGINE_VERSION` below.

| Ticket | Title | Blocked by | ENGINE_VERSION | Claimed by | Status |
|---|---|---|---|---|---|
| #84 | R02 Fixed-width KPI strip | | n/a | | todo |
| #85 | R03 Keyboard camera | | n/a | wave 1 | in progress |
| #86 | R04 Scenario picker | | n/a | | todo |
| #87 | R05 TTI research KB | | n/a | | todo |
| #88 | R06 Yard no mixed 20/40 | | 0.13.0 | wave 1 | in progress |
| #89 | R07 Vessel no 20 on 40 | #88 | 0.14.0 | | todo |
| #90 | R08 Maritime locations | | n/a | | todo |
| #91 | R09 Hatch covers engine | | 0.15.0 | wave 1 | in progress |
| #92 | R10 Hatch covers 3D | #91 | n/a | | todo |
| #93 | R11 SHC states and metrics | | n/a (KPI fields only) | | todo |
| #94 | R12 SHC queue areas, chaining | #93 | 0.16.0 | | todo |
| #95 | R13 SHC pre-dispatch | #94, #91 | 0.17.0 | | todo |
| #96 | R14 Paired dispatch | #94 | n/a | | todo |
| #97 | R15 Truck appointments | | 0.18.0 | | todo |
| #98 | R16 Stall admission, holding | #97 | 0.19.0 | | todo |
| #99 | R17 ASC pre-retrieval | #98 | 0.20.0 | | todo |
| #100 | R18 Truck metrics | #98 | n/a (KPI fields only) | | todo |
| #101 | R19 Reefers | #87, #88 | 0.21.0 | | todo |

## Notes

- The spec asks for one PR per slice; this session may only push to the integration branch, so everything lands in one PR. Raise this with the user at the end.
- Dependencies beyond the issues' own text: R10 needs R09; R13 should follow R09 (hatch time in predictions); R19 follows R05 (KB) and R06.
- `gh` is unauthenticated in this container; use the GitHub MCP tools for issues and PRs.

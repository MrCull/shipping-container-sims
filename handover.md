# Handover: Terminal Twin smooth playback, 60 fps and hero containers (spec #243)

For the next agent. Read this file, then spec [#243](https://github.com/MrCull/shipping-container-sims/issues/243), then `docs/agents/implementing.md` (orchestrator and implementer workflow). Keep the table current after every merge. Delete this file before the spec's final PR merges to `main`.

## Status (2026-11-12, `main` at 8713553)

- **Integration branch:** `claude/practical-cerf-asprbc` (orchestrator session https://claude.ai/code/session_0155BNjyJ45Cnu5X19SbvEUH). Implementers run on Sonnet, two at a time.
- **Start here:** #246, #247, #248 and #249 have no blockers. #246 comes first in practice: it records the baseline and adds the counters and the reference test that #250 to #254 are judged against.
- **No real GPU for the first few days** (owner, 2026-11-11). Every ticket except #262 is accepted on counts and ratios that software WebGL measures faithfully. Never judge frame rate from the headless browsers.
- **Blender works in cloud sessions.** A trial installed `bpy` 5.2.3 on Python 3.13 in under a minute and regenerated the container group byte-identical (`pnpm run tt:assets --check --no-previews --only containers --python <venv>/bin/python`). Preview renders and the other groups are untried: that is #247.

## Tickets

Rows are in dependency order. A ticket is startable when every blocker is merged in the branch. The issue's `## Blocked by` section is authoritative.

| Issue | Title | Blocked by | Status | Claimed by |
|---|---|---|---|---|
| #246 | Headless baseline, posing counters and drawn-box reference | none | merged in branch (87c0545) | |
| #247 | Opt-in Blender install script for cloud sessions | none | merged in branch (a01e946) | |
| #248 | Environment reflections and contact shadows | none | open | |
| #249 | Far tier: stand-ins for fences, ASC rails and masts | none | open | orchestrator session_0155BNjyJ45Cnu5X19SbvEUH |
| #250 | Posing: boxes at rest are written only when their custody changes | #246 | open | |
| #251 | Playback: even pacing with the achieved speed shown | #246 | open | |
| #252 | Sweep-only invariant checks in the browser, "strict checks" switch | #246 | open | |
| #253 | Worker reads only the entities an event names | #246 | open | |
| #254 | One-click benchmark on a production build | #246 | open | |
| #255 | Hero container model, per face, with asset budgets | #247 | open | |
| #256 | Far tier: far-field wordmark on containers | #247 | open | |
| #257 | Posing: cull before posing, one custody lookup per box | #250 | open | |
| #258 | Hero renderer: visible faces only, capped, loaded on first close zoom | #250, #248, #255 | open | |
| #259 | Hero detail arrives smoothly (frame allowance, fade-in, camera gate) | #258 | open | |
| #260 | Sharp markings on hero faces | #259 | open | |
| #261 | Auto quality works from frame time and sheds in a fixed ladder | #259, #260 | open | |
| #262 | Run the benchmark on the laptop, record the numbers, retune Auto (`ready-for-human`) | #254, #261, #257, #249, #256 | open | |
| #263 | Run the browser smoke suite and fix regressions | #246 to #261 | open | |

## Things the tickets do not say

- **The ticket table inside spec #243 is stale.** It shows an earlier 16-ticket split with its own numbering. The sub-issues and this table are the real list.
- **Ticket bodies exist only as issues.** Write each one to a scratchpad file before briefing an implementer (`docs/agents/implementing.md`, Frontier).
- **No engine behaviour changes.** No event log, golden or hash may move in any ticket. If one does, the ticket has gone out of scope.
- **#246 may reorder #251 to #253.** The claim that the engine sustains about 600 sim seconds per wall second on the full-scale TTI preset is an estimate from headless wall times. If the measurement differs much, say so on #243 before starting the playback tickets.
- **A doc line to fix in #246:** the frame-rate guide says of the x3600 smoke spec "software GL reaches only 190 to 396". That figure came from a fixture too small to measure anything (#191); replace it with the measured rate.
- **Caps and thresholds are provisional.** Hero caps come from #255's measured cost; Auto's thresholds stay provisional until #262.
- **Outside this spec:** #244 (engine backlog after scale 1) and #245 (hero detail for equipment), both `needs-triage`. Leave them alone.

## Open points

- **#247:** `scripts/install-bpy.sh` installs bpy into `$HOME/.cache/tt-bpy-venv` (last output line is the venv python). A full `tt:assets --check` over all 7 groups is byte-identical for every GLB and sidecar; 56 preview `.webp` files differ (Cycles on a different CPU), recorded in `assets-pipeline.md`. Use `--no-previews` for a models-only check.

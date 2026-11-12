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
| #248 | Environment reflections and contact shadows | none | merged in branch (5b12dc2) | |
| #249 | Far tier: stand-ins for fences, ASC rails and masts | none | merged in branch (290113b) | |
| #250 | Posing: boxes at rest are written only when their custody changes | #246 | merged in branch (eae8de4) | |
| #251 | Playback: even pacing with the achieved speed shown | #246 | open | orchestrator session_0155BNjyJ45Cnu5X19SbvEUH |
| #252 | Sweep-only invariant checks in the browser, "strict checks" switch | #246 | open | |
| #253 | Worker reads only the entities an event names | #246 | open | |
| #254 | One-click benchmark on a production build | #246 | open | |
| #255 | Hero container model, per face, with asset budgets | #247 | merged in branch (f568b1c) | |
| #256 | Far tier: far-field wordmark on containers | #247 | open | |
| #257 | Posing: cull before posing, one custody lookup per box | #250 | merged in branch (ccf3ff8) | |
| #258 | Hero renderer: visible faces only, capped, loaded on first close zoom | #250, #248, #255 | merged in branch (8df80fd) | |
| #259 | Hero detail arrives smoothly (frame allowance, fade-in, camera gate) | #258 | open | orchestrator session_0155BNjyJ45Cnu5X19SbvEUH |
| #260 | Sharp markings on hero faces | #259 | open | |
| #261 | Auto quality works from frame time and sheds in a fixed ladder | #259, #260 | open | |
| #262 | Run the benchmark on the laptop, record the numbers, retune Auto (`ready-for-human`) | #254, #261, #257, #249, #256 | open | |
| #263 | Run the browser smoke suite and fix regressions | #246 to #261 | open | |

## Things the tickets do not say

- **The ticket table inside spec #243 is stale.** It shows an earlier 16-ticket split with its own numbering. The sub-issues and this table are the real list.
- **Ticket bodies exist only as issues.** Write each one to a scratchpad file before briefing an implementer (`docs/agents/implementing.md`, Frontier).
- **No engine behaviour changes.** No event log, golden or hash may move in any ticket. If one does, the ticket has gone out of scope.
- **(Resolved, see the #243 comment: engine keeps up to x600, saturates at about 1,300 to 1,500; order kept.) #246 may reorder #251 to #253.** The claim that the engine sustains about 600 sim seconds per wall second on the full-scale TTI preset is an estimate from headless wall times. If the measurement differs much, say so on #243 before starting the playback tickets.
- **(Done in #246.) A doc line to fix in #246:** the frame-rate guide says of the x3600 smoke spec "software GL reaches only 190 to 396". That figure came from a fixture too small to measure anything (#191); replace it with the measured rate.
- **Caps and thresholds are provisional.** Hero caps come from #255's measured cost; Auto's thresholds stay provisional until #262.
- **Outside this spec:** #244 (engine backlog after scale 1) and #245 (hero detail for equipment), both `needs-triage`. Leave them alone.

## Open points

- **#247:** `scripts/install-bpy.sh` installs bpy into `$HOME/.cache/tt-bpy-venv` (last output line is the venv python). A full `tt:assets --check` over all 7 groups is byte-identical for every GLB and sidecar; 56 preview `.webp` files differ (Cycles on a different CPU), recorded in `assets-pipeline.md`. Use `--no-previews` for a models-only check.
- **#246:** baseline `pnpm run tt:baseline` (heavy, about 3 min; run under `scripts/bg.sh run --heavy`). Overview posing 14.3 ms per frame, 9,895 boxes posed, 2,006,400 instance bytes per frame. Drawn-box reference: `tests/drawn-boxes.test.ts` + `drawn-boxes.reference.json` (regenerate only on purpose with `UPDATE_DRAWN_BOXES=1`); it takes about 45 s, close to the 60 s Vitest limit on a busy machine. A flat-out `run` compacts motion plans, so the reference feeds the model with `advance` steps of 900 s: a box in flight at T is posed from motion planned later (matters for #251, #253).
- **#250:** the instancer is retained (`set`/`remove` per box, range uploads); the renderer poses only custody changes, carried boxes, new boxes and vessels whose placement changed. Overview posing 14.3 to 2.40 ms, 9 boxes posed, 0 bytes when nothing changes. Left for #257: the O(boxes) close-up offer loop still runs every frame. Not run per ticket (for #263): `terminal-twin.smoke`, bay-viewer and gantry-alarm specs; two `@load` specs (colour-by full TTI, container-closeup 10-box view) failed on software GL and were not diagnosed.
- **#249:** far tier in `modules/farTier.ts` (fences and ASC rails beyond 220 m, masts beyond 350 m, hysteresis, code-generated 12-triangle stand-ins). TTI overview 1,561,283 to 382,435 triangles, 282 draw calls unchanged; perf smoke budget now < 420k. No cross-fade: stand-ins are visually indistinguishable at switch distance (`docs/prototypes/249/yard-all-*.png`); confirm on the laptop in #262.
- **#255:** `hero` asset group, 12 GLBs `hero-<20|40|40hc>-<side|door|front|roof>` (82 to 458 triangles, 2 draw calls per face, 3 for the door; 20 to 29 KB per file). Worst case per box: 1,084 triangles, 7 draw calls before instancing. Caps in `budgets.json` `heroCaps`: High 32 boxes (44k triangles), Medium 12, Low none; geometry allows about double, so #258/#259 measure the binding cost. Paint is white and tintable. Nothing outside dev loads `models/hero` yet (a test checks it; #258 changes that). Previews under `assets/models/hero/previews/`, linked from the PR.
- **#248:** `modules/skyEnvironment.ts` (procedural sky baked to PMREM once per lighting mode; `atmosphere().environmentBuilds` counts it) and `modules/contactShadow.ts` (bottom 0.7 m of each container face fades to 50 %, one shared uniform). Quality fields `environmentReflections`, `contactShadows` (off on Low). Contact darkening is subtle under the new sky light; the one knob is `environmentIntensity`. Marking decals and vessel hulls get neither. Not run per ticket (for #263): bay-viewer, colour-by, rob-bays, infrastructure.smoke, terminal-twin.smoke.
- **#257:** moving boxes outside a widened frustum (20 m plus 20 m/s since last posed) are not posed; `SceneModel.poseOwner` replaces the second `custodyAt`; the close-up offer walks only in-reach keys and runs only on change. Saving is small at the TTI baseline (overview playing 2.65 to 2.17 ms) because #250 already left only 9 to 14 moving boxes. Acceptance 1 (only moving boxes in view posed on a zoomed crane) shown headless only. Not run per ticket (for #263): container-closeup, terminal-twin.smoke.
- **#258:** `heroFaceSelection.ts` (pure: exposed faces turned to the camera, nearest first, cap `heroBoxes` x 3, 15 m, hysteresis 1.15), `heroRenderer.ts`, `heroAssets.ts` (the only file allowed to name `models/hero`; loads on the first chosen face). Instanced per (size, kind, part), paint tinted from the instance colour, wear from `wearFor`. `stats.heroFaces` in perf. `onReady` redraws a still camera when models arrive (needed because of #257's `closeupDirty` gate). Smoke `hero-faces.smoke.ts` (3). **Left for #259:** prep time per box and live triangles/draw calls were not measured; caps (High 32, Medium 12) are still untuned. **Left for #260:** hero ribs poke through the close-up marking decals. Screenshots of vessel deck, truck and spreader not taken (only `docs/prototypes/258/hero-yard-10m.webp`).

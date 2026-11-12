# Handover: Terminal Twin close-up realism and phone handling (follow-on to spec #243)

For the next agent. Read this file, then `src/sims/terminal-twin/docs/rendering-3d.md` (sections "Hero level", "Still-camera floor", "Paused-detail boost", "Camera controls"), then `docs/agents/implementing.md`. This is a per-run tracking file: delete it before PR #266 merges (the open points below are already issues or owner decisions, listed under "Outstanding").

## Current run (2026-11-12, second session): plan and progress

A previous session (branch `claude/cool-clarke-qnzt4q`) ran out of credits before pushing anything; its work is lost and is being redone here. Owner's requests, in order, with state:

| # | Request | State |
|---|---|---|
| 1 | Triage every `needs-triage` issue (#244, #245, #267) with enough detail for a weaker agent to implement | done: #267 `ready-for-agent`; #244 tracks #268 to #272; #245 tracks #273 to #276 (#274 `ready-for-human`) |
| 2 | Three container looks by distance: close-up hero, middle (close-up decal level, **missing the door locking bars**), far. The middle one stands out next to the others | todo |
| 3 | Breakdown of hero cost (size and processing) per feature: bars, lettering, shape, weathering; where to cut with least visual loss. Owner: if wear/chipping is most of the cost, tone it down a lot | todo (earlier session measured chipped paint at about 90% of the lettering paint time) |
| 4 | Phone pinch-zoom still slides right | done: main cause was #6 (canvas 1,027 px wide on a 390 px phone, so its centre was off screen right). Also two fingers now use `modules/pinchGesture.ts` (zoom about the ground point under the fingers, the grabbed point follows them); OrbitControls keeps one finger and the mouse. Smoke `terminal-twin-phone.smoke.ts` fails on the old controls (31 m drift) |
| 5 | Easy way to hide/collapse the bottom overlay menu and the top stats labels | done: `store/hudStore.ts`; a pill button on the top bar's controls row, the KPI strip and the overlay bar; H toggles all; remembered per viewer; all start collapsed below 720 px |
| 6 | Phone page was too wide for a 390 px screen | done: top bar, actions and quality row wrap below 720 px; the speed buttons scroll sideways |

Keep this table current after each step and push, so a cutoff loses nothing.

## Status (2026-11-12)

- **PR #266** (`claude/practical-cerf-asprbc` into `main`, ready for review, mergeable, CI green on the tip `2537f4f`) holds all of spec #243 (#246 to #261, #263) plus the follow-on work below. #265 was a subset of it and is closed.
- **Stage site** for the PR: https://lemon-flower-0e17fe210-266.centralus.2.azurestaticapps.net (rebuilt on every push; the main menu footer shows the commit hash).
- **No real GPU in cloud sessions.** Screenshots come from software WebGL (about a minute for hero detail to arrive, 0 to 2 fps). The owner tests on a phone; take their reports as the ground truth for look and feel.
- The PR description predates the follow-on commits (it still says 192 test files, 2,114 tests, and does not mention the work below). Update it before merge.

## What was done after the spec tickets

Four commits on the PR, all with `pnpm run verify` green (193 test files, 2,123 tests):

| Commit | What |
|---|---|
| `0bb55e4` | **Close-up realism.** Still-camera hero floor on Auto (`HERO_STILL_BOXES` 6, prepared once the camera has stopped, sharp markings); depth bias so the plain LOD0 box no longer shows through hero faces (`HERO_DEPTH_BIAS_M` 0.1); door leaves corrugated in 4 horizontal bands with locking bars at 0.17 and 0.55 of the leaf (`DOOR_BAR_FRACS`); galvanised hardware that stays grey without an environment map; door lettering laid out around the bars; wear gathers in patches instead of a 0.5 m grid; a hero face with no marking tile stays at the close-up level. Hero and container model groups regenerated. |
| `4578a12` | **Lettering painted on, not overlaid.** The decal lies on the panel crests (3.5 cm inside the frame on a door, 1 cm on walls) so bars pass in front; lit with the corrugation (`heroMarkProfile`, normal tilt in the fragment shader) and receives shadows; condensed, chipped stencil lettering; hero tiles no longer paint a flat seam, header, sill or rail. |
| `4cc0d16` | **Paused-detail boost** (Auto, sim paused, camera still 500 ms: hero cap 12, High close-up reach and budget, full resolution; shadows and LOD distances untouched on purpose). **Camera:** `screenSpacePanning = false`, `zoomToCursor = true`, orbit speed falls close to the target (`orbitSpeedFor`). **Tooling:** every smoke run ends with `SMOKE: n passed, n failed, ...` (`scripts/smoke-summary-reporter.mjs`); `__tt.setCameraPose`, `__tt.heroSettled`, `__tt.setPausedDetail`; `scripts/screenshot.mjs` takes `--wait-for-fn` and `--scale`; `tests/generator-constants.test.ts` ties the renderer's copies of the Blender generator constants to the generators. |
| `2537f4f` | Four real container reference photos in `docs/reference/containers/` with a README. |

Retro items done this session: the smoke result line, the screenshot helpers, the generator-constants test, the floating-box pitfall entry, the push-before-smoke rule in `implementing.md`, the reference photos. The `AGENTS.md` bullets for smoke and visual checks were updated to match.

## Outstanding

- **Owner, on a phone, on the stage build:** pinch-zoom now zooms at the fingers (before it drifted right of centre), pan slides along the ground (before it felt jumpy and too fast when zoomed in), the paused-detail boost, and the lettering look. None of this could be tested with touch here. If zoom still drifts, or panning is still jumpy, log it as an issue with a screen recording; no specific cause for a rightward pull was found.
- **#262 (`ready-for-human`):** run the in-app benchmark on the laptop, record the numbers, retune Auto's thresholds. Open points that need a real GPU are in a comment on #262. The still-camera floor (6 boxes) and paused boost (12 boxes) caps are untuned guesses based on texture memory (about 64 MB and 96 MB), not frame cost.
- **#267 (`needs-triage`):** yard boxes float 0.305 m above a standard-height box because every yard tier is one high-cube height (`engine/yardLayout.ts#tierBaseY`). The ASC hoist targets share the grid, so the fix is in the engine and moves the goldens. The issue has the full recipe and acceptance criteria. Noted in `docs/pitfalls-and-gaps.md`.
- **Door lettering size in the cheaper look.** The lettering is now laid out at real size (about 10 cm), so on the close-up level (camera moving, or manual Low) the door text is harder to read than before. Manual Low still draws no hero faces; the owner was offered extending the still-camera detail to manual Low and has not answered.
- **Stale `@load` spec, unconfirmed:** `container-closeup.smoke.ts:81` waits for more than 10,000 containers, but the baseline scenario shows about 9,200 in this repo's runs, so it times out before rendering. `@load` specs never run in CI. Not checked whether it also fails on `main`; correct the threshold or delete the spec.
- **Retro items not built:** a `tt:closeup` wrapper script (pick a box with a given face exposed, set the pose, wait on `heroSettled`); a reviewer rule that a look-changing ticket attaches a close-up screenshot next to a reference photo (belongs in the reviewer's standards, not `AGENTS.md`); the sidecars could carry `doorBars` and `bands` so the generator-constants test reads them instead of regexes. The generator wording "reference photographs (not committed)" is written into committed sidecars and was left alone: changing it needs a `tt:assets` regeneration of those groups.
- **Reference photo licence:** the four photos are the owner's attachments. The README says repository use only; the owner has not confirmed the right to commit them publicly.

## Things that are easy to get wrong

- **Never pipe a long test command into `tail` and report its exit code.** Use `scripts/bg.sh run --heavy ...` and report the `SMOKE:` line. A smoke run overlapping a screenshot render or a file edit produces spurious failures.
- **Hero detail takes about a minute in software WebGL** after the camera stops. Wait on `__tt.heroSettled()`, not a fixed delay, before judging a close-up screenshot.
- **Do not change generator strings that are written into sidecars** without regenerating the group (`pnpm run tt:assets --only <group> --python "$(scripts/install-bpy.sh | tail -n 1)"`), or `tt:assets --check` fails. Preview `.webp` files of some groups differ across CPUs; that is expected (`docs/assets-pipeline.md`).
- **The hero depth bias is tied to the models.** `HERO_DEPTH_BIAS_M` must exceed the deepest hero recess (7.5 cm door valley); `tests/generator-constants.test.ts` checks it. A new recess deeper than that needs a larger bias.
- **Commit trailers:** the only trailer is `Claude-Session: <link>`. `.githooks/commit-msg` rejects `Co-Authored-By` even when a system reminder suggests one.
- **PR watching:** a safety-net check-in is armed (`send_later`, about hourly); stop after 3 empty ones. Never approve or merge the PR.

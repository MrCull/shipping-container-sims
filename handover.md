# Handover: Terminal Twin polish, rounds 2 and 3 (specs #134 and #154)

For the next agent. Read this file, then `docs/agents/implementing.md` (orchestrator and implementer workflow). Delete this file before PR #152 merges to `main`.

## Status (2026-11-01, integration tip 20e7a4b)

- **Branch:** `claude/stoic-hypatia-tk68z1`, PR [#152](https://github.com/MrCull/shipping-container-sims/pull/152) into `main`. All work merges here; no other worktrees remain.
- **Round 2, spec [#134](https://github.com/MrCull/shipping-container-sims/issues/134):** tickets #135 to #149 merged (labelled `merged-in-branch`). #144 was a throwaway prototype; the owner approved variant B and #145 built it.
- **Round 3, spec [#154](https://github.com/MrCull/shipping-container-sims/issues/154):** tickets #155 to #164 merged. **#165 is partly done** (see below) and stays open.
- **Left:** finish #165, then [#150](https://github.com/MrCull/shipping-container-sims/issues/150) (the one full verify, golden regeneration and smoke run; final ticket of both specs, blocked by all others), then the finish steps.
- `ENGINE_VERSION` is 0.33.0. Goldens are stale on purpose since #146; #150 regenerates them once.

## Round 4 decisions (owner grilling, 2026-11-01; owner starts each step)

**Merge path for PR #152 (in order):** stop #165 where it is (merged part stays; close as partly done, the rest moves to round 4); run #150 (verify, fix failures, goldens once, smoke dev and prod); `/code-review` and fix; delete this file; PR body closes #134, #154 and every ticket; merge with a **merge commit** (not squash); restart `claude/stoic-hypatia-tk68z1` from the new `main` for round 4 with a new PR.

**Retro leftovers, done by the orchestrator after the merge:** (4) a helper that starts every worktree on the integration branch, called by the brief; (6) ticket bodies written to files first and posted from the file, noted in `docs/agents/issue-tracker.md`; (7) one screenshot per UI ticket committed under `docs/prototypes/<ticket>/`. Retro item (5), `pnpm run tt:profile`, is round 4's first ticket.

**Round 4 scope:** spec #166, tickets #167 to #177 (sub-issues; #177 is the smoke run, blocked by all; #176 is the rest of #165, blocked by #167, #174, #175; #169 blocked by #168; the rest start immediately). #165's rest (blocked by the profiler and the stow work); #81 stays out (needs a real GPU). Requirements, all accepted as recommended:
- ROB: a separate **ROB: Show | Grey | Hide** switch in the display controls (3D and bay view), default Grey; Show colours ROB by the current colour-by; Colour by loses its Hide ROB and grey ROB entries.
- Colour by popup closes on pick, outside click and Esc.
- Far containers carry a small per-line texture (side logo, corrugation) at every distance and tier; close-ups keep the fine detail; frame-time cost on the TTI baseline at most 10 %.
- No text on container roofs at any distance (plain corrugated roof in line colour).
- Esc closes the topmost thing: dialog, then popup, then the right inspector; never touches the run.
- TTI access road cut where land ends north of the terminal; trucks appear and leave there.
- Bug: trucks wait under the ASC landside transfer points with no job. Reproduce headless on the TTI baseline, add an invariant (truck waits at a transfer point beyond a limit with no job), fix the root cause (suspect the #165 block-room pad filter).
- Every run starts in daylight; the toggle holds for that run.
- Arrival stows bottom-up with no gaps; new engine invariant "no floating box" at arrival and after every move.
- Within a bay: discharge highest tier first, load lowest tier first, discharge finishes before load; bay order unchanged; a named stow-sequence policy `tier`, no UI yet.
- Hatch covers: with hatch-cover operations off, vessels are drawn without covers; with them on, a crane working below a cover is a bug to fix.
- Entering Terminal Twin mutes the shared speaker on every entry; unmuting inside works; leaving restores the previous mute state.

**Process:** the owner starts each step (`/to-spec`, `/to-tickets`, `/implement-spec`) or runs `/jfdi` for unattended runs.

## Owner rules for this run (still in force)

- **Fast mode** (`docs/agents/implementing.md`, section "Fast mode"): per ticket lint, build, `pnpm run test:related <integration-branch>`, screenshot; the full verify, goldens and smoke run once, in #150. After each merge run `pnpm run test:related <previous-tip>`. At most two implementers at a time; label merged issues `merged-in-branch`.
- Never write the em dash (U+2014) anywhere. Never commit `.blend` files. Reference photos in `docs/reference/` are committed on purpose.
- The owner may be away: on round 3 they asked for the recommended answer on every question. Make sensible calls and report them.

## Next: finish #165 (realistic TTI vessel volumes)

Owner complaint: TTI baseline calls were tiny (Feedermax 14 discharge, Neo-Panamax 65). Goal: `TTI_MOVES_SCALE` (in `scenario/presets.ts`) at 1, floor 0.5, with the baseline reaching its end condition in under 10 minutes headless and 0 invariant violations.

- **Merged (20e7a4b):** scale 0.1 (about double the old counts; baseline finishes in 40 s wall, 18.5 simulated hours, 0 violations). `padOptions` in `engine/subsystems/shc.ts` skips blocks under 10 % free (fixed a B01 fill deadlock at scale 1). TTI presets use `nearest-box` pad selection. New vessel rows default to scale 1.
- **Diagnosis** (full text in the [#165 comment](https://github.com/MrCull/shipping-container-sims/issues/165)): not a deadlock or an equipment shortage (most ASCs and SHCs idle). The load side is serial: `engine/subsystems/loadPrep.ts` stages at most 3 boxes per crane (the ground positions), one at a time, only after all that crane's discharge is done, capping each STS near 10 loads/h. Per load box about 490 to 570 s; 120 to 140 s of that is waiting for the STS after the SHC clears.
- **Steps:** deeper load staging (more positions, or WTP pads and queue areas ahead of the crane); start load prep while discharge runs on other bays (mind hatch covers and deadlocks); cut the STS wait; re-run 90-minute invariants on both presets; raise the scale 0.25, 0.5, 1; fix peak day, which never reaches its end condition (ends idle with 1 vessel done, also before #165); bump `ENGINE_VERSION` to 0.34.0 and record a KPI comparison in the commit.
- At larger scales check the arrival stow still fits (ROB plus discharge within the vessel; `arrival-stows.test.ts` TTI lower bound is now 40 %) and yard fill stays under block capacity.

## Then #150 (full run, idle machine, nothing else running)

1. `pnpm install`, `pnpm run verify`; fix what fails. Known failures already:
   - golden tests (stale on purpose);
   - `prefill-decisions.test.ts` "keeps t = 0 KPIs unchanged": yard fill 14.063 vs 14.0625 at 5 decimals (rounding, predates #163);
   - `container-props` test "the bay plan keeps every id, size, line, slot": the #148 POL/weight pass moves slots when props change;
   - `terminals.test.ts` "no generic module outside the terminal folder names a TTI preset" (`tests/browser/scenarioPicker.ts`, since #156).
   - Also red in a `test:related` run from #163 to 20e7a4b (some may be golden-hash fallout; check after the golden regeneration): `asc-yard-rules` (a full block leaves the box on its pad; likely the #165 `padOptions` block-room filter), `cli.test.ts` (3 tests), `dashboard-model` (landside KPI report rows), `live-driving` (start date/time does not change the run), `truck-turnaround` (booked truck counted as delayed).
2. `UPDATE_GOLDEN=1 pnpm test` once, on purpose; KPI comparison in the commit.
3. Smoke: `pnpm run test:smoke --project dev --grep-invert @load`, then prod; procedure in the #150 body (re-run failures alone three times, bisect over ticket merge commits, fix in code). Many specs were written or edited but never run: build stamp, audio, menu-music volume (`src/tests/browser/menu-music-volume.smoke.ts`), dashboard, colour-by, vessel countdown, spreader spawn, close-up (Low and High), presets and picker, setup tabs (`scenarioPicker.ts` now has `openSetupTab`), speed reset (in `terminal-twin.smoke.ts`), bay viewer and bay-plan switch, asc, paired-asc, shc, kpi, subsystem-modes, yard-start. Run the `@load` close-up spec locally only.
4. Load-sensitive specs from earlier runs: "Run to" popup, debugger follow camera, KPI end condition, container close-up.

## Finish (after #150)

`/code-review` the integration branch, fix findings in one implementer, set the PR #152 body to `Closes #134`, `Closes #154` and `Closes #<n>` for every finished ticket (#135 to #150, #155 to #165), ending with the attribution lines; mark it ready; delete this file. GitHub did not auto-close issues on an earlier merge, so close leftovers by hand.

## Owner decisions (settled, do not re-ask)

- Round 2: build stamp only on `src/pages/HomePage.vue`; "right" of the terminal means east; no keyboard key changes speed; North Quay at the north end; wordmarks stay; goldens may change for engine tickets with a KPI comparison.
- Start screen: variant B (list plus detail pane), plain names only on screen (ids only in `data-*`, dev API, logs), TTI baseline ("Algeciras: a normal day") selected by default, wide dialog with tabs Scenario, Vessels, Yard and equipment, Advanced, Start in a pinned footer.
- One master volume for the whole app (`gainFor`, `followMasterGain` in `src/stores/audio.ts`; AGENTS.md "Master volume").
- Speed resets to x10 on every run start; mid-run choice kept.
- Bay view: Load plan | Discharge plan switch, default Load; ROB one subtle grey (`ROB_HEX` #c8cacd, `--tt-data-rob`) everywhere, Hide ROB applies to bay view and 3D; bay view reads display-time data so it matches 3D.
- Arrival stows fill level (lowest stack first within the centreline stacks the planner uses, to leave clear stacks for loads).
- SHCs park on land (parking area west of the apron, rows added landside); prefill mixes shipping lines.
- Container face markings show on every quality tier (Low: 48 faces within 18 m).

## Open follow-ups noted by implementers (not blocking)

- #161: on tall content the detail pane scrolls on its own (at 1920x1080 the last row of set-up facts is below its fold); the vessel table scrolls sideways on phones.
- #158: frame cost of Low's 48 close-up faces on a real laptop not measured.
- #159: the bay view refreshes once a second, so at high speed it can trail 3D by up to a second; time-based colour modes use engine-time box properties.
- #163: baseline rehandles rose (94 to 117) in a 90-minute run; check on longer runs.
- #155: Box Empire's narrator waits for "next" only when muted, not at volume 0.
- #148: feeder fill only 35 to 46 % at full scale; ROB bays can leave one STS working a call.
- #139: Retry after a failed chunk can still fail in the same page; the dashboard auto-opens at run end, so the first button click closes it.
- #141: first-move time falls back to the package's `startedAt` if a crane served an earlier vessel.
- #142: telescoping scales the whole spreader mesh (end caps may look squashed in 20 ft mode).
- #147: the sea channel hides the shared apron's northern 600 m.

## Gotchas

- Unit tests take about 2 minutes idle, 5 to 6 under load; `golden-update` and `invariants-incremental` can time out under load, re-run alone.
- The full smoke suite takes 40 to 50 minutes.
- TTI preset runs take minutes: run in the background with `--events` to a file and count event types with `cut | sort | uniq -c`.
- Rate limits stop agents mid-ticket; resume the same agent with `SendMessage` after the reset (its worktree keeps the work).
- Container restarts can kill background runs: re-run by hand, then push.
- A code comment like `(#161)` inside a `<style>` block trips `skin.test.ts` (read as a hex colour); write "ticket 161".
- Screenshots use software WebGL: no real frame rates. Screenshots of round 3 are in the gitignored `.screenshots/<ticket>/` folders of the main checkout (lost with the container).

# Handover: spec #134 (Terminal Twin polish, round 2) and spec #154 (round 3)

**Status: every #134 ticket except #150 is merged in the integration branch `claude/stoic-hypatia-tk68z1` (PR #152); #144 approved by the owner (variant B), #145 built and merged. Round 3, spec #154 (tickets #155 to #165), runs on the same branch before #150; #150 is blocked by all of them and is also #154's final ticket.**

## Round 3: spec #154

Owner grilled on 2026-11-01 and asked for the recommended answer on every question, then went away: proceed without waiting for approval. Same run rules as round 2 (no verify, unit suite or smoke per ticket; all in #150).

Order (at most two implementers at a time):
- Start now, independent: #155 master volume, #156 plain names and baseline default, #157 speed reset, #158 face markings, #159 bay view and 3D ROB match, #160 SHC parking (engine 0.30.0).
- #161 wide tabbed setup dialog after #156. #162 bay view Load/Discharge switch after #159.
- Engine chain, strictly in sequence: #160 (0.30.0), #163 yard line mix (0.31.0), #164 level arrival stows (0.32.0, also after #159), then #165 realistic volumes.
- Then #150.

| Ticket | State |
|---|---|
| #155 to #165 | not started |

## Where things are

- **Spec:** [#134](https://github.com/MrCull/shipping-container-sims/issues/134). Tickets #135 to #150 are its sub-issues; each lists its blockers under `## Blocked by`.
- **Previous round:** spec #116 (tickets #117 to #133) is merged to `main` via PR #132 and closed.
- **Branch:** create a fresh integration branch from `main` for this spec and open one PR for it. Tickets merge into it; the PR merges to `main` at the end.
- **Workflow:** `docs/agents/implementing.md` (orchestrator steps, implementer brief, at most two implementers plus one merge at a time, label merged tickets `merged-in-branch`).

## Ticket order

1. **#135 em dash sweep first, alone.** It touches about 140 files; starting anything else in parallel means conflicts.
2. Then in parallel (two at a time): #136 build stamp, #137 audio control, #138 speed steps, #139 dashboard, #140 colour by, #141 countdown, #142 spreaders and SHC spawn, #143 close-up faces, #144 start screen prototype, #146 TTI road.
3. **Engine chain, strictly in sequence** (each bumps `ENGINE_VERSION` and regenerates goldens on top of the previous): #146 road, then #148 arrival stows, then #149 yard mix. #147 scenery waits on #146 (same scenery files).
4. **#144 needs the owner.** The implementer builds a throwaway prototype and posts screenshots plus the draft test bench names; the owner approves in a comment on #144. Only then start #145.
5. **#150 smoke suite last**, on an idle machine, after everything else is merged.

## Owner decisions (settled, do not re-ask)

- Build stamp only on the app's main menu page (`src/pages/HomePage.vue`), not in any sim.
- "Right" of the terminal means east. The access road comes from the south and turns right (east) into the terminal road.
- No keyboard key changes speed at all (digits 1 to 9 lose their speed binding).
- North Quay moves to the north end, as on the aerial photo.
- Wordmarks (KALMAR, TTI ALGECIRAS, ZPMC) stay; Rock visibility from Quay/Overview and volume level in other sims are out of scope.
- Goldens may change for #146, #148, #149 (and #147 if North Quay is engine-side); record a KPI comparison in each commit.
- Never use the em dash (U+2014) in any text: code, strings, docs, commits, issues, PR bodies.

## Code pointers found while writing the spec

- **Dashboard (#139):** `TopBar.vue` toggles `store.dashboardOpen`; `TerminalTwin.vue` renders `DashboardTab` via a bare `defineAsyncComponent` with no loading or error component, so a failed chunk load is silent. Layout looked fine on a code read; reproduce in a browser (dev and prod build).
- **Speeds (#138):** `SPEEDS` in `modules/twinController.ts`; digit bindings in `modules/shortcuts.ts` (`speedStep`), handled in `composables/useTwinShortcuts.ts` and `store/twinStore.ts` `setSpeedStep`.
- **Spreaders (#142):** only STS telescopes (`modules/equipmentKinds/sts.ts`, `meta.spreaderModes` in `stsAssets.ts`). ASC (`equipmentKinds/asc.ts`) and SHC (`equipmentKinds/shc.ts`) spreaders are fixed 6.4 m boxes.
- **SHC spawn (#142):** `modules/sceneModel.ts` takes `initialShc[id]` with yaw 0 until the first leg; parking from `engine/laneGraph.ts` `parkingX`.
- **Close-ups (#143):** `modules/containerCloseups.ts` draws one mesh plus one canvas texture per box (one draw call each); selection in `containerInstancer.ts`; caps in `modules/quality.ts` (`closeupCap` 0/24/48, `closeupDistanceM` 0/25/35).
- **Truck road (#146):** engine road graph in `engine/landsideGraph.ts` (affects goldens). The rendered access road is scenery only: `terminals/tti-algeciras/scenery.ts` plus `SURROUNDINGS.landside` in `terminals/tti-algeciras/constants.ts`.
- **Scenery and North Quay (#147):** land plane in `modules/backdrop.ts`; TTI scenery and the North Quay slab (`NORTH_QUAY_LENGTH_M`) in the TTI terminal folder.
- **Arrival stows (#148):** `scenario/bayPlan.ts` `planCargo`; ROB in `scenario/robBays.ts` (`DEFAULT_ROB_FILL = 0.7`), peak-day ROB in TTI `constants.ts`.
- **Yard mix (#149):** `engine/prefill.ts` (`planPrefill`), grouping keys in `engine/decisions/yardGrouping.ts`; presets in `scenario/presets.ts` (peak day at 75%).
- **Start screen (#144/#145):** `components/setup/ScenarioPicker.vue`, model in `modules/scenarioPicker.ts`; fixture names and descriptions in `scenario/fixtures/definitions.ts`.
- **Countdown (#141):** `modules/vesselStatus.ts` hides the label once berthed; first move time exists only per STS (`firstMoveStartS` in `engine/state.ts`), so it must be added to the vessel status input.
- **Audio (#137):** `src/components/AudioControls.vue`; the speaker opens the popover today.
- **Build stamp (#136):** `vite.config.ts` has no `define` yet.

## Reference photos

Committed in `docs/reference/tti-algeciras/` (owner decision). The aerial road layout photo for #146 and #147 is `aerial-tti-terminal-road-layout.webp`; the bay overview and map are there too. Older photos from `tti1.zip` are still missing: ask the owner to upload them if a ticket needs them.

## Gotchas from the last run

- Unit tests take about 2 minutes on a quiet machine and 5 to 6 under load; `golden-update.test.ts` and `invariants-incremental.test.ts` can time out under load, so re-run alone before calling them real.
- The full smoke suite takes 40 to 50 minutes; run it only in #150. Implementers run lint, build, their own unit tests and only the smoke specs for paths they changed (`scripts/smoke-specs-for.sh`).
- Load-sensitive smoke specs: the "Run to" popup, the debugger follow camera, the KPI end condition, container close-up. They pass on an idle machine.
- Container restarts can kill background runs: re-run checks by hand, then push.
- After a hand-resolved merge, `scripts/merge-ticket.sh` does not auto-push: push once `pnpm run verify` is green.
- GitHub did not auto-close issues from `Closes` lines when PR #132 merged; close them by hand after merging.

## Owner instruction for this run

No unit tests, `pnpm run verify` or browser smoke specs per ticket: the single full run (verify, goldens, smoke) happens at the end, in #150. Merges are plain `git merge` without `scripts/merge-ticket.sh` verification, so #137, #138 and #146 have only the implementers' own verify results (#137 and #146 ran verify green; #138 not confirmed) and the combined tree is unverified. Allowed per ticket: lint, build, targeted tests that take seconds.

## State

| Ticket | State |
|---|---|
| #135, #136 | merged (verified) |
| #137 audio control | merged (implementer ran verify green) |
| #138 speed steps | merged, verify not confirmed |
| #139 dashboard | merged, lint and build only; smoke specs written, never run |
| #140 colour by | merged, lint and own tests; screenshot not taken |
| #141 countdown | merged, lint, build, vessel-status tests; smoke spec never run |
| #142 spreaders, SHC spawn | merged, lint and build; two smoke specs never run |
| #143 close-up faces | merged, no verify, specs never run, frame times not measured |
| #146 TTI road | merged, ENGINE_VERSION 0.27.0 |
| #147 scenery, North Quay | merged, scenery only, no frame stats |
| #148 arrival stows | merged, 0.28.0, goldens stale on purpose |
| #149 yard mix | merged, 0.29.0, goldens stale, KPI before/after in commit message |
| #144 start screen prototype | owner approved variant B (decision comment on #144); prototype branch not merged, worktree still to remove |
| #145 start screen build | merged, lint, build, picker and catalogue tests only; smoke specs never run |
| #150 smoke suite | last |

## To do at the end (in #150 or just before)

1. `pnpm install`, then `pnpm run verify`; fix failures from the unverified merges (#137, #138, #143, #146, #148 touched engine or shared files).
2. Regenerate goldens once, on purpose (#149 is merged): `UPDATE_GOLDEN=1 pnpm test`; record KPI comparisons (the #148 one is in its commit message; #149's is in its commit message).
3. Run the smoke specs that were never run: build stamp (dev and prod), audio (Terminal Twin and Container Stack), close-up block edge, and the `@load` 10-boxes-wide spec locally only. #143 assumes block `B01` exists in the TTI baseline.
4. Implementer follow-ups: #148 fill is only 35 to 46% for feeders at full scale (30% test floor), and ROB bays can leave one STS working a call (owner may want a spread rule); #143 dropped the old per-box door rods and corner castings (the GLB LOD0 carries them) and its frame-time table in `docs/scene-quality-atmosphere.md` says "not measured".

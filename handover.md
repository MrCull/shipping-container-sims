# Handover: spec #134 (Terminal Twin polish, round 2)

**Status: #135 (em dash sweep) merged in the integration branch `claude/stoic-hypatia-tk68z1`; #136 onward not started.** A new session implements them with `/implement-spec` on #134. Delete this file in the PR that finishes the spec.

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

Git-ignored, so they exist only in the container they were uploaded to. The aerial road layout photo for #146 and #147 (`docs/reference/tti-algeciras/aerial-tti-terminal-road-layout.webp`) is on the GitHub conversation only: ask the owner to re-upload it (and `tti1.zip` for the older set) before starting #146 or #147. Never commit photos.

## Gotchas from the last run

- Unit tests take about 2 minutes on a quiet machine and 5 to 6 under load; `golden-update.test.ts` and `invariants-incremental.test.ts` can time out under load, so re-run alone before calling them real.
- The full smoke suite takes 40 to 50 minutes; run it only in #150. Implementers run lint, build, their own unit tests and only the smoke specs for paths they changed (`scripts/smoke-specs-for.sh`).
- Load-sensitive smoke specs: the "Run to" popup, the debugger follow camera, the KPI end condition, container close-up. They pass on an idle machine.
- Container restarts can kill background runs: re-run checks by hand, then push.
- After a hand-resolved merge, `scripts/merge-ticket.sh` does not auto-push: push once `pnpm run verify` is green.
- GitHub did not auto-close issues from `Closes` lines when PR #132 merged; close them by hand after merging.

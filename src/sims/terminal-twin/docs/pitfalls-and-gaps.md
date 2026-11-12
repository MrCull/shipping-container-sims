# Pitfalls, known behaviours and gaps

Checked against ENGINE_VERSION 0.53.0.

Read this before changing engine behaviour, writing a test against the event log, comparing runs or reporting a
"bug" that may be a modelled limit. Each entry is one or two lines with a pointer to the doc or code that has the
detail. Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## Determinism, events and the log

- **Every decision adds two events** (`DecisionRequested`, `DecisionResolved`); every run has `berthAllocation` and
  `craneSplit` pairs before the first STS move. Tests must filter on `payload.decisionPoint` (see `gpEvent` / `gpOfType`
  in `tests/decisions.test.ts`). [decision-points.md](decision-points.md)
- **Pre-run decisions** of a `prefilled` start are in the log with `payload.preRun: true`, at sim time 0, before
  `ScenarioStarted`; the KPI collector skips them. Filter on `preRun` when counting decisions. [scenarios-and-persistence.md](scenarios-and-persistence.md)
- **`ScenarioEnded` and `InvariantViolated`** are committed directly: not queued, not invariant-checked. `engine/simulation.ts#createSimulation`
- **`wallLatencyMs`** on `DecisionResolved` is not hashed and is absent when 0; with a real async handler the payload
  and the handler latency KPI are timing dependent. [decision-points.md](decision-points.md)
- **Caches keyed on object identity**: lane graph and shortest paths per config, road zones per landside graph, yard,
  vessel-slot and occupancy indexes per `state.*` object. Never mutate a config after `createSimulation`. [engine-core.md](engine-core.md)
- **Reefer flag** comes from a hash of the container id, not the RNG stream, so `cargo.reeferShare` does not shift other
  random draws. [subsystems/yard.md](subsystems/yard.md)
- **Logs** (`--log`) are derived from committed events only; there is no free-text reactor logging. [cli-and-tooling.md](cli-and-tooling.md)
- **Hatch job restarts after a lashing wait are timing dependent**: compare hatch steps as distinct (panel, op) pairs,
  not as a sequence. [subsystems/quay.md](subsystems/quay.md)

## Invariants

- **Incremental checks see only the event's subjects.** An event that changes a container's custody or yard slot must
  list it in `subjects.containers`, else the violation surfaces only at the next sweep (every `DEFAULT_SWEEP_EVERY`
  1000 events) and is attributed to the sweep's event. Guard: `tests/invariants-incremental.test.ts`. [invariants.md](invariants.md)
- **`STATE_NEUTRAL_EVENTS`** (only `DecisionRequested`) skips the per-event check. Add a type only if its reactors and
  handlers change nothing an invariant reads; it changes `invariants.checks` in goldens. `engine/invariants.ts`
- **Time-based invariants** (`landside.stranded-truck`, `yard.no-progress`) are checked at their deadline
  (`invariantDeadline`) even with no event, and the closing sweep of a duration-ended run moves the clock to the end first.
- **`STALL_STRAND_LIMIT_S` is 1800 s** for stranded trucks, exit-slot waits and yard deadlock; a block with a working
  ASC never fires `yard.no-progress`; a queued pick truck's wait counts from its gate-in (#209). [subsystems/yard.md](subsystems/yard.md)
- **A rail stall breaks no invariant**: two cranes waiting for each other just stop moving, so the move count (or the
  run ending `idle`) is the check (`tests/crane-split.test.ts`).
- **Index upkeep is mandatory**: `indexVesselSlotAdded` / `indexVesselSlotRemoved` on any `state.vesselSlots` change
  after start, `occupancySlotFilled` / `occupancySlotCleared` on any slot `containerId` change, `notePlanChanged` when a
  `plannedContainerId` is set after start, `indexYardSlotAdded` / `indexYardSlotRemoved` for yard slots. Today:
  `bookExtraExport` (landside) and the STS pick and `StsLoaded` in `subsystems/quay.ts`. [optimising/run-speed.md](optimising/run-speed.md)
- **Treat cached results as read-only** (`retrievalRanks` maps, index lists). `computeRetrievalRanks` is the uncached form.
- **Any code building a `YardStacks` must fill `stackSpans`** (via `stackSpansOf`) and the reefer fields
  (`reeferFields`), or `candidateSlots` offers illegal slots. [subsystems/yard.md](subsystems/yard.md)

## Decision points and latency

- **An injected delay of at least `timeoutMs` (default 5 s, `DEFAULT_DECISION_TIMEOUT_MS`) is a timeout**: raise
  `timeoutMs` for long latencies.
- **Stale replies are realistic**: in keep-running mode a reply computed at request time arrives later; two SHCs asking
  `wtpPadSelection` at once can get the same pad. Invariants flag the result.
- **`kpis.handlers` omits decision points never called**, so fixtures without SHCs keep their goldens.
- **Default strategies are not the TTI strategies.** TTI presets set `shcDispatch` `chained-nearest`, `wtpPadSelection`
  `balanced`, `transferStallSelection` `spread-drops`; globals are `oldest-job`, `first-free`, `nearest-to-box`.
  [decision-points.md](decision-points.md)
- **Default flip (0.25.0)**: `yardAllocation` `grouped`, `emptyAllocation` `iso-type-best-position`,
  `vesselPlanning.ordering` `pod-weight`. Roll back per point (`--strategy yardAllocation=nearest-wtp`, `--ordering
  as-today`). Absent settings behave like the new defaults (`yardGroupingOn`, `vesselOrderingOf`).
- **`group-by-vessel` has no alias**: a saved config naming it fails with the list of available strategies.
- **Fixtures that isolate dispatch pin `yardAllocation: nearest-wtp`** (`shc-queue-chained`, `shc-prepositioning`,
  `shc-paired-dual-cycle`): under `grouped` the ASC is the bottleneck and `predispatch` loses its edge.
- **`shcDispatch` replies only `{jobId}`**; a discharge job is then held while `wtpPadSelection` answers; a `null` pad
  gives the job back and parks the SHC. Load jobs name their own pad and never ask. [subsystems/horizontal.md](subsystems/horizontal.md)

## Quay, vessel planning and cranes

- **Peak day looks slow and is not a defect**: about 9 gross moves per STS-hour, about 29 for a crane never held up.
  Rail conflicts, anchorage queueing, load prep after discharge, rehandles and hatch work stack up. [optimising/terminal-throughput.md](optimising/terminal-throughput.md)
- **`stsMinSpacingM` 27 m vs a 14 m bay pitch**: cranes either side of a split boundary cannot work adjacent bays.
  Bounded yield (#174) and lowest-rail-index-first yield (`askToYield`, #212) prevent the deadlock, not the wait. [subsystems/quay.md](subsystems/quay.md)
- **Berth allocation is first come first served**: a vessel that fits cannot overtake the head of the anchorage queue.
- **Load boxes get their SHC job only after the crane's discharge before them is done** (`engine/subsystems/loadPrep.ts`);
  staged boxes (`loadReleaseAhead`) wait on pads without a job, which the load `horizontal` wait counts.
- **Stow sequence `tier`**: discharge highest tier first across a bay section, load lowest first. Twin-20 halves pair on
  discharge only (`twinLeads`); pairing on load deadlocked `Small automated`.
- **Tier stow throughput gap (#187, open)**: TTI baseline first 90 minutes 23 to 24 moves and 1 to 3 twin-20 lifts vs 26
  and 4 before #174; no small safe engine change is evident.
- **Shared cells (#203)**: discharge and load share a bay's cells; `pumpLoadPrep` asks a ground position only when
  `cellIsEmpty`. A discharge package never reads a shared slot's `emptyReq`. [subsystems/quay.md](subsystems/quay.md)
- **Bay planner `break` in `fill`** (`scenario/bayPlan.ts`): unreached by any scenario; if reached, `units.forEach`
  throws on the missing cell (a crash, not a short plan).
- **Late export bookings** (`bookExtraExport`) need the vessel `scheduled` and with room, else trucks are not offered it.
- **Hatch panel counts per class** differ from the spec example (feeder 2, ULCV 4): a panel must fit the laydown bay.
  Every fixture except `hatch-cover-cycle` and `hatch-deck-only-no-open` sets `hatch.enabled: false`.
- **`arrivalFill`** (`NORMAL_ARRIVAL_FILL` 0.7) adds ROB bays; ties and bay granularity put `Small automated` at 60 to
  80 %, and at moves scale 1 the load side limits it. [scenarios-and-persistence.md](scenarios-and-persistence.md)
- **STS ground wake-up**: a crane with no ground position re-asks on a freed position or every `stsGroundRetryS` (30 s,
  0 = off); a handler that always returns `null` keeps asking.

## Horizontal transport (SHC)

- **SHCs corner at about 4.2 m/s** (`cornerRadiusM` 12 m, lateral accel 1.5 m/s²) and stop for reversals, locks and
  pads; `cornerRadiusM: 0` restores stop-at-every-turn. Landside trucks still stop at turns, except at `rolling` loop corners.
- **`chained-nearest` takes the lowest-numbered free SHC**: on TTI most SHCs stay parked. Not a throughput loss (#239:
  load jobs are claimed the second they exist).
- **Pad wait (#218)**: a job refused a pad is parked (`ShcJob.padWait`, key `padRoomKey`) until pad room changes
  (`padRoomMayHaveRisen` on `AscRetrieved`). The zero-time re-ask #214 reported was not reproduced (`tests/shc-block-full-reask.test.ts`).
- **Parking area grows landside**, one row per pair of SHCs; a bigger fleet adds rows, not length west. [subsystems/horizontal.md](subsystems/horizontal.md)
- **Lane-node count grows with quay length x ground-position lanes** (a 2 km quay with 3 lanes is about 1,000 nodes):
  fine with the path caches, watch it at larger scale.

## Yard

- **`rehandle: full` is a dead end until an ASC lifts a box**: `reopenFullJobs` on `AscRetrieved` is the only retry.
  Room appearing without a lift, or a null reply after room appeared, are unproven gaps. [subsystems/yard.md](subsystems/yard.md)
- **Rehandle rule**: a stack a truck is coming for is forbidden as a target only for a truck holding a stall
  (`rehandleCandidates`); a retrieval with `dispatch: 'asked'` counts as taken (`nextBlocker`, the #188 race fix).
- **`yardReserve` 0.1 and `spread-drops` are load-bearing** on TTI presets; removing either deadlocks the yard at scale.
- **Pre-fill ignores load order**, so many export retrievals are buried; `grouped` and `pod-weight` reduce, not remove, rehandles.
- **Mixed lines in the pre-fill (#163)**: filler imports group by flow, not line; empties keep to blocks by size and ISO
  type (each empty stack still one line). The run-time `grouped` strategy keeps its groups.
- **Reefers** go only to powered rows below tier 5 (`REEFER_MAX_TIERS` 4); TTI preset values are unverified.

## Landside

- **A dual transaction's drop has no room filter**: its own pick is the only thing that frees a cell, so filtering it
  would deadlock the gate. A drop refused for geometry waits for a retrieval in its block; `landside.stranded-truck`
  reports it if none comes. [subsystems/landside.md](subsystems/landside.md)
- **A truck with a pick keeps its box's block**: an ASC reaches only its own block's stalls.
- **Gate bypass** admits a queued pick for a free block at once, but it takes a lane only at the head (#208).
- **Exits despawn at the gate's outbound lanes**: trucks do not drive back out along the access road.

## Snapshots, CLI and measuring

- **Snapshots embed the full event log**; `--from-snapshot` runs write only the window's events and log lines, but KPIs
  and the hash in the summary are cumulative from t = 0. [scenarios-and-persistence.md](scenarios-and-persistence.md)
- **`--until time:T` leaves `now = T`**: events at `t <= T` are in the snapshot, the window holds `t > T`.
- **Handlers are not in snapshots**: pass the same `--handlers` when resuming.
- **Snapshot size**: 1.4 GB at 0.25 peak day sim 7,200 s; resuming a larger one may need `NODE_OPTIONS=--max-old-space-size=<MB>`.
- **Piping `tt:run` into `head`** gives a harmless EPIPE stack trace.
- **`STS0n waited N s for a free ground position`** in `tt:run` sums ground and load-box waits (`stsGroundPositionWaitS`
  is fed by both wait-end events); use `tt:sts` buckets to separate them. [optimising/terminal-throughput.md](optimising/terminal-throughput.md)
- **`tt:profile` has no `--strategy`**; `scripts/proof-runner.sh` splits variants on spaces, so it cannot take preset
  names; `tt:run` prints no wall time; `perf/baseline.json` of `tt:bench` is from older engines. [cli-and-tooling.md](cli-and-tooling.md)
- **Run peak-day jobs one at a time** (`scripts/bg.sh run --heavy`): shared cores inflate wall time 50 to 75 %.
- **Full-size peak day is 554 s wall**, 8 % under the 10 minute criterion: a new unscoped invariant can break it. [optimising/run-speed.md](optimising/run-speed.md)
- **Never regenerate goldens to make a test pass** unless the behaviour change is intended; two branches that both
  regenerate goldens must regenerate again on the merged tree. [kpis-and-reports.md](kpis-and-reports.md)

## Known gaps (accepted, not built)

- **Extra shortcuts** E, I and P and the ASC yield moves go beyond the spec (accepted scope). [browser-host.md](browser-host.md)
- **Far-field livery and corrugation (#170)**: wordmark and rib shading fade to body colour beyond about 80 to 100 m;
  the Yard view (about 493 m) showed no text; roofs carry no text. Fixed by the far-field wordmark atlas (#256, `livery-atlas-far.webp`, blended in by camera distance, see rendering-3d.md); a box seen from the Yard view is only a few pixels long, so the wordmark reads as a coloured band, not as letters. Frame time of the extra texture sample is for the laptop benchmark (#262). The close-up corrugation pitch (`CORRUGATION_PITCH_M` 0.25 m) differs from the LOD0 GLB rib (0.56 m) on purpose. [assets-pipeline.md](assets-pipeline.md), [rendering-3d.md](rendering-3d.md)
- **Hub files** `store/twinStore.ts` and `engine/subsystems/asc.ts` are large; splitting them was out of scope (the ASC
  subsystem is already split into `asc.ts`, `ascStorage.ts`, `ascReservations.ts`, `ascDispatch.ts` and pure `ascRail.ts`). [architecture.md](architecture.md)
- **Setup dialog shape**: `SetupDialog.vue` is a shell; a new setup section is a `components/setup/Setup<Section>Section.vue`
  plus a draft field in `composables/useSetupDraft.ts` plus a `*Validation.ts` validator placed on a tab
  (`modules/setupTabs.ts`). The end-conditions fieldset stays inline because `tests/setup-inputs.test.ts` reads it. [browser-host.md](browser-host.md)
- **Code-review smells accepted for v1.1**:
  - duplicated lock and unlock inputs and readout guards across `SetupStsSection`, `SetupShcSection`,
    `SetupYardSection` and the `*Validation.ts` files (candidates: a `LockUnlockFields` component, a `kinematicsValid` helper);
  - `modules/equipmentKinds/sts.ts` and `asc.ts` repeat the same equipment-kind skeleton;
  - unnamed magic numbers in `components/setup/yardValidation.ts` and `shcValidation.ts` (8 rows per bay, a nominal 300 m trip);
  - `modules/sceneModel.ts` keeps a kind chain beside the equipment registry;
  - `dev/devApi.ts` builds the scene state with `state as unknown as SceneState` (wants a typed builder).
- **Not modelled yet** (throughput follow-ups, not defects): berth overtaking, load-box fetch during discharge, crane
  split with spacing-aware boundaries. [optimising/terminal-throughput.md](optimising/terminal-throughput.md)
- **Not landed (#229, #240)**: package look-ahead for a yielding crane in `prepareNextPackage` was inert at 0.1 and
  0.5; `tests/yielding-crane-packages.test.ts` guards that no crane starts a package and waits for the rail on the 4-STS fixture.
- **Yard boxes float above a standard-height box.** Every yard tier is one high-cube height (`engine/yardLayout.ts#tierBaseY`, `TIER_PITCH_M` 2.896), so a 2.591 m box leaves a 0.305 m gap under the box above it. The ASC hoist distances (`engine/subsystems/ascReservations.ts`) use the same grid, so settling the boxes in the renderer alone would have cranes release them in mid-air: the fix is in the engine and moves the goldens.

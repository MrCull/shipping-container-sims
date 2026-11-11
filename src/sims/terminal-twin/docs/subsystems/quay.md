# Quay subsystem: vessels, berths, STS cranes, hatch covers

Checked against ENGINE_VERSION 0.53.0.

Read this when you change or tune anything between a vessel's arrival and its departure: berth allocation, the
crane split, the shared STS rail, the STS discharge and load cycles, work packages, the vessel work order (POD and
weight, tier order), hatch covers, ROB bays, or the vessel-side stowage invariants. Horizontal transport from the
ground positions onwards is [horizontal.md](horizontal.md). Terms: [GLOSSARY.md](../../../../../GLOSSARY.md).

## Files

| File | Role |
|---|---|
| `engine/subsystems/berth.ts` | Vessel call lifecycle, `berthAllocation` and `craneSplit` requests, `validateSplit`, vessel departure |
| `engine/subsystems/quay.ts` | STS discharge and load cycles, ground-position requests, twin-20, `predictedGroundings`, quay mode `instant` |
| `engine/subsystems/rail.ts` | Rail reservations, `wakeRail`, step-aside and bounded yield (`askToYield`) |
| `engine/subsystems/workPackages.ts` | `createPackages`, `workPackageRelease` requests, `prepareNextPackage`, load orders |
| `engine/subsystems/hatch.ts` | Hatch reactors: lashing, removal, laydown, replacement, securing, waits |
| `engine/hatch.ts` | Pure hatch part: settings, laydown sites and geometry, `hatchLaydownProblems`, `createHatchPanels` |
| `engine/vesselOrdering.ts` | Pure work order inside a bay section: `orderDischarge`, `orderLoad`, `stowByPodWeight`, ordering KPIs |
| `engine/kinematics.ts` | Trapezoidal / triangular axis profiles, `planSegment`, `positionAt`, `travelTime`, `cornerSpeedCap` |
| `engine/cycleTime.ts` | Nominal cycle readouts (`stsNominalCycle`, `shcNominalCycle`, `ascNominalCycle`) |
| `engine/stsProductivity.ts` | Crane time buckets from an event log (`tt:sts`) |
| `engine/predictions.ts` | `predictedReady`: union of quay and ASC predictions, read by SHC pre-dispatch |
| `engine/decisions/quayStrategies.ts`, `workPackageStrategies.ts` | Built-in berth, crane-split and release strategies |
| `scenario/vesselClasses.ts` | Size classes, hull profile, slot and panel geometry and ids |
| `scenario/bayPlan.ts`, `scenario/robBays.ts` | Arrival stow and load bookings (`planCargo`), ROB bays |

## Vessel call lifecycle (`engine/subsystems/berth.ts`)

`config.vessels` holds vessel calls: `arrivalS`, `sizeClass`, `discharge`, `load`, `transshipment`, `maxSts`, optional
`sizeMix`, `dischargeTransshipment`, `deckOnly`, `empties`. Berth position and cranes are not config: decision points
choose them. `DEFAULT_MAX_STS` (`scenario/builder.ts`): feeder 2, feedermax 3, panamax 4, neo-panamax 5, ULCV 6.

```
ScenarioStarted -> VesselArrived (status at-anchorage, pushed on berth.queue)
  -> berthAllocation (head of queue only, one pending: berth.allocating)
     reply null    -> VesselAtAnchorage (once per vessel); asked again at every VesselDeparted
     reply berthX  -> validateBerth -> BerthAllocated (status mooring, panels positioned)
  -> +quay.mooringS -> VesselBerthed
     nothing to do (or quay off) -> VesselWorkComplete at once
     else pushed on berth.craneQueue -> craneSplit (head only, one pending: berth.splitting)
  -> STS work (packages) -> StsWorkComplete per crane
  -> last crane released and remainingDischarge 0 and (remainingLoad 0 or load inactive) -> VesselWorkComplete
  -> +quay.unmooringS -> VesselDeparted (kpis.vesselsCompleted++, tryAllocateBerth)
```

- Defaults (`DEFAULT_QUAY`, `scenario/builder.ts`, all [A]): `lengthM` 400, `berthGapM` 15, `mooringS` 1800,
  `unmooringS` 1200, `stsMinSpacingM` 27, `twinLift` true. TTI presets set mooring 1800 / unmooring 1200 explicitly.
- Berth allocation is strictly first come, first served: only `berth.queue[0]` is asked. A vessel that never fits
  (LOA > quay) blocks the queue for good (the setup dialog warns).
- `validateBerth` throws (the run fails) for a berth off the quay or within `berthGapM` of a vessel on the quay
  (mooring, berthed or unmooring). Anchorage wait = allocation minus arrival (`VesselState.anchorageWaitS`).
- The quay stretch is held from `BerthAllocated` until `VesselDeparted`.
- An empty `craneSplit` reply (no eligible free crane) keeps the vessel at the head of `craneQueue`; it is asked again
  on the next `StsWorkComplete` or `VesselBerthed`. Re-asking at once would loop at one instant.
- With no end condition configured the run ends when every vessel has departed.

### Berth allocation strategies (`berthAllocation`, default `first-fit`)

`berthCandidates` lists every stern position that fits: X 0, or just past a vessel on the quay plus `berthGapM`.
`first-fit`: the lowest candidate. `best-fit`: the candidate whose free gap is shortest. Berth mode `off` skips the
decision and runs `firstFitBerth` in `berth.ts` (leftmost stretch, anchorage if none).

### Crane split (`craneSplit`, default `balanced-moves`)

Request: the vessel's work bays (`workBays`: bays with a discharge box on board, or a load slot when the load flow is
active, with gantry X and move count), every crane in rail order with its vessel. Reply: assignments of crane to an
ascending bay list.

1. `eligibleCranes`: free cranes for which every busy crane of another vessel stays on its correct side (a crane of a
   vessel berthed further along the quay must be at a higher rail index, and vice versa).
2. `chooseCranes`: `n = min(maxSts, bays)` consecutive eligible cranes whose mean gantry X is nearest the mean X of
   the work bays.
3. `partition`: linear partition by dynamic programming, minimising the heaviest group then the sum of squares.
   Weight per bay: moves (`balanced-moves`) or 1 (`equal-bays`).

`validateSplit` (engine) rejects: more than `maxSts` cranes, unknown / duplicate / busy cranes, empty or non-ascending
bay lists, bay ranges out of rail order, bays not exactly covering the work bays, a busy crane between the assigned
ones, or a busy crane that would have to pass them. On acceptance each crane gets `createPackages`, `askRelease` and
`continueWork` (a crane that was stepping aside drops that; a repositioning crane starts at `StsRepositionCompleted`).

## Vessel geometry, slots and the hull profile

`scenario/vesselClasses.ts` (`VESSEL_CLASSES`, all [A]): LOA, beam, 40 ft bays, rows, `holdRows`, hold and deck
tiers, `deckHeightM`, `hatch`. Frame: `berthX` is the stern; bay 0 aft; row 0 quay side; tier 0 the hold floor,
tiers >= `holdTiers` on deck. `BAY_PITCH_M` 14, `ROW_PITCH_M` 2.55, `TIER_PITCH_M` 2.896, `HALF_OFFSET_M` 3.067.
A cell holds one 40 ft or two 20 ft halves (`aft` / `fore`). Slot id `V001:BB-RR-TT[a|f]` (`vesselSlotId`). Engine,
scene model and renderer share `slotX`, `slotZ`, `tierBaseY`.

**Hull profile (V-shaped holds).** `holdRows` lists the usable rows per hold tier, bottom first, centred on the beam
(feeder 4/6/6/8 of 8 rows; ULCV 11 up to 23 of 23); deck tiers keep every row. `rowRange`, `isCellUsable`,
`stackBaseTier`, `isStackBase`, `cellsPerBay`, `cellCapacity` are the one source: never enumerate `0..spec.rows` for a
hold tier. A hold stack starts at its row's `stackBaseTier`, which is above tier 0 in outer rows, so "bottom of the
stack" is `isStackBase`, not tier 0. Used by the bay planner (discharge fill, load cells, reserved slots,
`extraLoadCell`), ROB fill and `workableCells`, and the capacity check (`setup.check.capacity`,
`scenario/overrides.ts`). Invariant `hull.profile`: a box on board never sits outside its tier's rows.

**Bay plan (`planCargo(config, seed)`, own RNG stream).** Discharge boxes are spread unevenly over bays, hold and
deck in proportion (deck only with `deckOnly`), stacked bottom up and level: a bay section uses the fewest stacks
nearest the centreline that hold its cells, each next box goes on the lowest of them (ties nearest the centreline),
used stacks differ by at most one tier. 20 ft boxes pair aft/fore; never a 20 on a 40 or a 40 on a single 20 half; a
lone 20 ft half goes on top of the lowest stack (after trading places with twin-20 cells) or on the floor of the
stack that leaves the section most level. Load bookings (exports, transshipment, then empties, one bay per empties
requirement) fill every non-ROB cell bottom up (hold before deck, lowest tier first, level, bays round-robin), so
discharge and load **share cells** (#203): a load booking of the same shape as a discharge slot reuses it
(`PlannedSlot.loadPurpose`; `loadPurposeOf`), the other shape is a separate slot of the same cell. The fit check
counts discharge and load separately (`N discharge cells ... do not fit`, `N load cells do not fit`). The scene model
regenerates the plan from config and seed, so it never crosses the worker protocol. Query: `sim.query.vesselSlots(id?)`.
Detail of the planner's inputs (props, presets): [../scenarios-and-persistence.md](../scenarios-and-persistence.md).

### ROB bays (engine side)

`ScenarioConfig.robBayFraction` (default 0; builder `.robBays(fraction, fill?)`) sets aside `round(fraction x bays)`
of each vessel's bays (never all) as remain-on-board bays; `robFill` (default `DEFAULT_ROB_FILL` 0.7). All in
`scenario/robBays.ts`. `arrivalFill` (presets: `NORMAL_ARRIVAL_FILL` 0.7) adds extra ROB bays so a small call still
looks stowed (`arrivalRobBayCount`).

- Not worked: `pickRobBays` (property stream keyed by seed and vessel id, so no engine or bay-plan stream moves)
  chooses them; `planVessel` leaves them out of the discharge spread, the load cells and the reserved-slot search;
  the capacity check counts working bays only (`workableCells`); `extraLoadCell` skips `VesselState.robBays`. ROB bays
  have no `vesselSlots`, no work packages, no moves. Their hatch panels are created and stay `secured` all run.
- Contents are display data: `VesselState.robBoxes` are `RobBox` entries (slot id, bay/row/tier, half, size, ISO
  type, POD, line, weight class, gross kg, full), not containers: not in `state.containers`, KPIs, yard or cranes.
  Engine readers: the vessel occupancy index (`engine/vesselOccupancy.ts`) and the `stowage.no-floating` /
  `stowage.cell-free` invariants. Renderers and bay viewer: [../rendering-3d.md](../rendering-3d.md), [../browser-host.md](../browser-host.md).
- Fill [A] (`fillRobBays`, `stackHeights`): per bay hold and deck each get `round(fill x cells)` cells, stacks built
  bottom up and level, twin-20 cells first then 40 ft (`stackAccepts`), heaviest first within a kind. PODs come from
  the ports after the terminal in the rotation (`laterPorts`). Lines and empty share follow `config.cargo`.
- A vessel whose working bays cannot hold its discharge and load throws at planning ("do not fit"): lower the fraction.
  `validateRob` runs in `validateScenario`. Peak-day preset: `PEAK_DAY_ROB` (30 % of bays, 70 % full,
  `terminals/tti-algeciras/constants.ts`).

## STS ground positions

Each STS owns `groundPositions` lanes (`StsConfig.groundPositions`); ids `<stsId>-GP<n>` (`groundPositionId`). Lane j
is at Z = `layout.stsGroundLaneZ0M` (8) + j x `stsGroundLaneSpacingM` (3) (`DEFAULT_LAYOUT`). A ground position has
no fixed X: a box lies on its lane at the crane's gantry X at set-down (`StsGrounded.payload.x`, `ShcJob.x`). State:
`GroundPositionState {stsId, lane, containerId, claimedBy}` (`claimedBy` = export box reserved for it). Fixtures
without SHCs give each STS enough positions for all its boxes (nothing clears them); SHC fixtures and presets use 3.
With SHCs `validateLaneLayout` caps the lanes (see [horizontal.md](horizontal.md)).

`stsGroundPosition` (default `lowest-free-lane`; also `highest-free-lane`) is asked once per carried box with every
position's `occupiedBy` (box, claim, or a drop already chosen by this crane). A `null` reply: `StsWaitingForGroundPosition`
(status `waiting-for-ground-position`); it ends with `StsGroundPositionWaitEnded {waitedS}` when an SHC picks a box off
that crane's lanes (`resumeStsWaitingForGroundPosition`), or after the back-off `layout.stsGroundRetryS`
(`DEFAULT_STS_GROUND_RETRY_S` 30 s, 0 = off; `StsGroundPositionWaitBackoff`). The wait sums into
`kpis.horizontal.stsGroundPositionWaitS`. An unknown id in the reply throws; a double-occupied position surfaces as
`custody.single-owner`.

## STS rail (`engine/subsystems/rail.ts`)

Cranes never pass. Each crane holds `[railLo, railHi]` covering every gantry X of its current motion; neighbours stay
`stsMinSpacingM` (27 m) apart. Rail order = `railIndex` (config order).

1. `reserveRail(state, config, sts, targetX, alsoX?)`: span = current X to target (and `alsoX` for a hatch move that
   visits the laydown). Returns null and sets the span, or the blocking neighbour id, or `'quay-end'`.
2. Blocked: status `waiting-for-rail`, `railTargetX` set, `StsWaitingForRail {targetX, blockedBy}`, rail wait timer
   (`kpis.perSts.*.railWaitS`). Its reactor runs `wakeRail`.
3. `wakeRail` (after every rail change: `StsPicked`, `StsLoadPicked`, hatch set-down/replace, repositions, `StsWorkComplete`) retries every waiting crane in
   rail order, up to `2 x cranes + 2` passes until nothing changes. A crane with vessel work starts its move; a free or
   yielding crane gets `StsRepositionStarted -> StsRepositionCompleted`.
4. Still blocked: `askToYield(blocker)`. A blocker is yieldable when stationary (`railLo === railHi`) and either free
   (idle or waiting for the rail) or busy but waiting for the rail empty-handed (#174 bounded yield: two busy cranes
   whose targets lie on each other's side waited forever; the `adjacent` case in `tests/crane-split.test.ts` ended at
   24 of 40 moves). It is sent to the edge the waiter needs (`waiter extent +/- spacing`); a busy blocker sets
   `railYield`, repositions, then resumes through `continueWork`.
5. Three-crane fairness (#212, `railYieldFrom`): a blocker asked from both sides (or whose own want, laydown included,
   lies against the ask) serves the lowest rail index first; a higher-index ask is refused until it has moved. Without
   it the 0.5 peak day stalled at 89,151 s with the middle crane pulled both ways.
6. `releaseRail` shrinks the span to the crane's X at `StsPicked`, `StsLoadPicked`, hatch set-down/replace and
   `StsRepositionCompleted`.

A busy crane is never pushed while it carries or works, so a waiting crane may idle until its neighbour finishes.
Invariant `sts.rail-order` (after every event, reads `time`): order, spacing, position inside reservation, on the
quay. `berth.no-overlap` checks vessels.

## STS discharge cycle (`engine/subsystems/quay.ts`)

Each event's `segments` is the motion that led up to it. Axes move **one after another** (`planSequence`), never
together; each `planSequence` call draws one variation factor.

```
continueWork -> prepareNextPackage -> StsMoveStarted {containerIds (1, or 2 for twin-20)}
  reserveRail(liftX) blocked -> StsWaitingForRail (status waiting-for-rail)
  else status moving-to-pick: hoist up empty to stsSafeHoistM, gantry, trolley to slotZ(row),
       hoist down to tierBaseY(tier) + tallest box -> +lockS
-> StsPicked (custody slot -> STS; releaseRail; slot cleared; deckBoxChanged; shared slot flips to its load purpose)
   status waiting-for-decision -> stsGroundPosition per carried box
-> all boxes have a drop -> status carrying -> planDrop: hoist up loaded (to safe height), trolley to lane Z,
   hoist down to box height (with SHCs: start delayed until the lane zones under the box are free) -> +unlockS
-> StsGrounded {groundPositionId, x} (custody STS -> ground position; moves++; SHC job released)
   twin-20 second box: planDrop from 1 m above the box, no return to safe height
-> status returning: hoist up empty to safe height -> continueWork at the end of that hoist
```

`liftX` is the bay centre, or the half centre for a single 20 ft box. `planDrop` sets `StsDrop.groundAt` (used by the
predictions). With SHCs the STS reserves the lane sections and lane nodes within half a box length of the set-down
(`laneZonesAt`) from carry start to set-down plus unlock, and `earliestStart` delays the carry while an SHC is still
there. `StsWorkComplete` fires when every package is complete and no replaced panel is still unsecured.

**Load cycle** (export boxes): `StsLoadStarted {containerId, slotId}`. Box not on one of this crane's ground positions:
`StsWaitingForBox` (status `waiting-for-box`) until `ShcDroppedAtGround` raises `StsBoxWaitEnded {waitedS}` (added to
`stsGroundPositionWaitS`). Otherwise rail to `slotGantryX`, status `loading`, hoist up empty, gantry, trolley to the
lane, hoist down (with SHCs the pick waits until the delivering SHC has left the lane zones, and holds them until the
box is lifted clear) -> `StsLoadPicked` (custody GP -> STS, releaseRail, `pumpLoadPrep`) -> hoist up loaded, trolley
over the slot, hoist down -> `StsLoaded` (custody STS -> slot; `remainingLoad--`) -> hoist up empty -> next. Load moves
are single boxes (no twin-20 on load).

## Cycle-time model

- Profiles (`engine/kinematics.ts`): one `MotionSegment` per axis move, trapezoidal or triangular, rest to rest unless
  `v0`/`v1` are set (SHC cornering). End time known at plan time, so events are scheduled exactly; renderers use
  `positionAt`.
- STS defaults `DEFAULT_STS_KINEMATICS` (`scenario/builder.ts`, Malaccamax [A]): gantry 0.75 m/s (a 0.25 m/s^2,
  100 m takes about 136 s, one bay pitch about 22 s), trolley 4 m/s (0.8), hoist loaded 1.5 m/s (0.6), hoist empty
  3 m/s (0.8), `lockS` 3, `unlockS` 3. `layout.stsSafeHoistM` 50 m: every carry rises to it, the dominant hoist cost.
- Variation: `variation(ctx)` = 1 +/- `moveVariationPct` % (uniform, engine RNG) per `planSequence` call; profiles are
  scaled with `scaled` (time x f). Fixtures 0, presets 10.
- Nominal readout `stsNominalCycle` (setup dialog; no gantry, no waits; geometry `stsCycleGeometry`: middle row,
  mid tier of the first vessel's class): about 122 s (panamax) to 125 s (feeder), about 29 moves/h per crane.
  `tests/cycle-readout.test.ts` checks it against the engine's measured average.
- Where crane time actually goes: `stsProductivity` buckets (`cycle`, `hatch`, `lashing`, `ground`, `box`, `rail`,
  `reposition`, `done`) from the event log, `pnpm run tt:sts <events.jsonl> --until T`.

## Twin-20 lifts

`quay.twinLift` (default true): `nextLift` takes the next two boxes of the work queue when they are the aft and the
fore half of one cell (aft first). One `StsPicked` with `payload.twin`; each box gets its own ground-position decision;
they are set down one after the other (two `StsGrounded`, `payload.x` = set-down X, spreader offset `HALF_OFFSET_M`)
[A: sequential release]. KPIs: `moves` (boxes), `cycles`, `twinLifts`. Discharge ordering keeps pairs adjacent
(`twinLeads`, below). Fixture `twin-20-lift`: 4 moves in 2 cycles.

## Work packages (`engine/subsystems/workPackages.ts`)

A package = one crane's moves for one bay section (deck or hold) of one vessel: kind `discharge`, `load`,
`hatch-remove`, `hatch-replace`. Status `planned -> released -> active -> complete`. Ids `WP<n>`.

`createPackages(ctx, sts, vesselId, bays)` at crane split:
1. Discharge slots (box on board) sorted bay asc, deck first, tier desc, row asc, aft before fore; load slots
   (`isLoadSlot`, only while `loadActive`: quay, SHC and ASC all not `off`) by `loadSequenceKey` (bay, hold first,
   empties after boxes, tier asc, row, aft first).
2. With `pod-weight` (default) both lists are re-sorted by `orderDischarge` / `orderLoad` and `kpis.ordering` counted.
3. Consecutive slots of one bay section (and one empties requirement) form a package (`emptyReq` for empties).
4. Hatch off: all discharge packages, then all load packages. Hatch on, per bay ascending: deck discharge,
   `hatch-remove` per opening panel (index ascending), hold discharge, hold load, `hatch-replace` (reverse index, so the
   top of the laydown stack goes back first), deck load. A bay without hold work gets no hatch packages.

Release: `askRelease` asks `workPackageRelease` (one pending per crane, `sts.releasing`) at assignment and on every
`WorkPackageStarted` / `WorkPackageCompleted`. Strategies: `keep-k-ahead` (default; k = `config.workPackages.releaseAhead`,
default 2: keeps k+1 open) and `just-in-time` (one when none is open). The engine throws if a reply names a foreign or
non-planned package, or releases nothing while the crane has nothing to work. On release: `WorkPackageReleased`, load
orders for load packages (`createLoadOrders`), `raiseEmptiesRequired` for empties, `pumpLoadPrep`.

`prepareNextPackage` completes the active package (`WorkPackageCompleted {durationS}`), then starts the next: not
released -> `waiting` (ask release); empties not allocated -> `waiting`; deck load with an unsecured panel in the bay
-> wait for securing; else `WorkPackageStarted {leadTimeS}` (release to start). KPIs `kpis.workPackages`
(released, started, completed, lead time sum/max, boxesLoaded). Load preparation itself (pads, ASC retrieval,
`loadReleaseAhead`) is yard-side: [yard.md](yard.md).

## Vessel ordering and the stow sequence (`engine/vesselOrdering.ts`)

`config.vesselPlanning.ordering` (builder `.vesselPlanning({ ordering })`, CLI `--ordering as-today|pod-weight`) is a
planning option, not a decision point. Default `DEFAULT_VESSEL_ORDERING` = `pod-weight` (read via `vesselOrderingOf`).
`as-today` restores the plain sorts of `createPackages` and drops `kpis.ordering`. Stacking is the only hard rule;
POD and weight are soft preferences: nothing refuses or waits for them, broken preferences are counted.

- **Discharge, stow sequence `tier`** (`config.vesselPlanning.stowSequence`, only `tier`, `DEFAULT_STOW_SEQUENCE`,
  validated): per bay section (`bySection`), highest tier first across all stacks, so no stack is emptied to its floor
  while another stands high. Inside a tier: twin-20 pairs first (`twinLeads`: the fore half sorts with its aft half's
  key, #187; discharge only, because the same on load deadlocked `Small automated` with `yard.no-progress`), then
  `yardGroupOrderKey` (imports by line, transshipments by onward vessel and POD, storage empties by line, size and ISO
  type), then planned departure, row, aft before fore.
- **Load**: lowest tier first across the section; inside a tier the later POD first (`podRank` = position in the port
  rotation), then heavier (`grossKgOf`), then row and half. Empties requirements keep their place after the boxes.
- **Plan-time stowage** (`stowByPodWeight`, called by `planCargo`): booked export boxes of the same bay section, size
  and reefer-ness trade cells so later PODs and heavier boxes sit low. No random draw; transshipment and empties slots
  untouched; only the box-to-cell booking changes, so the yard pre-fill stays consistent.
- **KPIs** `kpiReport().ordering` (only with `pod-weight`, counted at package build): `discharge {boxes, groupSplits}`
  (`countDischargeSplits`), `load {boxes, podOnEarlier, heavyOnLight}` (`countLoadBreaks`, same row, box directly below).
- The package order and bay order do not depend on the ordering. Fixture `vessel-ordering-pod-weight`; hatch restarts
  after a lashing wait are timing dependent, so compare hatch steps as distinct (panel, op) pairs.

## Stowage rules on board

| Invariant | Rule | Scope |
|---|---|---|
| `stowage.order` | A filled load slot above its section base has a box directly below; no 20 on a 40; a 40 rests on a 40 or two filled halves | vessel moves, scoped |
| `stowage.no-floating` | Every box on board (discharge, load, transshipment, ROB) above its `isStackBase` has a box below (a half needs a half or a whole cell) | on arrival and every vessel move, `reads: vessel, container` |
| `stowage.cell-free` | No cell (either half for a 40, same half for a 20) holds two boxes, ROB boxes included (#202) | state-only, vessel-scoped; no hash change |
| `hull.profile` | No box outside its tier's rows | |

Shared cells in the engine (#203): `isLoadSlot` is true for a slot with a `loadPurpose`; `StsPicked` flips such a slot
to its load purpose once its discharge box is lifted; a discharge package never reads a shared slot's `emptyReq`;
`pumpLoadPrep` asks for a load box's ground position only when `cellIsEmpty` (no discharge box left in the cell).
Late truck exports use `extraLoadCell` and `bookExtraExport` (`engine/subsystems/landside.ts`), same bottom-up rule.
The arrival bay plan floats nothing for any fixture or preset over the nine seeds tested; `fill` in
`scenario/bayPlan.ts` would crash (not plan short) if a section ran out of cells.

## Hatch covers (`engine/hatch.ts`, `engine/subsystems/hatch.ts`)

STS cranes lift the hatch panels off a bay when its hold has work and put them back afterwards. On by default
(`hatchEnabled`: `config.hatch.enabled !== false`) and active only while the quay is not `off` (`hatchActive`).
Presets run with hatch covers on; most fixtures set `hatch.enabled: false`.

- **Settings** (`VESSEL_CLASSES[...].hatch`, `HATCH_DEFAULTS`, all [A]): `panels` across the beam (feeder 2,
  feedermax 2, panamax 2, neo-panamax 3, ULCV 4), `panelLengthM` 13.5, `panelWeightT` 12 to 32, `lashingReleaseS` 300,
  `lashingSecureS` 180, `cycleS` 240, `laydownStackLimit` 3. Panel width = its rows x `ROW_PITCH_M` minus `HATCH_GAP_M`
  0.3 (`hatchPanelWidthM`, about 15 m at most with these counts, which is what fits a laydown bay); thickness
  `HATCH_THICKNESS_M` 0.45. `ScenarioConfig.hatch` (builder `.hatch({...})`) overrides timings and stack limit for
  every class (`hatchSettings`).
- **State**: `state.hatchPanels[id]` (`HatchPanelState`, id `V001:H04-1` = bay 4, panel 1 from the quay side; rows,
  size, weight, `home`/`pos` as top-face centre, `status` secured/unsecured/lifted/in-laydown/replaced, `opens`,
  `deckBoxes`, `siteId`/`level`, `placedOn`), `state.hatchLaydown[siteId]` (stack, bottom first),
  `VesselState.hatchPanelIds`, `StsState.hatchJob/carryingPanel/hatchWaitPanel/hatchWaitSince`. Panels exist for every
  bay with a slot plus ROB bays, created secured (`createHatchPanels`) and placed at berth (`positionHatchPanels`).
  They are not containers: no custody, no yard slot, no move count.
- **Sequence**: at crane split `openingPanels` marks panels with hold work under them (hold discharge or a hold load
  slot) and `prepareHatches` counts their deck boxes. `deckBoxChanged` (from `StsPicked` / `StsLoaded`) keeps the count;
  at 0 `maybeReleaseLashing` schedules `HatchLashingReleased` (status `unsecured`) `lashingReleaseS` later.
  `StsHatchStarted` (re-raised after a rail or lashing wait): panel still secured -> `StsWaitingForHatch {reason:
  lashing}`; else `claimLaydown`, rail reserved for the whole move (`reserveRail(..., alsoX)`), leg 1 to the panel ->
  `HatchLifted {from: hatch|laydown}` -> leg 2 -> `HatchSetInLaydown {siteId, level}` (remove) or `HatchReplaced`
  (replace) -> `HatchSecured` after `lashingSecureS`. Each is caused by the one before; panels and the crane are the
  `equipment` subjects.
- **Cycle**: the motion is planned like a box move; `padOf` adds handling time split over lock and unlock so start to
  set-down = `cycleS` (the hoist back to the safe height comes after, so a measured move is a little longer).
- **Waits**: lashing release before a removal, securing before a deck load onto a replaced hatch (`hatchBlocker`), and
  the last securing before `StsWorkComplete` (`hatchOpenPanel`: no departure with an unsecured panel). KPI
  `hatch.waitS`.
- **Laydown**: `laydownSites`: one site per lane-graph station, X = -15 + pitch x k + 5 + (pitch - 5)/2 (25 k with the
  default 25 m station spacing: between an up spine and the next down spine), id `LD@<x>`. `claimLaydown` takes the
  nearest site with room whose stack holds only panels of the same hatch (throws when none). Z: landside of the last
  ground lane + `SHC_HALF_WIDTH_M` 2.45 + `LAYDOWN_CLEAR_M` 0.4, below the landside STS rail `STS_LAND_RAIL_Z` 33.48,
  else landside of the rail (only no-SHC scenarios with many lanes). `hatchLaydownProblems(config)` checks every site
  at the widest panel against ground lanes, rails and (with SHCs) lane-graph nodes, edges and zones;
  `createInitialState` throws on a problem, which with SHCs means more than 3 ground positions per STS: turn hatch
  covers off for those.
- **KPIs** `kpiReport().hatch` (once a hatch move started): `moves`, `removes`, `replaces`, `stsTimeS`, `waitS`, per STS
  `{moves, timeS, waitS}`. Hatch moves are not in `sts.*.moves` or moves per hour; `lastMoveEndS` includes them.
- **Invariants** (tampered-snapshot tests in `tests/hatch.test.ts`): `hatch.no-removal-with-boxes-on-top`,
  `hatch.no-lift-before-lashing-release`, `hatch.no-hold-access-through-closed-hatch` (spreader below the hatch plane
  over a closed panel, from the planned end positions), `hatch.no-deck-load-on-missing-hatch`, `hatch.replace-own-hatch`,
  `hatch.laydown-stack-limit`, `hatch.no-departure-open`. Scoped checks read the panel in `subjects.equipment`.
- Fixtures `hatch-cover-cycle` (bay 0 has deck discharge, hold discharge, hold load, deck load) and
  `hatch-deck-only-no-open` (no hatch moves). 3D panels, hull openings and the dev API: [../rendering-3d.md](../rendering-3d.md).

## Predictions published by the quay

`predictedGroundings` (read through `predictedReady`, `engine/predictions.ts`): per working crane, every planned drop
at its `groundAt` (`exact: true`), then the next `PREDICTED_UPCOMING` (2) discharge boxes of its packages at crane-free
time + `stsNominalCycle` per box + the class `hatch.cycleS` per hatch package in front (`exact: false`). Discharge only;
stops at the first load package. Pure read; ignores rail waits, SHC shortage and variation. Consumer:
[horizontal.md](horizontal.md) (pre-dispatch).

## Vessel status and countdown (engine data)

No dedicated engine state: the view (`modules/vesselStatus.ts`) is built from `VesselState` times (`arrivedAt`,
`berthAllocatedAt`, `berthedAt`, `workCompletedAt`, `departedAt`, status `scheduled | at-anchorage | mooring | berthed
| unmooring | departed`), the call's `arrivalS` (ETA), `quay.mooringS`, and `SimQuery.vesselFirstMoveS(vesselId)`
(`engine/query.ts`): earliest `kpis.perSts[sts].firstMoveStartS` over the vessel's packages, or the package start when
the crane's first move was for an earlier vessel. `collectVesselStatusInput` counts moves from the non-hatch work
packages (complete = all boxes; the active package = boxes minus its `workQueue`; before the split, the call's
planned boxes). `firstMoveS` ships to the scene model as a view field on the vessel `EntityStateChange`
(`worker/engineHost.ts`): no event, state field or golden depends on it. Phases, labels and popup:
[../browser-host.md](../browser-host.md).

## Subsystem modes (quay, berth)

`config.subsystems.quay|berth` (overridden by `SimulationOptions.subsystems`, resolved by `resolveSubsystemModes` into
`SimState.subsystems`; validated by `validateSubsystemModes`; CLI `--subsystem quay=instant`):
- quay `instant`: every STS segment, lock, unlock, reposition, hatch handling and lashing delay is zero; same events.
  An instant crane can outrun its feeders, so extra `Sts*Waiting*` events appear. Rejected without STS cranes.
- quay `off`: no STS work; vessels berth and `VesselWorkComplete` fires at once; the load flow is inactive.
- berth `instant`: mooring and unmooring zero. berth `off`: no `berthAllocation` decision (first fit, anchorage if none)
  and instant mooring.

## Decision points used here

| Point | Asked when | Default | Built-ins |
|---|---|---|---|
| `berthAllocation` | head of the arrival queue, after arrival or a departure | `first-fit` | `best-fit` |
| `craneSplit` | head of the crane queue, after berthing or a crane release | `balanced-moves` | `equal-bays` |
| `workPackageRelease` | assignment, package start and completion | `keep-k-ahead` | `just-in-time` |
| `stsGroundPosition` | per carried box (discharge), per load box (`direction: 'load'`, yard side) | `lowest-free-lane` | `highest-free-lane` |

Request and reply shapes, latency model: [../decision-points.md](../decision-points.md).

## Gotchas

- Changing any cycle rule, order or rail rule changes event order, so event-log hashes and goldens move. Prove with
  `pnpm run tt:golden` (drift per field), `pnpm run tt:diff` on before/after event logs for the first divergence, then
  `pnpm run tt:golden --update` only for an intended change (see "How to prove a change works" in
  [../../terminal-twin-AGENTS.md](../../terminal-twin-AGENTS.md)). The tier sequence changes every run with a
  multi-stack bay section.
- The engine trusts a ground-position reply; it validates berth and split replies by throwing (the run fails).
- A stall (cranes waiting on each other) passes every invariant: the move count is the check
  (`tests/crane-split.test.ts`, 40 of 40 and 24 of 24). `tests/yielding-crane-packages.test.ts` guards that no crane
  starts a package and then waits for the rail on the 4-STS fixture.
- `wakeRail` runs on many events and loops over all cranes; cheap at TTI crane counts but O(cranes^2) per wake.
- `workBays`, `cellIsEmpty` and `createLoadOrders` scan `state.vesselSlots` linearly; fine per call, but avoid calling
  them per event.

## Optimisation levers

- **Throughput (moves/h)**: STS kinematics and `stsSafeHoistM` (every cycle hoists to 50 m twice); `twinLift`;
  `maxSts` and the crane split (bay ranges that keep cranes `stsMinSpacingM` apart avoid rail waits; `tt:sts` shows the
  `rail` and `reposition` shares, 17 % and 25 % at scale 0.5 with 8 cranes per #221); ground positions per STS
  (`ground` bucket = SHC shortage); `releaseAhead` (yard look-ahead); hatch `cycleS` and lashing times (`hatch` and
  `lashing` buckets); `mooringS` / `unmooringS` for turnaround.
- **Run speed**: quay mode `instant` (same events, zero durations) when the quay is not the subject; hatch off removes
  the hatch events and waits.
- **Measure**: `pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:7200 --events /tmp/peak.jsonl`, then
  `pnpm run tt:sts /tmp/peak.jsonl --until 7200`; `pnpm run tt:profile <fixture> --until T`. Compare strategies with
  `--strategy craneSplit=equal-bays`, `--ordering as-today`.

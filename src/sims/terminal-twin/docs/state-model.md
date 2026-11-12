# State model: SimState, entities and indexes

Checked against ENGINE_VERSION 0.53.0.

Read this when you read or write engine state: adding a field or entity, writing a reactor, invariant, KPI or
strategy that looks at state, debugging a snapshot, or replacing a whole-state scan with an index. All types are in
`engine/state.ts` unless named otherwise. The loop that mutates it is in [engine-core.md](engine-core.md).

## Rules

- `SimState` is **plain JSON**: records keyed by id, arrays, numbers, strings, booleans, null. No Map, Set, class or
  function. A snapshot is a `structuredClone` of it plus the log; the event queue, every RNG stream and the running
  hash live inside it.
- Records are `Record<string, T>` keyed by entity id; iteration order is insertion order, and some code depends on it
  (`vesselSlotsOf` keeps the `Object.values` order). Do not rebuild a record in a different order.
- Built once by `engine/state.ts#createInitialState(config, seed, subsystems)`; mutated only by reactors (through
  `EngineContext`); read by everything else through `SimQuery` (`engine/query.ts`, live views, copy before keeping).
- Containers are created only by `scenario/containerFactory.ts` (`makePlannedContainer`, `makeContainerState`;
  guarded by `tests/containerFactory.test.ts`).

## SimState

| Field | Type | Holds |
|---|---|---|
| `now` | number | sim time (s) of the event being or last processed |
| `nextEventId`, `nextSeq` | number | id and seq counters ([engine-core.md](engine-core.md#event-envelope)) |
| `rngState` | number | engine RNG (mulberry32 state) |
| `propsSeed` | number | seed of the per-container property streams |
| `logHash` | `[number, number]` | running event-log hash |
| `queue` | `EngineEvent[]` | pending events, binary heap ordered `(t, id)` |
| `containers` | `Record<id, ContainerState>` | every box known to the run (outside ones too) |
| `vesselSlots` | `Record<id, VesselSlotState>` | bay-plan cells of every vessel (working bays only) |
| `vessels` | `Record<id, VesselState>` | vessel calls |
| `berth` | `BerthState` | arrival queue, pending berth allocation, crane-split queue |
| `sts`, `groundPositions` | records | quay cranes and their ground lanes |
| `shcs`, `shcJobs`, `nextShcJob` | records, counter | carriers and released transport jobs (`J<n>`) |
| `queueClaims` | `Record<nodeId, shcId>` | queue spots held from assignment to departure (exclusive) |
| `wtpPads` | record | waterside pads |
| `ascs`, `ascJobs`, `nextAscJob`, `nextClaimSeq` | records, counters | stacking cranes, yard jobs (`A<n>`), slot claim order |
| `yardBlocks`, `yardSlots` | records | stack heights per block; stacked boxes |
| `workPackages`, `nextWorkPackage` | record, counter | STS work packages (`WP<n>`) |
| `hatchPanels`, `hatchLaydown` | records | hatch panels; quay laydown bays in use |
| `emptiesAsking` | string or null | the empties package whose `emptyAllocation` is pending (one at a time) |
| `loadOrders` | `Record<containerId, LoadOrder>` | export boxes in load preparation |
| `reservations`, `nextReservationId` | `Reservation[]`, counter | conflict-zone time windows (SHC, ASC, trucks) |
| `trucks` | record | trucks inside the terminal (removed at `TruckDeparted`) |
| `landside` | `LandsideState` or null | gate, stalls, holding, own RNG; null when the landside is off |
| `warmUp` | `WarmUpState` or null | warm-up start only |
| `subsystems` | `ResolvedSubsystemModes` | `real`/`instant`/`off` per quay, berth, yard, shc, asc, landside |
| `kpis` | `KpiCounters` | running counters behind `kpiReport()` |
| `decisions` | `DecisionState` | correlation counter, latency RNG, pending decisions, handler KPIs |
| `prefill?`, `prefillCells?` | object | pre-filled start: replies so far (removed after the pre-run); cells per block at the end of it |
| `ended` | `{ reason, t }` or null | set by `ScenarioEnded` |

## Ids

| Entity | Format | Built by |
|---|---|---|
| Vessel slot | `V001:03-04-05` (+ `a`/`f` for the aft/fore 20 ft half); bay, row, tier 0-based, bays are 40 ft | `scenario/vesselClasses.ts#vesselSlotId`, `parseVesselSlotId` |
| Hatch panel | `V001:H03-0` (bay, index across the beam, 0 = quay side) | `scenario/vesselClasses.ts#hatchPanelId` |
| Yard slot | `B01:03-5-2` (bay zero-padded to 2, row, tier; 1-based; 20 ft bays; a 40 ft box is named by its lower bay) | `engine/yardLayout.ts#yardSlotId`, `parseYardSlotId` |
| Ground position | `STS01-GP1` | `engine/state.ts#groundPositionId` |
| ASC | `B01-ASC1` (1 waterside, 2 landside) | `ascIdOf`, `ascIndexOf` |
| Transfer stall | `B01-TS1` | `engine/yardLayout.ts#transferStallId` |
| Container | ISO 6346 with check digit (`scenario/iso6346.ts`); truck-delivered boxes use serials from 500000 | `scenario/bayPlan.ts`, `engine/subsystems/landside.ts` |
| Truck | `T0001` | `engine/subsystems/landside.ts` |
| SHC | `SHC01` | `scenario/builder.ts#shcId` |

## Container

`ContainerState`: `id`, `size` (`'20' | '40' | '40HC'`), `full`, `line`, `vesselId` (discharged from or booked to;
`POOL` for the empty pool, `scenario/bayPlan.ts#POOL_VESSEL_ID`), `custody: CustodyRef`, `custodyHistory:
CustodyRecord[]`, `props: ContainerProps`, and optional flow fields:

| Field | Set for |
|---|---|
| `reefer` | reefers (a hash of the id below `cargo.reeferShare`, `scenario/reefer.ts`): powered rows only, at most `REEFER_MAX_TIERS` (4) high |
| `onwardVesselId`, `onwardSlotId`, `dwellS`, `readyAt` | transshipment boxes: onward vessel and slot, yard dwell, when it ended (`TransshipmentReady`) |
| `yardSince` | time it stood in the yard since (negative for pre-aged pool boxes) |
| `allocatedTo` | an empty allocated to a load package (package id) |
| `pickupReadyAt` | imports and empties: when a truck may collect it (stacked time + import dwell); absent = never collected |
| `truckClaim` | the truck whose leg claimed it (not offered to other trucks or to empty allocation) |

**Custody** (`CustodyKind`): `vesselSlot`, `sts`, `groundPosition`, `shc`, `wtpPad`, `asc`, `yardSlot`, `truck`,
`external` (left on a truck; `id` = the truck, or `outside` for a box not yet arrived). Exactly one owner at a time
(`custody.single-owner` invariant). Change it only with `ctx.transferCustody` at grip and release, and update the
physical holder in the same reactor. `custodyHistory[0]` with `eventId: null` is the initial placement.

### Stored container properties

`ContainerState.props` (`scenario/containerProps.ts#ContainerProps`) is set once at creation and never recomputed:

| Property | Meaning |
|---|---|
| `direction` | `IMPORT`, `EXPORT`, `TRANSSHIPMENT`, `STORAGE` |
| `isoType` | ISO 6346 size-type, e.g. `22G1`, `45G1`, `45R1` |
| `pol`, `pod` | UN/LOCODEs from the port rotation |
| `tareKg`, `cargoKg`, `weightClass` | tare by size and reefer; cargo 0 for an empty; `LIGHT`/`MEDIUM`/`HEAVY` by gross weight |
| `plannedDepartureS` | outbound vessel ETD, else a truck appointment (`PropsInput.appointmentS`; no creator knows one yet), else arrival + expected dwell by direction |
| `inbound`, `outbound` | `CarrierRef { kind: 'vessel' | 'truck', id? }` |
| `reeferSetpointC` | reefers only |
| `bookingRef` | booking reference |
| `holds` | always `[]`: carried, never created or enforced |

- **Creators:** only `scenario/containerFactory.ts`; `makeContainerState` requires `props`. The bay plan assigns
  `PlannedContainer.props` in `assignProps` (end of `planCargo`); pre-filled imports (`engine/prefill.ts`) and truck
  drops (`engine/subsystems/landside.ts` `newBox`) call `drawContainerProps` themselves.
- **Direction by flow:** discharge = `IMPORT` (`TRANSSHIPMENT` when discharged as such; an empty non-transshipment
  box draws `IMPORT`/`STORAGE` from `directionMix`); booked export or truck export = `EXPORT`; empty pool or
  truck-dropped empty = `STORAGE`. When `emptyAllocation` resolves, `allocateEmptyProps` turns the empty into an
  `EXPORT` for the package's vessel (still empty, outbound = that vessel, planned departure = its ETD).
- **RNG:** `propsStream(seed, id)`, keyed by `SimState.propsSeed` and the container id, so it consumes no engine or
  bay-plan stream and is independent of creation order. Draw order inside `drawContainerProps` is fixed (direction,
  POL, POD, weight, setpoint, booking, dwell): do not reorder it.
- **ETD estimate:** `vesselEtdS` = arrival + 1800 s + moves / (max(1, `maxSts`) x 25 per STS-hour) h
  (`ETD_ALLOWANCE_S`, `ETD_MOVES_PER_STS_HOUR`, [A]).
- **Config** (`ScenarioConfig.containerProps`, all optional, builder `.containerProps()`, not in the setup dialog):
  `portRotation { terminal, ports[] }` (`DEFAULT_PORT_ROTATION`, ESALG rotation, [A]); `directionMix` (IMPORT vs
  STORAGE for discharged empties, `DEFAULT_DIRECTION_MIX` 1:3); `cargoWeight` per size (lognormal median, sigma, max:
  `DEFAULT_CARGO_WEIGHT` 11 t / 14 t medians); `weightClassBands` (`DEFAULT_WEIGHT_BANDS` 12 t / 24 t gross);
  `expectedDwell` per direction (`DEFAULT_EXPECTED_DWELL`: imports 3 to 7 days, storage 5 to 20 days, exports 1 to 3,
  transshipment 1 to 4). `validateContainerProps` runs inside `validateScenario`.
- **Display:** `modules/entityInspector.ts` lists the properties as facts; `EntityView.tooltip` is the key subset,
  shown as the hover `title` of the selection heading (no 3D hover tooltip).
- **Hash:** props enter no event, so goldens and the event-log hash do not depend on them. A snapshot from before
  #108 has no `props`; the inspector tolerates that.

### Transit status, content status and dwell

Derived, never stored, no event: `engine/transit.ts` (pure, exported from the barrel) `transitStatus(box, world)`,
`contentStatus(box)`, `dwellS(box, now)`, `terminalArrivalS(box)`, `terminalExitS(box)`, `isTerminalCustody(kind)`.

- **`TransitWorld`** supplies carrier state: `vesselStatus(vesselId)`, `truckStatus(truckId)` (undefined for an
  unknown carrier). The vessel comes from the slot id (`parseVesselSlotId`). Engine side: from `sim.query`; main
  thread: from the worker's `vessels` and `trucks` queries (`transitWorldOf` in `modules/entityInspector.ts`; the
  store asks for `trucks` only while the box is on one).
- **Rules:** terminal custody (`sts`, `groundPosition`, `shc`, `wtpPad`, `asc`, `yardSlot`) = `ON_TERMINAL`.
  Otherwise "held" means the custody history contains terminal custody.
  - Vessel slot: vessel `departed` = `DEPARTED`; held = `LOADED`; not held = `ARRIVED` when the vessel is `berthed`
    or `unmooring`, else `ADVISED` (`mooring` is still on the way in).
  - Truck: held = `LOADED` (pickup on the chassis, truck still here); not held = `ADVISED` while the truck is
    `queued` or `in-lane` (before the kiosk), else `ARRIVED`.
  - `external`: held = `DEPARTED`, else `ADVISED` (awaiting its truck).
- **Content status:** `EMPTY` or `LADEN` from `full`.
- **Dwell** starts at the first terminal custody (or `yardSince` if earlier: pre-aged pool boxes) and stops at the
  first later non-terminal custody; null for a box that has not reached the terminal.
- **KPI report** `dwell` (only directions with at least one arrived box): `{ count, departed, meanS, maxS }` per
  direction, built from the containers at report time (`engine/kpis.ts` `dwellReport`, no collector state). CLI
  block `Dwell on terminal:`.
- **Inspector:** `describeEntity('container', state, { transit, now })` adds Transit status (only with `transit`),
  Content status and Dwell (only with `now`) at the head of the facts and the tooltip. Tests:
  `tests/transit-status.test.ts`, `tests/entity-inspector.test.ts`.

## Vessel and bay plan

`VesselState`: `id`, `sizeClass`, `status`, timestamps (`arrivedAt`, `berthAllocatedAt`, `berthedAt`,
`workCompletedAt`, `departedAt`), `berthX` (stern position on the quay), `anchorageWaitS`, `anchored`, `stsIds`
(assigned cranes in rail order), `stsHistory`, `hatchPanelIds?`, `robBays?`, `robBoxes?` (display-only ROB boxes,
not containers), `remainingDischarge`, `remainingLoad`.

Status chain: `scheduled -> at-anchorage -> mooring -> berthed -> unmooring -> departed` (a vessel berthed on
arrival spends 0 s at anchorage).

`VesselSlotState`: `id`, `vesselId`, `bay`, `row`, `tier`, `deck`, `half` (`aft`/`fore`/null for a 40 ft cell),
`purpose` (`SlotPurpose` from `scenario/bayPlan.ts`: `discharge`, `load`, `transshipment`; an empty-container slot is a load slot with `emptyReq`), `containerId`,
`plannedContainerId?` (load slots: the booked export box), `emptyReq?` (empty slots: the requirement), `loadPurpose?`
(#203 shared cell: a discharge slot that also carries a load booking; becomes the `purpose` once the discharge box
has left at `StsPicked`). Slots exist only for working bays; ROB bays have none. The bay plan comes from
`scenario/bayPlan.ts#planCargo(config, seed)`, which the engine and the scene model both call.

## Quay equipment

`StsState`: `railIndex` (fixed order on the rail), `status` (`idle`, `moving-to-pick`, `carrying`, `returning`,
`repositioning`, `waiting-for-rail`, `waiting-for-decision`, `waiting-for-ground-position`, `waiting-for-box`,
`loading`), `vesselId`, `bays`, `workQueue` (boxes of the active package in work order), axis positions at the end of
the planned motion (`gantryX`, `trolleyZ`, `hoistY`), rail reservation `railLo`/`railHi` and `railTargetX`,
`railAlsoX?`, `railYield?`, `railYieldFrom?` (bounded yield, #174, #212), `carrying` (two for a twin-20 lift),
`drops: StsDrop[]` (chosen ground positions, `groundAt` once the carry is planned), `motion`, `groundPositionIds`,
`waitingSince?`, `packageIds`, `activePackageId`, `releasing?`, hatch fields (`hatchJob?`, `carryingPanel?`,
`hatchWaitPanel?`, `hatchWaitSince?`).

`GroundPositionState`: `stsId`, `lane`, `containerId`, `claimedBy` (load flow: the export box reserved for it).

`WorkPackage`: `id`, `stsId`, `vesselId`, `kind` (`discharge`, `load`, `hatch-remove`, `hatch-replace`), `section`
(`deck`/`hold`), `bay`, `containerIds` (work order), `seq`, `status` (`planned -> released -> active -> complete`),
`releasedAt`, `startedAt`, `completedAt`, `emptyReq?` (`EmptiesRequirement`, stage `pending -> asked -> allocated`),
`hatchPanelId?`.

`LoadOrder` (per export box): `containerId`, `vesselId`, `stsId`, `packageId`, `slotId`, `seq` (crane load sequence),
`stage` (`released`, `staging`, `padded`, `gp-asked`, `gp-claimed`, `retrieving`, `on-pad`, `to-ground`,
`on-ground`), `groundPositionId`.

`HatchPanelState`: `vesselId`, `bay`, `index`, rows covered, size and weight, `home` and `pos`, `status`
(`secured -> unsecured -> lifted -> in-laydown -> lifted -> replaced -> secured`), `opens`, lashing and lift times,
`stsId`, `siteId`, `level`, `cycles`, `deckBoxes`, `placedOn`. Panels are not containers: no custody, never a move.
`HatchLaydownSite { id, x, panelIds }`: one stack per hatch, bottom first. Details: [subsystems/quay.md](subsystems/quay.md).

## Horizontal transport

`ShcState`: `status` (`parked`, `waiting-for-dispatch`, `waiting-for-pad`, `job-assigned`, `routing-empty`,
`positioning-at-pickup`, `locking`, `lifting`, `routing-loaded`, `positioning-at-dropoff`, `lowering`, `unlocking`,
`clearing`, `available`, `routing-to-parking`, `queuing-for-pad`, `queuing-for-work`), `nodeId` (lane-graph node at
the end of its plan), `carrying`, `jobId`, `lastJobKind?` (`paired-dual-cycle` only), `motion` (axes x, z, lift),
`plan: ShcPlannedEvent[]` (remaining phase events). `engine/shcStates.ts` maps the 17 statuses to 7 operational
states for display and KPIs.

`ShcJob`: `containerId`, `groundPositionId`, `stsId`, `x`, `kind?` (`load` = pad to ground position; absent =
discharge), `readyAt`, `shcId` (null = open), `wtpPadId`, `padWait?` (#218: the pad and block-room picture when pad
selection answered none; not offered again until it changes).

`WtpPadState`: `blockId`, `containerId`, `claimedBy` (the SHC, or the ASC for a retrieved export box, that will drop
a box here).

`Reservation` (`engine/reservations.ts`): `{ id, zone, holder, from, to }`, half-open `[from, to)`. A plan reserves
every zone it passes before it starts; `earliestStart` moves the whole plan later on any overlap; `reserve` prunes
windows that ended before `now`. Zones: lane-graph intersections, STS lanes and ground positions, WTP pads, ASC rail
segments (twin blocks), landside road zones. A parked twin-block ASC holds its rail segments until `PARK_UNTIL_S`
(1e9). Details: [subsystems/horizontal.md](subsystems/horizontal.md).

## Yard

`YardBlockState`: `id`, `bays`, `rows` (always `BLOCK_ROWS` = 8), `tiers`, `heights[]` and `topVessels[]` (flat,
index `(bay-1)*rows + (row-1)`, `engine/yardLayout.ts#stackIndex`), `progressAt?` (last ASC job start;
`yard.no-progress`). **Claimed slots count in `heights`**: a slot is claimed when allocated and stacked later.

`YardSlotState`: a stacked box: `id` (anchor cell), `blockId`, `bay`, `row`, `tier`, `span` (1 or 2 bays),
`containerId`. A slot entry exists while a box stands in it (`placeInStack` at `AscStacked`, `removeFromStack` at `AscRetrieved`,
both in `engine/subsystems/ascStorage.ts`); an allocated slot that is not yet filled lives only as a claim in an
`AscJob` (and in `heights`).

Geometry (`engine/yardLayout.ts`): `ROW_PITCH_M` 2.9, `BAY_PITCH_M` 6.7 (20 ft bay), `TIER_PITCH_M` 2.896 (travel clearance only; a box rests on the boxes under it, `yardSlotBaseY`),
`DEFAULT_BLOCK_BAYS` 20, `DEFAULT_BLOCK_TIERS` 5, `DEFAULT_WTP_PADS` 5, `DEFAULT_TRANSFER_STALLS` 5,
`ASC_MIN_SEPARATION_M` 12 (8 m portal + 4 m gap), `RAIL_SEGMENT_M` 3.35, `RAIL_MARGIN_M` 16. Reserved stacks
(`reservedStacksOf`, share `config.yard.reserveShare`, in pairs of bays) are kept free of pre-fill and discharge.

`AscState`: `blockId`, `status` (`idle`, `job-assigned`, `routing-to-pad`, `positioning-at-pad`, `locking`,
`lifting`, `routing-to-slot`, `positioning-at-slot`, `unlocking`, `releasing`, `repositioning`), `carrying`, `jobId`,
`stacked`, `gantryZ`/`trolleyX`/`hoistY` at the end of the planned motion, `motion`, `plan: AscPlannedEvent[]`.

`AscJob`: `blockId`, `containerId`, `wtpPadId`, `vesselId`, `allocation` (`waiting`, `asked`, `claimed`, `full`),
`yardSlotId` (stacking: the claimed slot; retrieve and rehandle: the box being lifted), `claimSeq`, `cleared`,
`ascId`, `dispatch?`, `kind?` (absent = stack, `retrieve`, `rehandle`), `targetSlotId?` and `forJobId?` (rehandle),
`rehandle?` (`required`/`full`), `stallId?` and `truckId?` (truck interchange). Details:
[subsystems/yard.md](subsystems/yard.md).

## Landside

`TruckState`: `transaction` (`dropExport`, `pickImport`, `dropEmpty`, `pickEmpty`, `dual`), `legs: TruckLeg[]`
(`kind` drop/pick, `purpose` export/import/empty, `containerId`, `vesselId?`, `slotId?`, `done`), `status` (`queued`,
`in-lane`, `waiting-for-stall`, `routing-to-holding`, `holding`, `routing-to-stall`, `at-stall`, `being-served`,
`routing-to-exit`; removed from `trucks` at `TruckDeparted`), `queueIndex`, `promoted?`/`headWakeAt?` (#208 head
bypass), lanes, `stallId`, `holdingId`, `holdingAt`, `heldOutside`, `nodeId`, `carrying`, timestamps, `booked`,
`driveS`/`driveSince`, `motion`, `plan`.

`LandsideState`: `rngState` (own stream), counters `nextTruck`, `nextBox`, `nextScripted`, `queue` (gate queue),
`inLanes`, `laneAsking`, `stalls: Record<id, TransferStallState { blockId, x, z, truckId }>`, `stallWaiting`,
`stallAsking`, `holding: Record<id, HoldingPositionState>`, `appointments?: AppointmentBook`,
`lastDepartureByLane?`, `fullDrops?` (#184). Details: [subsystems/landside.md](subsystems/landside.md).

## Other state

- `BerthState { queue, allocating, craneQueue, splitting }`: one berth and one crane-split decision at a time.
- `KpiCounters`: `movesCompleted`, `vesselsCompleted`, `perSts`, `workPackages`, and per area when present
  (`horizontal`, `yard`, `hatch`, `landside`, `ordering`). The hourly and shift series are not in state: the KPI
  collector folds the log ([kpis-and-reports.md](kpis-and-reports.md)).
- `DecisionState`: `nextCorrelation`, `rngState`, `pending` (by correlation id, kept in snapshots), `kpis` per
  decision point.
- `WarmUpState { durationS, ended, vesselsCompletedBefore, movesBefore, cellsAtEnd? }`.

## Derived indexes

Not part of `SimState`. Each is cached in a module-level `WeakMap` keyed by a state object, built by a full scan on
first use, then kept current by explicit calls where the state changes. A restored snapshot has new objects, so the
caches miss and rebuild lazily (a tampered snapshot is scanned afresh).

| Index | Key object | Holds | Kept current by | Callers that must notify |
|---|---|---|---|---|
| `engine/yardIndex.ts#yardIndexOf` | `state.yardSlots` | `byBlock`, `byColumn` (`<block>\|<bay>-<row>`, a 40 ft slot in both columns), `stackVersion` per block, `planVersion`, `ranks` cache | `indexYardSlotAdded`, `indexYardSlotRemoved`, `notePlanChanged` | `subsystems/ascStorage.ts` (lift and set-down), `subsystems/prefill.ts`; `notePlanChanged` from `landside.ts` and `empties.ts` when a vessel slot gets a booked box |
| `retrievalRanks` cache (#228) | inside the yard index | per block retrieval ranks, valid while `stackVersion` and `planVersion` match | version bumps above | same |
| `engine/vesselSlotIndex.ts#vesselSlotsOf` | `state.vesselSlots` | slots per vessel in `Object.values` order | `indexVesselSlotAdded` (with `replaced` for an overwrite), `indexVesselSlotRemoved` | `subsystems/landside.ts` (export slots added for truck exports) |
| `engine/vesselOccupancy.ts#vesselOccupancyOf` | `state.vesselSlots`, per vessel | numeric `cellKey(bay,row,tier)` to occupants (filled slots and ROB boxes), `shared` count | `occupancySlotFilled`, `occupancySlotCleared` | `subsystems/quay.ts` (fill at load, clear at pick), `subsystems/landside.ts` (overwrite) |
| `laneGraphOf`, `landsideGraphOf` | `config` | lane graph, shortest paths, landside roads | immutable | none |
| invariant caches (`blockSpecCache`, `roadZoneCache`) | `config`, graph | block specs, road zones | immutable | none |

Recomputed on every call (not cached, cheap enough or must see claims): `stackSpansOf` (stack length lock: tier-1 box
span, plus claims in `ascJobs`), `stackTopsOf` (top box view per stack for the grouped strategy), `candidateSlots`.
A slot's bay, row, tier and span never change and the indexes hold the slot objects themselves, so a `containerId`
change on an existing slot needs no call. `YardBlockState.heights` and `topVessels` are stored and maintained
incrementally by the ASC storage code.

Engine memory outside `SimState`, rebuilt on restore: `byId` (event id to event), the KPI collector (refed from the
log), the `InvariantTracker` memory (next check is a full sweep), the decision runtime's in-flight async calls
(re-sent), the pre-fill generator (replayed from `state.prefill.replies`).

## What a snapshot holds

`SimSnapshot` (`engine/simulation.ts`) = `structuredClone` of `{ kind, schemaVersion, engineVersion, config, seed,
status, firstError, invariants (report, violations), state (all of SimState), log (every committed event) }`.

| In the snapshot | Not in it |
|---|---|
| the queue with every pending event and planned motion | handlers (pass the same ones on resume) |
| every RNG stream and the log hash | listeners and the logger |
| pending decisions and handler KPIs | options: `invariants.enabled`, `sweepEvery`, `log`, `asyncMode` |
| reservations, plans, motion segments | derived indexes and caches |
| KPI counters | KPI collector series (rebuilt from the log) |
| the full event log | invariant wall time and check stats |

Size grows with the log: a long large run's snapshot reaches hundreds of MB (`cli/snapshotFile.ts` writes it in
pieces past the string limit; `restore(snap, { adopt: true })` avoids a second copy).

## Gotchas

- Mutating `yardSlots` or `vesselSlots` (add, delete, overwrite, or a vessel slot's `containerId`) without the
  matching index call leaves a stale index: the invariants then pass or fail on the wrong data. Every new mutation
  site needs the call.
- Replacing `state.yardSlots` or `state.vesselSlots` with a new object silently drops the cache (a full rebuild on next
  use); fine for a restore, a cost if done per event.
- `query.*()` lists are fresh arrays over live objects: never mutate them, and copy before storing.
- Adding a field to `SimState` or an entity changes the snapshot shape; if old snapshots cannot run with it, bump
  `ENGINE_VERSION`. A field that feeds an event payload moves the hash and the goldens.
- Containers outside the terminal (`external:outside`) are in `containers` from the start in empty, warm-up and
  pre-filled starts; filter by custody, not by presence.

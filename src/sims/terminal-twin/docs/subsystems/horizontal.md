# Horizontal transport: SHCs, lane graph, reservations, pads and queues

Checked against ENGINE_VERSION 0.53.0.

Read this when you change or tune how shuttle carriers (SHCs) move boxes between the STS ground positions and the WTP
pads: jobs and dispatch strategies, the waterside lane graph and routing, conflict-zone reservations, pad selection,
queue areas, parking, pre-dispatch and paired dispatch. The crane side of the handover is [quay.md](quay.md); the ASC
side and load preparation are [yard.md](yard.md). Terms: [GLOSSARY.md](../../../../../GLOSSARY.md).

## Files

| File | Role |
|---|---|
| `engine/subsystems/shc.ts` | Jobs, dispatch, trip planning (`TripBuilder`), queue areas, pre-dispatch, pairing, phase reactors |
| `engine/laneGraph.ts` | Pure waterside graph (`buildLaneGraph`, cached `laneGraphOf`), `laneAccess`, `laneZonesAt`, Dijkstra `shortestPath` |
| `engine/reservations.ts` | Time windows on conflict zones: `earliestStart`, `reserve`, `mergeWindows`, overlap checks |
| `engine/shcStates.ts` | `ShcStatus` to the seven operational states (`shcOperationalState`) |
| `engine/kinematics.ts` | Axis profiles, `cornerSpeedCap`, `travelTime` |
| `engine/predictions.ts` | `predictedReady` (quay and ASC predictions) for pre-dispatch |
| `engine/subsystems/loadPrep.ts` | Creates export load jobs (`createLoadShcJob`) |
| `engine/decisions/strategies.ts` | `shcDispatch` and `wtpPadSelection` built-ins, `PAIRING_RADIUS_M`, `balancedPad` |

## Config and defaults

| Setting | Default | Where |
|---|---|---|
| `shcs: [{id}]` (builder `.shcs(n, kin?)`, `withShcFleet`) | none; 1 to 120 in the setup limits | `scenario/limits.ts` |
| `kinematics.shc` | `DEFAULT_SHC_KINEMATICS` [A]: empty 8.3 m/s (a 1.0, d 1.2), loaded 6.9 m/s (a 0.7, d 0.9), lift 0.4 m/s, `liftHeightM` 1, `lockS` 2, `unlockS` 2 | `scenario/builder.ts` |
| Cornering `cornerRadiusM`, `maxLateralAccel` | `DEFAULT_SHC_CORNER` 12 m, 1.5 m/s^2: a right-angle turn at about 4.24 m/s (15 km/h); radius 0 = stop at every turn | `scenario/builder.ts` |
| `driverVariabilityPct` | 0 (presets 10): one factor 1 +/- pct per trip from the engine RNG | `engine/subsystems/shc.ts#driverFactor` |
| `yard.blocks: [{id, x, wtpPads}]` | `DEFAULT_WTP_PADS` 5 pads per block | `engine/yardLayout.ts` |
| `apron` | `DEFAULT_APRON_LAYOUT` (below) | `engine/laneGraph.ts` |
| `queueAreas: {stsCapacity?, blockCapacity?, predispatchMarginS?}` | absent = no queue areas; margin `DEFAULT_PREDISPATCH_MARGIN_S` 15 s; TTI presets 3 / 3 [unverified] | `scenario/types.ts`, `scenario/presets.ts` |
| `subsystems.shc` | `real` when SHCs and blocks exist, else `off` | `engine/state.ts#resolveSubsystemModes` |

`DEFAULT_APRON_LAYOUT` (m): `westboundZ` 40, `eastboundZ` 46, `padClearZ` 52, `parkingZ` 54, `queueZ` 58, `wtpZ` 64,
`padPitchM` 5.5, `stationSpacingM` 25, `parkingPitchM` 6, `parkingAisleOffsetM` 25, `parkingSideM` 10,
`zoneClearanceM` 4, `queuePitchM` 8. STS ground lanes sit at Z 8 + 3 j (`DEFAULT_LAYOUT`). TTI presets:
`chained-nearest` dispatch, `balanced` pad selection, queue areas 3 / 3, 3 ground positions per STS.

Nominal readout `shcNominalCycle` (300 m empty + 300 m loaded, lift, lower, lock, unlock): about 107 s, 34 per hour.

## Lane graph (`engine/laneGraph.ts`)

Pure, deterministic, built from the config and cached per config object (`laneGraphOf`, a `WeakMap`). Every edge runs
along X or Z (`buildLaneGraph` throws otherwise). Z grows landside; X along the quay.

```
Z 8 + 3j   STS lane j (one-way +X), nodes D<k>:<j> at x_k and U<k>:<j> at x_k + 5, x_k = -15 + 25 k to quay + 15
           down spine  AW@x_k -> D<k>:J -> ... -> D<k>:1        (enter a lane)
           up spine    U<k>:1 -> ... -> U<k>:J -> AW@(x_k + 5)    (leave a lane)
Z 40       westbound apron (-X)  AW@x     } crossovers both ways at every apron X: a loop
Z 46       eastbound apron (+X)  AE@x     }
Z 52/64    WTP spur  AE@px -> C:<pad> (clear position) -> P:<pad> and back
Z 58       queue spur AE@x <-> QS:<stsId>:<n> / QB:<blockId>:<n>
west       parking aisle AE@aisleX <-> PA:1 <-> PA:2 ... (+Z); spots S:<shcId> either side
```

- Apron X positions are the union of station spines, pad X, the parking aisle X and queue spot X.
- WTP pads: `<blockId>-WTP<n>` (`wtpPadId`), centred on the block's X at `padPitchM`, at `wtpZ`, boxes along Z.
- Parking (#160): the aisle runs landside from the eastbound lane `parkingAisleOffsetM` west of the westmost apron X;
  row r at `parkingZ + r x parkingPitchM`, two spots per row `parkingSideM` either side (east side first). The area
  grows landside, never west into the sea, for any fleet up to 120 (rows to about Z 410). SHCs drive past parked SHCs
  on the aisle. `tests/shc-parking.test.ts` checks every preset and SHC fixture (and 1 to 120 SHCs on the TTI layout)
  against the land the scene draws (for TTI, the sea channel north of x = -70 m).
- Queue areas (TT-R12): one per STS (`QS:<stsId>`, starting at the crane's config `gantryX + queuePitchM`, so per
  home position: the gantry moves, the spot does not) and one per block (`QB:<blockId>`, east of its pads). `queueXs`
  nudges each spot by `queuePitchM` until it is 0.75 x pitch clear of every pad column and earlier spot.
- `validateLaneLayout` (in `createInitialState` with SHCs and blocks) throws when the last ground lane comes within
  3 m of the westbound apron: 11 or more lanes with the default layout.
- Size grows with quay length x lanes (a 2 km quay with 3 lanes is about 1,000 nodes).

**Node kinds** `apron`, `laneDown`, `laneUp`, `padClear`, `wtpPad`, `parking`, `parkingAisle`, `queue`.
**Conflict zones**: every apron and lane node (intersection, 4 m square), every STS lane section between two lane
nodes (`L<j>@<x>`, also the zone of that edge), and each pad with its spur (`<padId>`, zone of `P` and of the C to P
edges). Pad clear positions, parking spots, aisle nodes and queue spots are not zones: vehicles rest only there.

**Pathfinding**: `shortestPath(graph, from, to)` is Dijkstra with a binary heap, ties by node id, memoised per graph in
an unbounded `Map` keyed `from>to` (also used by the landside road graph). `pathLength` sums Manhattan legs.
`laneAccess(graph, lane, x)`: enter at the last down spine at least 1 m before x, leave at the first up spine at least
1 m after it; `walk` = lane nodes in between, the box lies between `walk[before]` and `walk[before + 1]`.
`laneZonesAt(graph, lane, x, half)`: lane nodes and sections within `half` of x (the STS set-down footprint).

## Jobs

`ShcJob` (`state.shcJobs`, ids `J<n>`): `containerId`, `groundPositionId`, `stsId`, `x` (box X on its lane, or the
drop X for load), `kind` (absent = discharge, `'load'`), `readyAt`, `shcId` (null = open), `wtpPadId`, `padWait`.
- Discharge: created by the `StsGrounded` reactor (`x` = crane gantry X). Released into the pool at once.
- Load: created yard side when the export box is on its pad (`createLoadShcJob` from `AscDroppedAtWtp` or for a box
  staged on a pad), with its ground position already claimed, so load drop-offs never wait.
- Deleted at `ShcCleared`. Any SHC may take any job: no fixed SHC-to-crane or SHC-to-block assignment.

## Dispatch algorithm (`maybeDispatch`)

Runs on job creation, every `ShcCleared` / `ShcParked` / `ShcQueued` / `ShcPickedAtWtp`, after each assignment, and
when block room may have risen (`padRoomMayHaveRisen`).

1. `refreshPadWaits`: drop `padWait` on jobs whose pad and block-room picture (`padRoomKey`) changed (#218: a job
   given back for lack of a pad is not re-offered at the same picture, so dispatch and pad selection cannot re-ask each
   other at one sim time).
2. `serveQueues`: loaded SHCs resting at block queue spots ask `wtpPadSelection` again, at most one per free pad.
3. Count open discharge jobs, open load jobs, free pads (no box, no claim), free block queue spots, SHCs already
   asking. While `asking < min(openDischarge, freePads + freeBlockQueueSpots) + openLoad`, the next free SHC asks
   (`requestDispatch`): rank `available`, then `queuing-for-work`, then `parked`, ties by id.
4. `maybePredispatch` (only under `predispatch`).

`shcDispatch` request: the SHC's node and X/Z, every open job without `padWait` (oldest first) with `distanceM`
(discharge: route to the lane entry node plus the run along the lane to x; load: route to the pad node), `kind`,
`padId`, every pad (`padOptions`: occupancy and claim; a pad of a block with `blockRoom <= 0` reads `claimedBy:
'block-full'`), and `lastJobKind` under `paired-dual-cycle` only.

Reply handling (`DecisionResolved`):
- `jobId: null`: `goIdle`.
- A job another SHC took meanwhile, from a built-in strategy (handler id `strategy:*`): ask again (two SHCs asked at
  the same instant). A custom handler is trusted; invariants catch a double claim.
- Load job: `assignLoadJob` at once.
- Discharge job with a free pad: hold the job (`waiting-for-pad`) and ask `wtpPadSelection`. No pad free: with block
  queue spots, `assignQueuedJob` (fetch the box to the nearest block queue spot); without, the SHC idles and the job
  stays open.

`wtpPadSelection` reply: a pad -> `assignJob` (a stale pick from a built-in strategy asks again); `null` from a queued
loaded SHC -> keep waiting there with `padWait` set; `null` otherwise -> job given back (`padWait` set), SHC idles.

`blockRoom(state, blockId)`: free cells, less boxes on its pads still waiting for a slot, less `BLOCK_FREE_RESERVE`
(0.1) of its cells (#165: full-size calls on a 60 % pre-filled yard starved the quay by filling the first block's pads
with boxes that had no slot).

### `shcDispatch` strategies (`engine/decisions/strategies.ts`, default `oldest-job`)

| Strategy | Handler picks | Engine behaviour keyed on the name |
|---|---|---|
| `oldest-job` | lowest `readyAt` (FIFO) | idle SHCs drive back to their parking spot |
| `nearest-job` | shortest `distanceM`, then `readyAt`, id | as `oldest-job` |
| `chained-nearest` | as `nearest-job` | `isChained`: idle SHCs wait at queue areas while work remains |
| `predispatch` | as `nearest-job` | `isChained` + `isPredispatch`: send idle SHCs ahead of predicted boxes |
| `paired-dual-cycle` | after a discharge delivery the nearest open load job, after a load delivery the nearest discharge job, if within `PAIRING_RADIUS_M` (150 m route [assumed]); else nearest | `isChained` + `isPaired`: `lastJobKind` set on `ShcCleared` and sent in the request |

### `wtpPadSelection` strategies (default `first-free`)

`first-free` (list order), `last-free`, `nearest-box` (Manhattan from the box), `balanced` (#207: Manhattan distance +
`BALANCED_FILL_M` 6000 x block fill + `BALANCED_QUEUED_M` 60 x queued ASC jobs; request carries `blockLoad`; spreads a
vessel's discharge over blocks; TTI presets). A pad is free when neither occupied nor claimed (so `block-full` pads are
skipped).

## Trip planning (`TripBuilder`)

A job is planned **whole** at assignment: motion segments (axes `x`, `z`, `lift`), phase marks, and conflict-zone
windows, all relative to 0, then shifted to the start time (`install`). Each phase event schedules the next from
`ShcState.plan` and carries the segments that led up to it.

```
discharge (assignJob):  [node] -> lane entry D -> along lane -> box X        ShcRoutingEmpty, ShcPositioningAtPickup
                        lock (lockS)                                          ShcLocking -> ShcPicked (GP -> SHC)
                        lift to liftHeightM -> rest of lane -> up spine -> pad P   ShcRoutingLoaded, ShcPositioningAtDropoff
                        lower, unlock                                         ShcLowering, ShcUnlocking -> ShcDroppedAtWtp (SHC -> pad)
                        reverse P -> C (clear position)                       ShcCleared (status available, rests at C)
load (assignLoadJob):   [node] -> pad P, lock -> ShcPickedAtWtp, lift, P -> lane entry -> drop X, lower, unlock
                        -> ShcDroppedAtGround (SHC -> GP), on to the lane exit up spine -> ShcCleared
queued (assignQueuedJob): as discharge up to the lane exit, then -> block queue spot -> ShcQueued {loaded: true}
resume (resumeFromQueue): spot -> pad -> lower, unlock -> ShcDroppedAtWtp -> ShcCleared  (ShcQueueDeparted announces it)
```

- `driveThrough` splits waypoints into straight runs (one segment per run). Speed between runs (`cornerSpeeds`): a
  right-angle turn is capped by `cornerSpeedCap` (sqrt(lateralAccel x radius)), by `vMax`, and by sqrt(a x length) of
  both neighbouring runs (a = min(accel, decel)); a reversal (two runs on the same axis) stops. Trips start and end at
  rest, and so do locks, lifts and pads. "Positioning" is the final straight run into the box or pad.
- Driver factor and profiles: one `driverFactor` per trip scales `driveEmpty` and `driveLoaded` (`scaled`).
- Windows: each zone visit (node zone at a point, edge zone along a stretch), widened by `zoneClearanceM` (4 m) of
  path distance each way and converted to times (`timeAt`, bisection on the run profile), merged per zone
  (`mergeWindows`).
- `commitTrip`: `earliestStart` over all windows, `reserve`, `install`, KPIs, then `ShcJobAssigned {departAt,
  distanceM, reservations}` (or `ShcQueueDeparted` for a resumed trip). Status `job-assigned` until departure.
- Idle drives: `goPark` (`ShcRoutingToParking -> ShcParked`, `parkingReturns++`) and `goQueue` (`ShcRoutingToParking
  -> ShcQueued {loaded: false}`, with `predicted` under `predispatch`). Both reserve like a job trip.
- Quay-side guards: `ShcLocking` throws if the box is not on the ground position (or pad) it should be on.

## Reservations (`engine/reservations.ts`)

`SimState.reservations`: `{id, zone, holder, from, to}`, half-open `[from, to)`. Zero-length windows (instant mode)
are not stored, so they never conflict.

1. `earliestStart(state, windows, now)`: index existing reservations by zone (only zones the plan touches, only those
   ending after now); start = now; for any overlapping window move start to `r.to - w.from`; repeat until no overlap
   (guard 100,000 iterations, then throws).
2. `reserve` prunes reservations that ended before now, then stores the shifted windows.

Consequences: a conflict delays the **whole trip's departure**; a trip is never re-planned and never stops mid-route.
Vehicles wait only where they rest (parking spot, pad clear position, queue spot), none of which is a zone. The STS
also reserves lane zones for each discharge set-down and each load pick ([quay.md](quay.md)), and the ASC reserves
its pad zone from arrival over the pad until its spreader is clear ([yard.md](yard.md)); an SHC planned later departs
after them. KPI `reservationWaitS` = sum of departure delays. Invariant `reservation.no-overlap` (scoped: only
reservations made since the last check, `overlappingNewReservations`).

## Handovers

| Handover | Events | Effects |
|---|---|---|
| STS to SHC (discharge) | `StsGrounded` -> job; `ShcPicked` | GP freed; `resumeStsWaitingForGroundPosition`; `pumpLoadPrep` |
| SHC to WTP pad | `ShcDroppedAtWtp` | pad holds the box, claim cleared, `boxesToWtp++`; ASC asks `yardAllocation` |
| Pad released to ASC | `ShcCleared` | ASC job `cleared` (the ASC starts only after the SHC left) |
| ASC to SHC (load) | `AscDroppedAtWtp` -> load job; `ShcPickedAtWtp` | pad freed; `maybeDispatchAsc(blockId)` |
| SHC to STS (load) | `ShcDroppedAtGround` | GP holds the box, its `claimedBy` cleared; `resumeStsWaitingForBox` |

STS and ASC never wait for an SHC: they set down whenever a ground position or pad is free. The SHC handover counter
(`shc.handovers` KPI) counts picks and drops.

## Queue areas and chained dispatch (TT-R12)

Needs `config.queueAreas`; without it nothing below happens (older fixtures keep their graph and event logs).
`state.queueClaims` maps spot node to holding SHC: exclusive, held from the assignment that targets the spot until the
SHC leaves it (`releaseQueue`).
- **Loaded wait for a pad**: with block spots, a discharge job is dispatched even when no pad is free:
  `ShcJobAssigned` with `wtpPadId` '' and a trip ending in `ShcQueued {loaded: true}` (status `queuing-for-pad`). The
  ground position is freed early; pad claims stay exclusive, so no box is ever delivered into a full pad.
- **Chained idle** (`goIdle` under `isChained`): while `workRemains` (an open job, or a vessel mooring or berthed),
  an idle SHC with no job waits at the nearest free queue spot (STS or block area, by route) as `queuing-for-work`;
  it parks when no spot is free, and the `VesselWorkComplete` reactor parks every resting queued SHC once no work
  remains. Without chained dispatch the STS areas are unused and idle SHCs return to parking after every job.
- KPIs per SHC: `parkingReturns`, `queueArrivals`. Fixture `shc-queue-chained` (2 STS, 24 boxes, 4 SHCs, 1 pad, real
  ASC, areas of 2, `chained-nearest`): about 0 parking returns versus 19 with `oldest-job`.

## Pre-dispatch on predicted ready time (TT-R13, `predispatch`)

`maybePredispatch` runs after `maybeDispatch` and on `DecisionResolved(stsGroundPosition)`, `StsMoveStarted`,
`StsHatchStarted`, `AscJobAssigned` (events, not a timer: a long quiet period delays a send).
1. `predictionDeficits`: for each prediction of `predictedReady` (quay: planned set-downs exact, next 2 boxes per
   crane estimated; ASC: planned retrievals to a pad, exact) find its area (`QS:<sts>` or `QB:<block>`); it is
   uncovered when fewer idle SHCs wait at (or drive to) that area than predictions so far for it. Spare SHCs: parked
   with no plan, plus those resting at an area beyond its demand.
2. For each uncovered prediction with a free spot: the spare SHC with the shortest empty `travelTime` to it is sent
   (`goQueue` with `predicted {areaId, readyAt, source}`) when `readyAt - now <= travel + predispatchMarginS`.
3. After a delivery `goIdle` heads for the earliest uncovered prediction's area instead of the nearest one.

No early collection: the SHC claims a spot, never a job; the job exists only after `StsGrounded` / `AscDroppedAtWtp`.
Fixture `shc-prepositioning` (2 STS with one ground position each, 4 SHCs, 3 pads, areas 3/3, margin 15 s): STS
ground-position wait about 80 s with `chained-nearest` to 0. No KPI of its own: count `ShcRoutingToParking` with
`predicted`. Does not combine with pairing.

## Paired dispatch (TT-R14, `paired-dual-cycle`)

Chained dispatch plus the pairing handler above. `ShcDispatchRequest.lastJobKind` exists only under this strategy, so
other event logs, snapshots and goldens are unchanged. No new claims. Fixture `shc-paired-dual-cycle` (one feeder
discharging at STS01, one loading at STS02, 3 SHCs, 2 pads 150 m along the quay, areas of 2): empty travel about
7364 m versus 7665 m with `chained-nearest`. The gain is small where `nearest-job` already pairs by geometry; a single
vessel discharges first and loads after, so there is nothing to pair unless two vessels (or hatch-free and covered
bays) work at once. It does not hold for a predicted load box.

## SHC states (`engine/shcStates.ts`)

A status names the last phase event that fired, so the SHC is already doing the next phase. `shcOperationalState`
maps each `ShcStatus` to one of `SHC_OPERATIONAL_STATES`:

| Operational state | Statuses |
|---|---|
| `parked` | `parked`, `waiting-for-dispatch`, `available` |
| `moving-to-collect` | `job-assigned` (once departed), `routing-to-parking` |
| `queuing-to-collect` | `waiting-for-pad` (empty), `queuing-for-work`, `job-assigned` before its departure |
| `collecting` | `routing-empty`, `positioning-at-pickup`, `locking` |
| `moving-to-deliver` | `lifting` |
| `queuing-to-deliver` | `queuing-for-pad`, `waiting-for-pad` while carrying |
| `delivering` | `routing-loaded`, `positioning-at-dropoff`, `lowering`, `unlocking`, `clearing` |

Note `routing-to-parking` covers queue and pre-dispatch drives too. The KPI collector accumulates seconds per state
from the phase events (`kpiReport`, CLI `Horizontal:` block); `tests/shc-states.test.ts`.

## KPIs and invariants

`kpiReport().horizontal` (only with SHCs): `boxesToWtp`; per SHC `jobs`, `emptyDistanceM` (empty legs, the reverse
out of a pad, and parking/queue drives), `loadedDistanceM`, `reservationWaitS`, `parkingReturns`, `queueArrivals`;
`stsGroundPositionWaitS` per STS. Collector KPIs: `shc.empty-travel-ratio`, `shc.empty-distance-m`,
`shc.loaded-distance-m`, `shc.handovers`, state shares, `shc.cycle-time-s`. Details:
[../kpis-and-reports.md](../kpis-and-reports.md).

| Invariant | Guards |
|---|---|
| `reservation.no-overlap` | no two reservations of a zone overlap |
| `claim.single-holder` | no box claimed by two SHCs; every claimed job names its SHC |
| `shc.waiting-positions` | parked SHCs on a parking spot; resting queued SHCs on a queue spot they hold; one SHC per spot (negative tests in `tests/shc-queue.test.ts`) |
| `custody.single-owner` | a ground position or pad holds one box ("is double-occupied: X was set down on it") |

## Subsystem modes

`shc` `real` (default with SHCs and blocks), `instant` (same events, zero durations: `TripBuilder` zeroes segments
and dwells, windows collapse to nothing), `off` (no jobs: boxes stay on the ground positions; the load flow is
inactive). Fixture `shc-1sts-2shc-1wtp` (3 ground positions, 2 SHCs, block B01 at x 20 with 4 pads, ASC `instant`,
ends at `simDurationS` 1800 after every box is in the yard) tests SHC transport on its own.

## Gotchas

- The engine trusts dispatch and pad replies (it throws only on unknown ids); invariants catch double claims.
- Trips are planned whole: a later conflict never re-plans a trip, it only delays the next trip's departure. A
  vehicle waiting at a pad clear position holds no reservation, so another SHC approaching that pad can pass through
  it visually (rare). A load SHC rests at a lane exit node (a zone) after `ShcCleared` without a reservation until
  `goIdle` moves it.
- `laneGraphOf` caches by config object identity: build a new config (as `applyOverrides` does), never mutate one
  after a graph was built. The path cache never evicts; at TTI scale it holds every routed pair.
- `requestDispatch` routes from the SHC to every open job (`shortestPath` per job, memoised): with many open jobs and
  free SHCs this is the hot spot of `maybeDispatch`; `padOptions` and `blockRoom` scan all ASC jobs per request.
- Hatch laydown and SHC lanes share the strip landside of the ground lanes: more than 3 ground positions per STS with
  SHCs and hatch covers fails `hatchLaydownProblems` ([quay.md](quay.md)).
- Strategy names drive engine behaviour (`isChained`, `isPredispatch`, `isPaired` read
  `config.decisions.points.shcDispatch.strategy`); a custom handler under any other strategy name gets the non-chained behaviour (idle SHCs park).
- Any change to routing, windows or dispatch order moves event-log hashes and goldens: prove with `pnpm run tt:golden`,
  compare with `pnpm run tt:diff` on before/after event logs, update goldens only for an intended change (see
  [../../terminal-twin-AGENTS.md](../../terminal-twin-AGENTS.md), "How to prove a change works").
- 3D poses (`SceneModel.shcPose`), overlays (lane graph, reservations) and setup-dialog units: [../browser-host.md](../browser-host.md),
  [../rendering-3d.md](../rendering-3d.md).

## Optimisation levers

- **Throughput**: fleet size; `shcDispatch` (`chained-nearest` removes parking returns; `predispatch` cuts STS
  ground-position waits; `paired-dual-cycle` cuts empty travel with mixed discharge and load); `wtpPadSelection`
  (`balanced` spreads blocks, `nearest-box` shortens trips); `queueAreas` capacities; pads per block; ground positions
  per STS (buffer between crane and SHC); kinematics and cornering (short runs rarely reach vMax, so acceleration and
  `cornerRadiusM` matter as much as speed); `stationSpacingM` (shorter lane walks, more nodes).
- **Run speed**: SHC mode `instant`; fewer stations (larger `stationSpacingM`) shrink the graph and routes.
- **Measure**: `pnpm run tt:run --fixture shc-1sts-2shc-1wtp` (per-SHC jobs, distances, reservation wait, state time);
  compare `--strategy shcDispatch=<name>` / `--strategy wtpPadSelection=<name>`, or `pnpm run tt:diff --fixture
  shc-1sts-2shc-1wtp --b-handlers nearest-job`; `pnpm run tt:profile <fixture> --until T` for SHC idle share.

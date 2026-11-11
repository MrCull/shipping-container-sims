# Landside: trucks, gate, roads and transfer stalls

Checked against ENGINE_VERSION 0.53.0.

Read this when you change how external trucks arrive, pass the gate, choose and reach a transfer stall, hand boxes
to the landside ASC and leave, when you tune appointments, holding positions or stall strategies, or when you chase a
`landside.stranded-truck` or a gate that stops moving. The ASC side of the interchange, rehandles and the yard rules
are in [yard.md](yard.md). Terms (truck transaction, gate, transfer stall, holding position, overflow, turnaround,
stranded truck): [GLOSSARY.md](../../../../../GLOSSARY.md).

## Where the code is

| Concern | File#symbol |
|---|---|
| Arrivals, transactions, gate, admission, stalls, exit, KPI counters | `engine/subsystems/landside.ts#landsideReactors` |
| Road graph, gate lanes, stalls, holding spurs, access road, loop | `engine/landsideGraph.ts#buildLandsideGraph`, `#landsideGraphOf` |
| Appointment booking (pure) | `engine/appointments.ts#planAppointments`, `#appointmentCap` |
| Gate lane and stall strategies | `engine/decisions/landsideStrategies.ts` |
| Truck trip building, reservations | `engine/subsystems/shc.ts#TripBuilder`, `engine/reservations.ts` |
| ASC interchange phases | `engine/subsystems/asc.ts` (`AscPickedFromTruck`, `AscDroppedAtStall`) |
| Rehandle room for picks | `engine/subsystems/rehandle.ts#rehandleRoomFor`, `#admittedPicksKeepRoom` |
| Stranded truck and deadline | `engine/invariants.ts` (`landside.stranded-truck`, `#invariantDeadline`) |
| Defaults | `scenario/builder.ts#DEFAULT_LANDSIDE`, `#DEFAULT_GATE`, `#DEFAULT_HOURLY_PROFILE` |

## Config and defaults

`config.landside` (`LandsideConfig`, builder `.landside({...})`, clock `.clockStart(s)`); subsystem mode `landside`
`real` | `instant` | `off`. A landside needs blocks with transfer stalls and an ASC (`engine/landsideGraph.ts#hasLandside`).

| Field | Default [A] | Meaning |
|---|---|---|
| `hourlyProfile` | `DEFAULT_HOURLY_PROFILE` (24 values, 3 at night, peaks 48 at 08:00 and 46 at 15:00) | trucks per clock hour |
| `mix` | dropExport 0.25, pickImport 0.3, dropEmpty 0.1, pickEmpty 0.1, dual 0.25 | transaction weights |
| `importDwell` | lognormal, median 3 days, sigma 0.6 | time before a stacked box may be collected |
| `exportWindow` | 1 to 5 days before ETA | when an export may be delivered |
| `gate` | 4 in, 4 out, 40 s in, 20 s out, variation 0 %, OOG lane | `DEFAULT_GATE` |
| `drive` | vMax 8 m/s, accel 1, decel 1.5 | truck motion |
| `scripted` | none | `[{atS, transaction}]` fixed arrivals |
| `appointments`, `holding`, `accessRoad`, `teardropLoop` | absent | opt-in features below |

The clock hour comes from `kpi.startTimeOfDayS` (`engine/kpi/clock.ts#kpiClockOf`), so the start time of day changes
truck counts and nothing else. TTI presets (`scenario/presets.ts#terminal`): profile scaled by `truckScale`, gate
3 in / 3 out, `transferStallSelection: 'spread-drops'`; the peak day adds appointments and 6 holding positions, both
marked `unverified`.

## Landside road graph

`engine/landsideGraph.ts`, pure, cached per config object (`landsideGraphOf`; never mutate a config after creating a
simulation from it). Separate from the waterside lane graph: node and zone ids start `ls:` (stalls are
`<block>-TS<n>`). Every edge is axis-aligned.

```
  gate cluster (west)                         blocks (stalls at their landside end)
  in lanes | OOG | out lanes   kiosks at roadOutZ + 14, queue behind the in lanes
  RO westbound  <-------------------------------------------+   z = roadInZ + 8
  RI eastbound  ---H--H--+-------+-------+----------------->+   z = last stall z + 10
                         | spur  | spur  |   one dead-end spur per stall (in cab first, reverse out)
                        stall   stall   stall
```

- **Inbound road** `ls:RI@<x>`: one node per in lane, stall spur, holding spur and the east end; each section is its
  own conflict zone `ls:SI@<x>`. **Outbound road** `ls:RO@<x>`: sections longer than `OUT_ROAD_SECTION_M` 40 are cut
  into pieces, zones `ls:SO@<x>.<k>` (#184): one 700 m zone capped exits near 37 trucks/h on the peak day.
- **End connector:** two sharp turns, or with `teardropLoop` (TTI only) the loop `ls:LP1..4` (kind `loop`, `rolling`,
  zone `ls:loop`) driven at `cornerSpeedCap` (about 4.2 m/s, `TRUCK_CORNER` radius 12 m, 1.5 m/s^2). Trucks otherwise
  stop at every turn.
- **Gate:** lanes west to east: in lanes, the OOG lane (8 m, drawn, never routed), out lanes; lane width
  `GATE_LANE_W_M` 3.5, islands `GATE_ISLAND_W_M` 1.2. The cluster ends `GATE_WEST_GAP_M` 40 m west of the first block,
  more with holding. Queue slots `QUEUE_PITCH_M` 19 m apart behind the in lanes (`queueSlotZ`, `queueSlotAt`).
- **Access road** (`accessRoad {z, fromX}`, TTI only, #146): trucks appear at `ls:AS`, drive north along it and turn
  into the terminal road at `ls:AJ` without stopping (`arrivalMotion`); a long queue backs up along the access road.
  Exits still despawn at the out lanes.
- **Holding positions** (`holding.positions`): dead-end spurs `ls:H<n>` (zone `H<n>`) off the inbound road, all west
  of every stall spur (`HOLDING_PITCH_M` 5.5), so every stall stays reachable on the one-way road. Without holding the
  graph is unchanged.
- Zone clearance `TRUCK_ZONE_CLEARANCE_M` 10. Routes: `landsideRoute` (throws "No landside route" when none exists).
- **Invariant `landside.segregation`:** trucks only on landside nodes and never in the waterside area (now and at every
  motion breakpoint); SHCs only on lane-graph nodes.

## Arrivals and transactions

- **Poisson** (default): `nextPoissonArrival` draws a piecewise-constant Poisson process over the hourly profile from
  the landside's own RNG stream (`LandsideState.rngState`, `landsideRandom`), so other subsystems' draws never
  change. Each `TruckArrivalDue` schedules the next. Scripted trucks are scheduled at `ScenarioStarted`.
- **Feasibility** (`feasibleKinds`): `pickImport` / `pickEmpty` need a box in its own slot with `pickupReadyAt <= now`,
  no `truckClaim`, not `allocatedTo` a package (`eligiblePickups`); `dropExport` needs an export vessel
  (`exportVessels`); `dual` = both; `dropEmpty` is always possible. The mix is restricted to feasible kinds; nothing
  feasible (or an infeasible scripted or booked kind) falls back to `dropEmpty` (`TruckArrived.fallback`, KPI
  `fallbacks`).
- **`pickupReadyAt`:** set at `AscStacked` (not a rehandle) to `now + sampleDwell(importDwell)` for a discharged box
  with no onward vessel and for a truck-delivered empty; pre-filled imports and pool boxes get it at start. The same
  dwell distribution serves imports and empties.
- **Legs** (`makeLegs`): a pick claims a random eligible box (`truckClaim`). A drop export picks a vessel weighted by
  its remaining exports, then either takes a booked undelivered box (empty or warm-up start, last in load sequence
  first) or creates a new box (ISO id from serial 500000, custody `truck`, props drawn) and books it to a new `load`
  slot of the vessel (`bookExtraExport`, cell from `scenario/bayPlan.ts#extraLoadCell`; leg `slotId`; the vessel must
  be `scheduled` with room). A drop empty creates a box with `vesselId 'POOL'`. Reefers are drawn by id hash.
- **Export windows:** legacy and pre-filled starts accept vessels `scheduled` inside `[minBeforeEtaS, maxBeforeEtaS]`
  before ETA with `load > 0` and a free cell. Empty and warm-up starts accept any not-departed vessel with undelivered
  bookings whose window has opened, also after arrival (its load waits for them).
- `announcePicks` creates each pick's retrieval `AscJob` at `TruckArrived`, so the block it belongs to is fixed then
  and rehandles may start (once the truck holds a stall, see [yard.md](yard.md#rehandles)).

### Appointments (`landside.appointments`, TT-R15)

Replaces the Poisson process with booked windows; absent keeps every older golden. At `ScenarioStarted`
`planAppointments` books every window of the horizon (`horizonS`, default `simDurationS` plus warm-up, else 24 h):
demand = profile rate at the window's clock hour x window x product of overlapping `bunching` factors, rounded with
one draw; booked = min(demand, cap); each booking gets a uniform arrival in its window and a transaction from `mix`.
`appointmentCap` = min(gate `inLanes x windowS / inProcessingS`, stalls `x windowS / stallServiceS`, `maxPerWindow`);
`windowS` default `DEFAULT_APPOINTMENT_WINDOW_S` 1800, `stallServiceS` default `DEFAULT_STALL_SERVICE_S` 300 [A].
Rejected demand is counted, never booked. Booked kinds are forced like scripted ones (infeasible falls back).
`TruckArrivalDue`/`TruckArrived` carry `appointmentId`. Not modelled: ANPR, early or late arrival behaviour.

## Truck turn

```
TruckArrivalDue -> TruckArrived (queue, FIFO) -> [admission with holding] -> gateLaneAssignment
  -> TruckGateStarted -> TruckGateIn (kiosk processing) -> transferStallSelection (or reserved at admission)
  -> TruckStallAssigned (trip planned, zones reserved) -> TruckRoutingToStall (frees the lane / holding spot)
  -> TruckAtStall -> ASC interchange (AscPickedFromTruck / AscDroppedAtStall) -> TruckInterchangeDone
  -> TruckRoutingToExit (reverse out, frees the stall) -> TruckGateOut -> TruckDeparted
with holding: TruckGateIn -> TruckRoutingToHolding -> TruckAtHolding -> (stall decision) -> TruckStallAssigned ...
```

Statuses: `queued in-lane waiting-for-stall routing-to-holding holding routing-to-stall at-stall being-served
routing-to-exit`. Trips use `TripBuilder` and `reservations.ts` like SHCs.

- **Gate** (`pumpGate`): when an in lane is free and no lane decision is pending, the head of the queue is offered to
  `gateLaneAssignment` (v1; strategies `lowest-free-lane` default, `least-used-lane`). A stale reply (head changed)
  re-pumps. Processing time `inProcessingS`, varied by `processingVariationPct` (landside RNG). Queued trucks move up
  slot by slot (`planQueueMoves`).
- **Without holding:** after `TruckGateIn` the truck waits at its kiosk (`waiting-for-stall`) and **holds its gate
  lane** until it drives to a stall; `TruckWaitingForStall` marks a wait with no free stall at all. `pumpStalls` serves
  `stallWaiting` in order but skips a truck with no free legal stall, so a truck whose block is full does not hold up
  the others.
- **Exit** (`planExit`): every out lane is planned (reverse out, roads, out kiosk `outProcessingS`, lane end) and the
  one with the earliest start wins. The stall is freed at `TruckRoutingToExit`. Picked boxes leave with custody
  `external` at `TruckDeparted`; `lastDepartureByLane` is stamped for the exit-wait check.

### Stall admission and holding (`landside.holding`, TT-R16)

`HoldingConfig {positions, overflow: 'wait-outside', unverified}`. With it, `admit` runs for the queue head before a
lane is asked: (1) a free legal stall exists: `transferStallSelection` picks it and it is **reserved before the truck
is sent** (`TruckStallReserved`; trip planned at `TruckGateIn`); (2) else a free holding position is reserved
(`TruckHoldingAssigned`); (3) else **overflow**: the truck stays outside (`TruckHeldOutside`, once per truck). The head
blocks those behind it while it waits, except for the bypass below. While a stall decision is open the gate admits
nobody. Holding trucks join `stallWaiting` and are served first (`pumpStalls` runs before `pumpGate`); distances are
measured from the truck's own node. A stall or holding position is freed when the truck starts driving out of it.
Invariants: `landside.stall-exclusive`, `landside.waiting-off-road`, `landside.leaves-complete`.

**Head-of-line bypass** (`bypassBlockedHead`, holding on only, #184, #208): when the head holds nothing, cannot use any
free stall, and is drop-only, or no holding position is free, or no stall of any occupancy could take it, queued trucks
with a pick leg and a free legal stall are promoted to the front in queue order, at most one per free stall of their
block and one lane in all. A promoted truck is admitted at once but asks for a lane only when it physically stands at
the head (`atSlotAt`; `TruckReachedGateHead` wakes it; `TruckState.promoted`, `headWakeAt`). Otherwise first come,
first served.

### Stall legality

`stallLegal(ctx, truck, blockId, room)` filters every stall offer (gate admission, `pumpStalls`, the decision request,
the bypass). The request lists only legal stalls; a reply outside the truck's pick block throws.

- **Truck with a pick:** only the block its retrieval job was made for (`legalBlocks`, #183: the custody at stall time
  could be an ASC and leave every stall legal). A pick-only truck with open legs also needs `rehandleRoomFor` (its
  blockers fit under the stacking rules, together with the blockers of every pick whose truck holds a stall in the
  block) and `admittedPicksKeepRoom` (each admitted pick still fits with this truck counted). Queued or holding trucks
  promise nothing. Dual transactions skip the room clause (their own drop is the issue; their pick frees room).
- **Drop-only truck:** every drop must fit: `blockTakes` = `engine/subsystems/shc.ts#blockRoom > 0` (free cells minus pending stacking
  jobs minus `BLOCK_FREE_RESERVE` 10 %) and at least one `candidateSlots` slot on the `withoutPendingPickups` view with
  the yard reserve (a 40 ft box needs two bays free in one row). Memoised per decision by `roomReader`. Then
  `blockRoom - committedDropCells >= dropCells`: drops of other trucks holding a stall of the block but not yet in it
  come off the room first (#184).
- **Drop reroute** (#184): a drop-only truck at its stall whose every drop got `full` with no ASC started is listed in
  `LandsideState.fullDrops` (`dropMetFull`). `pumpStalls` offers it free legal stalls of another block **further east**
  only (`reachableStall`: the inbound road is one way). On the reply its drop jobs are deleted, the old stall freed, the
  new one reserved and the trip planned from the old stall. A truck in the last blocks has nowhere to go and waits for a
  lift (`reopenFullJobs`).
- **Room appeared** (`stallRoomAppeared`, called from `AscRetrieved`): re-runs `pumpStalls` and, with holding, the gate.

### `transferStallSelection` strategies (`landsideStrategies.ts`)

Request: truck, transaction, legs (`blockId` of a pick box), legal `stalls` (`occupiedBy`, `distanceM` road distance
from the truck's node), `blockLoad` (stall holders plus waiters per block), `blockFill` (cells used / cells).

| Strategy | Rule |
|---|---|
| `nearest-to-box` (default) | free stall of the pick block, else any free stall; nearest the gate, then id |
| `spread-drops` (TTI) | picks as `nearest-to-box`; drop-only: lowest `distanceM + SPREAD_FILL_M 6000 x fill + SPREAD_TRUCK_M 60 x load` |
| `least-loaded-block` | free stall in the block with the lowest `blockLoad`, then nearest |

`spread-drops` exists because nearest-the-gate drops filled B01 to B04 to 90 % while far blocks stood near 77 % (#188).

## Interchange with the ASC

- **Drop:** at `TruckAtStall`, `startInterchange` creates a stacking `AscJob` with `stallId/truckId` per drop leg
  (`allocation: 'waiting'`); its `yardAllocation` request has `stallId` and the stall as origin. ASC events
  `AscRoutingToTruck -> AscPositioningAtTruck -> AscLocking -> AscPickedFromTruck -> AscRoutingToSlot ... AscStacked`.
- **Pick:** the retrieval job exists from arrival; it can start when the truck stands with a free chassis and every
  drop leg done (`truckReadyForPick`) and the box is on top. Events end `AscRoutingToStall -> AscPositioningAtStall ->
  AscUnlocking -> AscDroppedAtStall` (throws if the truck is not at its stall).
- `ascDispatch` jobs at a stall are `kind: 'transfer'`; `waterside-first` gives them to the landside ASC. Stacks
  holding a box a truck is coming for read full to `yardAllocation`; stall-holding trucks' stacks are never rehandle
  targets.
- `legDone` marks each leg; the stall wait ends at the first `AscJobAssigned.departAt`; `TruckInterchangeDone` when
  all legs are done, then `planExit`.

### ASC pre-retrieval

Strategy `pre-retrieval` of `ascDispatch` (opt-in, `preRetrievalOn`; TT-R17). A pick may start before the truck
arrives when `earlyPickReady`: stall reserved and trip planned, truck within `PRE_RETRIEVAL_MAX_LEAD_S` 150 s [A] of
`TruckAtStall`, empty chassis, no drop leg (dual never qualifies), box on top, no rehandle open. Early picks are the
lowest priority and only for an idle ASC; even a one-ASC block asks the decision for them. The ASC hovers over the
stall (`AscTrip.wait`, also in instant mode) until the truck's planned arrival. `AscJobAssigned.early`; service then
starts at `TruckAtStall` with zero stall wait. Fixture `asc-pre-retrieval`: mean stall service about 50 s against 80 s.
The fetch starts only when the trip is planned at gate-in, so it saves roughly the kiosk-to-stall drive.

## Stuck trucks at the transfer points

A truck at its stall with its box on the chassis must never wait on nothing (#175).

- **Retry:** a stacking job answered `full` returns to `waiting` and a `rehandle: 'full'` retrieval to `required` on
  every `AscRetrieved` in the block (`engine/subsystems/ascStorage.ts#reopenFullJobs`), then `maybeDispatchAsc`. No event is added: the
  retry shows as the next `DecisionRequested` for the box. `allocationFailures` counts each refused retry.
- **Stall choice:** drop-only trucks only get stalls of blocks that take every box (above); picks keep their block.
- **Invariant `landside.stranded-truck`** (reads `time`): a truck `at-stall` or `being-served` for more than
  `STALL_STRAND_LIMIT_S` 1800 s [A] while no ASC of its block works and no open job of the block can start
  (`jobCanStart`: not allocation `full`, not `rehandle: 'full'`, not a pick held by its own drop). A truck whose legs
  are all done is checked for its **exit-slot wait** instead, measured from the later of `interchangeDoneAt` and the
  last departure through its own out lane (`lastDepartureByLane`): a moving lane is a queue, a blocked slot is
  reported although other lanes move. Checked at its deadline too (`invariantDeadline`), and the closing sweep of a
  duration-ended run moves the clock to the end first.
- **Not covered:** a dual transaction's drop has no room filter (filtering would deadlock the gate); a drop refused for
  geometry while cells are loose waits for a retrieval in its block and is reported if none comes.

Proof: `tests/stranded-trucks.test.ts`, `tests/pick-admission.test.ts`, `tests/exit-road-pipeline.test.ts`,
`tests/yard-no-progress.test.ts`; full-block yard rule in `tests/asc-yard-rules.test.ts`.

## KPIs

`kpiReport().landside` (`engine/kpis.ts#LandsideKpiReport`), counters in `state.kpis.landside`
(`LandsideKpiCounters`, updated in the handlers; `driveStep` and `touchHolding` keep the time integrals, closed at
report time so a mid-run report is exact):

| Field | Definition |
|---|---|
| `trucksIn`, `trucksOut`, `trucksInside`, `gateQueue`, `gateQueueMax` | counts |
| `gateWaitS` | arrival to lane assigned |
| `gateProcessingS` | in-kiosk processing |
| `stallAllocWaitS` | gate-in to stall assigned |
| `internalDriveS` | inbound driving only (kiosk to holding, holding to stall, or kiosk to stall), incl. waits for a zone while moving |
| `stallWaitS` | at the stall until the first ASC job departs |
| `serviceS` | at the stall to interchange done, mean |
| `turnTimeS` | gate-in to gate-out |
| `totalTurnaroundS` | `TruckArrived` to `TruckGateOut` (includes waits outside and in holding) |
| `road {meanTrucks, maxTrucks}` | trucks driving on internal roads, time-weighted (no capacity, not a %) |
| `transactions`, `boxesDropped`, `boxesPicked`, `fallbacks` | counts |
| `appointments {windowS, capPerWindow, windows, booked, rejected, maxBookedPerWindow, delayed}` | with appointments; delayed = gate start after its window ended |
| `holding {positions, admittedToStall, admittedToHolding, heldOutside, inUse, maxInUse, waitS, utilisationPct}` | with holding |

Series (dashboard group Landside): `landside.trucks-in`, `trucks-out`, `gate-queue`, `gate-wait-s`,
`gate-processing-s`, `internal-drive-s`, `stall-wait-s`, `truck-turn-s`, `total-turnaround-s`, `road-trucks`,
`holding-utilisation-pct`, `appointments-delayed`. CLI summary prints a `Landside:` block and a `Truck turnaround`
headline (`HeadlineKpis.truckTurnaroundS`). Details: [kpis-and-reports.md](../kpis-and-reports.md). A warm-up start
zeroes `state.kpis.landside` with the other KPIs at `WarmUpEnded` (see [yard.md](yard.md#empty-and-warm-up)).

## Fixtures

`dual-truck-transaction`, `truck-gate-queue`, `landside-morning-peak`, `truck-appointment-windows` (2 stalls, cap 12,
36 booked, 12 rejected), `truck-holding-overflow` (2 stalls, 2 holding positions, 10 trucks 5 s apart),
`asc-pre-retrieval`. Tests: `tests/landside.test.ts`, `truck-appointments`, `truck-holding`, `truck-turnaround`,
`truck-exports-booked`, `spread-drops-stall`, `tti-road`. Browser rendering and `__tt` camera targets for trucks,
gate and stalls: [browser-host.md](../browser-host.md), [rendering-3d.md](../rendering-3d.md).

## Known gaps

- No setup-dialog fields for the landside (use fixtures or `config.landside`).
- A truck always drives to its holding position even if a stall frees on the way; a truck declined by the stall
  decision (`stallId: null`) at admission waits for the next gate event; no priority between holding trucks and new
  arrivals beyond holding first.
- Room checks are not reservations: other trucks' rehandles can take the room between admission and arrival.
- A heavy truck load (about 20 trucks/h) on a small yard stalls retrievals: rehandles behind truck-claimed boxes.
- The default yard strategy piles imports near the waterside end, where the landside ASC cannot reach while the
  waterside ASC works pads, so pickups wait (`landside-morning-peak`).

## Optimisation levers and gotchas

- **Throughput:** gate lanes and `inProcessingS` cap admission; stalls per block (at most 5) cap interchange;
  `spread-drops` balances block fill; holding positions plus the bypass keep a blocked head from idling other blocks;
  `pre-retrieval` cuts stall service; outbound road sectioning (`OUT_ROAD_SECTION_M`) sets the exit rate (one long
  zone held 96 s per truck took turnaround from 1,350 s to 780 s once cut). See
  [terminal-throughput.md](../optimising/terminal-throughput.md).
- **Run speed:** `eligiblePickups` / `hasEligiblePickups` scan every yard slot on each arrival; `roadDistance` is
  cached per graph; `roomReader` memoises `blockTakes` per decision; `stallLegal` for picks runs `rehandleRoomFor`
  over every admitted pick of the block.
- **Determinism:** landside draws use only `LandsideState.rngState`; the draw in `drawTransaction` is always taken so a
  mix with no feasible kind does not shift the stream. Changing the graph (zones, sections) or admission rules moves
  the landside goldens' event-log hashes; KPI-only changes move only their `kpis` fields. Prove with
  [terminal-twin-AGENTS.md](../../terminal-twin-AGENTS.md#how-to-prove-a-change-works).
- A truck at a stall whose transfers are done waits for its exit reservation, which on a busy road can be long; that
  is reported only when its own out lane stops moving for 1800 s.
- Gate deadlock shapes seen at realistic volume (drop-only head with no room, holding positions full of picks for one
  hot block, finished trucks unable to exit): [realistic-volume-reports.md](../reports/realistic-volume-reports.md).

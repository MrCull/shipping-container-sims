# Glossary

Domain terms used in code, tests, docs and conversations. Most are from **Terminal Twin** (`src/sims/terminal-twin/`). Use these words; avoid the listed alternatives.

## Equipment

- **STS (ship-to-shore crane, quay crane):** a rail-mounted crane on the quay that moves containers between a vessel and its STS ground positions. STS cranes share one rail and never pass each other. Its axes are **gantry** (X, along the quay), **trolley** (Z, waterside to landside) and **hoist** (Y). *Avoid:* "QC" in code.
- **ASC (automated stacking crane):** a rail-mounted gantry crane serving one yard block. Each block has 1–2 ASCs, which never pass each other. The waterside ASC prefers WTP work and the landside ASC prefers truck work.
- **SHC (shuttle carrier):** a straddle-type vehicle that carries one container at a time between STS ground positions and WTP pads. It sets a box down and drives clear before the box can be picked up again. *Avoid:* "straddle carrier" for this role.
- **Spreader:** the lifting frame on an STS or ASC hoist. It grips a container with twist-locks (**lock** and **unlock** times).

## Places

- **Quay:** the continuous berth face at Z = 0. Sea is at negative Z and the yard at positive Z, with X running along the quay.
- **Vessel slot:** a bay/row/tier position on a vessel (`<vesselId>:<bay>-<row>-<tier>`, plus `a`/`f` for the aft/fore 20 ft half of a cell). Its **purpose** is discharge, load or transshipment.
- **Cell:** one bay/row/tier position of a vessel. It holds one 40 ft box or two 20 ft boxes (aft and fore half).
- **Bay plan:** a vessel's slots and the boxes in them, generated from the vessel call and the seed. Bays are 40 ft bays counted from aft. Tiers count from the hold floor; tiers above the hatch covers are **on deck**, the rest **in the hold**.
- **Berth:** a vessel's stretch of the continuous quay, from its stern (`berthX`) to its bow (LOA). Vessels keep a **berth gap** apart.
- **Anchorage:** where an arrived vessel waits when no berth is free. **Anchorage wait** = berth allocation time − arrival time.
- **Rail reservation:** the stretch of the STS rail a crane may occupy during its current gantry motion. Neighbouring reservations stay at least the minimum STS spacing apart.
- **Ground position (STS ground position):** a buffer lane under an STS where discharged boxes are set down and from which load boxes are picked (`<stsId>-GP<n>`).
- **WTP (waterside transfer point) pad:** a buffer position at the waterside end of a yard block. SHCs drop boxes there, and the ASC picks them up (and the reverse).
- **Transfer stall (landside transfer stall):** a truck position at the landside end of a block where the ASC serves external trucks.
- **Block:** one yard block, perpendicular to the quay. It has 8 rows (fixed by the 25.4 m ASC span), with configurable bays and tiers.
- **Bay (yard bay):** one 20 ft position along a block (6.7 m). A 40 ft box covers two bays.
- **Row:** one of the 8 lines across a block, under the ASC span.
- **Tier:** a level in a stack, from 1 at the ground. A block has a **tier limit**.
- **Yard slot (slot):** a 20 ft cell `<block>:<bay>-<row>-<tier>` that holds a box. A 40 ft box is named by its lower bay (its **anchor**) and also covers the next bay.
- **Stack:** the boxes in one bay and row. A box above tier 1 must rest on boxes (no **floating** box).
- **Yard slot:** a bay/row/tier position in a block.

## Operations

- **Custody:** the single owner that currently holds a container (vessel slot, STS, ground position, SHC, WTP pad, ASC, yard slot or truck). Custody changes only at a confirmed grip or release. Each container keeps a **custody history**.
- **Handover:** a custody change between two pieces of equipment via a ground buffer, never directly.
- **Discharge / load:** a vessel-to-quay move / a quay-to-vessel move.
- **Vessel call:** one vessel's visit: arrival, size class (Feeder, Feedermax, Panamax, Neo-Panamax, ULCV), discharge/load/transshipment counts and max STS. The **vessel table** lists the calls.
- **Mooring / unmooring:** the time from berth allocation to all-fast, and from the last move to departure.
- **Crane split:** which STS cranes work which bays of a vessel (a decision point). Cranes keep rail order, so bay ranges follow crane order.
- **Twin-20 lift:** an STS lift of the two 20 ft boxes of one cell in one cycle; each box gets its own ground position.
- **Deck before hold:** within a bay, an STS discharges the deck stacks (top tier first) before the hold.
- **Move:** one productive container transfer by an STS (a discharge or a load). This is the unit of moves per hour.
- **Cycle:** one complete loop of a crane: start, pick, carry, ground, return.
- **Work package:** one STS's moves for one bay section (deck or hold, discharge or load) of one vessel. A package is `planned`, then `released` by the `workPackageRelease` decision point, `active` while its crane works it, then `complete`. A crane works its packages in sequence: discharge packages first, then load packages.
- **Release ahead (K):** how many packages the default release strategy keeps released behind the one the crane is working (default 2). The **release lead time** is the time from a package's release to the start of its work.
- **Export box:** a box booked to a vessel for loading. It starts in the yard (pre-filled from the bay plan) and is loaded into its **load slot**, the empty slot the bay plan booked for it.
- **Load flow:** the reverse of discharge: stack → ASC → WTP pad → SHC → STS ground position → STS → vessel slot. The ASC step is a **retrieval**.
- **Load order:** the yard work of one export box from its package's release to its ground position (claim a ground position, retrieve, carry). A crane **stages** at most as many boxes as it has ground positions, in load sequence.
- **Load sequence:** the order a crane loads a vessel: bay by bay, hold before deck, bottom tier before upper tier, then row, aft half before fore half.
- **Stowage order:** a box is never loaded into a slot whose lower tier (in the same stack) is still empty. Checked by the invariant `stowage.order`.
- **Rehandle:** a non-productive ASC move needed to reach a buried box.
- **Job (SHC job):** one box to move from an STS ground position to a WTP pad. Grounding a box **releases** a job into the **released pool**; a job is **open** until an SHC **claims** it.
- **Pull dispatch:** free equipment asks the dispatch decision point (`shcDispatch`) for its next job from the released pool, rather than jobs being pushed to equipment.
- **Trip:** an SHC's planned drive with its phases (routing empty, positioning at pickup, locking, lifting, routing loaded, positioning at drop-off, lowering, unlocking, clearing), or its drive to its parking spot.
- **Clear position (pad clear position):** where an SHC reverses to after setting a box down on a WTP pad, clear of the pad. *Avoid:* "exit".
- **Parking spot:** an SHC's own rest position off the apron, where idle SHCs return.
- **Driver variability:** a ± % random factor on each SHC trip's drive times.
- **Transshipment:** a box that goes vessel → yard → another vessel.

## Engine and tooling

- **Scenario config:** the small, serialisable description of a run (layout, equipment, kinematics, vessel table, cargo mix, end conditions, seed; bay plans and containers are generated from it and the seed). It is built with the **scenario builder**.
- **Fixture:** a small focused scenario config committed as JSON under `scenario/fixtures/`, with a **golden summary** (`*.golden.json`: KPIs plus event-log hash).
- **Preset:** a full-size scenario config generated in code (TTI Algeciras baseline, Small automated, Stress test).
- **Event:** a happening in the sim, wrapped in the common **envelope** (`id`, `seq`, `t`, `type`, `causedBy`, `subjects`, `payload`).
- **Root event:** an event with no cause: `ScenarioStarted`, plus any event injected through `inject` (dev API / tests).
- **Cause chain:** an event's `causedBy` links back to the root, as returned by `why(eventId)`.
- **Reactor:** the engine's internal handling of one event type (physics and flow). It is not swappable.
- **Decision point:** a place where the sim asks the TOS for a decision (berth allocation, crane split, yard allocation, ground-position selection, dispatch, …).
- **Handler:** a function that answers a decision point. Handlers are swappable, and a **handler set** maps decision points to handlers.
- **Strategy (built-in strategy):** a named built-in handler for a decision point (1–3 each, e.g. `lowest-free-lane`), selected per scenario.
- **Correlation id:** the id that ties a decision's request, failure and reply events together (`<decisionPoint>-<n>`).
- **Async mode:** what the sim does while a decision is pending: **keep running** (equipment waiting on it idles) or **pause** (the sim clock freezes).
- **Latency injector:** a per-decision-point wrapper that delays replies (none / fixed / random ms) and injects a % of timeouts or errors.
- **Fallback:** the built-in strategy that answers when a handler times out or errors (`DecisionFailed` → `DecisionResolved` with outcome `fallback`).
- **Idle time caused:** sim seconds that equipment spent waiting on a decision, attributed to that decision point's handler.
- **Motion segment:** a planned rest-to-rest move of one equipment axis with a known start and end time. It uses an accelerate/cruise/decelerate (trapezoidal) or short-move (triangular) profile.
- **Invariant:** a rule that must hold after every event (for example `custody.single-owner`). **Fail-fast** stops the run at the first violation.
- **Snapshot:** a full JSON copy of a run's state (queue, RNG, log), used to resume the run exactly.
- **Event-log hash:** a deterministic hash of every committed event. The same seed and config always give the same hash.
- **Structured log:** JSON-lines records derived from committed events (`t`, `eventId`, `seq`, `subsystem`, `level`, …), filtered by **per-subsystem verbosity** (`sts=debug,*=warn`).
- **Subsystem (logging):** the part of the sim an event belongs to (`scenario`, `vessel`, `sts`, `invariants`; later `asc`, `shc`, …), normally the first word of its event type.
- **Run diff:** a comparison of two event logs that reports the **first diverging event** (its `seq`, the differing fields and both events).
- **Time window:** a run resumed from a snapshot that processes only events after the snapshot's time, up to a stop condition.
- **Golden update:** an explicit rewrite of golden summaries (`npm run tt:golden -- --update`). Without it, any difference from a golden is **drift** and fails.
- **Engine horizon:** in the browser, the sim time up to which the worker's engine has processed events. The displayed time never passes it.
- **Display time:** the sim time the 3D view and clock show. It advances with wall time × **speed** (×1 = real time) and is drawn by interpolating motion segments.
- **Look-ahead:** how far the engine runs ahead of the display time while playing, so that the motion for the displayed instant is already known.
- **Run to…:** run the engine flat out (without rendering) to a target sim time, then resume playback there.
- **Delta:** the compact worker → main-thread update: new motion plans, custody changes, status changes and summarised events.
- **Dev API:** `window.__tt`, the dev-build-only browser API (load, step, runUntil, query, inject, snapshot, why, select, cameraTo) used by Playwright smoke tests and agents.
- **Lane graph:** the generated one-way graph SHCs route over (apron loop, STS lanes, WTP spurs, parking spurs). Edges run along X or Z.
- **Conflict zone:** a part of the lane graph only one vehicle may use at a time: an intersection, an STS lane section (ground position) or a WTP pad with its spur.
- **Reservation:** a time window `[from, to)` on a conflict zone held by one piece of equipment. Trips reserve all their zones before departing and depart later if any window is taken.
- **Yard allocation:** the decision point (`yardAllocation`) that picks a box's slot in the block of the pad it was dropped on. Built-in strategies: random, nearest-wtp, group-by-vessel.
- **Claim (slot claim):** a slot is claimed when allocation answers and stacked later. Stacks fill in claim order: an ASC does not stack a box before an older claim in the same stack.
- **ASC job:** one box to move from a WTP pad to its slot. It is **ready** once its slot is allocated and its SHC has released the box and cleared the pad.
- **Lifting envelope (of a WTP pad):** the space over the pad where an ASC spreader is below travel height. An ASC never enters it while an SHC is on the pad (the pad zone's **handover**).
- **Twin-ASC block:** a block with two ASCs on one rail (`ascsPerBlock: 2`): the **waterside ASC** (`<block>-ASC1`) and the **landside ASC** (`<block>-ASC2`). The engine default is 1; the setup dialog defaults to 2.
- **Rail segment:** a half-bay slice of a block's ASC rail (zone `<block>:R<k>`). A crane's footprint is its position plus half the **minimum separation** (12 m between centres: 8 m portal + 4 m safe gap) either side; it holds the segments the footprint touches.
- **Park hold:** the open-ended reservation of the segments around an ASC that stands still. It ends when the crane's next trip starts. A trip that conflicts with the other ASC's trip waits (**rail wait**); one that conflicts with its parked position makes it **step aside** (yield) if idle, or cannot start until it is idle.
- **ASC dispatch:** the decision point (`ascDispatch`) that picks which idle ASC of a twin block takes the oldest ready box. Built-in strategies: `waterside-first` (default: WTP work to the waterside ASC, transfer-stall work to the landside ASC, the other crane only when no step-aside is needed) and `balanced` (fewest jobs so far).
- **Subsystem mode:** how a subsystem runs: **real**, **instant** (a stub that raises the same events with zero durations) or **off**.
- **Overlay (3D debug overlay):** an optional drawing over the 3D view: lane graph, active reservations, occupancy, state labels, **ASC rail** (reserved and parked rail segments, waterside ASC blue and landside ASC red). Each toggles independently; `O` hides or shows them all.
- **Breakpoint:** a debugger rule that pauses the sim right after an event that matches it: an event type, a container id, an equipment id or a decision point. Set from the event feed panel or `__tt.addBreakpoint`.
- **Single-step:** process exactly one engine event and pause, at any speed setting.
- **Event feed:** the left panel's live list of recent events, newest first, filterable and capped. At high speed it **summarises bursts** (runs of the same event type) into one row.
- **Event inspector:** the right panel's view of one event: payload, subjects, a decision's handler, request and reply, and its **cause chain**.
- **Cause chain:** the events that led to one, from the event back to the root, as returned by the engine's `why`. Clicking an entry inspects it.
- **Selection:** the container, equipment or vessel picked in the 3D view (or by an id in the feed or inspector). The **inspector** shows its current state, current job and history, and the **follow camera** can track it.
- **Picking:** finding the entity under a click by testing the view ray against each entity's bounding box (containers first).
- **Occupancy overlay:** plates over WTP pads and STS ground positions, free or occupied at the displayed time. The **labels overlay** floats each crane, carrier and vessel's status above it.
- **Display settings:** the UI's **locale** (Intl formatting of dates, times, numbers, first day of week) and **unit system** (metric: m, km/h, t; imperial: ft, mi/h, US tons). Display only: the engine and saved configs are always SI. Imperial speed is written **mi/h** because **mph** would read as crane moves per hour.
- **Message catalogue:** `i18n/messages.ts`, the single home of every user-visible UI string (English only for now), looked up with `t(key)`.
- **KPI collector:** the engine fold (`engine/kpi/`) that turns the event log into every KPI as a time series. `Simulation.kpiSeries()`.
- **KPI series:** one KPI for one entity (a crane, a block, the terminal) with an **hourly** value per hour bucket, a value per **shift** and a **total**.
- **Hour bucket / shift bucket:** an hour cut on the scenario clock, and a run of 8 whole hours (3 per day; default 06-14, 14-22, 22-06). A night shift belongs to the day it starts.
- **Gross / net moves per hour:** a crane's moves divided by the hours it was on a vessel (gross) or on a vessel and not waiting for an SHC or the rail (net).
- **Headline KPIs:** the few numbers on the **KPI strip** and in the CLI summary.
- **End condition:** a rule that ends the run: N vessels completed (default all scheduled), sim duration or total moves. The first one met wins.
- **Final report:** the panel shown when a run ends: reason, **highlights**, headline KPIs, tables and export buttons. The scene stays inspectable; only Reset and New Scenario remain of the time controls.
- **Highlights:** friendly facts in the final report: hardest-working crane, busiest block, longest wait.
- **TOS (terminal operating system):** the external software whose decisions the handlers stand in for.

## Rehandles (TT-12)

- **Buried box:** an export box with other boxes stacked on top of it, so it cannot be lifted.
- **Blocker:** a box that has to move before a buried box can be retrieved (the boxes on it, and the boxes on those).
- **Rehandle:** the extra ASC move that takes a blocker to another slot of the same block. It is not a productive move. *Avoid:* "reshuffle", "restow" (that is on board a vessel).
- **Productive move:** an ASC move that stacks an arriving box or retrieves an export box for loading.
- **Rehandle ratio:** rehandles per productive move, overall and per block (`rehandlesPerProductiveMove`).
- **Rehandle target:** the slot the `rehandleTarget` decision picks for a blocker.

## 3D assets (phase 2)

- **Asset:** one generated GLB (for example `container-40`) plus its **sidecar** `<asset>.meta.json`, made by the Python (bpy) **generators** in `assets/generators/` and committed. *Avoid:* "model file" for the pair.
- **LOD (level of detail):** `LOD0` (most detailed), `LOD1`, `LOD2` nodes in an asset. The renderer picks one per instance by camera distance.
- **Rig node:** a named movable node (`door_left`, `trolley`, `hoist`, …) whose origin is its mechanical pivot. Its range is in the sidecar's **travel limits**.
- **Attach point:** a named point where something connects (container twist-lock and stacking points, a spreader's container seat).
- **Provenance tag:** how a value is known: `V` verified, `P` photo-supported, `A` approximated, `M` intentional modification. These are the TTI reference pack's tags.
- **Livery:** a shipping line's container colours and wordmark. The **livery atlas** has one tile per line, and an instance's **livery index** is its tile.
- **Wordmark:** the line's name set in a close open-licence typeface and the brand colours, standing in for the official logo.
- **Asset budget:** the triangle, draw-call and file-size limits per asset kind (`assets/budgets.json`), enforced by the **budget check** (`npm run tt:assets:check`).
- **SHC model:** the rigged Kalmar-style shuttle carrier asset `shc` (nodes `steer_*`, `wheel_*`, `hoist`, `spreader`, `twistlock_*`). Its **tunnel** is the open space between the legs that a box is carried through, and its **container attach point** is the centre of the twist-lock plane (the top of the carried box). *Avoid:* "SHC mesh".
- **STS model:** the rigged Malaccamax quay-crane asset `sts-malaccamax` (nodes `gantry`, `trolley`, `hoist`, `spreader`, `boom`, twist-locks). Its **container attach point** is the spreader's seat for the top of a box; a **spreader mode** (`20`, `40`, `twin-20`) sets the telescope and twin-lock positions. *Avoid:* "crane mesh".
- **Hoist travel:** how far the SHC's `hoist` node moves down from rest (0 to −3.1 m); equal to the carried box's top height minus 6.0 m.
- **Odometer (SHC):** the signed distance an SHC has rolled along its heading, from which the renderer derives wheel roll.
- **ASC model:** the rigged ZPMC-style stacking crane asset `asc` (nodes `gantry` > `trolley` > `ropes`/`hoist` > `spreader` > `twistlock_*`). The **bridge** is its twin box-beam girder across the 25.4 m **span**; the **design stack** is the 5-high stack of 40 ft high-cube boxes it was sized for. *Avoid:* "ASC mesh".
- **Rope scale:** the Y scale of the ASC `ropes` node, derived from the hoist (the ropes have no travel limit of their own).
- **Truck model:** the rigged haulier asset `truck-cab-high|mid|day` (a cab-over tractor plus the skeletal chassis) and the chassis alone `truck-chassis`. Nodes `fifth_wheel`, `tractor`, `steer_*`, `wheel_*`, `wheel_t1..t3`, `chassis`. *Avoid:* "trailer model" (the chassis is a container carrier, the box is the load).
- **Fifth wheel:** the articulation pivot between tractor and chassis (the kingpin axis). **Articulation** is the tractor's yaw against the chassis through a turn.
- **Chassis pin:** a twist-lock housing on the chassis at an ISO 1161 casting centre (`pin_40_*`, `pin_20_mid_*`). A **load position** (`load_40`, `load_20_front`, `load_20_rear`) is where the bottom centre of a box sits.
- **Truck livery:** a tile of the truck atlas: cab colour, maker wordmark (Volvo, Scania, DAF, MAN, Mercedes-Benz) and chassis colour. The truck's id picks its cab shape and livery.
- **Asset viewer:** the dev-only page `/sim/terminal-twin?viewer=<asset>` (or `?viewer=yard`), with its API `window.__ttAssets`.
- **Hull asset:** the generated GLB of a vessel size class (`vessel-ulcv`, …), with nodes `hull`, `hatch_covers`, `lashing_bridges` and `bay_grid`. Its **bay grid** (in the sidecar) is the origin and pitches that put a deck or hold slot exactly where the engine's bay plan does.
- **Vessel livery:** the hull colour, funnel mark and hull-side wordmark of a shipping line, from the **vessel livery atlas** (one tile per line, like the container atlas). The line comes from `VesselConfig.line` or from the vessel name's style ("HMM Tarifa").

## Dashboard (TT-16)

- **Dashboard:** the full-screen tab (D) with the KPI time-series charts, the yard heatmap, the Gantt timeline and the final report. It loads Apache ECharts lazily on first open. *Avoid:* "KPI strip" (that is the small always-visible bar over the 3D view).
- **KPI group:** a set of KPI charts shown together: Quay, Horizontal transport, Yard, Landside (when it has data) or TOS handlers.
- **Bucketing:** whether the dashboard charts show one point per clock hour or per 8-hour shift (the same series the collector builds).
- **Yard heatmap:** yard fill % per block (rows) per hour (columns), plus each block's fill now.
- **Gantt timeline:** one row per vessel (anchorage, mooring, berthed and working, unmooring) and one per crane **assignment** (and one per **work package**), built from the event log by `buildTimeline`.
- **Crane assignment:** a crane takes a range of bays of a vessel from the split decision until `StsWorkComplete` (the dashboard's Gantt row per crane). *Avoid:* "work package" (that is the release unit above).
- **Data palette:** the colour-blind-safe categorical steps of the dashboard; every slot also has a marker symbol and a dash style, so state is never shown by colour alone.

## Transshipment and empties (TT-11)

- **Transshipment box:** a box discharged from one vessel that another vessel loads. It carries an **onward-vessel link** (`onwardVesselId`), stands in the yard for its **dwell** (sampled from the transshipment dwell distribution once it is stacked), then flows like an export box. *Avoid:* "transfer box".
- **Flow mix:** a vessel's moves split into import, export and transshipment percent (`flowMixOf`); the vessel generator can be given one (`flowMix`).
- **Empty:** an unladen container (`full = false`), distinct by size and shipping line. The **empty pool** is the empties standing in the yard at the start.
- **Empties required:** the event raised when a released load work package needs N empties of a size and line; the **empty-allocation** decision point (`emptyAllocation`) then assigns which yard empties go (strategies `nearest-wtp`, `oldest-first`).

## Landside (TT-13)

- **Truck transaction:** what one truck visit does: drop an export, pick an import, drop an empty, pick an empty, or **dual** (drop an export and pick an import in one visit).
- **Gate:** the public entrance: a FIFO queue, inbound lanes with kiosks (processing time each), outbound lanes and an unused out-of-gauge (OOG) lane. The `gateLaneAssignment` decision point picks the inbound lane.
- **Transfer stall:** the truck standing place at the landside end of a block where the landside ASC works the chassis. The `transferStallSelection` decision point picks it. Also a conflict zone.
- **Interchange:** the ASC lifting a box off a chassis (drop) or setting one on it (pick) at a stall.
- **Import dwell / export window:** how long an import stands in the yard before a truck may collect it (default lognormal, median 3 days); the period before a vessel's ETA (default 1 to 5 days) in which trucks may deliver its exports.
- **Segregation:** trucks never enter the waterside network and SHCs never use the gate (invariant `landside.segregation`).
- **Truck turn time:** gate-in to gate-out.

## Yard start (TT-14)

- **Yard start mode:** how the yard looks at t = 0: **pre-filled** (default; exports, empty pool and imports placed through the selected yard-allocation strategy up to a target % of the cells), **warm-up** (starts empty; a warm-up period of truck and vessel activity runs first and is excluded from KPIs and end conditions) or **empty** (starts empty; exports arrive by truck during the run).
- **Pre-fill:** the starting population of a pre-filled yard: boxes booked to the scenario's vessels, imports awaiting pickup with their dwell partly elapsed, and the empty pool.
- **Warm-up / measured period:** the first `warmUpS` of a warm-up start / everything after it. At `WarmUpEnded` the KPI and end-condition counters restart at zero.

## Presets and layout (TT-15)

- **Preset:** a named full scenario (TTI Algeciras baseline, Small automated, Stress test); every value stays overridable.
- **Derived layout:** block and STS positions computed from the counts and the quay length, in the TTI functional order (quay, STS rail, apron and WTP pads, blocks, stalls, roads, gate).
- **Frontage:** the quay length a block needs (32 m); blocks need count x 32 m.
- **Scale limits / stress-test scale:** hard maxima (errors) and the softer size above which the dialog warns the run may be slow.
- **Nominal cycle:** the derived cycle time and moves per hour of one crane from its kinematics, without variation or waiting.

## Persistence (TT-17)

- **Config save:** the scenario as run (layout, equipment, kinematics, vessels, landside, strategies and latency, end conditions, start date/time, locale and units) plus the seed. Small; re-running it reproduces the run.
- **Snapshot save:** the engine's full state mid-run (containers, equipment, motion segments, event queue, reservations, KPIs, RNG, event log). Loading it resumes exactly where the run left off.
- **Save schema version:** the version of the save file format; older files migrate forward on load. A snapshot also records the **engine version** that wrote it.
- **Rewind point:** an automatic checkpoint (every 15 sim-minutes by default) the user can jump back to; running on from it reproduces the original events.


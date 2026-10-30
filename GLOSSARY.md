# Glossary

Domain terms used in code, tests, docs and conversations. Most are from **Terminal Twin** (`src/sims/terminal-twin/`). Use these words; avoid the listed alternatives.

## Equipment

- **STS (ship-to-shore crane, quay crane):** a rail-mounted crane on the quay that moves containers between a vessel and its STS ground positions. STS cranes share one rail and never pass each other. Its axes are **gantry** (X, along the quay), **trolley** (Z, waterside to landside) and **hoist** (Y). *Avoid:* "QC" in code.
- **ASC (automated stacking crane):** a rail-mounted gantry crane serving one yard block. Each block has 1–2 ASCs, which never pass each other. The waterside ASC prefers WTP work and the landside ASC prefers truck work.
- **SHC (shuttle carrier):** a straddle-type vehicle that carries one container at a time between STS ground positions and WTP pads. It sets a box down and drives clear before the box can be picked up again. *Avoid:* "straddle carrier" for this role.
- **Spreader:** the lifting frame on an STS or ASC hoist. It grips a container with twist-locks (**lock** and **unlock** times).
- **Equipment kind (registry):** one of STS, SHC, ASC, truck or vessel, registered in its own module under `modules/equipmentKinds/` (ids, bounds, dev-API state, inspector view, scene renderer). The renderer, dev API, picking, labels and inspector iterate `EQUIPMENT_KINDS`, so a new kind is a module plus one entry.

## Places

- **Quay:** the continuous berth face at Z = 0. Sea is at negative Z and the yard at positive Z, with X running along the quay.
- **Vessel slot:** a bay/row/tier position on a vessel (`<vesselId>:<bay>-<row>-<tier>`, plus `a`/`f` for the aft/fore 20 ft half of a cell). Its **purpose** is discharge, load or transshipment.
- **Maritime location notation (TT-R08):** how the UI names a slot, display only (internal ids, the engine API, saves and goldens keep the internal form). Vessel: `VESSEL.V<nn>.<bay>.<row>.<tier>`, e.g. `VESSEL.V01.04.02.82`, shown with the vessel name ("MSC Aurora · VESSEL.V01.04.02.82"). Bays count from the bow: odd = a 20 ft half cell, even = the 40 ft cell between its two odd halves. Row 00 is the centreline of an odd beam, starboard odd, port even (the quay side is port). Tiers: hold 02, 04, ...; deck 82, 84, .... Yard: `YARD.B<nn>.<bay>.<row>.<tier>`, e.g. `YARD.B01.03.02.1` (same bay convention, two-digit row, one-digit tier).
- **Cell:** one bay/row/tier position of a vessel. It holds one 40 ft box or two 20 ft boxes (aft and fore half).
- **Bay plan:** a vessel's slots and the boxes in them, generated from the vessel call and the seed. Bays are 40 ft bays counted from aft. Tiers count from the hold floor; tiers above the hatch covers are **on deck**, the rest **in the hold**.
- **Berth:** a vessel's stretch of the continuous quay, from its stern (`berthX`) to its bow (LOA). Vessels keep a **berth gap** apart.
- **Anchorage:** where an arrived vessel waits when no berth is free. **Anchorage wait** = berth allocation time − arrival time.
- **Rail reservation:** the stretch of the STS rail a crane may occupy during its current gantry motion. Neighbouring reservations stay at least the minimum STS spacing apart.
- **Ground position (STS ground position):** a buffer lane under an STS where discharged boxes are set down and from which load boxes are picked (`<stsId>-GP<n>`).
- **WTP (waterside transfer point) pad:** a buffer position at the waterside end of a yard block. SHCs drop boxes there, and the ASC picks them up (and the reverse).
- **Transfer stall (landside transfer stall):** a truck position at the landside end of a block where the ASC serves external trucks.
- **Queue area:** a waiting place for SHCs near each STS and each block's WTP pads (slice D, #94), separate from parking spots, ground positions and pads. An SHC dispatched before its box is ready waits there. Capacity is configurable.
- **Maritime location notation:** a location written the way a vessel bay plan writes it (bay, row, tier; ISO 9711), used for display. The sim's internal slot ids (`<block>:<bay>-<row>-<tier>`) are kept unchanged. See `knowledge-base/dk_ops__tti_algeciras_operations.md`.
- **Hatch laydown (laydown bay):** a place on the quay under an STS's backreach where removed hatch panels are stacked (`LD@<x>`): the gap between two SHC spines, landside of the last ground lane and clear of the landside STS rail. One laydown bay holds one stack of at most `laydownStackLimit` (default 3) panels of one hatch.
- **Block:** one yard block, perpendicular to the quay. It has 8 rows (fixed by the 25.4 m ASC span), with configurable bays and tiers.
- **Bay (yard bay):** one 20 ft position along a block (6.7 m). A 40 ft box covers two bays.
- **Row:** one of the 8 lines across a block, under the ASC span.
- **Tier:** a level in a stack, from 1 at the ground. A block has a **tier limit**.
- **Yard slot (slot):** a 20 ft cell `<block>:<bay>-<row>-<tier>` that holds a box. A 40 ft box is named by its lower bay (its **anchor**) and also covers the next bay.
- **Stack:** the boxes in one bay and row. A box above tier 1 must rest on boxes (no **floating** box). A stack takes the **length** of its bottom box (20 or 40 ft) and accepts only that length until it is empty; a 40 ft box **40-locks** both stacks it covers. The lock is derived from the contents, never stored. Checked by `yard.no-mixed-length-stack`.
- **Yard slot:** a bay/row/tier position in a block.
- **Reefer:** a refrigerated box (`ContainerState.reefer`), a share of the full boxes (`cargo.reeferShare`, default 0). It needs a plug: it is only allocated to a **powered row** of its block (`BlockConfig.poweredRows`, rows 1-8) and stacks at most **`REEFER_MAX_TIERS`** (4) high. A block without powered rows takes no reefer. Plain boxes may use powered rows, but `nearest-wtp` avoids them. Checked by `yard.reefer-powered`.

## Operations

- **Custody:** the single owner that currently holds a container (vessel slot, STS, ground position, SHC, WTP pad, ASC, yard slot or truck). Custody changes only at a confirmed grip or release. Each container keeps a **custody history**.
- **Handover:** a custody change between two pieces of equipment via a ground buffer, never directly.
- **Discharge / load:** a vessel-to-quay move / a quay-to-vessel move.
- **Vessel call:** one vessel's visit: arrival, size class (Feeder, Feedermax, Panamax, Neo-Panamax, ULCV), discharge/load/transshipment counts and max STS. The **vessel table** lists the calls.
- **Mooring / unmooring:** the time from berth allocation to all-fast, and from the last move to departure.
- **Crane split:** which STS cranes work which bays of a vessel (a decision point). Cranes keep rail order, so bay ranges follow crane order.
- **Twin-20 lift:** an STS lift of the two 20 ft boxes of one cell in one cycle; each box gets its own ground position.
- **Deck before hold:** within a bay, an STS discharges the deck stacks (top tier first) before the hold.
- **Bay work order (with hatch covers):** within a 40 ft bay: deck discharge → hatch removal → hold discharge → hold load → hatch replacement → deck load. A hatch is opened only when its bay has hold work under it.
- **Move:** one productive container transfer by an STS (a discharge or a load). This is the unit of moves per hour.
- **Cycle:** one complete loop of a crane: start, pick, carry, ground, return.
- **Work package:** one STS's moves for one bay section (deck or hold, discharge or load) of one vessel, or one **hatch move** (`hatch-remove` / `hatch-replace`, see below). A package is `planned`, then `released` by the `workPackageRelease` decision point, `active` while its crane works it, then `complete`. A crane works its packages in sequence: with hatch covers (the default) bay by bay, without them all discharge packages first and then all load packages.
- **Release ahead (K):** how many packages the default release strategy keeps released behind the one the crane is working (default 2). The **release lead time** is the time from a package's release to the start of its work.
- **Export box:** a box booked to a vessel for loading. It starts in the yard (pre-filled from the bay plan) and is loaded into its **load slot**, the empty slot the bay plan booked for it.
- **Load flow:** the reverse of discharge: stack → ASC → WTP pad → SHC → STS ground position → STS → vessel slot. The ASC step is a **retrieval**.
- **Load order:** the yard work of one export box from its package's release to its ground position (claim a ground position, retrieve, carry). A crane **stages** at most as many boxes as it has ground positions, in load sequence.
- **Load sequence:** the order a crane loads a vessel: bay by bay, hold before deck, bottom tier before upper tier, then row, aft half before fore half.
- **Stowage order:** a box is never loaded into a slot whose lower tier (in the same stack) is still empty. Checked by the invariant `stowage.order`.
- **Hatch panel (hatch cover panel):** one lift-away cover of a vessel's hatch. Each 40 ft bay has one hatch of N panels across the beam (N and the panel size and weight come from the vessel class). A panel has an id (`V001:H04-1`: bay, index from the quay side), dimensions, weight, a position and a **panel state**: `secured` → `unsecured` (lashing released) → `lifted` → `in-laydown` → `lifted` → `replaced` → `secured`. Panels are **not containers**: never in custody, yard slots or container counts. Deck boxes rest on a panel, so it only comes off when they are gone. *Avoid:* "hatch cover" for a single panel. In the 3D view a panel is its own mesh: on its hatch, hanging from the STS spreader while lifted, or stacked in its laydown bay; the deck under a lifted panel shows the open hold.
- **Hatch move (`hatch-remove`, `hatch-replace`):** an STS job that lifts one panel off its hatch into the laydown, or back onto its own hatch. It takes the **hatch cycle time** (default about 4 minutes), counts as STS time and as vessel turnaround, and is not a move (not counted in moves per hour).
- **Lashing release / securing:** the crew work around a hatch panel: the cleats are released a (configurable) delay after the deck boxes above it are gone, before the crane may lift it; a replaced panel is secured a delay after it is set back, before deck boxes may be loaded on it and before the vessel may leave. The crane idles (`StsWaitingForHatch`) when it has to wait.
- **No 20 on a 40 (stowage):** on board a 20 ft box never sits on a 40 ft box, and a 40 ft box rests only on a 40 ft box or on two filled 20 ft halves. A stack reads, bottom up, twin-20 cells, then 40 ft cells or lone 20 ft halves. The structural 40-on-20 exception is not modelled. Checked by `stowage.order`; the bay plan only produces such stows (`stackAccepts`).
- **Rehandle:** a non-productive ASC move needed to reach a buried box.
- **Job (SHC job):** one box to move from an STS ground position to a WTP pad. Grounding a box **releases** a job into the **released pool**; a job is **open** until an SHC **claims** it.
- **Pull dispatch:** free equipment asks the dispatch decision point (`shcDispatch`) for its next job from the released pool, rather than jobs being pushed to equipment.
- **Pad selection:** the decision point (`wtpPadSelection`) an SHC asks, after dispatch gave it a discharge job, for the WTP pad to set the box on. Built-in strategies: first-free, nearest-box, last-free.
- **Trip:** an SHC's planned drive with its phases (routing empty, positioning at pickup, locking, lifting, routing loaded, positioning at drop-off, lowering, unlocking, clearing), or its drive to its parking spot.
- **Cornering (corner speed):** an SHC takes a right-angle turn at a capped speed (`sqrt(lateral acceleration x assumed radius)`) instead of stopping; the run before and after share that **entry/exit speed** (`v1`/`v0` on the motion segments). Reversals still stop.
- **Clear position (pad clear position):** where an SHC reverses to after setting a box down on a WTP pad, clear of the pad. *Avoid:* "exit".
- **SHC operational state:** a coarse view of an SHC's `ShcStatus`, one of seven: parked, moving to collect, queuing to collect, collecting, moving to deliver, queuing to deliver, delivering. Each status maps to exactly one (`engine/shcStates.ts`); statuses are not renamed. Shown in the inspector, summed per state in the KPIs. *Avoid:* "SHC status" for the seven.
- **Queue area (queue spot):** lane-graph rest spots (`QS:<stsId>:<k>`, `QB:<blockId>:<k>`, node kind `queue`) where an SHC waits when its drop-off or its next job is not ready: an area near each STS (empty SHCs wait for work) and one near each block's WTP pads (SHCs carrying a box wait for a free pad). Configured by `config.queueAreas` (capacity per area), separate from parking spots, ground positions and WTP pads; a spot is held by one SHC from assignment to departure (`state.queueClaims`). *Avoid:* "buffer" (that is a ground position or pad), "parking" (the SHC's own spot).
- **Chained dispatch (`chained-nearest`):** the `shcDispatch` strategy that takes the nearest open job and, after a delivery, asks for the next job at once; with none it waits at the nearest queue area while there is work, and parks only when there is none. Counted by the `parkingReturns` KPI (drives back to the parking spot).
- **SHC handover (KPI):** one custody change between an SHC and a ground buffer (an STS ground position or a WTP pad): one per box picked up and one per box put down, so a job is two. Counted per SHC as `shc.handovers`.
- **Parking spot:** an SHC's own rest position off the apron, where idle SHCs return.
- **Driver variability:** a ± % random factor on each SHC trip's drive times.
- **Transshipment:** a box that goes vessel → yard → another vessel.

## Engine and tooling

- **Scenario config:** the small, serialisable description of a run (layout, equipment, kinematics, vessel table, cargo mix, end conditions, seed; bay plans and containers are generated from it and the seed). It is built with the **scenario builder**.
- **Fixture:** a small focused scenario config committed as JSON under `scenario/fixtures/`, with a **golden summary** (`*.golden.json`: KPIs plus event-log hash).
- **Preset:** a full-size scenario config generated in code (the list lives in Terminal Twin's `scenario/presets.ts`).
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
- **Invariant:** a rule that must hold after every event (for example `custody.single-owner`). **Fail-fast** stops the run at the first violation. Checking is **incremental** (only the invariants and entities an event touched, by the entity kinds each invariant `reads`), with a full **sweep** every N events and at the end of each run.
- **Snapshot:** a full JSON copy of a run's state (queue, RNG, log), used to resume the run exactly.
- **Event-log hash:** a deterministic hash of every committed event. The same seed and config always give the same hash.
- **Structured log:** JSON-lines records derived from committed events (`t`, `eventId`, `seq`, `subsystem`, `level`, …), filtered by **per-subsystem verbosity** (`sts=debug,*=warn`).
- **Subsystem (logging):** the part of the sim an event belongs to (`scenario`, `vessel`, `sts`, `invariants`; later `asc`, `shc`, …), normally the first word of its event type.
- **Run diff:** a comparison of two event logs that reports the **first diverging event** (its `seq`, the differing fields and both events).
- **Time window:** a run resumed from a snapshot that processes only events after the snapshot's time, up to a stop condition.
- **Golden update:** an explicit rewrite of golden summaries (`pnpm run tt:golden --update`). Without it, any difference from a golden is **drift** and fails.
- **Engine horizon:** in the browser, the sim time up to which the worker's engine has processed events. The displayed time never passes it.
- **Display time:** the sim time the 3D view and clock show. It advances with wall time × **speed** (×1 = real time) and is drawn by interpolating motion segments.
- **Look-ahead:** how far the engine runs ahead of the display time while playing, so that the motion for the displayed instant is already known.
- **Run to…:** run the engine flat out (without rendering) to a target sim time, then resume playback there.
- **Delta:** the compact worker → main-thread update: new motion plans, custody changes, status changes and summarised events.
- **Dev API:** `window.__tt`, the dev-build-only browser API (load, step, runUntil, query, inject, snapshot, why, select, cameraTo) used by Playwright smoke tests and agents.
- **Lane graph:** the generated one-way graph SHCs route over (apron loop, STS lanes, WTP spurs, parking spurs). Edges run along X or Z.
- **Conflict zone:** a part of the lane graph only one vehicle may use at a time: an intersection, an STS lane section (ground position) or a WTP pad with its spur.
- **Reservation:** a time window `[from, to)` on a conflict zone held by one piece of equipment. Trips reserve all their zones before departing and depart later if any window is taken.
- **Yard allocation:** the decision point (`yardAllocation`) that picks a box's slot in the block of the pad it was dropped on. Built-in strategies: random, nearest-wtp, grouped (opt-in; groups by direction, line, outbound vessel, POD and weight class, mismatch costs score and never removes a slot). Candidates keep each stack to one length.
- **Claim (slot claim):** a slot is claimed when allocation answers and stacked later. Stacks fill in claim order: an ASC does not stack a box before an older claim in the same stack.
- **ASC job:** one box to move from a WTP pad to its slot. It is **ready** once its slot is allocated and its SHC has released the box and cleared the pad.
- **Lifting envelope (of a WTP pad):** the space over the pad where an ASC spreader is below travel height. An ASC never enters it while an SHC is on the pad (the pad zone's **handover**).
- **Twin-ASC block:** a block with two ASCs on one rail (`ascsPerBlock: 2`): the **waterside ASC** (`<block>-ASC1`) and the **landside ASC** (`<block>-ASC2`). The engine default is 1; the setup dialog defaults to 2.
- **Rail segment:** a half-bay slice of a block's ASC rail (zone `<block>:R<k>`). A crane's footprint is its position plus half the **minimum separation** (12 m between centres: 8 m portal + 4 m safe gap) either side; it holds the segments the footprint touches.
- **Park hold:** the open-ended reservation of the segments around an ASC that stands still. It ends when the crane's next trip starts. A trip that conflicts with the other ASC's trip waits (**rail wait**); one that conflicts with its parked position makes it **step aside** (yield) if idle, or cannot start until it is idle.
- **ASC dispatch:** the decision point (`ascDispatch`) that picks which idle ASC of a twin block takes the oldest ready box. Built-in strategies: `waterside-first` (default: WTP work to the waterside ASC, transfer-stall work to the landside ASC, the other crane only when no step-aside is needed) and `balanced` (fewest jobs so far).
- **Subsystem mode:** how a subsystem runs: **real**, **instant** (a stub that raises the same events with zero durations) or **off**. Six subsystems have one: quay (STS cranes), berth, yard, SHC, ASC, landside. The yard mode caps the ASC and landside modes (yard off turns both off; yard instant makes the ASC instant).
- **Overlay (3D debug overlay):** an optional drawing over the 3D view: lane graph, active reservations, occupancy, state labels, **ASC rail** (reserved and parked rail segments, waterside ASC blue and landside ASC red). Each toggles independently; `O` hides or shows them all.
- **Breakpoint:** a debugger rule that pauses the sim right after an event that matches it: an event type, a container id, an equipment id or a decision point. Set from the event feed panel or `__tt.addBreakpoint`.
- **Single-step:** process exactly one engine event and pause, at any speed setting.
- **Event feed:** the left panel's live list of recent events, newest first, filterable and capped. At high speed it **summarises bursts** (runs of the same event type) into one row.
- **Event inspector:** the right panel's view of one event: payload, subjects, a decision's handler, request and reply, and its **cause chain**.
- **Cause chain:** the events that led to one, from the event back to the root, as returned by the engine's `why`. Clicking an entry inspects it.
- **Keyboard camera:** the held-key camera controls: W/A/S/D or arrows pan along the camera heading (speed scales with distance), Shift + A/D (or ←/→) orbits, Shift + W/S (or ↑/↓) tilts, `=`/`-` zoom, all within the orbit limits. Any camera key ends **follow** mode. Read through `__tt.cameraPose()` (target, distance, azimuth, polar angle).
- **View preset:** a one-click or one-key camera pose computed from the layout: Quay (Q), Yard (Y), Landside/Gate (G) or Overview (V). The pose's target lies inside the region it names, so it fits every preset and fixture; the Gate view needs a landside. **Label declutter** hides any Labels-overlay label that would overlap a higher-priority one on screen (the selection first, then equipment-kind registry order).
- **Selection:** the container, equipment or vessel picked in the 3D view (or by an id in the feed or inspector). The **inspector** shows its current state, current job and history, and the **follow camera** can track it.
- **Picking:** finding the entity under a click by testing the view ray against each entity's bounding box (containers first).
- **Occupancy overlay:** plates over WTP pads and STS ground positions, free or occupied at the displayed time. The **labels overlay** floats each crane, carrier and vessel's status above it.
- **Display settings:** the UI's **locale** (Intl formatting of dates, times, numbers, first day of week) and **unit system** (metric: m, km/h, t; imperial: ft, mi/h, US tons). Display only: the engine and saved configs are always SI. Imperial speed is written **mi/h** because **mph** would read as crane moves per hour.
- **Message catalogue:** `i18n/messages.ts`, the single home of every user-visible UI string (English only for now), looked up with `t(key)`.
- **KPI collector:** the engine fold (`engine/kpi/`) that turns the event log into every KPI as a time series. `Simulation.kpiSeries()`.
- **KPI series:** one KPI for one entity (a crane, a block, the terminal) with an **hourly** value per hour bucket, a value per **shift** and a **total**.
- **Hour bucket / shift bucket:** an hour cut on the scenario clock, and a run of 8 whole hours (3 per day; default 06-14, 14-22, 22-06). A night shift belongs to the day it starts.
- **Gross / net moves per hour:** a crane's moves divided by the hours it was on a vessel (gross) or on a vessel and not waiting for an SHC or the rail (net).
- **Headline KPIs:** the few numbers on the **KPI strip** and in the CLI summary. The strip shows them fixed-width: fixed fraction digits (one decimal for rates and percentages), tabular figures and a minimum width per tile.
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
- **Asset budget:** the triangle, draw-call and file-size limits per asset kind (`assets/budgets.json`), enforced by the **budget check** (`pnpm run tt:assets:check`).
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
- **Follow next truck:** the camera action that selects the next truck to arrive at or after the display time and follows it through the gate and its transfer stall until it leaves (button, `N`, `__tt.followNextTruck()`). Waits while no arrival is known yet.
- **Asset viewer:** the dev-only page `/sim/terminal-twin?viewer=<asset>` (or `?viewer=yard`), with its API `window.__ttAssets`.
- **Hull asset:** the generated GLB of a vessel size class (`vessel-ulcv`, …), with nodes `hull`, `hatch_covers`, `lashing_bridges` and `bay_grid`. Its **bay grid** (in the sidecar) is the origin and pitches that put a deck or hold slot exactly where the engine's bay plan does.
- **Vessel livery:** the hull colour, funnel mark and hull-side wordmark of a shipping line, from the **vessel livery atlas** (one tile per line, like the container atlas). The line comes from `VesselConfig.line` or from the vessel name's style ("HMM Tarifa").

## Dashboard (TT-16)

- **Dashboard:** the full-screen tab (B) with the KPI time-series charts, the yard heatmap, the Gantt timeline and the final report. It loads Apache ECharts lazily on first open. *Avoid:* "KPI strip" (that is the small always-visible bar over the 3D view).
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
- **Empties required:** the event raised when a released load work package needs N empties of a size and line; the **empty-allocation** decision point (`emptyAllocation`) then assigns which yard empties go (strategies `nearest-wtp`, `oldest-first` and the opt-in `iso-type-best-position`, which matches on ISO type and picks the best yard position).

## Landside (TT-13)

- **Truck transaction:** what one truck visit does: drop an export, pick an import, drop an empty, pick an empty, or **dual** (drop an export and pick an import in one visit).
- **Gate:** the public entrance: a FIFO queue, inbound lanes with kiosks (processing time each), outbound lanes and an unused out-of-gauge (OOG) lane. The `gateLaneAssignment` decision point picks the inbound lane.
- **Transfer stall:** the truck standing place at the landside end of a block where the landside ASC works the chassis. The `transferStallSelection` decision point picks it. Also a conflict zone.
- **Interchange:** the ASC lifting a box off a chassis (drop) or setting one on it (pick) at a stall.
- **Import dwell / export window:** how long an import stands in the yard before a truck may collect it (default lognormal, median 3 days); the period before a vessel's ETA (default 1 to 5 days) in which trucks may deliver its exports.
- **Segregation:** trucks never enter the waterside network and SHCs never use the gate (invariant `landside.segregation`).
- **Truck turn time:** gate-in to gate-out. **Total truck turnaround** (TT-R18) is arrival at the gate to gate-out, so it includes the wait outside the gate and in holding.
- **Internal drive time:** the time a truck spends driving inside the terminal on its inbound leg (kiosk to stall, through a holding position if any), without the time it stands waiting. Reported per truck as mean and max.
- **Road use:** how many trucks are driving on the internal landside roads (inbound legs and the way out): time-weighted mean over the run and the peak. **Holding utilisation** is the share of holding position-time that was occupied.
- **Delayed appointment:** a booked truck that passed the gate after the end of its appointment window. **Rejected appointment:** a booking refused because its window was at capacity.
- **Holding position:** a dead-end spur off the inbound road (`landside.holding.positions`, nodes `ls:H<n>`) where an admitted truck waits for a transfer stall. It never lies on a road, junction or gate exit (invariant `landside.waiting-off-road`).
- **Stall admission:** the gate lets the head of the queue through only when a transfer stall can take it (the stall is reserved first, so no two trucks claim one stall: `landside.stall-exclusive`) or a holding position is free.
- **Overflow (holding):** when no stall and no holding position is free, the truck waits outside the gate in the queue (`TruckHeldOutside`).
- **Appointment window:** a slot of the truck booking system (default 30 min, `landside.appointments.windowS`). A truck books a window and arrives at a random time inside it; bookings per window are capped by gate and transfer stall capacity (`appointmentCap`), so demand above the cap is rejected. A peak is bunched bookings (`bunching` spans). Each **appointment** carries one transaction (its transport orders: export delivery, import collection or both = dual). No ANPR, no early, late or invalid arrivals.

## Yard start (TT-14)

- **Yard start mode:** how the yard looks at t = 0: **pre-filled** (default; exports, empty pool and imports placed through the selected yard-allocation strategy up to a target % of the cells), **warm-up** (starts empty; a warm-up period of truck and vessel activity runs first and is excluded from KPIs and end conditions) or **empty** (starts empty; exports arrive by truck during the run).
- **Pre-fill:** the starting population of a pre-filled yard: boxes booked to the scenario's vessels, imports awaiting pickup with their dwell partly elapsed, and the empty pool.
- **Pre-run:** the phase before `ScenarioStarted` in which a pre-filled start asks `yardAllocation` for each starting box through the decision runtime. Its decision events carry `preRun: true`, sit at sim time 0 and are not in the KPI series.
- **Warm-up / measured period:** the first `warmUpS` of a warm-up start / everything after it. At `WarmUpEnded` the KPI and end-condition counters restart at zero.

## Presets and layout (TT-15)

- **Preset:** a named full scenario (TTI Algeciras baseline, Small automated, TTI Algeciras — peak day); every value stays overridable. Shown as a hero card in the setup dialog, with chips and a layout sketch derived from its config. The 16 test scenarios are **engine test fixtures**, listed in a collapsed table.
- **Derived layout:** block and STS positions computed from the counts and the quay length, in the TTI functional order (quay, STS rail, apron and WTP pads, blocks, stalls, roads, gate).
- **Frontage:** the quay length a block needs (32 m); blocks need count x 32 m.
- **Scale limits / peak-day scale:** hard maxima (errors) and the softer size above which the dialog warns the run may be slow.
- **Nominal cycle:** the derived cycle time and moves per hour of one crane from its kinematics, without variation or waiting.

## Performance and quality (TT-19)

- **Engine benchmark:** `pnpm run tt:bench`, a headless run of a preset for N sim-hours that reports events/sec, wall-ms per sim-hour and peak memory and compares them with the committed baseline (a metric over 20% worse is a regression). Local only.
- **Quality level / quality setting:** Low, Medium or High is a level (a bundle of shadows, LOD distances, resolution, ocean detail and night-light budget); the setting is a level or Auto (default).
- **Auto quality:** steps the level down when the frame rate stays under 45 fps and back up when there is headroom, with a back-off against oscillation.
- **Performance overlay:** the toggleable (key P) readout of FPS, draw calls, triangles, frame CPU time and the quality in force.
- **Instance culling:** boxes outside the camera frustum are not written to the instanced meshes.
- **Static batch:** scenery that never moves, merged into one mesh per material to save draw calls.
- **Yard index:** the per-block and per-column lookup of yard slots that keeps rehandle queries off a whole-yard scan.

## Atmosphere (TT-21)

- **Daylight lock:** keeps the scene in daylight whatever the sim clock says; the sun still moves. On by default in the TTI Algeciras — peak day preset.
- **Night mode:** the cheaper lighting at night: no sun shadow pass, floodlight glow on high masts and emissive equipment lights instead of real lights.
- **Backdrop:** the distant low-poly scenery: Algeciras (Rock of Gibraltar, hills, North Quay) for the TTI preset, a generic coastline otherwise.
- **North Quay:** TTI's 550 m of quay beside the working berths, drawn idle (non-operational).
- **Cue:** a moment (box landed, vessel horn, scenario complete) that may make a sound or banner when the display clock reaches it.
## Persistence (TT-17)

- **Config save:** the scenario as run (layout, equipment, kinematics, vessels, landside, strategies and latency, end conditions, start date/time, locale and units) plus the seed. Small; re-running it reproduces the run.
- **Snapshot save:** the engine's full state mid-run (containers, equipment, motion segments, event queue, reservations, KPIs, RNG, event log). Loading it resumes exactly where the run left off.
- **Save schema version:** the version of the save file format; older files migrate forward on load. A snapshot also records the **engine version** that wrote it.
- **Rewind point:** an automatic checkpoint (every 15 sim-minutes by default) the user can jump back to; running on from it reproduces the original events.


## Infrastructure models (TT-28)

- **Gate module:** a generated GLB that tiles into the gate complex: a 3.5 m truck lane, the 8 m out-of-gauge lane, a 1.2 m island (kerb stripes, kiosk, camera post, canopy columns) between and beside lanes, and the control office.
- **Island:** the concrete strip between two gate lanes; the engine lane pitch is lane half-width + island + lane half-width.
- **Instanced infrastructure:** bollards, fenders, quay and ASC rail segments, fence panels, masts, ground markings and gate modules drawn as one InstancedMesh per model (one draw call each).
- **Predicted ready time:** when a box is expected to be physically available for an SHC to collect: a ground-position box's planned set-down (exact) or the crane's estimated next one (nominal cycle plus hatch cycle), published by the quay subsystem; a WTP pad box's planned set-down by the ASC subsystem. `sim.predictedReady()`.
- **Pre-dispatch (`predispatch`):** the `shcDispatch` strategy that sends an idle SHC to the queue area of a box predicted ready within the SHC's travel time plus `queueAreas.predispatchMarginS`. The SHC holds a queue spot, not a job, so no box is collected before it exists. *Avoid:* "early pick-up".
- **Pre-retrieval:** the `pre-retrieval` `ascDispatch` strategy: once an import truck's stall is reserved and its trip planned, an idle ASC fetches the box to the stall before the truck arrives (an early job, `AscJobAssigned.early`) and hovers over it until the truck is there, so the stall service time drops. Never for a dual transaction or a buried box.
- **Paired dispatch (`paired-dual-cycle`):** the `shcDispatch` strategy that, after an SHC delivers a discharge box to a WTP pad, prefers a nearby load pickup (and after a load delivery at the quay a discharge pickup), so the SHC drives loaded more often and less empty. Chained dispatch otherwise. The SHC's last delivery is `lastJobKind` on the dispatch request.

## Container properties (spec #106)

- **Transit direction:** why a box is on the terminal: IMPORT, EXPORT, TRANSSHIPMENT or STORAGE (`ContainerProps.direction`). Storage boxes are always empty. An empty allocated to a vessel becomes EXPORT while it stays empty. *Avoid:* "flow" for this (flow is the bay-plan role discharge/load/pool).
- **Weight class:** LIGHT, MEDIUM or HEAVY, from gross weight (tare + cargo) against the scenario's `weightClassBands`.
- **Port rotation:** the scenario's ordered list of port calls (UN/LOCODEs) with this terminal marked; POL and POD of every box come from it (`containerProps.portRotation`).
- **ROB (remain on board) bays:** the share of each vessel's bays (`robBayFraction`) set aside and never worked at this terminal: no discharge, load or truck export, hatch covers closed. They hold **ROB boxes**: display-only slot data (slot, ISO type, POD, line, weight class) for later ports, not containers, drawn in the 3D hull and (later) the bay viewer. *Avoid:* "ROB containers".
- **POL / POD (port of loading / port of discharge):** UN/LOCODEs. Imports and storage boxes end at this terminal; exports start here; transshipment boxes neither start nor end here.
- **Planned departure:** the sim time a box is planned to leave: outbound vessel ETD, else truck appointment, else arrival plus an expected dwell by direction.
- **Transit status:** where a box is in its journey through the terminal: ADVISED (never held here; its inbound carrier has not arrived: a vessel not yet at berth, a truck outside the gate, or a box still outside), ARRIVED (inbound carrier here, box not off yet), ON_TERMINAL (terminal custody), LOADED (on its outbound carrier, which has not left) and DEPARTED (the outbound carrier has left). One pure function of the box and the carriers' state (`engine/transit.ts transitStatus`), never stored, no event of its own. *Avoid:* "container status", "lifecycle state" (the latter is the older entity-skill model).
- **Content status:** EMPTY or LADEN, derived from the stored `full` flag (`contentStatus`). *Avoid:* "load status".
- **Dwell:** seconds a box has been on the terminal: from its first terminal custody (or its pre-aged `yardSince`) to its departure from terminal custody, else to now (`dwellS`). The KPI report's `dwell` groups it by transit direction (count, boxes that have left, mean, max). Not the same as the transshipment or import dwell (`dwellS` on a box, the *planned* yard time).


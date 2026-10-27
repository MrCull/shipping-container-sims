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
- **Work package:** one STS's moves for one bay section (deck or hold, discharge or load). Its release is a decision point.
- **Rehandle:** a non-productive ASC move needed to reach a buried box.
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
- **Display settings:** the UI's **locale** (Intl formatting of dates, times, numbers, first day of week) and **unit system** (metric: m, km/h, t; imperial: ft, mi/h, US tons). Display only: the engine and saved configs are always SI. Imperial speed is written **mi/h** because **mph** would read as crane moves per hour.
- **Message catalogue:** `i18n/messages.ts`, the single home of every user-visible UI string (English only for now), looked up with `t(key)`.
- **TOS (terminal operating system):** the external software whose decisions the handlers stand in for.

## 3D assets (phase 2)

- **Asset:** one generated GLB (for example `container-40`) plus its **sidecar** `<asset>.meta.json`, made by the Python (bpy) **generators** in `assets/generators/` and committed. *Avoid:* "model file" for the pair.
- **LOD (level of detail):** `LOD0` (most detailed), `LOD1`, `LOD2` nodes in an asset. The renderer picks one per instance by camera distance.
- **Rig node:** a named movable node (`door_left`, `trolley`, `hoist`, …) whose origin is its mechanical pivot. Its range is in the sidecar's **travel limits**.
- **Attach point:** a named point where something connects (container twist-lock and stacking points, a spreader's container seat).
- **Provenance tag:** how a value is known: `V` verified, `P` photo-supported, `A` approximated, `M` intentional modification. These are the TTI reference pack's tags.
- **Livery:** a shipping line's container colours and wordmark. The **livery atlas** has one tile per line, and an instance's **livery index** is its tile.
- **Wordmark:** the line's name set in a close open-licence typeface and the brand colours, standing in for the official logo.
- **Asset budget:** the triangle, draw-call and file-size limits per asset kind (`assets/budgets.json`), enforced by the **budget check** (`npm run tt:assets:check`).
- **Asset viewer:** the dev-only page `/sim/terminal-twin?viewer=<asset>` (or `?viewer=yard`), with its API `window.__ttAssets`.

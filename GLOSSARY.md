# Glossary

Domain terms used in code, tests, docs and conversations. Most are from **Terminal Twin** (`src/sims/terminal-twin/`). Use these words; avoid the listed alternatives.

## Equipment

- **STS (ship-to-shore crane, quay crane):** a rail-mounted crane on the quay that moves containers between a vessel and its STS ground positions. STS cranes share one rail and never pass each other. Its axes are **gantry** (X, along the quay), **trolley** (Z, waterside to landside) and **hoist** (Y). *Avoid:* "QC" in code.
- **ASC (automated stacking crane):** a rail-mounted gantry crane serving one yard block. Each block has 1–2 ASCs, which never pass each other. The waterside ASC prefers WTP work and the landside ASC prefers truck work.
- **SHC (shuttle carrier):** a straddle-type vehicle that carries one container at a time between STS ground positions and WTP pads. It sets a box down and drives clear before the box can be picked up again. *Avoid:* "straddle carrier" for this role.
- **Spreader:** the lifting frame on an STS or ASC hoist. It grips a container with twist-locks (**lock** and **unlock** times).

## Places

- **Quay:** the continuous berth face at Z = 0. Sea is at negative Z and the yard at positive Z, with X running along the quay.
- **Vessel slot:** a bay/row/tier position on a vessel (`<vesselId>:<bay>-<row>-<tier>`).
- **Ground position (STS ground position):** a buffer lane under an STS where discharged boxes are set down and from which load boxes are picked (`<stsId>-GP<n>`).
- **WTP (waterside transfer point) pad:** a buffer position at the waterside end of a yard block. SHCs drop boxes there, and the ASC picks them up (and the reverse).
- **Transfer stall (landside transfer stall):** a truck position at the landside end of a block where the ASC serves external trucks.
- **Block:** one yard block, perpendicular to the quay. It has 8 rows (fixed by the 25.4 m ASC span), with configurable bays and tiers.
- **Yard slot:** a bay/row/tier position in a block.

## Operations

- **Custody:** the single owner that currently holds a container (vessel slot, STS, ground position, SHC, WTP pad, ASC, yard slot or truck). Custody changes only at a confirmed grip or release. Each container keeps a **custody history**.
- **Handover:** a custody change between two pieces of equipment via a ground buffer, never directly.
- **Discharge / load:** a vessel-to-quay move / a quay-to-vessel move.
- **Move:** one productive container transfer by an STS (a discharge or a load). This is the unit of moves per hour.
- **Cycle:** one complete loop of a crane: start, pick, carry, ground, return.
- **Work package:** one STS's moves for one bay section (deck or hold, discharge or load). Its release is a decision point.
- **Rehandle:** a non-productive ASC move needed to reach a buried box.
- **Job (SHC job):** one box to move from an STS ground position to a WTP pad. Grounding a box **releases** a job into the **released pool**; a job is **open** until an SHC **claims** it.
- **Pull dispatch:** free equipment asks the dispatch decision point (`shcDispatch`) for its next job from the released pool, rather than jobs being pushed to equipment.
- **Trip:** an SHC's planned drive with its phases (routing empty, positioning at pickup, locking, lifting, routing loaded, positioning at drop-off, lowering, unlocking, clearing), or its drive to its parking spot.
- **Clear position (pad clear position):** where an SHC reverses to after setting a box down on a WTP pad, clear of the pad. *Avoid:* "exit".
- **Parking spot:** an SHC's own rest position off the apron, where idle SHCs return.
- **Driver variability:** a ± % random factor on each SHC trip's drive times.
- **Transshipment:** a box that goes vessel → yard → another vessel.

## Engine and tooling

- **Scenario config:** the small, serialisable description of a run (layout, equipment, kinematics, vessels, containers, end conditions, seed). It is built with the **scenario builder**.
- **Fixture:** a small focused scenario config committed as JSON under `scenario/fixtures/`, with a **golden summary** (`*.golden.json`: KPIs plus event-log hash).
- **Preset:** a full-size scenario config generated in code (TTI Algeciras baseline, Small automated, Stress test).
- **Event:** a happening in the sim, wrapped in the common **envelope** (`id`, `seq`, `t`, `type`, `causedBy`, `subjects`, `payload`).
- **Root event:** an event with no cause: `ScenarioStarted`, plus any event injected through `inject` (dev API / tests).
- **Cause chain:** an event's `causedBy` links back to the root, as returned by `why(eventId)`.
- **Reactor:** the engine's internal handling of one event type (physics and flow). It is not swappable.
- **Decision point:** a place where the sim asks the TOS for a decision (berth allocation, yard allocation, ground-position selection, dispatch, …).
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
- **Subsystem mode:** how a subsystem runs: **real**, **instant** (a stub that raises the same events with zero durations) or **off**.
- **Overlay (3D debug overlay):** an optional drawing over the 3D view: lane graph, active reservations.
- **Display settings:** the UI's **locale** (Intl formatting of dates, times, numbers, first day of week) and **unit system** (metric: m, km/h, t; imperial: ft, mi/h, US tons). Display only: the engine and saved configs are always SI. Imperial speed is written **mi/h** because **mph** would read as crane moves per hour.
- **Message catalogue:** `i18n/messages.ts`, the single home of every user-visible UI string (English only for now), looked up with `t(key)`.
- **TOS (terminal operating system):** the external software whose decisions the handlers stand in for.

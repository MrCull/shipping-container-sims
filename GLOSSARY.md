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
- **Transshipment:** a box that goes vessel → yard → another vessel.

## Engine and tooling

- **Scenario config:** the small, serialisable description of a run (layout, equipment, kinematics, vessels, containers, end conditions, seed). It is built with the **scenario builder**.
- **Fixture:** a small focused scenario config committed as JSON under `scenario/fixtures/`, with a **golden summary** (`*.golden.json`: KPIs plus event-log hash).
- **Preset:** a full-size scenario config generated in code (TTI Algeciras baseline, Small automated, Stress test).
- **Event:** a happening in the sim, wrapped in the common **envelope** (`id`, `seq`, `t`, `type`, `causedBy`, `subjects`, `payload`).
- **Root event:** an event with no cause. The only one is `ScenarioStarted`.
- **Cause chain:** an event's `causedBy` links back to the root, as returned by `why(eventId)`.
- **Reactor:** the engine's internal handling of one event type (physics and flow). It is not swappable.
- **Decision point:** a place where the sim asks the TOS for a decision (berth allocation, yard allocation, ground-position selection, dispatch, …).
- **Handler:** a function that answers a decision point. Handlers are swappable, and a **handler set** maps decision points to handlers.
- **Motion segment:** a planned rest-to-rest move of one equipment axis with a known start and end time. It uses an accelerate/cruise/decelerate (trapezoidal) or short-move (triangular) profile.
- **Invariant:** a rule that must hold after every event (for example `custody.single-owner`). **Fail-fast** stops the run at the first violation.
- **Snapshot:** a full JSON copy of a run's state (queue, RNG, log), used to resume the run exactly.
- **Event-log hash:** a deterministic hash of every committed event. The same seed and config always give the same hash.
- **TOS (terminal operating system):** the external software whose decisions the handlers stand in for.

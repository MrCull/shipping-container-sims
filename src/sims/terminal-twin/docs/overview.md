# Overview: what the Terminal Twin models

Checked against ENGINE_VERSION 0.53.0.

Read this when you are new to the Terminal Twin and need the big picture before touching code: what is simulated,
at what fidelity, which real terminal it is modelled on, where it deliberately differs from reality and what it does
not model at all. Every later doc assumes this one. Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## What it is

An event-driven digital twin of a large automated container terminal, built as a **TOS test bench** (spec: GitHub
issue #24). The engine simulates equipment physics and flow; every operational decision a Terminal Operating System
would take is a swappable **decision point** (12 of them, see [decision-points.md](decision-points.md)). A run is
fully deterministic for a given scenario config and seed, so two strategies, two seeds or two code versions can be
compared event by event (`tt:diff`, [engine-core.md](engine-core.md#run-diff)).

Three ways to drive it, all through the same engine API (`engine/index.ts`):

| Host | Entry | Use |
|---|---|---|
| Headless CLI (Node) | `cli/runCli.ts` (`pnpm run tt:run`), `cli/golden.ts`, `cli/profileCli.ts`, `cli/benchCli.ts` | proofs, goldens, profiling, benchmarks ([cli-and-tooling.md](cli-and-tooling.md)) |
| Vitest | `tests/*.test.ts` | behaviour and golden tests |
| Browser | `worker/engine.worker.ts` + `TerminalTwin.vue` | 3D view, dashboard, debugger, saves ([browser-host.md](browser-host.md)) |

## Reference terminal

**TTI Algeciras** (Spain): automated ASC blocks perpendicular to the quay, shuttle carriers (SHCs) for horizontal
transport, STS cranes on a continuous quay, a road gate with transfer stalls at the landside end of each block.
Background research, with every figure tagged general [G], sim value [S] or unverified [U]:
[knowledge-base/dk_ops__tti_algeciras_operations.md](../../../../knowledge-base/dk_ops__tti_algeciras_operations.md).
The engine stays generic: TTI numbers live in presets and in `terminals/tti-algeciras/constants.ts`, never in engine
code. Generic modules ask the terminal registry (`terminals/index.ts`), never a preset name.

Presets (`scenario/presets.ts#presets`):

| Preset | Layout | Start |
|---|---|---|
| `TTI Algeciras baseline` | 850 m quay, 8 STS (STS101 to STS108), 16 blocks x 2 ASC x 8 rows x 45 bays x 5 tiers, 23 SHC, gate 3 in / 3 out + OOG, about 85 % transshipment, 4 vessels 3 h apart | pre-filled to 60 % |
| `Small automated` | 400 m quay, 3 STS, 6 blocks (4 tiers), 8 SHC, gate 2 / 2 | pre-filled to 60 % |
| `TTI Algeciras, peak day` | TTI layout, 5 vessels within 40 min, about 3x truck traffic, 89 % transshipment, 30 % ROB bays | pre-filled to 75 % |

`TTI_BAYS` (45) is derived from 28,647 TEU / (16 x 8 x 5): an assumption (`terminals/tti-algeciras/constants.ts`).
Vessel volumes scale with `scenario/presets.ts#TTI_MOVES_SCALE` (1 since #222), which needs
`TTI_YARD_RESERVE` 0.1 (stacks kept free so a dig always finds room) and `TTI_LOAD_RELEASE_AHEAD` 4. Fixtures
(`scenario/fixtures/definitions.ts`, 31 with goldens) are small hand-placed scenarios, one per behaviour.

## Entities at a glance

| Entity | State type (`engine/state.ts`) | Notes |
|---|---|---|
| Vessel call | `VesselState` | classes `feeder`, `feedermax`, `panamax`, `neo-panamax`, `ulcv` (`scenario/vesselClasses.ts#VESSEL_CLASSES`); bay plan of `VesselSlotState` cells |
| Container | `ContainerState` | 20, 40 or 40HC; custody chain; stored `props` (direction, ISO type, POL/POD, weights, carriers) |
| STS crane | `StsState` | shared rail, gantry/trolley/hoist, twin-20 lifts, hatch moves, ground positions |
| Hatch panel | `HatchPanelState` | lifted to a quay laydown; not a container |
| SHC | `ShcState` | lane graph, whole-trip planning, conflict-zone reservations, queue areas, parking |
| WTP pad | `WtpPadState` | waterside handover between SHC and ASC |
| Yard block / slot | `YardBlockState`, `YardSlotState` | 8 rows, 20 ft bays, tier limit; 40 ft box spans 2 bays |
| ASC | `AscState` | 1 or 2 per block on a shared rail; waterside pads and landside stalls |
| Truck | `TruckState` | gate queue, kiosk, holding positions, transfer stall, exit |

Full shapes: [state-model.md](state-model.md).

## Flows

```
IMPORT / TRANSSHIPMENT DISCHARGE
  vessel slot -> STS (StsPicked) -> ground position (StsGrounded) -> SHC -> WTP pad (ShcDroppedAtWtp)
  -> ASC -> yard slot (AscStacked) -> [import] truck pick at a transfer stall -> external
                                     [transshipment] dwell -> TransshipmentReady -> load flow below

EXPORT LOAD (also empties once allocated, and transshipment boxes after their dwell)
  yard slot -> ASC (AscRetrieved, rehandles first if buried) -> WTP pad (AscDroppedAtWtp) -> SHC
  -> ground position (ShcDroppedAtGround) -> STS (StsLoadPicked) -> vessel slot (StsLoaded)

LANDSIDE
  TruckArrivalDue -> gate queue -> lane + kiosk -> stall (or holding position) -> ASC drop/pick -> exit lane -> gone
  transactions: dropExport, pickImport, dropEmpty, pickEmpty, dual
```

Vessel call: `VesselArrived` -> berth allocation (or anchorage) -> mooring -> `VesselBerthed` -> crane split ->
work packages per crane (deck discharge, hatch removal, hold discharge, hold load, hatch replacement, deck load) ->
`VesselWorkComplete` -> unmooring -> `VesselDeparted`. Details: [subsystems/quay.md](subsystems/quay.md),
[subsystems/horizontal.md](subsystems/horizontal.md), [subsystems/yard.md](subsystems/yard.md),
[subsystems/landside.md](subsystems/landside.md).

## Fidelity choices

- **Discrete events, continuous motion.** Each crane or vehicle move is planned per axis with a trapezoidal
  velocity profile (`engine/kinematics.ts#planSegment`); its end time is known when it starts, so the engine
  schedules only the phase events and renderers interpolate positions with `positionAt`.
- **Kinematics defaults** (all [A] assumptions, `scenario/builder.ts`): `DEFAULT_STS_KINEMATICS` gantry 0.75 m/s,
  trolley 4 m/s, hoist 1.5 m/s loaded / 3 m/s empty, lock and unlock 3 s; `DEFAULT_SHC_KINEMATICS` 8.3 m/s empty,
  6.9 m/s loaded, corner cap from `DEFAULT_SHC_CORNER` (12 m radius, 1.5 m/s2, about 4.2 m/s); `DEFAULT_ASC_KINEMATICS`
  gantry 4 m/s, trolley 1 m/s, hoist 0.5 m/s loaded / 1 m/s empty, lock and unlock 2 s; trucks 8 m/s.
- **Variability** is opt-in: `ScenarioConfig.moveVariationPct` (STS phases, `engine/subsystems/quay.ts#variation`)
  and `driverVariabilityPct` (SHC trips). Both draw from the seeded engine RNG.
- **Subsystem modes** (`ScenarioConfig.subsystems`, `engine/state.ts#resolveSubsystemModes`): `real`, `instant`
  (same events, zero durations) or `off`, per `quay`, `berth`, `yard`, `shc`, `asc`, `landside`. Each defaults to
  `real` when its equipment exists; `yard` caps `asc` and `landside`.
- **Yard start modes** (`ScenarioConfig.yardStart.mode`): `prefilled` (a pre-run phase places boxes through the
  `yardAllocation` handler), `warmup` (empty yard, KPIs restart at `WarmUpEnded`), `empty`, or absent (legacy: export
  boxes start in their planned stacks). Empty and warm-up starts need the landside, since exports arrive by truck.
- **Scale limits** (`scenario/limits.ts#SCALE_LIMITS`): quay 3 km, 24 STS, 40 blocks, 80 bays, 6 tiers, 120 SHC,
  60 vessels, 600 trucks/h; `createSimulation` refuses configs past them.

## Deliberate deviations from the real terminal

From the knowledge base "Sim deviations" section, plus engine rules that are simplifications by design:

1. Trucks are served by ASCs at landside transfer stalls, not at an SHC-served interchange area.
2. Internal slot ids stay (`B01:03-5-2` yard, `V001:03-04-05a` vessel); maritime notation is display only
   (`modules/locationNotation.ts`).
3. No 40-on-20 exception on board: the sim never stows a 40 on a 20 (`stowage.order` invariant).
4. No ANPR and no early/late truck handling: identification is a fixed kiosk time; appointments are honoured, or a
   window cap delays or rejects them.
5. Reefers are plugged rows only: a share of full boxes (`cargo.reeferShare`) go only to `BlockConfig.poweredRows`,
   at most `engine/yardLayout.ts#REEFER_MAX_TIERS` (4) high. TTI presets assume 8 % reefers in rows 1 and 2.
6. Hatch panel counts per class and hatch timings are sim configuration (`ScenarioConfig.hatch`, lashing release
   about 5 min, securing about 3 min, one hatch move about 4 min).
7. One length per yard stack: a stack takes the length of its bottom box until empty (R06).
8. Panels, lashing crews and crane drivers are not resources: lashing and securing are fixed delays.
9. Container properties (`ContainerState.props`) are drawn once from their own RNG stream and never recomputed;
   transit status, content status and dwell are derived, never stored ([state-model.md](state-model.md)).
10. Planned departure uses an estimated vessel ETD: arrival + moves at 25 per STS-hour + 30 min
    (`scenario/containerProps.ts#vesselEtdS`).

## Not modelled

- Dangerous goods segregation, weight stacking in the yard, rail, the "8 big blocks" scenario (out of scope).
- `ContainerProps.holds` is carried on every box but never created or enforced.
- Equipment breakdowns, maintenance, battery or fuel, weather and wind stops: no code exists for them.
- Reefer plug monitoring, power cuts, temperature events, vessel reefer plugs.
- SHC-served truck interchange; separate hatch-cover devices (the STS lifts every panel).
- Customs, inspections and holds; staff, shifts and labour (shifts exist only as KPI buckets, `engine/kpi/clock.ts`).
- ROB bays are display only: never worked, no slots, hatch covers stay closed (`scenario/robBays.ts`).

## Where to go next

- How the code is layered and where each folder fits: [architecture.md](architecture.md).
- The event loop: [engine-core.md](engine-core.md). The data: [state-model.md](state-model.md).
- What limits moves per hour: [optimising/terminal-throughput.md](optimising/terminal-throughput.md).
- Known behaviours and gaps: [pitfalls-and-gaps.md](pitfalls-and-gaps.md).

# Terminal Twin docs index

Checked against ENGINE_VERSION 0.53.0.

Written for AI agents that need to learn the Terminal Twin quickly and help decide what to change or optimise. Each file answers one question and can be read alone. Code references are `path#symbol` relative to `src/sims/terminal-twin/` (no line numbers: grep the symbol). Domain terms: [GLOSSARY.md](../../../../GLOSSARY.md). Commands that prove a change: "How to prove a change works" in [terminal-twin-AGENTS.md](../terminal-twin-AGENTS.md).

## Reading order

1. [overview.md](overview.md), then [architecture.md](architecture.md): what is modelled and how the code is layered.
2. [engine-core.md](engine-core.md) and [state-model.md](state-model.md): the event loop and the data it mutates.
3. The subsystem doc for the area you are touching, plus [decision-points.md](decision-points.md) and [invariants.md](invariants.md).
4. For optimisation work, the matching guide under `optimising/`.

## Files

| File | Answers |
|---|---|
| [overview.md](overview.md) | What does the sim model, at what fidelity, and where does it deliberately deviate from the real terminal? |
| [architecture.md](architecture.md) | How is the code layered (engine, decisions, scenario, CLI, worker, host, 3D), what is in each folder, and what is the determinism contract? |
| [engine-core.md](engine-core.md) | How does the discrete-event loop work: queue, step, reactors, handlers, causality, RNG, motion, hashing, snapshots, replay, logging? |
| [state-model.md](state-model.md) | What does `SimState` hold, what does each entity look like, and which indexes exist? |
| [subsystems/quay.md](subsystems/quay.md) | How do vessels berth, how are STS cranes split and sequenced, how do hatch covers, work packages and stow order work? |
| [subsystems/horizontal.md](subsystems/horizontal.md) | How are SHCs dispatched and routed (lane graph, reservations, WTP pads, queue areas)? |
| [subsystems/yard.md](subsystems/yard.md) | How do ASC blocks store, allocate, rehandle and prepare boxes; what causes yard deadlock? |
| [subsystems/landside.md](subsystems/landside.md) | How do trucks arrive, pass the gate and get served at the ASC transfer points? |
| [decision-points.md](decision-points.md) | Which TOS decisions exist, what each request and reply carries, which strategies are registered, and how latency is modelled? |
| [invariants.md](invariants.md) | Which invariants guard the run, how and when they are checked, and what they cost? |
| [kpis-and-reports.md](kpis-and-reports.md) | Which KPIs and end conditions exist, and what do the summary, golden, profiler and productivity reports contain? |
| [scenarios-and-persistence.md](scenarios-and-persistence.md) | How are presets, fixtures and layouts defined and validated; how do saves, snapshots and rewind work? |
| [cli-and-tooling.md](cli-and-tooling.md) | What does every `tt:*` command and helper script do, with which flags and outputs? |
| [browser-host.md](browser-host.md) | How does the browser run the engine (worker), and how do playback, dashboard, debugger, inspector, bay viewer and the `window.__tt` dev API work? |
| [rendering-3d.md](rendering-3d.md) | How is the 3D scene built and posed each frame: instancing, equipment rigs, hulls, quality tiers, lighting, sound? |
| [assets-pipeline.md](assets-pipeline.md) | How are the GLB models and sounds generated, budgeted and checked? |
| [optimising/run-speed.md](optimising/run-speed.md) | Where does headless wall-clock time go and which levers reduce it without changing results? |
| [optimising/terminal-throughput.md](optimising/terminal-throughput.md) | What limits moves per hour and vessel turnaround, and which strategies and knobs change it? |
| [optimising/frame-rate.md](optimising/frame-rate.md) | Where does browser frame time go and how is it measured and reduced? |
| [pitfalls-and-gaps.md](pitfalls-and-gaps.md) | Which known behaviours, pitfalls and gaps should an agent know before changing anything? |
| [reports/realistic-volume-reports.md](reports/realistic-volume-reports.md) | Measured runs per `TTI_MOVES_SCALE` step (run lines, KPIs, profiles, failure analyses). |
| [reports/throughput-and-speed-report.md](reports/throughput-and-speed-report.md) | Measured CPU profile and sim-time breakdown of the peak day (engine 0.52.0, scale 0.5). |

## Keeping these docs current

A change to engine behaviour, a strategy default, a KPI, a CLI flag or a renderer updates the matching doc in the same PR and bumps its `Checked against ENGINE_VERSION` line. Reports under `reports/` are records of past measurements: add new sections, do not rewrite old ones.

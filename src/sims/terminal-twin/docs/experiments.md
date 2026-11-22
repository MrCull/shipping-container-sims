# Experiments: is config B better than A?

Checked against ENGINE_VERSION 0.59.0.

An **experiment** runs several configs of one base preset or fixture on the same seeds and compares each config with a
**baseline config**, seed by seed (spec #309). Use it whenever a question is "does this strategy, parameter, fleet size or
TOS latency change the terminal's results?": one seed can make a lucky config look like an improvement, an experiment
cannot. Terms: [GLOSSARY.md](../../../../GLOSSARY.md), section **Experiments**. Every flag and file field in full:
[cli-and-tooling.md](cli-and-tooling.md), **tt:experiment**. Code: `cli/experiment.ts` (core: plan, statistics, report),
`cli/experimentCli.ts` (CLI, workers, cost guard, heavy lock).

## Quick start

Copy one of the checked-in examples in `experiments/`:

| File | Question | Size |
|---|---|---|
| [`experiments/pad-selection-baseline.json`](../experiments/pad-selection-baseline.json) | Strategy study: `wtpPadSelection` `balanced` (the preset's choice) against `nearest-box` on the TTI Algeciras baseline preset. Primary `grossMovesPerHour`, guard `truckTurnaroundS` within 5 %. | 2 configs x 10 seeds x (2 h warm-up + 24 h) |
| [`experiments/yard-shc-grid.json`](../experiments/yard-shc-grid.json) | Grid: `yardAllocation` (`nearest-wtp`, `grouped`) x two or four SHCs on the short `shc-paired-dual-cycle` fixture, each against the fixture as it is. `warmUpS: 0`, because the default 2 h warm-up would use up the fixture's whole workload. | 5 configs x 3 seeds x 1 h, about 2 s |

```
pnpm run tt:experiment src/sims/terminal-twin/experiments/yard-shc-grid.json --dry-run
pnpm run tt:experiment src/sims/terminal-twin/experiments/yard-shc-grid.json --out /tmp/grid
```

`--dry-run` validates the file, prints the expanded configs, the replicate count and the wall-time estimate, and runs
nothing. Run it first. `tests/experiment-examples.test.ts` keeps both examples valid and runs the grid one for real.

## The file

Format `terminal-twin-experiment`, version 1, plain JSON (so tools in any language can write it):

| Field | Default | Meaning |
|---|---|---|
| `name`, `description` | | Title and question; both go into `report.md` |
| `base` | required | `{ "preset": "<name>" }` or `{ "fixture": "<name>" }` |
| `warmUpS` | 7200 | Measurement warm-up of every replicate, excluded from KPIs (any yard start mode). Set it deliberately on a short fixture: 0 when the fixture's work fits in less than the default |
| `horizonS` | 86400 | Measured sim time per replicate; replaces the base's end conditions |
| `seeds` | `{ "count": 10, "from": 1 }` | Or an explicit list, e.g. `[3, 7, 11]`, to reuse an earlier experiment's seeds |
| `configs` | required, at least one | Named configs; overrides on the base (below) |
| `baseline` | the first config | The config every other config is compared with |
| `primary` | required | `{ "kpi": "<name>" }`: the KPI the verdict is about |
| `guards` | none | `[{ "kpi", "tolerance": { "abs": n } \| { "pct": n } }]`: KPIs a config must not make worse than the tolerance |
| `grid` | none | `{ "factors": { "<path>": [values] } }`: adds one config per combination |

A config overrides the base in four ways, applied in this order: `patch` (a JSON Merge Patch, RFC 7396, on the base
`ScenarioConfig`: objects merge, `null` deletes, arrays replace), then the shorthand `strategies` (`{ "<dp>": "<strategy>" }`),
`params` (`{ "<dp>": { "<NAME>": n } }`, the strategy params listed in [decision-points.md](decision-points.md)) and
`latency` (`{ "<dp>": "<spec>" }`, the `tt:run --latency` syntax). A patch may not set `endConditions` or
`measurementWarmUpS`: every replicate measures the same span.

Grid factor paths are `strategies.<dp>`, `params.<dp>.<NAME>`, `latency.<dp>` and `patch.<dotted path>`. Configs are named
from their values in factor order (strings bare, anything else as JSON), so an array-valued patch factor gives a long
name such as `shcs=[{"id":"SHC01"},{"id":"SHC02"}]` (the grid example). Everything is validated before any replicate
runs: an unknown KPI, decision point, strategy or param, a param out of range, a bad latency spec, a patch that makes an
invalid scenario, duplicate names. The error names the config and field.

## KPI catalogue

`EXPERIMENT_KPIS` in `cli/experiment.ts`. Every KPI is reported for every config; only the primary gets a verdict and
only guards get a status. A KPI that is null for a replicate (its subsystem is absent, e.g. `truckTurnaroundS` on a
fixture without trucks) is not compared for that pair.

| KPI | Unit | Better | Meaning |
|---|---|---|---|
| `grossMovesPerHour` | moves/h | higher | gross crane productivity, summed over the STS cranes |
| `netMovesPerHour` | moves/h | higher | net crane productivity (working time only), summed over the STS cranes |
| `movesDone` | moves | higher | container moves completed (measured period) |
| `vesselsDone` | vessels | higher | vessels completed (measured period) |
| `meanVesselTurnaroundS` | s | lower | mean berth to departure over the vessels that departed |
| `meanAnchorageWaitS` | s | lower | mean anchorage wait over the vessels allocated a berth |
| `truckTurnaroundS` | s | lower | mean truck turnaround, gate-in to gate-out |
| `shcEmptyTravelRatio` | ratio | lower | empty share of SHC travel, mean over the SHCs |
| `shcBusyPct` | % | lower | share of time the SHCs spend moving (less driving for the same work) |
| `ascUtilisationPct` | % | lower | ASC utilisation, mean over the ASCs (less crane time for the same work). Reads 0 after a measurement warm-up at engine 0.59.0 (known bug, [report](reports/experiment-pad-selection-report.md)) |
| `rehandlesPerProductiveMove` | ratio | lower | yard rehandles (blocker moves) per productive ASC move |
| `equipmentIdleS` | equipment s | lower | decision-caused idle, summed over the decision points |
| `invariantViolations` | violations | lower | invariant violations (any makes the replicate invalid) |

## Statistics and verdicts

- **Pairing.** For each config C and KPI, the per-seed difference is `d = C - baseline` over the seeds where both
  replicates are `ok` and the KPI is non-null. The same seed gives every STS and SHC the same random draws whatever the
  strategies (one **RNG stream** per source, #310), so most seed-to-seed noise cancels in `d`.
- **Interval.** n, mean of `d`, its SD and a 95% CI from Student's t with n - 1 degrees of freedom; plus the change
  against the baseline mean and each side's own mean and CI.
- **Primary verdict.** **better** when the CI lies entirely on the KPI's good side of 0, **worse** when entirely on the
  bad side, else **no difference detected**; **insufficient data** with fewer than 2 valid pairs. "No difference
  detected" is a result, not a failure: the effect is smaller than this many seeds can resolve.
- **Guard status.** Degradation is `d` signed so positive is worse; a percent tolerance is taken of the baseline mean.
  **held** when the degradation CI's upper bound is at or below the tolerance, **breached** when its lower bound is
  above it, else **uncertain** (more seeds needed); **insufficient data** with n < 2.
- **Invalid replicates.** A replicate is `ok`, `invalid: invariant`, `invalid: failed` or `invalid: error`. The
  experiment carries on; the seed is dropped from that config's pairing and listed under dropped seeds.
- **Many configs.** There is no multiple-comparison correction: with more than two configs the report says so, and
  with a large grid some "better" or "worse" verdicts are expected by chance. Re-run a surprising winner on fresh seeds
  (a different `seeds.from`).

## Running it

- Replicates run in parallel worker processes (`--jobs N`, default the CPU count); results do not depend on scheduling.
- The cost guard estimates wall time first (replicates x sim-hours x ms per sim-hour / jobs, from `perf/baseline.json`
  when the base has an entry). Above 10 minutes it asks, or refuses without `--yes` on a non-TTY.
- It takes the machine-wide heavy lock (as `scripts/bg.sh run --heavy`), so numbers are not skewed by a smoke suite.
  For a long study: `scripts/bg.sh run --heavy <log> pnpm run tt:experiment <file> --yes`, then `scripts/bg.sh wait <log>`.
- Output (`--out DIR`, default `.tt-experiments/<timestamp>/`, gitignored): `report.json` (format
  `terminal-twin-experiment-report`, version 4), `report.md` and `replicates/<config>/<seed>.summary.json`.
- Exit code 0 when every replicate was valid (whatever the verdicts), 1 when any was invalid, 2 for a usage or
  validation error or a refused cost confirmation.

## Reading the report

`report.md` has, in order: the question (primary KPI, direction, baseline, seeds, warm-up and horizon), the **Verdict**
table (one row per config: verdict, n, mean difference, 95% CI, change), the **Guards** table, the full **KPIs** table
(every KPI per config: baseline and config mean with CI, paired difference, verdict), invalid replicates and dropped
seeds, notes, provenance (engine version, commit, Node, CPU, start and end) and one reproduce line per replicate. A
measured example: [reports/experiment-pad-selection-report.md](reports/experiment-pad-selection-report.md). Excerpt from
the grid example (engine 0.59.0):

```
| Config | Verdict | n | Mean difference | 95% CI | Change |
| --- | --- | --- | --- | --- | --- |
| yardAllocation=grouped,shcs=[{"id":"SHC01"},{"id":"SHC02"}] | no difference detected | 3 | -0.878 | [-2.762, 1.006] | -2.137 % |

| Guard | Tolerance | Config | Status | Degradation 95% CI | Tolerance in KPI units |
| --- | --- | --- | --- | --- | --- |
| shcEmptyTravelRatio (ratio) | 0.05 | yardAllocation=grouped,shcs=[{"id":"SHC01"},{"id":"SHC02"}] | held | [-0.047, -0.027] | 0.05 |
```

Two numbers of the same experiment file on the same `ENGINE_VERSION` are comparable; across engine versions they are
not (the provenance says which one wrote the report). Only `provenance.startedAt`, `endedAt` and each replicate's
`wallMs` differ between two runs of the same file.

## Reproducing one replicate

Each replicate in `report.json` carries `command` and `eventLogHash`. Running the command prints the same `Event-log
hash:` line, e.g.:

```
pnpm run tt:run --preset "TTI Algeciras baseline" --seed 3 --async-mode pause --no-fail-fast --warm-up 7200 --end time:86400 --strategy wtpPadSelection=nearest-box
```

A config with a `patch` cannot be written as `tt:run` flags; its command says so and names the patch. To inspect such a
replicate, open its `replicates/<config>/<seed>.summary.json`, or apply the patch to the base scenario JSON and run that
file.

## Open questions an experiment can answer

- **Does `paired-dual-cycle` still save empty driving over `chained-nearest`?** #310 found that once RNG draws are per
  source, the old test that showed a saving passed only on seed luck. An experiment on a preset with both strategies
  for `shcDispatch`, primary `shcEmptyTravelRatio`, guard `grossMovesPerHour`, would settle it. Not run yet.

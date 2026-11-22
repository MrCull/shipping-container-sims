# Experiment: WTP pad selection, balanced vs nearest-box (#318)

Measured against ENGINE_VERSION 0.59.0, branch `tt/review-309-kpi-warmup` at 24ce3c3 (integration branch
`claude/gallant-curie-3so8w0`, spec #309), after the KPI warm-up fix of the #309 review. First run at 318245b
(branch `tt/318-experiment-examples-report`); the re-run's event logs are the same (the fix changes the KPI collector
only, not the engine), so moves, vessels, truck turnaround and rehandles did not move. The first measured `tt:experiment` study; how to read it:
[../experiments.md](../experiments.md).

## Question

On the TTI Algeciras baseline preset, does picking the WTP pad by distance only (`nearest-box`) change gross crane
productivity against the preset's own pad choice (`balanced`, which also weighs block fill and queued ASC jobs), without
making truck turnaround more than 5 % worse?

## Run

```
scripts/bg.sh run --heavy .tt-experiments/study.log pnpm run tt:experiment src/sims/terminal-twin/experiments/pad-selection-baseline.json --out .tt-experiments/pad-study --yes
```

- File: [`experiments/pad-selection-baseline.json`](../../experiments/pad-selection-baseline.json), unchanged: the full
  spec defaults, no cut. 2 configs x 10 seeds (1 to 10) = 20 replicates, each 7,200 s warm-up + 86,400 s measured.
- Machine: cloud container, 4 cores (`nproc` 4), Intel(R) Xeon(R) Processor @ 2.10GHz, Node v22.23.5, `--jobs` 4
  (default).
- Wall time: 4 min 45 s (19:35:57 to 19:40:43 UTC; the first run took 4 min 7 s). The `--dry-run` estimate was 1.8 min
  (808 ms per sim-hour from `perf/baseline.json`); one replicate took 41 to 60 s here, about twice the perf baseline
  machine's pace with four replicates sharing the cores.
- Exit code 0: all 20 replicates `ok`, 0 invariant violations, no dropped seeds.

## Verdict

| Config | Verdict on grossMovesPerHour | n | Mean difference | 95% CI | Change |
| --- | --- | --- | --- | --- | --- |
| nearest-box | **worse** | 10 | -38.4 moves/h | [-54.9, -21.9] | -23.7 % |

| Guard | Tolerance | Status | Degradation 95% CI | Tolerance in KPI units |
| --- | --- | --- | --- | --- |
| truckTurnaroundS | 5 % of the baseline mean | uncertain | [-113.6, 560.7] s | 38.6 s |

`nearest-box` is clearly worse on the primary KPI: every plausible effect size in the CI is a loss of 22 to 55 moves/h
(baseline 161.9 moves/h). The truck guard is uncertain, not breached: the mean degradation is +224 s, but one or two
seeds swing it, so ten seeds cannot tell whether it stays within 39 s. It does not matter for the decision here, since
the primary already fails.

## All KPIs (nearest-box minus balanced, paired by seed)

| KPI | balanced mean [95% CI] | nearest-box mean [95% CI] | Difference [95% CI] | Verdict |
| --- | --- | --- | --- | --- |
| grossMovesPerHour (moves/h) | 161.9 [152.7, 171.1] | 123.5 [110.6, 136.5] | -38.4 [-54.9, -21.9] | worse |
| netMovesPerHour (moves/h) | 232.5 [202.4, 262.6] | 202.6 [190.4, 214.9] | -29.9 [-61.1, 1.4] | no difference detected |
| movesDone (moves) | 2357.2 [1968.2, 2746.2] | 1804.5 [1563.6, 2045.4] | -552.7 [-805.7, -299.7] | worse |
| vesselsDone (vessels) | 1.9 [1.7, 2.1] | 1.6 [1.2, 2.0] | -0.3 [-0.6, 0.0] | no difference detected |
| meanVesselTurnaroundS (s) | 52,036 [45,479, 58,592] | 61,964 [54,401, 69,527] | +9,929 [3,444, 16,413] | worse |
| meanAnchorageWaitS (s) | 20,564 [14,339, 26,788] | 16,672 [6,279, 27,065] | -3,891 [-15,472, 7,689] | no difference detected |
| truckTurnaroundS (s) | 771.4 [760.3, 782.4] | 994.9 [658.7, 1331.1] | +223.5 [-113.6, 560.7] | no difference detected |
| shcEmptyTravelRatio (ratio) | 0.617 [0.606, 0.629] | 0.642 [0.619, 0.665] | +0.025 [0.002, 0.048] | worse |
| shcBusyPct (%) | 14.82 [12.37, 17.27] | 10.46 [9.19, 11.73] | -4.36 [-6.01, -2.70] | better |
| ascUtilisationPct (%) | 19.04 [16.75, 21.33] | 15.67 [14.37, 16.97] | -3.37 [-5.02, -1.73] | better |
| rehandlesPerProductiveMove (ratio) | 0.501 [0.457, 0.545] | 0.550 [0.503, 0.597] | +0.049 [0.021, 0.078] | worse |
| equipmentIdleS (equipment s) | 0 | 0 | 0 | no difference detected |
| invariantViolations | 0 | 0 | 0 | no difference detected |

Reading: with `nearest-box` the SHCs pile onto the nearest block's pads, the yard behind them works fewer boxes per hour
and stacks worse (more rehandles), so the STS cranes wait. Fewer moves done means less SHC driving and less ASC
crane time, which is why `shcBusyPct` and `ascUtilisationPct` read "better": a lower-is-better KPI can improve because
less work got done, so read it next to `movesDone` (23 % fewer moves, 18 % less ASC time, 29 % less SHC time). The preset's choice of `balanced` stands.

## Caveats and follow-ups

- Fixed since the first run: `ascUtilisationPct` read 0 for every replicate and `shcBusyPct` read about half its value,
  a KPI measurement bug after any measurement warm-up (departure times in event payloads were not moved to the measured
  clock, and work in progress at the warm-up end was dropped). The #309 review fixed the collector
  ([../kpis-and-reports.md](../kpis-and-reports.md), **Measurement warm-up**); this table is the re-run. The gross and
  net moves per hour moved by under 1 % (crane waits running across the warm-up end are now cut there).
- Two configs only, so no multiple-comparison caveat applies.

## Reproduce one replicate

```
pnpm run tt:run --preset "TTI Algeciras baseline" --seed 3 --async-mode pause --no-fail-fast --warm-up 7200 --end time:86400 --strategy wtpPadSelection=nearest-box
```

prints the `Event-log hash:` stored as that replicate's `eventLogHash` in `report.json`. The baseline replicates use
`--strategy wtpPadSelection=balanced` instead.

# Experiment: WTP pad selection, balanced vs nearest-box (#318)

Measured against ENGINE_VERSION 0.59.0, branch `tt/318-experiment-examples-report` at 318245b (integration branch
`claude/gallant-curie-3so8w0`, spec #309). The first measured `tt:experiment` study; how to read it:
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
- Wall time: 4 min 7 s (17:23:40 to 17:27:47 UTC). The `--dry-run` estimate was 1.8 min (808 ms per sim-hour from
  `perf/baseline.json`); one replicate took 41 to 60 s here, about twice the perf baseline machine's pace with four
  replicates sharing the cores.
- Exit code 0: all 20 replicates `ok`, 0 invariant violations, no dropped seeds.

## Verdict

| Config | Verdict on grossMovesPerHour | n | Mean difference | 95% CI | Change |
| --- | --- | --- | --- | --- | --- |
| nearest-box | **worse** | 10 | -37.8 moves/h | [-54.7, -20.9] | -23.2 % |

| Guard | Tolerance | Status | Degradation 95% CI | Tolerance in KPI units |
| --- | --- | --- | --- | --- |
| truckTurnaroundS | 5 % of the baseline mean | uncertain | [-113.6, 560.7] s | 38.6 s |

`nearest-box` is clearly worse on the primary KPI: every plausible effect size in the CI is a loss of 21 to 55 moves/h
(baseline 162.8 moves/h). The truck guard is uncertain, not breached: the mean degradation is +224 s, but one or two
seeds swing it, so ten seeds cannot tell whether it stays within 39 s. It does not matter for the decision here, since
the primary already fails.

## All KPIs (nearest-box minus balanced, paired by seed)

| KPI | balanced mean [95% CI] | nearest-box mean [95% CI] | Difference [95% CI] | Verdict |
| --- | --- | --- | --- | --- |
| grossMovesPerHour (moves/h) | 162.8 [153.6, 172.0] | 125.0 [111.9, 138.0] | -37.8 [-54.7, -20.9] | worse |
| netMovesPerHour (moves/h) | 233.2 [202.7, 263.7] | 201.7 [189.3, 214.0] | -31.6 [-63.9, 0.8] | no difference detected |
| movesDone (moves) | 2357.2 [1968.2, 2746.2] | 1804.5 [1563.6, 2045.4] | -552.7 [-805.7, -299.7] | worse |
| vesselsDone (vessels) | 1.9 [1.7, 2.1] | 1.6 [1.2, 2.0] | -0.3 [-0.6, 0.0] | no difference detected |
| meanVesselTurnaroundS (s) | 52,036 [45,479, 58,592] | 61,964 [54,401, 69,527] | +9,929 [3,444, 16,413] | worse |
| truckTurnaroundS (s) | 771.4 [760.3, 782.4] | 994.9 [658.7, 1331.1] | +223.5 [-113.6, 560.7] | no difference detected |
| shcEmptyTravelRatio (ratio) | 0.617 [0.606, 0.629] | 0.642 [0.619, 0.665] | +0.025 [0.002, 0.048] | worse |
| shcBusyPct (%) | 7.41 [6.22, 8.60] | 5.03 [4.47, 5.60] | -2.38 [-3.23, -1.52] | better |
| ascUtilisationPct (%) | 0 | 0 | 0 | no difference detected |
| rehandlesPerProductiveMove (ratio) | 0.501 [0.457, 0.545] | 0.550 [0.503, 0.597] | +0.049 [0.021, 0.078] | worse |
| equipmentIdleS (equipment s) | 0 | 0 | 0 | no difference detected |
| invariantViolations | 0 | 0 | 0 | no difference detected |

Reading: with `nearest-box` the SHCs pile onto the nearest block's pads, the yard behind them works fewer boxes per hour
and stacks worse (more rehandles), so the STS cranes wait. Fewer moves done means less SHC driving, which is why
`shcBusyPct` reads "better": a lower-is-better KPI can improve because less work got done, so read it next to
`movesDone`. The preset's choice of `balanced` stands.

## Caveats and follow-ups

- `ascUtilisationPct` reads 0 for every replicate. It is a measurement bug, not a result: the headline ASC utilisation
  is 0 after any measurement warm-up (`tt:run --preset "TTI Algeciras baseline" --warm-up 1800 --end time:1800` prints
  `ASC utilisation: 0 %`; with `--warm-up 0 --end time:3600` it prints 12.75 %). Worth a ticket before anyone uses it
  in an experiment with a warm-up.
- Two configs only, so no multiple-comparison caveat applies.

## Reproduce one replicate

```
pnpm run tt:run --preset "TTI Algeciras baseline" --seed 3 --async-mode pause --no-fail-fast --warm-up 7200 --end time:86400 --strategy wtpPadSelection=nearest-box
```

prints the `Event-log hash:` stored as that replicate's `eventLogHash` in `report.json`. The baseline replicates use
`--strategy wtpPadSelection=balanced` instead.

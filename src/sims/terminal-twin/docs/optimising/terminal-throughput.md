# Optimising terminal throughput

Checked against ENGINE_VERSION 0.53.0.

Read this when you want the simulated terminal to move more boxes per hour, idle its STS less, drive SHCs empty less,
rehandle less or turn vessels round faster, or when you compare two TOS strategies. It says what limits throughput
today (with measured numbers and their engine version), which levers exist, how to compare runs and what can go wrong.
Wall-clock speed of a run is [run-speed.md](run-speed.md). Terms: [GLOSSARY.md](../../../../../GLOSSARY.md).

## What limits throughput today

### Peak day at full size (ENGINE_VERSION 0.53.0, `TTI_MOVES_SCALE` 1)

From [../reports/realistic-volume-reports.md](../reports/realistic-volume-reports.md) ("Step: TTI_MOVES_SCALE 1"):
5 of 5 vessels, 9,163 moves, the fifth vessel done at sim day 3 21:56 (2.9 sim days), 0 violations. STS gross
moves/h per crane 8.0 to 21.1 (busiest STS107: 1,785 moves); the latest vessel waited 262,656 s at the anchorage; rail
wait is the largest crane loss (STS105 126,295 s, STS104 72,263 s). Going 0.5 to 1 doubled moves but sim time only
x1.4: the quay is better used at the larger volume. No `tt:profile` was run at scale 1; the breakdowns below are at 0.5.

### Where crane time goes

`engine/stsProductivity.ts` puts each crane in exactly one bucket (`STS_TIME_BUCKETS`):

| Bucket | Starts on | Meaning |
|---|---|---|
| `cycle` | `StsMoveStarted`, `StsLoadStarted`, end of any wait | lifting (also gaps between packages) |
| `hatch` | `StsHatchStarted` | hatch cover work |
| `lashing` | `StsWaitingForHatch` | cover still lashed or hatch not secured |
| `ground` | `StsWaitingForGroundPosition` | discharge: no free ground position |
| `box` | `StsWaitingForBox` | load: export box not on its ground position yet |
| `rail` | `StsWaitingForRail` | a neighbour is closer than `stsMinSpacingM` |
| `reposition` | `StsRepositionStarted` | stepping aside for another crane |
| `done` | `StsWorkComplete` | no more work on its vessel |

Measured shares (all cranes, share of crane windows):

| Run (engine) | cycle | hatch+lashing | box | rail | reposition | done | gross moves/h per STS |
|---|---|---|---|---|---|---|---|
| peak day, first 5,400 s after berthing (pre-0.30, spec #117) | 33 % | 16 % + 6 % | 22 % | 18 % | 5 % (with done) | | 8.8 |
| baseline 0.5 (0.52.0) | 37 % | 3 % + 1 % | 2 % | 21 % | 20 % | 17 % | 10.6 |
| peak day 0.5 (0.52.0) | 26 % | 1 % | 3 % | 17 % | 25 % | 27 % | 7.5 |
| peak day 0.5, `--until time:40000` (#229 slice) | 36 % | | | 36 % | 7 % | | |

A crane that never waits does about 29 moves/h (median discharge and load cycle 122 s: 35 s to the pick, 81 s pick to
grounded). Everything above that gap is waiting.

### The causes, in order of weight

1. **Rail conflicts at crane-split boundaries.** `stsMinSpacingM` is 27 m (`scenario/builder.ts#DEFAULT_QUAY`) but a
   40 ft bay pitch is about 14 m, so two cranes cannot work adjacent bays. `balanced-moves` gives each crane a
   contiguous bay range, so every boundary is such a pair. #229 split the rail wait at 0.5: 62 % is a neighbour mid
   package that cannot yield (it carries boxes, `engine/subsystems/rail.ts#yieldable` refuses), 38 % is cranes chained
   behind a waiting crane. Yield rules: `askToYield` (lowest rail index first, #212) and the busy-crane bounded yield
   (`StsState.railYield`, #174). Reposition share at 0.5 is mostly the bucket after a crane's work, not travel (3
   repositions, 162 s of motion in the slice).
2. **Anchorage waits.** `berthAllocation` `first-fit` (`engine/subsystems/berth.ts`) is first come first served: a vessel
   that would fit cannot overtake the head of the queue, and a berth frees only when its vessel leaves. 0.5 peak day:
   V003 to V005 waited 187,826 s, 187,127 s and 232,604 s (mean 121,511 s); scale 1: up to 262,656 s. Mooring is
   1,800 s and unmooring 1,200 s (`DEFAULT_QUAY`). On an 850 m quay two ULCVs (400 m each) plus a feedermax do not fit together.
3. **Load box supply.** By design (`engine/subsystems/loadPrep.ts`) a crane's load boxes get their SHC job only after
   its discharge before them is done (`dischargeDone`, then `pumpLoadPrep` asks `stsGroundPosition`, job from
   `createLoadShcJob`). Boxes staged ahead (`loadReleaseAhead`, TTI 4) sit on pads with no job. #239 proved the SHCs
   are not the cause: at 0.5 every load job was claimed in the sim second it was created; 100 % of long pad waits were
   before the job existed. The profile's load `horizontal` wait (696 s mean at 0.5 peak) is measured from
   `AscDroppedAtWtp`, so it includes that pre-job time.
4. **Rehandles.** The pre-filled yard (TTI peak day 75 %) is stacked without regard to load order. Spec #117 counted
   62 % of export retrievals buried and 263 rehandle lifts against 66 productive retrievals in 7,200 s (before the
   `grouped` and `pod-weight` defaults). Busy blocks queue their ASC jobs even with ASC utilisation low.
5. **Hatch covers.** `HATCH_DEFAULTS` (`scenario/vesselClasses.ts`): `lashingReleaseS` 300, `cycleS` 240 per cover,
   `lashingSecureS` 180, `laydownStackLimit` 3 (assumptions). One removal pair is about 730 s of crane time. Large share
   only early in a call; 1 to 4 % over whole runs.
6. **Idle equipment is a symptom, not a cause.** 0.5 peak day: SHC busy 9 %, empty travel ratio 0.67, 14 of 23 SHCs at
   99 % idle or more (`chained-nearest` takes the lowest-numbered free SHC, so work piles on SHC01 to SHC07); ASC
   utilisation 13 % (B03 busiest). Spreading SHC jobs (#230, least-loaded tie-break) spread the work but left the
   load-box wait flat. More SHCs or ASCs do not help while cranes wait on rail and load prep.

### Yard failure modes at higher volume

These end a run instead of slowing it, so they cap the usable `TTI_MOVES_SCALE`:

- **`yard.no-progress`** (silent deadlock, `engine/invariants.ts#stuckYardBlocks`): a block with claimed work, every ASC
  idle and nothing able to start for `STALL_STRAND_LIMIT_S` (1800 s). Seen at 0.25 without reserve (B01 to B04 at 90 %
  fill while B09 to B16 stood at 77 to 80 %, because truck drops all took the stall nearest the gate), and as a 40 ft
  blocker with no pair of equal-height 40 ft stacks in a 76 % block (inferred).
- **`rehandle: full`**: `pumpRehandle` sets it when `rehandleCandidates` is empty; it is retried only when an ASC lifts a
  box (`reopenFullJobs` on `AscRetrieved`). Room that appears without a lift is an unproven gap.
- **Pads full of non-head load boxes** (baseline 0.5 B14 at 81,017 s): fixed by the head box pad reserve (#213,
  `stageAhead`: a non-head box takes a pad only when `free - waiting retrievals - headsWithoutPad >= 2`).
- **Three cranes waiting for each other** (0.5 peak day idle at 89,151 s): fixed by #212.

What makes scale 1 work (all in `scenario/presets.ts`): `TTI_YARD_RESERVE` 0.1 (pairs of bays kept free of pre-fill and
discharge so a dig finds room), `wtpPadSelection` `balanced`, `transferStallSelection` `spread-drops`, plus the rail and
pad fixes #212, #213, #215, #218. Remove any of them and expect a deadlock, not a slow run.

## Levers

### Decision-point strategies

Full table of points, contracts and strategies: [../decision-points.md](../decision-points.md). The ones that move throughput:

| Point | Default (TTI preset) | Alternatives | Measured effect |
|---|---|---|---|
| `craneSplit` | `balanced-moves` | `equal-bays` | proposed (#229): give one crane every bay closer than `stsMinSpacingM` to another crane's range; would cut the 36 % rail share of the 0.5 slice. Not built |
| `berthAllocation` | `first-fit` | `best-fit` | proposed: berth look-ahead or overtaking for a vessel that fits; blocked until rail and load supply improve |
| `workPackageRelease` | `keep-k-ahead` (`workPackages.releaseAhead` default 2) | `just-in-time` | `releaseAhead` 6 measured and rejected in #176; package look-ahead for a yielding crane (#229, #240) left the 0.5 run identical |
| `shcDispatch` | `oldest-job` (TTI: `chained-nearest`) | `nearest-job`, `paired-dual-cycle`, `predispatch` | `chained-nearest` drops parking returns to 0 on `shc-queue-chained` (about 19 with `oldest-job`); `paired-dual-cycle` cuts empty travel (7,364 m vs 7,665 m on its fixture, pairing radius `PAIRING_RADIUS_M` 150 m); `predispatch` cuts STS ground waits on `shc-prepositioning` (margin `queueAreas.predispatchMarginS` 15 s). Under `grouped` yard allocation the ASC became the bottleneck and `predispatch` lost its edge |
| `wtpPadSelection` | `first-free` (TTI: `balanced`) | `nearest-box`, `last-free` | `balanced` (#207) adds `BALANCED_FILL_M` 6,000 m per unit of block fill and `BALANCED_QUEUED_M` 60 m per queued ASC job to distance; needed to spread the yard at scale |
| `yardAllocation` | `grouped` | `nearest-wtp`, `random` | `grouped` cut rehandles in busy fixtures (landside-morning-peak 17 to 0, rob-bays 48 to 11) at the cost of longer ASC gantry travel (some fixtures 3 to 7 % slower); `nearest-wtp` for a pure cycle-time comparison |
| `rehandleTarget` | `nearest-valid` | `min-future-rehandles` | not measured at TTI scale |
| `ascDispatch` | `waterside-first` | `pre-retrieval`, `balanced` | `pre-retrieval` fetches an import box before its truck (within 150 s) |
| `transferStallSelection` | `nearest-to-box` (TTI: `spread-drops`) | `least-loaded-block` | `spread-drops`: drop-only truck takes the stall of lowest road distance + `SPREAD_FILL_M` 6,000 m per unit of fill + `SPREAD_TRUCK_M` 60 m per truck; without it the 0.25 peak day deadlocks |
| `stsGroundPosition` | `lowest-free-lane` | `highest-free-lane` | ground waits 0 % at 0.5 |
| `emptyAllocation` | `iso-type-best-position` | `nearest-wtp`, `oldest-first` | not a throughput limit today |

### Preset and config knobs

| Knob | Where | Value | Notes |
|---|---|---|---|
| `TTI_MOVES_SCALE` | `scenario/presets.ts` | 1 | scales moves per call; every step needed fixes (0.05, 0.1, 0.25, 0.5, 1) |
| `TTI_YARD_RESERVE` / `yard.reserveShare` | presets, `.yardReserve()` | 0.1 | share of stacks kept free; 0 deadlocks at scale |
| `TTI_LOAD_RELEASE_AHEAD` / `yard.loadReleaseAhead` | presets | 4 | load boxes per crane staged on pads early; smaller shortens pre-job pad waits, moves the log |
| `quay.stsMinSpacingM` | `DEFAULT_QUAY` | 27 m | the rail conflict distance |
| `quay.mooringS` / `unmooringS` | presets | 1800 / 1200 s | dead quay time per call |
| `quay.berthGapM` | `DEFAULT_QUAY` | 15 m | with quay length decides how many vessels berth at once |
| hatch timings | `HATCH_DEFAULTS`, `config.hatch` | above | `hatch.enabled: false` removes cover work |
| `vesselPlanning.ordering` | `engine/vesselOrdering.ts` | `pod-weight` | `as-today` rolls back; affects rehandles and stow order |
| equipment counts | presets | 8 STS, 23 SHC, 16 blocks x 2 ASC (`ascsPerBlock` 1 or 2) | more of a non-bottleneck adds nothing |
| yard pre-fill | `yardStart` | baseline 60 %, peak 75 % | higher fill means more buried retrievals |
| `queueAreas` | presets | 3 per STS, 3 per block | needed by `chained-nearest` and `predispatch` |

Full-size presets take minutes per run. For a quick loop set `TTI_MOVES_SCALE` to 0.1 locally (never commit it; the
reports did this) or use a fixture: `crane-split-4sts`, `two-vessels-compete-for-berth`, `shc-queue-chained`,
`shc-prepositioning`, `shc-paired-dual-cycle`, `yard-grouped`, `vessel-ordering-pod-weight`. Note that the 8-crane rail
losses do not appear at 0.1 (only 3 cranes work there), so a rail change needs a 0.5 or 1 measurement.

## How to compare two strategies

1. Run A and B with the same seed, saving events. `tt:run` takes `--strategy <point>=<name>` (repeatable) and
   `--ordering`:
   `pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:40000 --events /tmp/a.jsonl`
   `pnpm run tt:run --preset "TTI Algeciras, peak day" --until time:40000 --strategy shcDispatch=paired-dual-cycle --events /tmp/b.jsonl`
   Compare `Moves completed`, per-STS gross moves/h and rail wait, `Quay:` anchorage, `Horizontal:` per SHC, the
   `Headline KPIs:` block and `Invariants: ... 0 violations`.
2. Where crane time goes: `pnpm run tt:sts /tmp/a.jsonl --until 40000` (and the same for b).
3. First divergence: `pnpm run tt:diff /tmp/a.jsonl /tmp/b.jsonl` (or `tt:diff --fixture <f> --b-handlers <set>` for
   the handler sets in `cli/handlerSets.ts`).
4. Full profile (hourly moves per STS, ASC and SHC idle share per hour, STS breakdown, box waits per stage, top waits):
   `pnpm run tt:profile "<preset or fixture>" --until <s> [--json f]`. It has no `--strategy` flag: it runs the
   scenario's own config, so profile a variant with a local preset edit or a fixture.
5. Many fixture variants at once: `scripts/proof-runner.sh "--fixture shc-queue-chained" "--fixture shc-queue-chained --strategy shcDispatch=oldest-job"`.
6. Run every preset-sized job under `scripts/bg.sh run --heavy`.

Reading the output:

- The `STS0n waited N s for a free ground position` lines in `tt:run` add both ground waits and load-box waits
  (`StsGroundPositionWaitEnded` and `StsBoxWaitEnded` both feed `stsGroundPositionWaitS` in `engine/subsystems/quay.ts`).
  Use `tt:sts` buckets to separate `ground` from `box`.
- The per-STS `railWaitS` KPI (`rail wait` in `tt:run`) counts closed waits only; a crane still waiting at the stop shows 0.
- Gross moves/h in the headline includes mooring time; per-crane rates in `tt:sts` start at the crane's first package.
- Bounded runs (`--until time:`) cut open waits; compare runs over the same bound.

## Pitfalls

- **Throughput up, yard dead.** Any change that packs the yard faster or retrieves in a new order can hit
  `yard.no-progress` or `rehandle: full` later in the run (#203's shared-cell load order deadlocked B02 until #207's
  spread landed). Always run to completion, not only a bounded window, and check `0 violations`.
- **Invariants are the safety net.** A stale TOS reply (latency injected) or a new strategy can produce an illegal pad,
  stall or slot; invariants report it. Never weaken an invariant to make a strategy pass.
- **Every strategy change moves the event log.** New behaviour changes the hash and goldens: regenerate with
  `pnpm run tt:golden --update` only when intended, and plan a default flip that moves every golden as its own ticket.
- **Scale hides and reveals effects.** Fixes measured at 0.1 were often inert (#213, #229) and losses at 0.5 (rail,
  reposition) do not exist at 0.1.
- **Defaults differ from TTI presets.** The global defaults (`oldest-job`, `first-free`, `nearest-to-box`) are not what
  TTI runs; compare against the preset's strategies.
- **Rejected ideas** (measured in #176): a room filter on dual-transaction drops (deadlocks the gate), load prep during
  discharge, `releaseAhead` 6. Ground positions stay capped at 3 per crane by the hatch laydown check.
- **Open ideas, not built:** crane split keeping bays `stsMinSpacingM` apart per crane; berth overtaking or look-ahead;
  fetching load boxes or their blockers while the crane still discharges; leaving a bay gap at split boundaries; start
  the load-box horizontal stage at job creation (`ShcJob.readyAt`) so the KPI stops counting pre-job pad time.
- Proof commands for any change: [../../terminal-twin-AGENTS.md](../../terminal-twin-AGENTS.md) "How to prove a change works".

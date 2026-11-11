# CLI and tooling

Checked against ENGINE_VERSION 0.53.0.

Read this when you run or change a `pnpm run tt:*` command or a file in `cli/`, need a flag, an output format or an
exit code, or want to run heavy jobs (peak-day runs, the smoke suite) without colliding with other agents.
Which command proves which kind of change is the table "How to prove a change works" in
[terminal-twin-AGENTS.md](../terminal-twin-AGENTS.md); this file is the reference behind it.

## Overview

All `tt:*` scripts run TypeScript with `tsx` (no build). `cli/` is Node-only and type-checked by
`tsconfig.tools.json`, not the app tsconfig. Each command is an entry file (sets `process.exitCode`) over a logic
module that takes `argv` and a `print` callback, so tests call the logic directly (`tests/cli.test.ts`,
`tests/cli-kpi.test.ts`, `tests/cli-profile.test.ts`, `tests/benchmark.test.ts`).

| Script | Entry -> logic | What it does |
|---|---|---|
| `tt:run` | `cli/run.ts` -> `cli/runCli.ts#runCli` | Headless run of a fixture, preset, JSON config or snapshot |
| `tt:diff` | `cli/diff.ts` -> `cli/diffCli.ts#runDiffCli` | First diverging event between two logs or two runs |
| `tt:golden` | `cli/golden-cli.ts` -> `cli/golden.ts#runGoldenCli` | Check or rewrite fixture golden summaries |
| `tt:fixtures` | `cli/build-fixtures.ts` | Regenerate every fixture JSON from `definitions.ts` |
| `tt:sts` | `cli/sts.ts#runStsCli` | STS productivity buckets from a saved event log |
| `tt:profile` | `cli/profile.ts` -> `cli/profileCli.ts#runProfileCli` | Where a run's time goes (hourly moves, idle shares, box waits) |
| `tt:bench` | `cli/bench.ts` -> `cli/benchCli.ts#benchMain` (+ `cli/benchmark.ts`) | Engine speed benchmark against `perf/baseline.json` (local only) |
| `tt:assets` | `cli/assets/build.ts` | Regenerate GLB assets with Blender `bpy` |
| `tt:assets:check` | `cli/assets/check.ts` -> `cli/assets/budgetCheck.ts#runBudgetCli` | Asset budget check (CI) |
| `tt:assets:shots` | `cli/assets/screenshots.ts` | Screenshot every asset per LOD in the dev asset viewer |
| `tt:sounds`, `tt:sounds:check` | `cli/sounds/build.ts` (+ `cli/sounds/synth.ts`) | Write or check the synthesized WAV files (CI) |
| `tt:card` | `scripts/tt-home-card.mjs` | Regenerate the home card PNG |

Support files: `cli/handlerSets.ts` (named `--handlers` sets), `cli/snapshotFile.ts` (streamed JSON for huge
snapshots), `cli/assets/glb.ts` (GLB JSON-chunk reader for the budget check).

pnpm passes arguments after the script name straight through: `pnpm run tt:run --fixture x`. A literal `--` is handed
to the script; `tt:golden` strips leading `--`, the other parsers (`node:util` `parseArgs`, `strict: true`) treat it
as an error or positional, so do not add one.

## tt:run

`pnpm run tt:run (--fixture <id|file.json> | --preset <name> | --from-snapshot <file>) [options]`

Scenario source (exactly one):
- `--fixture <id>`: a key of `scenario/fixtures/index.ts#fixtures`, or a path ending in `.json` (a `ScenarioConfig`).
- `--preset <name>`: a key of `scenario/presets.ts#presets` (quote names with spaces: `--preset "TTI Algeciras, peak day"`).
- `--from-snapshot <file>`: resume a snapshot written by `--snapshot` (read with `readJsonFile`, restored with
  `adopt: true`). It takes scenario, seed, decisions, end conditions, subsystems, ordering and match-line from the
  snapshot: combining it with `--fixture/--preset/--seed/--async-mode/--strategy/--latency/--end/--match-line/
  --subsystem/--ordering` is a usage error. `--events` and `--log` then hold only the window's events.

| Flag | Values | Effect |
|---|---|---|
| `--seed <n>` | integer | override the scenario seed |
| `--until <cond>` | `end` (default), `time:<s>`, `moves:<n>`, `vessels:<n>`, `event:<Type>` | stop condition (`parseUntil`); `time:T` leaves `now = T` exactly |
| `--end <cond>` | `moves:<n>`, `vessels:<n>`, `time:<s>`; repeatable | replaces `config.endConditions`; the first met ends the run |
| `--handlers <name>` | `default`, `highest-free-lane`, `nearest-job`, `broken-first-lane` | handler set (`cli/handlerSets.ts`) |
| `--async-mode <m>` | `keep-running` (default), `pause` | decision async mode |
| `--strategy <dp>=<name>` | repeatable | built-in strategy per decision point (validated with `getStrategy`) |
| `--latency <dp>=<spec>` | repeatable | `none`, `fixed:<ms>`, `uniform:<min>-<max>`, `exp:<mean>`, then `,timeout:<pct>`, `,error:<pct>`, `,timeoutMs:<ms>` |
| `--match-line` | flag | `emptyAllocation.matchLine = true` |
| `--subsystem <name>=<mode>` | repeatable; quay, berth, yard, shc, asc, landside = real, instant, off | merged over `config.subsystems`; impossible combinations exit 2 |
| `--ordering <name>` | `pod-weight` (engine default), `as-today` | `vesselPlanning.ordering` |
| `--no-fail-fast` | flag | keep running after an invariant violation |
| `--out <file>` | path | `RunSummary` JSON (the golden format) |
| `--events <file>` | path | event log as JSON lines (only events of this run when resuming) |
| `--events-json`, `--events-csv` | path | full event log as one JSON array / CSV (`exportRun`) |
| `--kpi-json`, `--kpi-csv` | path | KPI report (summary, series, headline, highlights) / long-form KPI series CSV |
| `--snapshot <file>` | path | snapshot where the run stopped (`writeJsonFile`, streamed) |
| `--log <file>` | path | structured JSON-lines log (`t eventId seq subsystem level type subjects`, plus `causedBy payload` at debug) |
| `--log-level <spec>` | e.g. `sts=debug,vessel=warn,*=info` (default `*=info`) | levels off, error, warn, info, debug |
| `--help` | | print usage, exit 0 |

Decision points for `--strategy`/`--latency` are `DECISION_POINT_IDS`; strategy names per point are in
[decision-points.md](decision-points.md). Handler sets: `highest-free-lane` (stsGroundPosition), `nearest-job`
(shcDispatch `nearest-job` + wtpPadSelection `nearest-box`), `broken-first-lane` (always lane 1, even when occupied:
proves the invariant checker and the failure exit code).

Output (stdout): `Terminal Twin, <name> (seed N)`, `Started`, `Stopped: <reason> (<endReason>)`, `Async mode`,
`Sim time` (`hh:mm:ss.sss`, `day N` prefix past 24 h) with events, `Event-log hash`, `Moves completed`,
`Vessels done`, one line per STS (moves, cycles, twin-20, gross moves/h, rail wait) and per vessel, `Quay:`, then
when present `Hatch covers:`, `Horizontal:` (per-SHC jobs, distances, reservation wait, handovers, parking returns,
queue arrivals, state time; ground-position waits per STS), `Headline KPIs:`, `Landside:` (holding, appointments),
`TOS handlers:` (per decision point: strategy, calls, ok, fallbacks, timeouts, errors, late, sim and wall latency,
backlog, idle caused), `Invariants: N checks, M violations` and `First error:`. Tracer reference: 10 moves, 104
events, hash `0d6ce70bd9bf84`, `82 checks, 0 violations`.

Exit codes: 0 ok; 1 invariant violation or `firstError`; 2 usage error (message plus usage). Piping into `head` gives
a harmless EPIPE stack trace. Logs derive from committed events only; `ScenarioEnded` and `InvariantViolated` are
committed directly (not queued, not invariant-checked).

Window reproduction: run to `--until time:T --snapshot s.json`, then `--from-snapshot s.json --until time:T2 --events
w.jsonl --log w.log.jsonl --log-level debug`. Events at `t <= T` are in the snapshot; the window holds `t > T` and
equals that slice of the uninterrupted run. Handlers are not in snapshots: pass the same `--handlers`.

## tt:diff

```
pnpm run tt:diff <a.jsonl|a.json> <b.jsonl|b.json> [--context n]
pnpm run tt:diff (--fixture <id|file.json> | --preset <name>) [--seed n] [--a-seed n] [--b-seed n]
                 [--handlers h] [--a-handlers h] [--b-handlers h] [--until cond] [--context n]
```

Two files: `.jsonl` event logs (from `tt:run --events`), a JSON array, or snapshot files (their embedded log). Two
runs: side B defaults to side A's settings; both run with `invariants.failFast: false`. `--context` (default 3) events
around the divergence. Uses `engine/runDiff.ts#diffEventLogs`.

Output: `A: <label> (N events)`, `B: ...`, then `No divergence: N events identical` (exit 0) or `First divergence at
seq N (after M identical events)`, `Differing fields: ...`, common context, `A > <event>` and `B > <event>` with the
following context (exit 1). Usage errors exit 2. To find the first effect of a code change: write `--events` before
and after, then diff the two files.

## tt:golden

`pnpm run tt:golden [--update] [--fixture <id>] [--dir <folder>]`. Runs each fixture to its end with default handlers
and compares `summarizeRun` with `<dir>/<id>.golden.json` (default `scenario/fixtures/`). Prints `<id>: match`, or
`<id>: DRIFT` with `path: golden X → actual Y` per field and hints (`tt:diff` recipe, how to accept), or `missing`.
`--update` writes `created`/`updated`. Exit 0 all match (or updated), 1 drift or missing, 2 usage or unknown fixture.
`tests/golden.test.ts` runs the same check in `pnpm test`; `UPDATE_GOLDEN=1 pnpm test` updates. Golden format and
rules: [scenarios-and-persistence.md](scenarios-and-persistence.md#golden-summaries).

## tt:fixtures

`pnpm run tt:fixtures`: no flags. Writes `scenario/fixtures/<id>.json` for every entry of `fixtureDefinitions`
(pretty JSON plus newline) and prints `wrote <file>` per file. It does not touch goldens or `index.ts`. After a
definition change: `tt:fixtures`, then `tt:golden --update`, then review both diffs.

## tt:sts

`pnpm run tt:sts <events.jsonl> [--until <seconds>]`. Reads a JSON-lines event log and prints
`engine/stsProductivity.ts#formatStsProductivity`: per crane and overall, moves, gross moves per hour and the share of
crane time in `cycle`, `hatch`, `lashing`, `ground`, `box`, `rail`, `reposition`, `done`, from each crane's first
work package to `--until` (default the last event time). No file: usage, exit 2; bad `--until`: exit 2; else 0.
Typical input: `tt:run --preset "TTI Algeciras, peak day" --until time:7200 --events /tmp/peak.jsonl` (minutes; run it
under the heavy lock). Interpretation of the buckets: [kpis-and-reports.md](kpis-and-reports.md).

## tt:profile

`pnpm run tt:profile <preset|fixture> --until <seconds> [--json <file>]`. One positional name (presets checked
first, then fixtures); `--until` is required and positive. Runs with default handlers to `--until` or the scenario
end. Prints: `Moves per clock hour` (one row per STS plus `ALL`), `ASC idle share` (100 minus `asc.utilisation-pct`
per hour and run), `SHC idle share` (`shc.idle-pct`), `STS time breakdown` (same as `tt:sts`), `Box waits` (mean
seconds per box for each path in `BOX_WAIT_PATHS` and stage in `BOX_WAIT_STAGES`: yard, horizontal, sts) and
`Top waits` (longest first, `open` if still waiting). `--json` writes `ProfileReport`
(`format: 'terminal-twin-profile'`). Exit 0 ok, 1 engine error (`First error:` printed), 2 usage.
This is the first tool for terminal throughput work ([optimising/terminal-throughput.md](optimising/terminal-throughput.md)).

## tt:bench

`pnpm run tt:bench [--preset <name>] [--hours <n>] [--sweep-every <n>] [--slow-ms <ms>] [--update-baseline] [--out <file>]`.
Defaults: preset `TTI Algeciras baseline`, 24 sim hours (run hour by hour, stops early on end, failure or idle).
`--sweep-every` sets `invariants.sweepEvery` (default `DEFAULT_SWEEP_EVERY` 1000; 0 = invariants off). `--slow-ms`
busy-waits per event (self-test: the regression flag must trip). Reports events, wall ms, events/s, wall ms per sim
hour, peak RSS MB, invariant time (total and per event), incremental checks and sweeps, status, first error and the
machine (node, CPU, load). Compares `eventsPerSec`, `wallMsPerSimHour`, `peakMemoryMb` with
`perf/baseline.json` key `<preset>|<hours>h`: worse by more than `REGRESSION_THRESHOLD` (0.2) flags REGRESSION.
`--update-baseline` rewrites that key. `--out` writes `{ report, comparison }`. Exit 0 ok, 1 regression, failure or
violation, 2 usage. Local only: CI timing is too noisy, and timings only compare on a like machine.
See [optimising/run-speed.md](optimising/run-speed.md).

## Asset and sound commands

Details of the generators, budgets and sidecars: [assets-pipeline.md](assets-pipeline.md).

- `tt:assets [--check] [--only <group>]... [--no-previews] [--samples <n>] [--python <exe>] [--help]`: runs
  `assets/generators/build.py` under Blender's Python into a temp staging folder (it writes `vessel-classes.json` from
  `VESSEL_CLASSES` and the bay-grid constants first, so hulls follow the engine's grid), compresses each GLB with
  gltf-transform (dedup, prune, meshopt), then replaces `assets/models/<group>/` and runs the budget check. Groups:
  containers, shc, asc, sts, trucks, vessels, infrastructure (default all). `--samples` = Cycles preview samples
  (48). Python: `--python`, else `$TT_BPY_PYTHON`, else python3.13, python3, python (`py -3.13` on Windows).
  `--check` regenerates and compares byte for byte without writing: `Regenerated assets are identical to the committed
  ones` (exit 0) or a list of differing files (exit 1). Errors exit 1. Needs `bpy`.
- `tt:assets:check [--dir <models dir>] [--budgets <budgets.json>] [--help]`: reads every GLB JSON chunk (no decoder,
  no Blender) and its `.meta.json`; prints `ok`/`FAIL` per asset with triangles and draw calls per LOD, the library
  size against `libraryMaxBytes`, problems, then `Budgets: pass` or `Budgets: FAIL (N problems)`. Exit 0, 1 over
  budget, 2 usage. Also a Vitest suite (`tests/asset-budgets.test.ts`) and a PR CI step.
- `tt:assets:shots [--base <url>] [--out <dir>] [--no-yard]`: starts Vite on a free port unless `--base`, opens
  `/sim/terminal-twin?viewer=yard`, and through `window.__ttAssets` screenshots each asset at LOD0, LOD1, LOD2 (when
  present) into `.screenshots/assets/` (git-ignored) plus `yard.png` (18,000 instanced boxes). Exit 1 on page errors.
- `tt:sounds` writes the 8 WAVs of `cli/sounds/synth.ts#SYNTHS` (gantry-alarm, motor-whine, twistlock, landing-thud,
  reverse-beeper, truck-engine, air-brake, harbour-ambience; 16-bit mono PCM at `SAMPLE_RATE` 22050, no randomness)
  to `assets/sounds/`. `tt:sounds:check` (`--check`) regenerates in memory: `Sounds are up to date.` (exit 0) or the
  drifted files (exit 1). Also `tests/sound-synth.test.ts` and a CI step. Add a sound: one more `SYNTHS` entry.
- `tt:card`: drives `scripts/screenshot.mjs` at 1200x630: loads `TTI Algeciras baseline` (seed 7, 10:00 start), runs
  `TT_CARD_HOURS` (default 1) sim hours, hides the UI, `cameraTo('STS104', 380)`, writes
  `src/sims/terminal-twin/assets/home-card.png` (committed). Re-run when visuals change.

## Repo scripts relevant to the sim

| Script | Use |
|---|---|
| `scripts/bg.sh run [--heavy] <log> <cmd...>` | start detached, print the pid; the log ends with `EXIT <code>`. `--heavy` takes one machine-wide lock (flock on `<git common dir>/bg-heavy.lock`, holder in `bg-heavy.holder`; the kernel frees it if the job dies; a waiting job logs `bg: waiting for heavy lock held by ...`). Use it for peak-day runs, `tt:profile` on presets, `tt:bench` and the smoke suite. The child sees `BG_HEAVY_HELD=1` |
| `scripts/bg.sh wait <log> [seconds]` | block until the `EXIT` line (default 600 s); exits with that code, or 124 if still running (wait again). Prints minutes left of a `scripts/timebox.sh` budget |
| `scripts/bg.sh tail <log>` | last 5 lines |
| `scripts/proof-runner.sh [--jobs N] [--out DIR] "<tt:run args>"...` | several `tt:run` variants in parallel (default `nproc` jobs) under the same heavy lock (skipped when `BG_HEAVY_HELD=1`), one log per variant in DIR (default a temp dir), then one table: variant, exit, wall_s, moves (from `Moves completed:`), violations (from `Invariants:`). Exit 0 only if every variant exits 0. Variants split on spaces, so no quoted names with spaces inside a variant. `PROOF_RUN_CMD` replaces `pnpm run tt:run` (tests: `scripts/test-proof-runner.sh`) |
| `pnpm run screenshot --path /sim/terminal-twin [--wait ms] [--wait-for sel] [--eval js] [--out f] [--width --height] [--full-page] [--fail-on-error] [--base url]` | headless Chromium (software WebGL: no real frame rate), Vite dev server on a free port so `window.__tt` exists; default output `.screenshots/<route-slug>.png`; `--eval` is awaited before the extra wait (default 5000 ms); `--fail-on-error` exits 1 on console errors or page errors. Chromium falls back to `CHROMIUM_PATH` or `/opt/pw-browsers/chromium` |
| `scripts/check-engine-version.sh [base]` | fails if `ENGINE_VERSION` on HEAD is lower than on base (default `HEAD^1`); run after resolving a merge |
| `pnpm run test:related [--allow-empty] [base]` | only the Vitest suites that import changed files |
| `scripts/smoke-specs-for.sh [base head]` + `scripts/smoke-map.txt` | smoke specs a diff needs (path pattern => spec names); `merge-ticket.sh` runs only those. Add a map line when a new area gets its own spec |
| `pnpm run test:smoke` | Playwright, `src/**/*.smoke.ts`; `dev` project (Vite dev server) and `prod` project (`*.prod.smoke.ts`, production build); free ports unless `SMOKE_DEV_PORT`/`SMOKE_PROD_PORT`; `@load` specs need a real frame rate and never run in CI |

Browser-side recipes (`window.__tt` calls inside `--eval`) are in [browser-host.md](browser-host.md#the-window__tt-dev-api).

## Gotchas

- `tt:run` without `--until` runs to the end; on a preset that is minutes of wall time at `TTI_MOVES_SCALE` 1
  (about 222 s for the baseline, 554 s for the peak day). Use `--until time:<s>` for quick checks and the heavy lock for full runs.
- `--seed` on a fixture changes the event-log hash: compare against the golden only at the fixture's own seed.
- `--events` writes only events of this invocation (relevant after `--from-snapshot`); `--events-json`/`--events-csv`
  write the whole log including the snapshot's past.
- `tt:diff` on two runs ignores invariant failures (`failFast: false`), so a diverging run can still be broken; check
  it with `tt:run`.
- The CLI never edits a golden unless `--update` is passed. `tt:fixtures` never edits goldens.
- Snapshot files of big runs exceed one JS string; always go through `cli/snapshotFile.ts`, never `JSON.parse(readFileSync(...))`.

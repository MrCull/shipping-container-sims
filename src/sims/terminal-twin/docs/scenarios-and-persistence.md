# Scenarios and persistence

Checked against ENGINE_VERSION 0.53.0.

Read this when you add or change a preset, a fixture or a golden, touch `ScenarioConfig`, layout derivation or
scenario validation, or change saves, snapshots, replay-based restore or rewind. Terms: [GLOSSARY.md](../../../../GLOSSARY.md).
Commands to prove a change: "How to prove a change works" in [terminal-twin-AGENTS.md](../terminal-twin-AGENTS.md).

## Where things live

```
scenario/
  types.ts          ScenarioConfig (SCENARIO_SCHEMA_VERSION 1, SI units) and every sub-config type
  builder.ts        ScenarioBuilder (fluent), [A] defaults (DEFAULT_QUAY, DEFAULT_*_KINEMATICS, DEFAULT_HOURLY_PROFILE,
                    DEFAULT_GATE, BLOCK_PITCH_M), withShcFleet, withYard, makeVesselCall
  presets.ts        presets registry (3 presets) + TTI_MOVES_SCALE, TTI_LOAD_RELEASE_AHEAD, TTI_YARD_RESERVE
  layout.ts         deriveBlockXs, deriveSts, stsIdFor, relayoutBlocks (pure)
  overrides.ts      ScenarioOverrides (setup-dialog edits), applyOverrides, validateOverrides
  compose.ts        composeScenario: base + edits, shared by dialog preview and store start
  validate.ts       validateScenario, assertValidScenario, ScenarioValidationError, validateSubsystemModes
  limits.ts         SCALE_LIMITS, STRESS_SCALE, BLOCK_FRONTAGE_M
  vesselGenerator.ts generateVessels, DEFAULT_CALL_MOVES, TTI_FLOW_MIX
  robBays.ts, bayPlan.ts, exportYard.ts, containerFactory.ts, containerProps.ts, dwell.ts, ...  (see state-model.md, quay.md)
  fixtures/         definitions.ts (source) -> <id>.json (generated) + <id>.golden.json; index.ts (fixtures map)
terminals/
  types.ts          TerminalProfile, TerminalPresetInfo, TerminalScenery, SceneryContext
  index.ts          TERMINALS registry, terminalForScenario, terminalPresetInfo, DEFAULT_SCENARIO_NAME
  tti-algeciras/    constants.ts (no THREE: engine and CLI import it), scenery.ts (TTI_SCENERY), index.ts (TTI_ALGECIRAS)
persistence/
  saves.ts          pure: SaveFile envelope, parseSaveFile, migrations, planLoad, names
  saveStore.ts      IndexedDB list (db `terminal-twin`, stores `meta` and `files`)
cli/snapshotFile.ts streamed JSON read/write for snapshots too big for one string (Node only)
```

The engine imports `scenario/` (types, bay plan, fixtures for tests); `scenario/` deep-imports a few leaf engine files
(barrel cycle exception, see [architecture.md](architecture.md)).

## ScenarioConfig shape

`scenario/types.ts#ScenarioConfig`. Everything is SI (m, s, t, m/s). `display` is ignored by the engine.

| Field | Meaning (defaults from `scenario/builder.ts` unless noted) |
|---|---|
| `schemaVersion` | `SCENARIO_SCHEMA_VERSION` = 1; migrated by `persistence/saves.ts#migrateScenarioConfig` |
| `name`, `description`, `seed` | `name` is the technical id (fixture id or preset name); it goes into the event log and goldens, never shown in UI |
| `startDateTime` | ISO time of sim t = 0. Builder default `2026-01-05T06:00:00Z`; presets `08:00Z`. Changes only the clock, not the run |
| `quay` | `DEFAULT_QUAY`: lengthM 400, berthGapM 15, mooringS 1800, unmooringS 1200, stsMinSpacingM 27, twinLift true |
| `layout` | `DEFAULT_LAYOUT`: stsGroundLaneZ0M 8, stsGroundLaneSpacingM 3, stsSafeHoistM 50, `stsGroundRetryS` (30) |
| `kinematics` | `{ sts, shc?, asc? }`: `DEFAULT_STS_KINEMATICS`, `DEFAULT_SHC_KINEMATICS`, `DEFAULT_ASC_KINEMATICS` |
| `moveVariationPct`, `driverVariabilityPct?` | +/- % random variation per STS move / per SHC trip |
| `sts[]` | `{ id, gantryX, groundPositions }` in rail order |
| `vessels[]` | the vessel table (`VesselConfig`: id, sizeClass, arrivalS, discharge, load, transshipment, maxSts, empties, ...) |
| `cargo` | lines weights, sizeMix, emptyShare, `reeferShare` (drawn by id hash, not an RNG stream) |
| `endConditions` | `{ vesselsCompleted?, simDurationS?, moves? }`; first met ends the run; none set = all scheduled vessels |
| `shcs?`, `yard?` | SHC fleet; blocks (+ `ascsPerBlock` 1 or 2, `reserveShare` 0 to `MAX_YARD_RESERVE` 0.5, `loadReleaseAhead` 0 to `MAX_LOAD_RELEASE_AHEAD` 20) |
| `yardStart?` | `{ mode: 'prefilled' \| 'warmup' \| 'empty', targetPct (60), warmUpS (48 h), mix? }`; absent = legacy start (`scenario/exportYard.ts#planExportYard`) |
| `apron?`, `queueAreas?` | lane-graph geometry overrides; SHC queue areas (see [subsystems/horizontal.md](subsystems/horizontal.md)) |
| `subsystems?` | `real \| instant \| off` per quay, berth, yard, shc, asc, landside |
| `decisions?` | async mode, strategy, latency per decision point ([decision-points.md](decision-points.md)) |
| `transshipment?`, `emptyPool?`, `emptyAllocation?` | dwell distribution (`DEFAULT_TRANSSHIPMENT`: lognormal median 2 days, sigma 0.6), starting empties, `matchLine` |
| `containerProps?` | port rotation, direction mix, weights, weight classes, expected dwell |
| `robBayFraction?`, `robFill?` (0.7), `arrivalFill?` | ROB bays and arrival stow (`scenario/robBays.ts`; see [subsystems/quay.md](subsystems/quay.md)) |
| `workPackages?`, `vesselPlanning?` | `releaseAhead`; `ordering` (`pod-weight` default, or `as-today`), `stowSequence` (`tier`) |
| `hatch?` | `{ enabled (true), lashingReleaseS, lashingSecureS, cycleS, laydownStackLimit }` overriding `VESSEL_CLASSES[...].hatch` |
| `kpi?` | `{ startTimeOfDayS?, shiftStartHour? }`; KPI bucket clock ([kpis-and-reports.md](kpis-and-reports.md)) |
| `landside?` | trucks, gate, stalls, appointments, holding, accessRoad, teardropLoop ([subsystems/landside.md](subsystems/landside.md)) |
| `display?` | `{ locale, units }` written by the browser (`i18n/display.ts#runConfigFor`) |

Builder methods (`ScenarioBuilder`): `seed startAt clockStart quay layout stsKinematics moveVariation sts vesselCall
vessels cargo transshipmentDwell emptyPool emptyAllocation containerProps robBays arrivalFill decisions shcs block
ascsPerBlock loadReleaseAhead yardReserve ascKinematics queueAreas apron driverVariability hatch vesselPlanning
subsystems landside yardStart endWhen build`. A new config field needs: the type, a builder method, a default that
leaves every existing log unchanged (so goldens hold), and a validation rule if a value can be impossible.

## Presets

`scenario/presets.ts#presets` (name to builder function). All go through one private `terminal(spec)` helper, so they
share: moveVariation 10, driverVariability 10, `startAt 2026-01-05T08:00Z` (daylight; fixtures keep 06:00 so goldens
do not move) and `clockStart(8 h)`, quay mooring 1800 s / unmooring 1200 s, queue areas `{ stsCapacity: 3,
blockCapacity: 3 }` [unverified], decisions `shcDispatch=chained-nearest`, `wtpPadSelection=balanced`,
`transferStallSelection=spread-drops`, 2 ASCs per block, gate with OOG lane, `endWhen({ vesselsCompleted: all })`,
`arrivalFill(NORMAL_ARRIVAL_FILL = 0.7)`, hatch covers on (class defaults). STS positions come from `deriveSts`,
block X from `deriveBlockXs`.

| Preset | Key values |
|---|---|
| `TTI Algeciras baseline` (`TTI_PRESET_NAME`), seed 2026 | 850 m, STS101 to STS108, 16 blocks (`TTI_BLOCKS`) x 2 ASC x 8 rows x 45 bays (`TTI_BAYS`) x 5 tiers, 23 SHC, gate 3 in / 3 out + OOG; 4 vessels every 3 h +/- 900 s (size mix ulcv 2, neo-panamax 3, panamax 3, feedermax 2; `TTI_FLOW_MIX` 8/7/85); yard prefilled 60 % with mix import 25 / export 10 / transshipment 65; empty pool 1,200 (max age 7 days); truck scale 1; TTI access road; reefers `TTI_REEFERS` (8 %, rows 1 and 2 powered); load release-ahead 4; yard reserve 0.1 |
| `Small automated` (`SMALL_PRESET_NAME`), seed 7 | 400 m, 3 STS (STS01..), 6 blocks x 30 bays x 4 tiers, 8 SHC, gate 2/2; 3 vessels every 4 h, moves scale 0.1, flow 30/30/40; prefilled 60 % (all imports); truck scale 0.4. The start screen lists it first |
| `TTI Algeciras, peak day` (`PEAK_DAY_PRESET_NAME`), seed 99 | TTI layout; 5 vessels within about 40 min (interval 600 s, jitter 300 s), `PEAK_DAY_FLOW_MIX` 6/5/89; prefilled 75 % mix 15/8/77; trucks x3; appointments `windowS 1800`, bunching x1.5 over 0 to 7200 s; holding 6 positions; `PEAK_DAY_ROTATION` (CNSHA SGSIN ESALG MAPTM ESVLC FRFOS ITGOA, terminal ESALG); `PEAK_DAY_ROB` 30 % of bays, 70 % full; empty pool 1,500; release-ahead 4; reserve 0.1. Every peak-day number is marked unverified |

Preset constants (`scenario/presets.ts` and `terminals/tti-algeciras/constants.ts`, the latter re-exported from presets):

| Constant | Value | Why |
|---|---|---|
| `TTI_MOVES_SCALE` | 1 | Multiplier on `DEFAULT_CALL_MOVES` (feeder 150/150, feedermax 300/250, panamax 600/500, neo-panamax 1200/1000, ulcv 1800/1600 discharge/load), each call drawn at 80 to 120 %. Was 0.05, 0.1 (#165), 0.25, 0.5 (#188); 1 since #222 (spec #220). Needs the reserve, `balanced` pads and `spread-drops` below |
| `TTI_YARD_RESERVE` | 0.1 | #188: share of every block's stacks (pairs of bays) kept free of prefill and discharge, so a dig always finds room for blockers [assumed] |
| `TTI_LOAD_RELEASE_AHEAD` | 4 | #186: load boxes per crane staged on WTP pads ahead of their ground positions [assumed; tune with `tt:profile`] |
| `TTI_YARD_TEU` 28647, `TTI_BLOCKS` 16, `TTI_ROWS` 8, `TTI_TIERS` 5 | | published capacity and layout |
| `TTI_BAYS` | round(28647 / (16 x 8 x 5)) = 45 | [A] derived, not from a drawing; the setup dialog says so (`TerminalPresetInfo.derivedBays`, test id `tt-bays-assumption`) |
| `TTI_REEFERS` | `{ share: 0.08, poweredRows: [1, 2] }` | [A] unverified |
| `TTI_ACCESS_ROAD_Z`, `TTI_ACCESS_ROAD_RUNUP_M` (100) | | access road entry (#146) |

Measured at scale 1 (#222): the baseline completes in about 222 s and the peak day in about 554 s of wall time with 0
violations. Full measurements: [reports/realistic-volume-reports.md](reports/realistic-volume-reports.md) and
[reports/throughput-and-speed-report.md](reports/throughput-and-speed-report.md). The TTI presets use `nearest-box`
then (since 0.43.0) `balanced` pad selection instead of `first-free`, which sent every box to B01 first; `padOptions`
in `engine/subsystems/shc.ts` reports a block with no room (free cells minus boxes waiting on its pads minus
`BLOCK_FREE_RESERVE` 10 %) as claimed, so a full block is not sent more discharge boxes (that deadlocked the quay).
The setup dialog's "Generate vessels" defaults to moves scale 1; a new row discharges its class's typical call.

Presets have no golden. Cover them with `tests/presets.test.ts` (shortened to 200 moves, `invariants.sweepEvery` 500)
and `tests/rob-bays.test.ts`; smoke `tests/browser/terminal-twin-presets.smoke.ts`. Full-length preset runs take
minutes: run them under `scripts/bg.sh run --heavy` ([cli-and-tooling.md](cli-and-tooling.md)).

## Terminal folders

`terminals/` holds what is specific to a real terminal; generic code asks the registry, never compares preset names.

- `terminals/index.ts#TERMINALS` = `[TTI_ALGECIRAS]`. `terminalForScenario(name)` returns the profile whose `presets`
  map owns that name (null for fixtures, custom configs and `Small automated`); `terminalPresetInfo(name)` returns its
  `TerminalPresetInfo` (`copy` catalogue keys `preset.<x>.name|tagline|description|watch`, `derivedBays`).
- `DEFAULT_SCENARIO_NAME` = `TTI_PRESET_NAME`: what a fresh start screen selects (#156).
- `TerminalScenery` (`kind`, `parts`, `modelParts`, `modelClipX`, `fogFarM`, `defaultCameraOffset`, `build(ctx)`)
  draws the distant scenery; a scenario no terminal claims gets the generic coastline. Details in [rendering-3d.md](rendering-3d.md).
- `constants.ts` must stay free of THREE (the engine and CLI import it). It also holds scenery figures (`TTI_GROUND`,
  `ROCK`, `SURROUNDINGS`, `TTI_ROAD_NORTH_END_X`, `TTI_SEA_CHANNEL_Y`, `NORTH_QUAY_LENGTH_M`); `SURROUNDINGS` repeats
  `groups['tti-surroundings']` in `assets/budgets.json` ([assets-pipeline.md](assets-pipeline.md)).
- Add a terminal: folder `terminals/<id>/` with an `index.ts` exporting a `TerminalProfile`, then list it in `TERMINALS`.

## Layout derivation

`scenario/layout.ts`, pure. Presets and the setup dialog derive positions from counts; fixtures keep hand-placed layouts.

- `deriveBlockXs(quayM, n)`: block centres evenly spaced and centred on the quay at pitch
  `max(BLOCK_FRONTAGE_M 32, min(BLOCK_PITCH_M 40, quayM / n))`, rounded to 0.1 m.
- `deriveSts(config, n, lengthM)`: crane i at `(i + 0.5) x lengthM / n`, keeping the first crane's ground positions
  (default 3) and numbering (`stsIdFor`: `STS101`.. when the first id is >= 100, else `STS01`..).
- `relayoutBlocks(config)`: a copy with block X re-derived from quay length and block count.
- `applyOverrides` re-spreads the STS when the count changes, a crane falls off the quay, or (`derive`) the quay length
  changed. `composeScenario(base, edits)` applies overrides, then the SHC fleet (`withShcFleet`), then yard
  (`withYard`), then `relayoutBlocks` if `overrides.derive`, then end conditions. The dialog previews and validates its
  result and `store.startScenario` runs the same result, so what is previewed is what runs.
- `ScenarioOverrides`: `quayLengthM stsCount vessels dwellMedianS emptyPool stsKinematics moveVariationPct
  driverVariabilityPct peakTrucksPerHour gate decisions subsystems derive`. An edited vessel table resets
  `endConditions.vesselsCompleted` to the new vessel count.
- Plan preview: `modules/planModel.ts#planOf(config)` (pure, from `blockSpecs` and the lane and landside graphs), drawn by
  `components/setup/PlanPreview.vue`; `tests/plan-preview.test.ts` compares it with `SceneModel`.
- Cycle readouts in the dialog: `engine/cycleTime.ts` (`stsNominalCycle`, `shcNominalCycle`, `ascNominalCycle`,
  `stsCycleGeometry`). The STS readout ignores gantry moves, so it reads a few % low; `tests/cycle-readout.test.ts`
  keeps it within 15 % of the measured mean.
- A scenario with SHCs and hatch covers needs the laydown to fit between the ground lanes and the landside STS rail, so
  at most 3 ground positions per STS (`createInitialState` throws otherwise; `hatch.enabled: false` lifts it).

## Validation

`scenario/validate.ts#validateScenario(config, overrides?)` returns `{ errors, warnings }` as `CheckMessage`
(`{ key: MessageKey, params? }`, rendered with `t()`). It runs `validateOverrides` (`scenario/overrides.ts`) first.

| Check | Key | Engine refuses? |
|---|---|---|
| quay length 100 to 3000 m (`SCALE_LIMITS.quayLengthM`) | `setup.check.quayLength` | yes |
| STS count 1 to 24, integer | `setup.check.stsCount` | yes |
| quay / STS < `stsMinSpacingM` | `setup.check.stsSpacing` | no |
| no vessels; more than 60 | `setup.check.noVessels`; `setup.check.tooManyVessels` | no; yes |
| duplicate id, negative counts, transshipment-in > discharge, bad arrival, maxSts < 1 | `duplicateId counts tsIn arrival maxSts` | no |
| boxes > `cellCapacity(spec)` (hull profile) | `setup.check.capacity` | no |
| blocks > 40; blocks x 32 m > quay | `setup.check.blocks`; `setup.check.frontage` | yes |
| per block: bays 1 to 80, tiers 1 to 6, pads 1 to 5, stalls 0 to 5 (25.4 m ASC span at 5.5 m pitch) | `setup.check.block` | yes |
| powered row outside 1 to `BLOCK_ROWS`; reefers with no powered rows | `poweredRows`; `reeferNoPower`, `reeferShare` | no |
| yard reserve outside 0 to 0.5; release-ahead not integer 0 to 20 | `yardReserve`; `loadReleaseAhead` | yes |
| SHC > 120; peak trucks/h > 600 | `shcCount`; `trucks` | yes |
| `empty` or `warmup` start without landside | `setup.check.startNeedsLandside` | yes |
| instant quay with no STS, instant yard with no blocks, yard off with asc/landside on | `modeNoSts modeNoBlocks modeYardOff` | yes |
| container props, ROB (`validateRob`), ordering, stowSequence | `setup.check.containerProps` | no |
| dwell median <= 0; empty pool count < 0 | `setup.check.dwell`; `setup.check.pool` | no |
| warnings: vessel LOA > quay (`tooLong`), block X off quay (`blockOffQuay`), above `STRESS_SCALE` (sts 12, blocks 24, bays 60, shc 40, vessels 20, trucks/h 250) (`heavy`) | | never |

`createSimulation` calls `assertValidScenario`, which throws `ScenarioValidationError` only for `ENGINE_ERROR_KEYS`
(the "yes" rows). The browser (`store.launch`) throws for any error, and the dialog disables Start while any error
shows. A new `setup.check.*` key also needs an entry in `modules/setupTabs.ts#CHECK_KEY_TABS`
(`tests/setup-tabs.test.ts` fails otherwise). The CLI runs `validateSubsystemModes` on `--subsystem` (usage error, exit 2).

## Fixtures

Source of truth: `scenario/fixtures/definitions.ts`. Each entry is a `FixtureDefinition` (`group`, `name`, `summary`,
`description`, `watch`, `build`), so a fixture cannot exist without its start-screen copy. Exports:
`fixtureDefinitions` (id to builder, for the CLI and tests), `fixtureCopy` (id to copy), `FIXTURE_GROUPS` (headings:
flows, quay, shuttle, yard, gate). `pnpm run tt:fixtures` (`cli/build-fixtures.ts`) writes every `<id>.json`;
`scenario/fixtures/index.ts#fixtures` imports them (add the import by hand for a new one). `tests/tracer.test.ts`
fails if any committed JSON differs from its builder.

Hatch covers are on by default; all fixtures turn them off except `hatch-cover-cycle`, `hatch-deck-only-no-open`,
`rob-bays` and `vessel-ordering-pod-weight` (the comment at the top of `definitions.ts` names only the two `hatch-*`).
Fixtures without SHCs give each crane enough ground positions for all its boxes, since nothing clears them.

| Fixture | Group | Purpose |
|---|---|---|
| `tracer-1sts-10-boxes` | flows | 1 STS discharges 10 x 40 ft to ground positions; seed 42. The smallest end-to-end run |
| `two-vessels-compete-for-berth` | quay | two Panamax on a 450 m quay; the second waits at anchorage |
| `crane-split-4sts` | quay | 4 STS on one call, rail order, crane split strategies |
| `twin-20-lift` | quay | twin-20 lifts (pairs of 20 ft in one cycle) |
| `shc-1sts-2shc-1wtp` | shuttle | 2 SHCs carry each box from the crane to a WTP pad |
| `shc-queue-chained` | shuttle | 4 SHCs, one pad, queue areas and chained nearest-job dispatch |
| `shc-prepositioning` | shuttle | SHC pre-dispatch on the predicted ready time |
| `shc-paired-dual-cycle` | shuttle | one crane discharges, one loads; SHCs pair the jobs |
| `asc-1sts-10-boxes-1block` | flows | 10 boxes through the full chain into a yard stack |
| `asc-2asc-block-conflict` | yard | 2 ASCs on one block wait and step aside |
| `load-1sts-10-boxes-1block` | flows | 10 exports from stack to vessel |
| `mixed-discharge-then-load` | flows | 8 discharge, 8 load, then departure |
| `transshipment-a-to-b` | flows | vessel A discharges 8, vessel B loads them after a 10 min yard stay |
| `empties-load-4-of-16` | yard | feeder loads 4 empty 40 ft MSC boxes picked from 16 |
| `empty-allocation-iso` | yard | 18 empties chosen by ISO type and best yard position |
| `stow-mixed-20-40` | quay | mixed sizes in hold and on deck; never a 20 on a 40 |
| `vessel-ordering-pod-weight` | quay | later ports and heavy boxes low in each stack (hatch covers on) |
| `yard-no-mixed-length` | yard | prefilled yard, no mixed lengths in a stack |
| `yard-grouped` | yard | grouped decking: imports by line, exports by ship and port, transshipment and empties apart |
| `reefer-powered-rows` | yard | a third reefers: powered rows only, at most 4 high |
| `rehandle-random-yard` | yard | random stacking buries exports; ASC moves blockers first |
| `dual-truck-transaction` | gate | one truck drops an export and picks an import |
| `truck-gate-queue` | gate | burst of 14 trucks fills the gate queue and stalls |
| `truck-appointment-windows` | gate | 30 min windows; a bunched window hits its cap |
| `truck-holding-overflow` | gate | 10 trucks at once: 2 in holding, the rest wait outside |
| `asc-pre-retrieval` | yard | box already at the stall when the truck arrives |
| `landside-morning-peak` | gate | random arrivals through a 4-lane gate to two paired-ASC blocks |
| `liveries-mixed` | yard | 12 boxes of mixed lines and sizes (livery check) |
| `hatch-cover-cycle` | quay | deck work, covers off, hold work, covers on, deck load in one bay |
| `hatch-deck-only-no-open` | quay | deck-only work, no cover ever lifted |
| `rob-bays` | quay | feeder keeps 3 of 7 bays as ROB (`robBays(0.43, 0.7)`), covers closed, landside exports |

Add a fixture: entry in `definitions.ts` (copy plus builder; technical id = config name), `pnpm run tt:fixtures`, add
the import to `index.ts`, `pnpm run tt:golden --update --fixture <id>` to create its golden, run `pnpm test`.

## Golden summaries

`scenario/fixtures/<id>.golden.json` is `engine/summary.ts#RunSummary` of a full default run
(`createSimulation(config)` with the fixture seed and default handlers, `runUntil()` to the end):
`{ scenario, seed, status, endReason, eventLogHash, kpis: KpiReport, invariants: { enabled, checks, violations, first },
firstError }`. `cli/golden.ts#checkGolden` compares field by field (`jsonDifferences`) and prints
`path: golden X → actual Y` per field; a file is written only with `update: true` (`pnpm run tt:golden --update` or
`UPDATE_GOLDEN=1 pnpm test`). `tests/golden.test.ts` runs every fixture. Any change to event order, timing, an RNG
draw or a KPI field moves goldens. Rules: regenerate only for an intended, explained change; two branches that both
regenerate conflict on merge, so regenerate on the merged tree; a change that moves every golden is its own ticket.
Bump `ENGINE_VERSION` (`engine/simulation.ts`) whenever engine behaviour changes (`scripts/check-engine-version.sh`
fails a merge that lowers it). Find the first divergence with `tt:diff` ([cli-and-tooling.md](cli-and-tooling.md)).

## Snapshots

`engine/simulation.ts#SimSnapshot`: `{ kind: 'terminal-twin-snapshot', schemaVersion: SNAPSHOT_SCHEMA_VERSION (1),
engineVersion, config, seed, status, firstError, invariants, state: SimState, log: EngineEvent[] }`.
`sim.snapshot()` is a `structuredClone` of all of it. `restoreSimulation(snapshot, handlers, options, { adopt? })`
creates the sim from the embedded config and seed (`skipPreRun`) and calls `sim.restore`, which throws
`SnapshotCompatError` unless `checkSnapshotCompat` passes (same `ENGINE_VERSION` and snapshot schema). `adopt: true`
takes the object without cloning (CLI, large snapshots). The KPI collector is rebuilt by replaying the log; handlers are
not stored (pass the same `--handlers` when resuming). Snapshots past a few sim hours of a big preset exceed the
512 MB V8 string limit, so the CLI writes and reads them with `cli/snapshotFile.ts#writeJsonFile` / `readJsonFile`
(walks containers to depth 4, flushes every 4 MB; still ordinary JSON).

## Saves (browser)

One JSON envelope (`persistence/saves.ts#SaveFile`), in IndexedDB and as a downloadable file:
`{ kind: 'terminal-twin-save', schemaVersion: SAVE_SCHEMA_VERSION (2), type: 'config' | 'snapshot', name, savedAt,
config, seed, snapshot?, simTimeS?, engineVersion? }`.

- `config` save: the SI config as run (with `display`, end conditions, decisions and latency, landside, start time)
  plus the seed. Small; rerunning reproduces the run. `snapshot` save: the full `SimSnapshot` (embeds its config).
- `parseSaveFile(text)` accepts the envelope, a bare engine snapshot, or a bare scenario config (`looksLikeConfig`);
  bad input throws `SaveFormatError(key)` with `saves.error.*` keys (`notJson`, `notASave`, `saveNewer`,
  `configNewer`, `configUnsupported`).
- Migrations: `SAVE_MIGRATIONS[n]` upgrades envelope v n to n+1 (v1 kept locale/units beside the config; v2 puts them
  in `config.display`). `CONFIG_MIGRATIONS` (scenario `schemaVersion`) is empty; `migrateScenarioConfig` rejects a
  newer version. Bump either version only with a migration step plus a fixture under `tests/fixtures/`
  (`make-save-v1.mjs`, `save-v1-config.json` show how).
- `planLoad(file)`: `config`, `snapshot`, or `snapshot-mismatch` (engine or snapshot schema version differs). On a
  mismatch the store sets `versionPrompt`; `SavesDialog` warns (`tt-version-warning`) and offers "Restart from its
  config" (`tt-version-restart`: t = 0 from the embedded config and seed). Nothing is replaced until the user picks.
- Names: `defaultSaveName(scenario, seed, elapsed?)` = plain name / seed N [/ elapsed]; `saveFileName` =
  `<slug>.tt-<type>.json`; `exportFileName(scenario, seed, suffix)` = `<slug>-seed<N>-<suffix>` for KPI and event-log
  downloads. All use `modules/scenarioPicker.ts#scenarioDisplayName`; technical ids never appear.
- `persistence/saveStore.ts#openSaveStore` (db `terminal-twin` v1, stores `meta` and `files`) rejects with
  `StorageUnavailableError` where IndexedDB is missing or refuses; the dialog then shows `tt-saves-storage-warning`,
  disables browser save buttons, and file export/import still works.
- UI: `components/modals/SavesDialog.vue` (top bar "Save / Load", `tt-saves-button`); store section "Saves and rewind".

## Replay-based restore and rewind

Both run in the worker host (`worker/engineHost.ts`) and rebuild the scene by replaying, because the `SceneModel`
needs every motion plan and custody change of the past (see [browser-host.md](browser-host.md)).

- Restore (`op: 'restore'`): start the snapshot's config and seed, `runUntilAsync({ maxEvents: snapshot.log.length })`,
  compare the hash with `snapshot.state.logHash`, then `sim.restore(snapshot)` for the exact state (now, queue,
  injected events) and re-seed the delta refs. `hashMatched` is false only when the original run had events a replay
  cannot make (injected ones); the state is still exact but the scene lacks their history. A load always starts
  paused at the snapshot's sim time, speed reset to x10.
- Checkpoints: the host's `observe` pushes `Checkpoint { t, events, hash }` each time an event crosses a multiple of
  the interval (`DEFAULT_CHECKPOINT_S` 900; the store's default `rewindIntervalMin` is 15). `setCheckpointInterval`
  applies from the next load, reset, restore or rewind, and is served before any scenario is loaded (empty `EngineInfo`).
- Rewind (`op: 'rewind'`): restart the loaded scenario and replay `events` events; later checkpoints rebuild
  identically. It keeps the current speed and drops events injected through the dev API.
- Tests: `tests/saves.test.ts` (formats, migration fixture, mismatch), `tests/persistence-host.test.ts` (checkpoints,
  rewind, restore over the worker protocol), `tests/persistence-controller.test.ts` (scene equality, storage
  resilience); smoke `tests/browser/terminal-twin-saves.smoke.ts` (reload round trip, file round trip in a fresh
  profile, mismatch, rewind, no IndexedDB).

## Gotchas

- Display names never reach the engine. Config `name`, the event log and goldens use the technical id.
- Presets build fresh every call (`presets[name]()`); `scenarioCatalogue` builds each preset to read its description.
- Do not hand-edit fixture JSON: edit `definitions.ts` and regenerate, or `tests/tracer.test.ts` fails.
- A new config field must default to "no change" or every golden moves; a new RNG draw must use its own stream for the
  same reason (see [engine-core.md](engine-core.md)).
- Snapshots from another `ENGINE_VERSION` never restore, by design: the restore path replays, and a different engine
  would replay differently.
- Fixed deadlock worth knowing when you change prefill presets: a 50 % prefilled `Small automated` once stalled with
  both ASCs idle beside open jobs (a dropped dispatch reply with no wake-up, and a blocker shuttling between two
  pending retrievals). Both are fixed in the ASC subsystem; `tests/presets.test.ts` guards it (50 % fill completes,
  rehandles per move < 3). Details in [subsystems/yard.md](subsystems/yard.md).

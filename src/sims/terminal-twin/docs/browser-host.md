# Browser host

Checked against ENGINE_VERSION 0.53.0.

Read this when you change the engine Web Worker or its protocol, playback and time controls, `SceneModel`, the Pinia
store, any component or composable, the dashboard, debugger, inspector, picking, overlays, bay viewer, Colour by,
vessel status UI, locale/units/message catalogue, shortcuts and keyboard camera, the `window.__tt` dev API, or the skin
and start screen. 3D drawing itself (renderer, instancing, rigs, quality, lighting, sound) is in [rendering-3d.md](rendering-3d.md).
Terms: [GLOSSARY.md](../../../../GLOSSARY.md). Proof commands: [terminal-twin-AGENTS.md](../terminal-twin-AGENTS.md), "How to prove a change works".

## Architecture

```
main thread                                                     worker
TerminalTwin.vue ── useTwinScene (rAF loop) ── TwinController ── EngineClient ──postMessage──> engine.worker.ts
     │                 tick → store.sync → view.update/render     │   (rid)                     └ createEngineHost()
     ├ store/twinStore.ts (Pinia facade, small reactive state)     └ SceneModel (timelines)          └ engine public API
     ├ components/ (TopBar, panels, dialogs, dashboard)  <── Delta + EngineInfo per reply ──────────┘
     └ dev/devApi.ts (window.__tt, DEV only)
```

- The worker drives the engine only through the public API (`createSimulation`, `runUntilAsync`, `step`, `query`,
  `inject`, `snapshot`, `restore`, `why`). The main thread never imports engine runtime code except types and pure
  helpers through `engine/index.ts`.
- Three.js objects never enter Vue reactivity (`markRaw` or module scope). Large collections live in
  `shallowRef(markRaw(...))` plus one `triggerRef`. The controller, view and scene model are raw objects reached through
  `store.controller()` / `store.view()`.
- The shared `src/composables/useThreeScene.ts` is too limited (far plane 1000, no OrbitControls, deprecated
  `THREE.Clock`), hence `composables/useTwinScene.ts`.

## Web Worker and protocol

Files: `worker/engine.worker.ts` (entry), `worker/engineHost.ts#createEngineHost` (serves requests),
`worker/protocol.ts` (types, internal, not a public seam), `modules/engineClient.ts#EngineClient` (promise wrapper).

- Build rules: `vite.config.ts` sets `worker.format = 'es'`; the worker must not import `three` (same ESLint bans as
  `engine/`); it is created as `new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' })`
  with the URL literal in that same expression (Vite needs it to bundle the worker).
- The entry serialises requests on one promise chain (a request may await async decision handlers). Each request
  carries `rid`; each reply is `{ rid, ok: true, result, delta, info }` or `{ rid, ok: false, error }`.

Requests (`WorkerRequest`):

| op | Effect | Delta |
|---|---|---|
| `load { config, seed }` | `createSimulation`, subscribe `observe`, clear checkpoints | initial |
| `reset` | restart the loaded config and seed | initial |
| `advance { to }` | `runUntilAsync({ time: to, predicate: stopAtBreakpoint })`: playback look-ahead | full |
| `run { condition }` | flat out to `WorkerRunCondition` (`RunCondition` minus predicate) | compacted |
| `step` | one event (`sim.step()`), breakpoint checked | full |
| `query { kind, id? }` | read-only query (below) | none |
| `inject { type, at, subjects, payload }` | `sim.inject`: a new root event | as processed |
| `snapshot` | `sim.snapshot()` | none |
| `restore { snapshot }` | replay `snapshot.log.length` events, then `sim.restore` ([scenarios-and-persistence.md](scenarios-and-persistence.md#replay-based-restore-and-rewind)); `ReplayResult { hashMatched }` | compacted |
| `rewind { events, hash }` | restart the loaded scenario, replay `events` events | compacted |
| `setCheckpointInterval { seconds }` | rewind point interval (default `DEFAULT_CHECKPOINT_S` 900); served before load | none |
| `why { eventId }` | cause chain, newest first, to the root | none |
| `export { kind }` | `exportRun`: KPI JSON/CSV or event log JSON/CSV as a string | none |
| `setBreakpoints { breakpoints }` | replace the list; kept across load/reset | none |

`QueryKind`: `container containers vessel vessels vesselSlots bayView vesselStatus sts stsList groundPosition shc
shcList shcJobs wtpPad asc ascList truck trucks hatch hatchList transferStalls yardBlocks yardSlots reservations kpis
kpiSeries kpiHeadline dashboard summary invariants eventLog checkpoints`. `kpiHeadline` = `{ headline, highlights }`;
`dashboard` = `DashboardData { series, timeline (buildTimeline), yard: {id, fillPct}[], landside | null }` in one trip;
`bayView` = `collectBayViewData`; `vesselStatus` = `collectVesselStatusInput`; `eventLog` = summaries.

`Delta` (built by `observe` per committed event, reset per request):
- `newContainers`: boxes created mid-run (a truck brings them), announced once with size, line, full, isoType, heavy,
  props, plus their first custody.
- `motion`: a new `MotionPlan` per STS, SHC, ASC and truck when the entity's `motion` array identity changes
  (`motionRefs`). Trucks are scanned only on `Truck*` and `AscJobAssigned` events.
- `custody`: `CustodyChange` per container whose last custody record is this event; ground positions carry `x`
  (payload x, else the crane's gantry X), STS twin lifts carry `dx` (+/- `HALF_OFFSET_M`).
- `hatch`: `HatchPanelChange` from `hatchChangeOf` (lashing released, lifted, in laydown, replaced, secured).
- `entities`: `EntityStateChange` on status change for sts, shc, asc, truck (with `loadSize`; `gone` on
  `TruckDeparted`) and vessel (with `berthX`, `firstMoveS`, a view field from `SimQuery.vesselFirstMoveS`).
- `reservations` (new ids only), `events` (`EventSummary`, capped at `EVENT_SUMMARY_CAP` 200), `eventCounts`,
  `breakpoint` (`BreakpointHit`).
- Compaction for `run`, `rewind`, `restore` (`compactDelta`): latest plan per entity plus the latest earlier segment of
  every axis that plan does not move (`compactMotion`), latest custody per box, latest hatch per panel, latest status
  per entity, only reservations still open.
- `EngineInfo`: `now` (engine horizon), `status` (`ready | ended | failed`), `endT`, `endReason`, `eventsTotal`,
  `movesCompleted`, `vesselsCompleted`, `eventLogHash`, `firstError`. Before any load the host replies `NO_INFO`.
- Cost: `observe` scans every STS, SHC and ASC, and every vessel (with a `vesselFirstMoveS` query) per event. That is
  the worker-side overhead on top of the engine in the browser ([optimising/frame-rate.md](optimising/frame-rate.md)).

## Playback and time controls

`modules/twinController.ts#TwinController` (non-reactive; the store mirrors a few fields once per frame in `sync`).

- `SPEEDS` = 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600 (x real time). `DEFAULT_SPEED` = 10: every run
  start (`load`, `reset`, `restore`) sets it (#157); a speed chosen mid-run survives pause, dialogs, the dashboard and
  a rewind. Smoke specs that need a speed after `__tt.load()`, Reset or a save load must set it afterwards
  (`tests/speed-reset.test.ts`).
- `tick(wallMs)` each frame: `displayTime += dt x speed`, clamped to `limit` = `info.endT ?? info.now` (never past the
  engine horizon or the end). While playing and no request in flight, if `info.now < displayTime + lookahead` it sends
  `advance { to: displayTime + lookahead }`, lookahead = `max(MIN_LOOKAHEAD_SIM_S 5, speed x LOOKAHEAD_WALL_S 1.5)`
  (90 sim minutes at x3600). While paused it does not run ahead, so the scene and dev-API queries describe the same
  instant. Then `model.prune(displayTime)`.
- Flat-out (`flatOut`, `busy` = true, rendering skipped): `runTo(time)` (top bar "Run to…", resumes at the current
  speed), `runToNextDeparture()` (`eventType: 'VesselDeparted'`, `tt-run-to-departure`), `runUntil(cond)` and `step()`
  (both pause, display jumps to engine time). `runTo` rejects a time not after the display.
- Generation guard: `restart` (load, reset, restore, rewind) bumps `generation`, builds a new `SceneModel`, sets
  display 0 and paused; replies of the old generation are dropped.
- After the end (`store.runEnded`: status not ready and display at `endT`): speed buttons, pause, Run to, Step and their
  shortcuts are no-ops; Reset and New Scenario work; scene, selection, inspector and feed stay usable.
- `runUntil({ time })` leaves `now = time`, so the horizon is exact; playing in slices gives the same hash as one run
  (`tests/live-driving.test.ts`). Large Run to… jumps at TTI scale still send one compacted delta per request.

## SceneModel

`modules/sceneModel.ts#SceneModel` (pure TS, no Three): the renderer's view, built from deltas. Axes: 1 unit = 1 m,
Y up, quay edge at Z = 0, sea at -Z, yard at +Z, X along the quay.

- Constructor rebuilds what the engine would know at t = 0 from the config and seed: bay plan (`planCargo`), prefill
  (`prefillOf`), lane and landside graphs, block specs, hatch panels, ROB boxes (`robBoxesOf`, the same pure
  `planCargo` the engine uses).
- `apply(delta)` appends per-axis motion segments, custody records, status records, reservations, hatch timeline and
  truck drives. `prune(t)` drops history older than the display time (display time never goes backwards except on a
  restart, which builds a new model); trucks gone before `t` are forgotten.
- Queries at any time up to the horizon: `stsPose shcPose ascPose truckPose hatchPanelPose containerPose custodyAt
  containerCentre entityCentre statusAt vesselPlacement vesselVisible vesselStatusTimes activeReservations
  colourSubjectAt nextTruckArrival truckPhase isGantrying isWorking isDriving isReversing shotsBetween`. A carried
  box follows its carrier's spreader.

## Store, components, composables

`store/twinStore.ts#useTwinStore` (about 1,250 lines, a known hub). State groups: run (`phase setup|running`, `choice`,
`config`, `info`, `displayTime`, `speed`, `paused`, `busy`, `error`), UI toggles (`overlays`, `overlaysVisible`,
`following`, `followNextPending`, `helpOpen`, `feedOpen`, `inspectorOpen`, `colourByOpen`, `runToOpen`, `toast`),
dashboard (`dashboardOpen/Tab/Data/Group/Bucketing/Rendered`), KPIs (`kpi`, `finalReport`, `reportOpen`), debugger
(`breakpoints`, `breakHit`, `inspectedEvent`, `entityView`, `selectedId`), bay viewer (`bayViewerVesselId`,
`bayViewerBay`, `bayViewData`, `bayPlan`), colour (`colourBy`, `robDisplay`), saves (`savesOpen`, `saves`, `storage`,
`versionPrompt`, `rewindPoints`, `rewindIntervalMin` 15), atmosphere (`lockDaylight`, `banner`, `sounds`,
`positional`). `cameraKeys` is deliberately not reactive.

- `startScenario(choice)` = `composeScenario(resolveScenario(name), choice)` then `runConfigFor` then `launch`, which
  validates (any error throws `ScenarioValidationError`), sets the checkpoint interval, loads, and resets run UI state
  (feed, KPIs, selection, bay viewer, `bayPlan = 'load'`, cues, `lockDaylight = true`).
- One `setInterval` at `KPI_POLL_MS` 1000: `kpiHeadline` when the event count changed, `dashboard` while open, and
  rewind points. When the run has ended it also fetches `kpis` and `kpiSeries` once and opens the dashboard on its
  report tab (once per run).
- Components: `TopBar.vue` (clock, speeds, Step, Run to…, Reset, New Scenario, Save/Load, Dashboard, `?`, settings
  region: Daylight, Sound, Quality, Stats, ROB display), `KpiStrip.vue`, `OverlayToggles.vue` (overlay toggles, view
  buttons, Follow next truck, `ColourByMenu.vue`), `debug/EventFeedPanel.vue`, `debug/InspectorPanel.vue`,
  `BayViewer.vue`, `FinalReport.vue`, `DashboardHost.vue` -> `DashboardTab.vue`, `DepartureBanner.vue`,
  `FpsChip.vue` (teleported into the shared header slot), `PerfPanel.vue`, `LocaleDateTimeInput.vue`,
  `modals/SetupDialog.vue`, `modals/SavesDialog.vue`, `modals/ShortcutHelp.vue`, `setup/*` (one section component per
  part plus `*Validation.ts`), `ui/TtIcon.vue`.
- Composables: `useTwinScene` (renderer, camera, OrbitControls min 8 m max 3500 m, the frame loop, pointer picking),
  `useTwinShortcuts` (window keydown/keyup to store actions), `useSetupDraft` (`provideSetupDraft`/`useSetupDraft`: the
  setup dialog's draft shared by its sections).
- Frame loop (`useTwinScene.loop`): `controller.tick` -> `store.sync` -> rebuild on a new model -> (skip if busy)
  overlays, `setColourBy`, `applyCameraKeys`, follow, lighting (per sim minute) -> `view.update(displayTime, ...)` ->
  positional sound -> render -> quality meter. `perf().stats.poseMs` and `cpuMs` are smoothed per-frame costs; `boxesPosed` and `instanceBytes` (#246) are the last frame's counts (boxes posed, container instance-buffer bytes handed to the GPU upload), also in the performance readout.

## Setup dialog and start screen

- Layout (#161): about 90vw (`width: min(90vw, 1440px, 100%)`), height capped to the sim area; only the tab body
  (`tt-setup-body`) scrolls. Tabs (`role=tab`, `tt-setup-tab-<scenario|vessels|yard|advanced>`, Left/Right arrows;
  panels `v-show` so drafts persist): Scenario (picker and detail), Vessels (`SetupVesselsSection`), Yard and equipment
  (layout, STS, landside, SHC, yard, modes), Advanced (`tt-advanced`: seed and start in `SetupSeedStart.vue`, end
  conditions, display, decisions in `DecisionSettings.vue`). Footer `tt-setup-footer`: plain name
  (`tt-setup-footer-name`, `data-scenario`), Cancel (with a scenario loaded), Start (`tt-setup-start-button`,
  `type=submit`, Enter submits). The hero (`assets/home-card.png`, `tt-setup-hero`) shows only above 820 px tall and
  760 px wide.
- Validation on tabs: `modules/setupTabs.ts` (`CHECK_KEY_TABS`, `tabOfCheckKey`, `setupIssues`, `tabsWithIssues`)
  puts every problem on the tab holding its field: live list `tt-setup-issues-<tab>`, tab marked (red, alert icon,
  `data-has-error`, aria-label "(needs fixing)"), footer `tt-setup-footer-fix`, engine start error `tt-setup-error`.
  The form is `novalidate`: Start opens the tab of the first input the browser rejects, else the first problem's tab.
- Picker (#145): `setup/ScenarioPicker.vue` with tabs Scenarios (presets, `Small automated` first) and Test benches
  (fixtures under `FIXTURE_GROUPS`), counts from data (`tt-count-scenarios`, `tt-count-benches`; tabs `tt-tab-*`).
  Rows (`role=radio`, Enter/Space/click) are `tt-preset-card` / `tt-fixture-row` with `data-scenario` = technical id.
  The tab opens on the selected kind; switching restores each tab's last choice. `setup/ScenarioDetail.vue` (right of
  the list, below under 760 px): kind, plain name, summary, `LayoutSketch.vue`, chips `tt-chip-*`, What it shows, What
  to watch for, Size of the run (`scenarioDurationS`), set-up facts `tt-summary-*`, the derived-bays note
  `tt-bays-assumption`. Model: `modules/scenarioPicker.ts` (`pickerModel`, `scenarioStats`, `statChips`,
  `layoutSketch`, `scenarioDurationS`, `presetCopy`, `scenarioDisplayName`, `pickerSectionOf`).
- Plain names only (#156): no technical id is visible text anywhere. Copy lives with the definition (fixtures:
  `fixtureCopy`; presets: `preset.<x>.*` keys via `TerminalPresetInfo.copy`). A fresh load selects
  `DEFAULT_SCENARIO_NAME` (TTI baseline) with its own seed and opens on Scenarios. Smoke specs that press Start on a
  fresh load and need a fixture call `pickScenario` first; `openSetupTab(scope, tab)` / `openAdvanced`
  (`tests/browser/scenarioPicker.ts`) before editing a field (fields in hidden tabs cannot be filled).
- Start = `store.startScenario({ name, seed, startDateTime, overrides, shc, yard, endConditions })`. Start date
  default Monday 08:00 of the current week, local (`modules/time.ts#defaultStartDate`). The End conditions fieldset
  (`modules/endConditions.ts`) replaces the scenario's own only once edited; vessels blank = all scheduled.

## Skin and landing page

- Tokens: `skin.css` (imported unscoped by `TerminalTwin.vue`) defines every colour, font, radius and shadow as
  `--tt-*` on `.terminal-twin` and `.tt-skin` (the FPS chip carries it in the shared header). Light frosted panels
  (`--tt-panel` + `--tt-blur`), navy text, TTI crane blue accent `--tt-accent`, `--tt-warn` and `--tt-danger` only for
  warnings and alerts, Inter (`--tt-font`, `--tt-font-mono`). Global `--color-*` tokens are remapped inside the scope,
  so other sims keep the dark look. `AudioControls.vue` (teleported to body) reads `--audio-popover-*`, set by
  `skin.css` on `body:has(.terminal-twin)`.
- Rules (`tests/skin.test.ts`): components never write hex or `rgb()`, a literal `font-family`, or a global
  `--color-*`/`--font-*` in styles; they use `--tt-*`. WCAG AA 4.5:1 for text, accent, warn, danger and success on the
  panel over black, white and sea-blue backdrops. `SURFACE` (dashboard palette) equals `--tt-chart-surface`;
  `DATA_PALETTE`/`RAMP_PALETTE` equal `--tt-data-N`/`--tt-ramp-N`. A new colour goes into `skin.css` first
  (decorative data colours as `--tt-data-*`/`--tt-plan-*`). No `--font-retro`; define sim-local tokens for mono,
  warning or spacing.
- Icons: `components/ui/TtIcon.vue` (outline SVG, `currentColor`); `::before` marks use `--tt-glyph-*` masks. No emoji
  or text glyphs in templates.

## HUD layout

`.scene` in `TerminalTwin.vue` is a grid (`auto | 1fr | auto` columns and rows, `flex: 1 1 0px`). Regions
(`modules/hudLayout.ts#HUD_REGIONS`, each root carries `data-hud-region`): `topBar`, `settings` (inside TopBar),
`kpiStrip` (centre top, wraps), `leftPanel` (events), `rightPanel` (inspector), `overlayBar` (centre bottom).
`overlappingRegions(__tt.hudLayout())` must be empty: `terminal-twin-hud.smoke.ts` checks every preset at 1280x720 and
1920x1080, panels open or closed. Add new HUD elements as a grid cell or inside a region, never `position: absolute`
over one. Active toggles show a check mark (state by shape, not colour alone). The bay viewer is a popup (top left
under the KPI strip), not a region.

## KPI strip, final report, dashboard

- KPI strip (`KpiStrip.vue`, `modules/kpiStrip.ts`): items moves, vessels, gross, net, shcBusy, shcEmpty, asc, yard,
  dwell; count-up (ease-out 600 ms, skipped with reduced motion), pulse on `crossedThreshold` ([A] thresholds).
  Fixed width: counts no decimals, rates and percentages exactly one (`Formatter.fixed`), tabular figures and a
  per-item `minWidthCh`. It shows the engine's state (up to the look-ahead ahead while playing).
- Final report (`FinalReport.vue`): docked panel when the display reaches the end; reason (`modules/endReason.ts`),
  highlights (`modules/highlights.ts`), headline, cranes, vessels, TOS handler table, export buttons (worker `export`,
  file names from `exportFileName`). Closable and reopenable. KPI content: [kpis-and-reports.md](kpis-and-reports.md).
- Dashboard (`B` or `tt-dashboard-button`; `DashboardTab.vue`): tabs Charts (group Quay, Horizontal transport, Yard,
  Landside, TOS handlers; hour or shift bucketing) and Final report (`FinalReport` with `embedded`). Landside appears
  only when its series exist (truck turnaround metrics plus a whole-run table, `buildLandsideSummary`). Reset and New
  Scenario close it; closing after the end docks the report.
- Lazy ECharts: `DashboardHost.vue` fetches the `DashboardTab` chunk via `modules/lazyComponent.ts#createLazyComponent`
  (`loading | ready | error`; error shows Retry and suggests a reload because Chromium caches a failed module fetch).
  `DashboardTab` dynamically imports `modules/chartLib.ts`, the only runtime importer of `echarts` (tree-shaken: line,
  heatmap, custom; grid, legend, tooltip, dataZoom, visualMap, aria; canvas). Never import either statically
  elsewhere: `tests/dashboard-lazy.test.ts` scans sources, `terminal-twin-dashboard.prod.smoke.ts` checks
  `chartLib-*.js` is its own chunk fetched on first open.
- Pure layers: `engine/kpi/timeline.ts#buildTimeline` (Gantt rows: anchorage, mooring, work, unmooring per vessel, one
  work package per crane-split assignment, open bars closed at now); `modules/dashboardModel.ts` (`KPI_GROUPS`,
  `groupsWithData`, `buildGroupCharts`, `downsampleEvery`, `POINT_BUDGET` 1500, `buildYardHeatmap`, `blockFillPct`);
  `modules/dashboardOptions.ts` (option builders, `import type` only from echarts, `ChartFormat` from `store.fmt`,
  `buildGanttModel`); `modules/dashboardPalette.ts`.
- Charts: one line per entity, at most `MAX_SERIES` 8 (rest counted "N more not shown"), `sampling: 'lttb'`, inside and
  slider zoom, an HTML "Table view" of run totals per chart. Heatmap: block x hour of `yard.fill-pct`, one-hue blue
  ramp 0 to 100 %, plus a live "now" fill per block. Gantt: custom series per phase with an HTML legend.
- Palette: `SERIES_COLOURS` are the dataviz skill's light categorical steps validated on `#fcfcfb`
  (`validate_palette.js --mode light`: worst adjacent CVD dE 9.1); do not reorder or recolour without re-running it.
  Gantt phases use the first five slots. Never colour alone: `SERIES_SYMBOLS`, `SERIES_DASHES`, legends, Gantt
  textures (`PHASE_PATTERNS`), heatmap values printed. Charts are `role="img"` with `aria-label`.
- Catalogue: all `dashboard.*` keys; a KPI title is `dashboard.kpi.<id>` (`kpiLabelKey`). A new `KPI_DEFS` row fails
  `tests/dashboard-model.test.ts` until it is in a `KPI_GROUPS` group with a title.

## Debugger, feed, inspector, picking

- Panels: `E` toggles the left `EventFeedPanel` (Step, Continue, breakpoints, filter, feed), `I` the right
  `InspectorPanel`. Both start collapsed, overlay the canvas, and open on a click or a breakpoint hit.
- Breakpoints (`modules/breakpoints.ts`): kinds `eventType`, `container` (in `subjects.containers`), `equipment` (in
  `subjects.equipment`), `decision` (`DecisionRequested/Resolved/Failed` of that point). The list goes to the worker,
  where `firstBreakpointHit` is the stop predicate of every advance, run and step, so the engine stops right after the
  hit and `Delta.breakpoint` names it. The controller keeps it as `pendingBreak` until the display reaches its time,
  then pauses with `breakHit`; the store opens the inspector on it. `play()`, a speed button, Run to… and Step clear
  it. A breakpoint catches only events not yet processed (the engine may be up to the look-ahead ahead).
- Step (`.` or `tt-topbar-step`): one engine event per press at any speed; pauses. After a pause the engine may be
  ahead, so the display jumps to the stepped event's time. Pause first (Space or 0) to step event by event.
- Feed (`modules/eventFeed.ts`): store buffer `FEED_BUFFER_CAP` 1000 summaries; rows rebuilt every `FEED_REFRESH_MS`
  250 (never per frame), only events up to the display time, newest first, at most `FEED_MAX_ROWS` 150. From
  `FEED_SUMMARY_MIN_SPEED` x60 while playing, runs of `FEED_BURST_MIN_RUN` 3 same-type events collapse into "N x Type".
  Filter: space-separated terms that must all occur in the type or a subject id.
- Event inspector (`modules/eventInspector.ts#describeEvent`): payload (motion segments summarised), clickable subjects,
  decision handler, outcome, request and reply, and `tt-event-locations` (slots in maritime notation) under the raw
  JSON. Cause chain via `op: 'why'`, newest first, ending at `ScenarioStarted` or an injected root; clicking an entry
  keeps the chain.
- Entity inspector (`modules/entityInspector.ts#describeEntity`): container, or an equipment kind of
  `modules/equipmentKinds/` (sts, shc, asc, truck, vessel, hatch; each `EquipmentKindDef` has `describe`, optional
  `loadExtras` for `shcJobs`/`vesselStatus`, `bounds`, `sceneState`, `createRenderer`). Refreshed every 500 ms while
  open. Shows the engine's state (ahead of the display while playing). Container custody history is the engine's full
  history ("Held by" in maritime notation via `store.locations`, `modules/locationNotation.ts`); equipment "history"
  is recent feed events naming the id. SHCs show "Operational state" first.
- Picking (`modules/picking.ts`): `entityBounds(model, id, t)` gives each entity an oriented box (also the selection
  outline, margin `SELECT_MARGIN_M` 0.6); `pickEntity` returns the nearest container hit, else the nearest equipment or
  vessel. Boxes are generous (cranes and hulls enclose what is under them); containers always win, so a carrier is
  picked by its frame. A click is under 5 px and 600 ms; dragging orbits; clicking nothing deselects. Clicking a vessel
  also opens the bay viewer.
- Follow (`F` or the inspector button): the loop re-aims the orbit target at the selection each frame, keeping the
  offset; it releases when the entity leaves (a truck still to arrive keeps the camera still). Follow next truck (`N`,
  `tt-follow-next-truck`, `store.followNextTruck`): earliest known arrival at or after the display time
  (`SceneModel.nextTruckArrival`); pending (`followNextPending`) until `sync` resolves it; no landside = a toast.
- Overlays (`modules/overlays.ts`, `OverlayToggles.vue`; drawn by `modules/overlayLayers.ts` from the scene model at
  display time): `laneGraph`, `reservations`, `occupancy` (WTP pads and ground positions free/occupied), `labels`
  (status labels above STS, SHC, ASC and vessels, decluttered by `modules/labelDeclutter.ts`: world size 36 x 8 m,
  priority selected then registry order), `ascRail` (ASC rail segments reserved or held, per ASC). `O` is the master
  switch. `scene().layers` reports counts.
- View presets (`modules/viewPresets.ts#viewPresetPose`): quay, yard, gate (null without landside), overview; region
  centre as target, distance fitted to the aspect (FOV 45). `Q Y G V`, `tt-view-<preset>`, `__tt.viewPreset`; all
  release follow.

## Bay viewer

`components/BayViewer.vue` (popup, not modal, not a HUD region). Opens on a vessel click in 3D or `tt-open-bay-viewer`
in the vessel inspector; X or Esc closes; a new scenario closes it. Text: `bayViewer.*` keys.

- Data: worker query `bayView` -> `BayViewData` (`modules/bayViewData.ts#collectBayViewData`: slots, the box in or
  booked to each, work packages, ROB boxes, ports, `now`). `store.refreshBayView` runs every 1000 ms while open (skips
  if one is in flight) and passes the reply through `modules/bayViewScene.ts#bayViewDataAt(data, model, displayTime)`
  (#159): each box takes its custody at the display time from the scene model, and ROB boxes come from the scene
  model, so bay view and 3D vessel always show the same boxes; box properties for time-based colours stay at engine
  time. `tests/bay-view-3d-match.test.ts` proves it on the TTI baseline at five display times.
- View model (`modules/bayView.ts#buildBayView(data, bay, { colourMode, locate, plan, robDisplay })`, pure): deck and
  hold of one bay, strip, counts, packages, legend, prev/next. Exports `slotStatus`, `bayOrder`, `stepBay`, `stripOf`,
  `defaultBay`, `planStatuses`. Cell status: `planned-discharge`, `planned-load`, `in-progress` (box on an STS
  spreader), `done` (a discharged slot finds its box as the first owner in custody history), `rob`, `empty`. Cells
  outside the hull profile are `absent` (`tt-bay-absent`), so the hold reads as a V.
- Load plan | Discharge plan (#162, `tt-bay-plan`, `tt-bay-plan-load|discharge`): `load` shows non-discharge slots,
  `discharge` discharge slots; the other move's slots read `empty`; ROB shows in both. `store.bayPlan` is `load` on
  every run start and kept across vessels.
- Paired panels (#127): the component draws `view.panels`: `fore` (even-1, left) and `aft` (even+1, right) odd bays
  around a 40 ft bay. A 40 is the fore cell plus an aft `continuation` (hatched, "40′ ▸"). Selectors
  `tt-bay-panel-fore|aft`, `data-continuation`, `data-rob`; exclude `[data-continuation]` when counting.
- Axes use maritime numbers (`vesselBayNumber`, `vesselRowNumber`, `vesselTierNumber`, port first); hover shows slot
  notation and POL, POD, ISO type, line, direction, weight, weight class. Strip lists bays bow first; it opens on the
  first bay with work (`defaultBay`). Packages show crane, state and done of planned (hatch steps have no count).
- Limits: cannot be moved; a snapshot from before spec #106 shows boxes without properties.

## Colour by and the ROB display

- `ColourByMenu.vue` (in the overlay bar): dropdown `tt-colour-by-select`, legend `tt-colour-by-legend`; closes on a pick
  and on a pointer-down outside. ROB display in the top bar: `tt-rob-display`, `tt-rob-show`, `tt-rob-grey` (default),
  `tt-rob-hide`. Both remembered in localStorage (`modules/colourBySettings.ts`, key `terminal-twin.colourBy`,
  `{ mode, robDisplay }`; old `hideRob: true` reads as hide; every access guarded). `sceneState().colour` reports them.
- `modules/colourBy.ts` (pure): modes `default` (line livery), `line pod weight iso length special flow dwell
  departure transit call`. `colourOf(mode, subject, t, ctx)` -> `{ key, hex }`; `legendOf` lists every key, including
  `other`/`unknown`/`none`, and ends with `rob`; `subjectOfBox` builds the subject counting custody up to `t`.
  `isTimeBased` = dwell, departure, transit. Dwell ramp `DWELL_PALETTE` (< 1 day, 1 to 3, 3 to 7, > 7); length from ISO
  code (22 = 20 ft, 42 = 40, 45 = 40 HC); `special` by ISO group [A] (R reefer, T tank, U/P out of gauge, none made).
  Palettes mirror skin tokens (`tests/colour-by.test.ts`). Labels: `modules/colourLabels.ts`.
- ROB (#159, #223): every ROB subject gets key `rob` and `ROB_HEX` (`--tt-data-rob`) in every mode. Show colours ROB
  boxes by the mode in 3D only; the bay viewer maps show to grey; Hide removes them in both (`vesselHulls[id].robBoxes`
  reads 0, `robHidden` true).
- 3D: `SceneRenderer.setColourBy(mode, robDisplay)` every frame (idempotent). Static modes are computed once per mode
  switch; time-based ones per box per `COLOUR_BUCKET_S` 30 sim seconds within `COLOUR_BUDGET_PER_FRAME` 4,000 boxes.
  A tinted box uses the generic livery tile with an instance colour; `sceneState().liveries[id].tint` (-1 = livery).
  ROB boxes: `modules/robBoxes.ts` (one InstancedMesh per vessel). Rendering detail: [rendering-3d.md](rendering-3d.md).
- Limit: 3D colour properties are those at planning time (a later-allocated empty keeps its storage direction in 3D,
  while the bay viewer uses live engine state); a trucked-in box is coloured from its scene entry on.

## Vessel status and countdown

View only: no event, state or golden change. `modules/vesselStatus.ts#buildVesselStatus(input, now)` turns a
`VesselStatusInput` (status, ETA = `arrivalS`, `berthAllocatedS`, `berthedS`, `departedS`, `firstMoveS`,
`quay.mooringS`, moves total/done, per STS) into a phase (`approaching waiting mooring berthed working unmooring
departed`; `berthed` = alongside, no move yet, "starting soon", no countdown), operations start (actual berth time, or
allocation + mooring flagged `opsStartEstimated`, null while waiting), `countdownS` (>= 0, null once working), moves
and a `label` (null from the first move). `formatCountdown` gives `mm:ss` or `h:mm:ss`.

- Adapters: `collectVesselStatusInput(q, config, id)` (worker query `vesselStatus`; moves from non-hatch work
  packages) feeds the inspector popup via the vessel kind's `loadExtras`; `vesselStatusInputFromModel(model, id, t)`
  (scene model, no moves) feeds the labels each frame. The popup builds the view with `store.displayTime`, so the
  countdown ticks between 500 ms refreshes. Test ids `tt-vessel-status` (`data-phase`), `tt-vessel-phase`,
  `tt-vessel-eta`, `tt-vessel-ops-start`, `tt-vessel-countdown`, `tt-vessel-moves`, `tt-vessel-sts-moves`.
- Floating label: `modules/vesselCountdownLabels.ts` (one sprite per vessel, skin colours, redrawn on text change)
  shows "V001 · Mooring · 24:52" while waiting or mooring, independent of the Labels overlay; `scene().vesselLabels`.

## Locale, units and the message catalogue

- Catalogue: every user-visible string in `.vue` files comes from `i18n/messages.ts` via `t(key, params)`
  (`{name}` placeholders; English only). `tests/message-catalogue.test.ts` parses every SFC and fails on hard-coded
  text. Add the key first. Ids, fixture names and engine values are data, not text.
- `DisplaySettings { locale, units }`: `store.display`, `store.fmt` (`i18n/format.ts#createFormatter`),
  `store.setDisplay`. Defaults from `navigator.languages` (US region imperial, else metric; bare `en` -> US), remembered
  under `terminal-twin.display`, written into `config.display` (`runConfigFor`, which also sets `kpi.startTimeOfDayS`
  from the local start so shifts match the clock). Changes apply live.
- Units are display only; engine, configs and snapshots stay SI. Use `fmt.length .speed` (km/h or mi/h, never "mph",
  which means crane moves per hour) `.mass .number .fixed .movesPerHour .teu .percent .seconds .duration .clock
  .dateTime .firstDayOfWeek .weekdayName`. Never `toFixed`/`toLocale*` in components. Node lacks
  `Intl.Locale#getWeekInfo`, so `format.ts` falls back to a region table; ICU differs (`de` "Mo" vs "Mo.").
- Date entry (`LocaleDateTimeInput.vue`, `i18n/dateInput.ts`): shows and parses the chosen locale's order, separators
  and 12/24 h; model stays a local ISO string; bad text emits `''` with `aria-invalid`. Never `datetime-local`.

## Keyboard shortcuts and keyboard camera

`modules/shortcuts.ts` (`shortcutFor`, `SHORTCUT_HELP`, rendered by `ShortcutHelp.vue`; add new keys there) ->
`composables/useTwinShortcuts.ts`. Space pause/resume (`preventDefault`), `0` pause, `.` step (repeat allowed), `F`
follow, `N` follow next truck, Esc, `B` dashboard, `O` overlays master, `E` feed, `I` inspector, `P` perf overlay, `Q Y
G V` views, `?` help. No key changes speed (digits 1 to 9 unbound since #138). Ignored with Ctrl/Meta/Alt, in typing
targets, on repeat (except `.`), and while the setup dialog is open (except Esc).

- Esc (#169): `modules/escape.ts#escapeTarget` closes one thing per press in this order: setup dialog (with a scenario
  loaded, not loading), saves, dashboard, Colour by, Run to, help, bay viewer, inspector, selection (`select(null)`,
  stops follow). Never pauses, steps or changes speed; ignored on repeat and in text fields except inside a popup.
  `AudioControls.vue` swallows the Esc it uses. `tests/escape-order.test.ts`.
- Camera keys (TT-R03): W/Up S/Down pan forward/back on the ground, A/Left D/Right pan sideways; with Shift A/D orbit
  and W/S tilt; `=`/`+` and `-` zoom. Held-key state in `store.cameraKeys` (keyup by camera key, cleared on blur).
  `useTwinScene.applyCameraKeys` steps the pose with `modules/cameraKeys.ts#stepCameraPose` (dt capped 0.1 s;
  `PAN_PER_SECOND` 0.8 x distance, `ORBIT_RATE` 1.2, `TILT_RATE` 0.9 rad/s, `ZOOM_RATE` 1.1). The first press releases
  follow. Do not mount the shared `useGodModeHotkey`: its `o`/`d` keys would toggle overlays and more.

## The window.__tt dev API

`dev/devApi.ts#installDevApi`, dynamically imported inside `if (import.meta.env.DEV)` by `TerminalTwin.vue` (absent
from production, checked by `terminal-twin.prod.smoke.ts`). All calls are safe from `page.evaluate`.

| Method | Returns / effect |
|---|---|
| `load(name?, { seed?, startDateTime?, autoplay?, overrides?, shc?, yard?, endConditions? })` | start a fixture or preset (default its own seed, paused); `EngineInfo` |
| `step()`, `runUntil(cond?)`, `runTo(t)` | engine step / flat-out run (pause) / Run to… |
| `query(kind, id?)`, `inject(type, at, subjects, payload)`, `snapshot()`, `why(eventId)` | worker passthroughs |
| `select(id \| null)`, `cameraTo(id, distanceM?)`, `viewPreset(name)`, `followNextTruck()` | selection and camera (`cameraTo` false for unknown ids and absent trucks; 60 m -> LOD0, 600 m -> LOD1) |
| `setSpeed(s)`, `pause()`, `play()`, `reset()`, `newScenario()`, `clock()` | playback; `clock` = `{ displayTime, speed, paused, busy, engine }` |
| `overlays(partial?)` | toggle overlays, returns state |
| `perf()`, `setQuality(setting)`, `perfOverlay(on)`, `setFrameLoad(ms)`, `drawBreakdown()`, `setAutoThresholds({down,up} \| null)` | quality and frame stats ([optimising/frame-rate.md](optimising/frame-rate.md)) |
| `scene()` | rendered counts, LOD splits, asset states, `layers`, `vesselLabels`, frames, render info |
| `sceneState()` | at display time: `containers` custody, `reservations`, `liveries`, `colour`, and per equipment kind its `sceneKey`/`rigKey` (`sts`/`stsRendered`, `shcs`/`shcRigs`, `ascs`/`ascRigs`, `trucks`/`truckRigs`, `vessels`/`vesselHulls`, `hatchPanels`/`hatchRigs`) |
| `display()`, `setDisplay(partial)`, `config()` | locale/units; loaded SI config with display |
| `ui()` | `{ selectedId, following, followNextPending, overlaysVisible, dashboardOpen, helpOpen, reportOpen, feedOpen, inspectorOpen, colourByOpen, runToOpen }` |
| `atmosphere()` | daylight lock, master gain, sounds played, positional voices, banner, scene lighting and backdrop |
| `dashboard()`, `openDashboard({ tab?, group?, bucketing? })` | `{ open, tab, group, bucketing, rendered }`; `rendered` = `{ chartLibLoaded, charts[], heatmap, gantt, landside }` |
| `exportRun(kind)`, `report()` | export text; `{ ended, open, headline, highlights, reportReady }` |
| `addBreakpoint(kind, value)`, `removeBreakpoint(id)`, `clearBreakpoints()`, `breakpoints()` | breakpoint list |
| `inspectEvent(id)`, `debug()` | inspector; `{ breakHit, paused, inspectedEvent { id, type, chain }, entity { kind, id, status } }` |
| `pickAt(clientX, clientY)`, `screenPoint(id)`, `cameraPose()`, `hudLayout()` | picking, orbit pose `{ target, distance, azimuth, polar }`, HUD boxes |
| `saves.fileText(type, name?)`, `saveToBrowser`, `list`, `load(id)`, `remove(id)`, `importText(text)`, `state()`, `rewindPoints()`, `rewindTo(i)`, `setRewindInterval(min)`, `restartFromEmbeddedConfig()` | saves and rewind |

The dev asset viewer (`?viewer=<asset>` or `?viewer=yard`) installs `window.__ttAssets` instead (`dev/assetViewerApi.ts`;
[assets-pipeline.md](assets-pipeline.md)).

## Gotchas

- The engine runs ahead of the display while playing: `query`, the inspector, the KPI strip and the feed buffer
  describe engine time. The bay viewer and 3D do not (scene model). Pause to make them agree.
- Injected events are extra roots: `why` ends at them, and a rewind drops them.
- Feed and inspector never show events after the display time, except the breakpoint hit (the display moves to it).
- Smoke: Playwright starts a Vite dev server and a production build on free ports; frame checks use
  `tests/browser/frameSampling.ts` ratios; specs import JSON `with { type: 'json' }`. Busy machines can fail frame
  checks: rerun on a quiet one.
- Hub debt: `twinStore.ts` is large; `devApi.ts` builds `sceneState` with a cast; `sceneModel.ts` still has a kind chain
  beside the equipment registry.

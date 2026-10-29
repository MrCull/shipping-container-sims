# Terminal Twin: browser host, dev API and debugger

The Web Worker host, the main-thread modules, locale and units, the `window.__tt` dev API and the debugger and inspection UI. Guide: [terminal-twin-AGENTS.md](../terminal-twin-AGENTS.md). Terms: [GLOSSARY.md](../../../../GLOSSARY.md).

## File map (i18n, components, modules, worker, dev)

```
├── i18n/                     UI text and display formatting (no Vue)
│   ├── messages.ts           Message catalogue (`t(key, params)`); ALL user-visible component strings
│   ├── format.ts             createFormatter({locale, units}): clock, numbers, length/speed/mass, week start (Intl)
│   └── display.ts            Browser defaults, remembered choice (localStorage), runConfigFor (config + display, SI)
├── TerminalTwin.vue          Root: TopBar, 3D host, SetupDialog, banner; installs window.__tt in DEV
├── components/               TopBar.vue (clock, speeds, Step, Run to…, Reset, New Scenario, ?), OverlayToggles.vue,
│                             debug/EventFeedPanel.vue (left: step/continue, breakpoints, filterable feed),
│                             debug/InspectorPanel.vue (right: event inspector + selection inspector),
│                             modals/SetupDialog.vue (scenario, seed, start, display, quay, STS, vessels, SHC fleet),
│                             modals/ShortcutHelp.vue, setup/VesselTable.vue (vessel table + "Generate N vessels")
├── composables/useTwinShortcuts.ts  Window keydown → store actions (table in modules/shortcuts.ts)
├── composables/useTwinScene.ts  Renderer/camera/OrbitControls + the frame loop (tick → sync → pose → render)
├── modules/                  Main-thread, non-reactive
│   ├── twinController.ts     Playback clock, look-ahead, Run to/runUntil/step, generation guard
│   ├── engineClient.ts       Promise wrapper over the worker (request ids)
│   ├── sceneModel.ts         Pure-TS timelines from worker deltas → poses/positions at any time
│   ├── sceneRenderer.ts      Three.js procedural quay, STS, SHCs, pads/blocks; vessels via VesselHulls; containers via
│   │                         ContainerInstancer (yaw per box); lane-graph + reservation overlays
│   ├── vesselRenderer.ts     VesselHulls: placeholder → class GLB LODs, line livery, name boards (TT-27)
│   ├── vesselAssets.ts       Loads hull GLBs + vessel livery atlas; vesselHull.ts = sidecar types and bay-grid mapping
│   ├── containerAssets.ts    Loads container GLBs (meshopt decoder from three), bakes LODs, livery shader patch
│   ├── containerInstancer.ts Instanced containers: placeholders → GLB LOD0/LOD1 per size, liveryIndex per instance
│   ├── breakpoints.ts        Breakpoint kinds + eventMatchesBreakpoint (also used inside the worker)
│   ├── eventFeed.ts          Feed rows: filter, display-time cut-off, burst summaries, caps
│   ├── eventInspector.ts     describeEvent: payload, subject links, decision request/reply
│   ├── entityInspector.ts    describeEntity: state, current job, custody history of a container/STS/SHC/ASC/vessel
│   ├── picking.ts            entityBounds + pickEntity (ray vs oriented boxes; also the selection outline)
│   ├── overlays.ts           OverlayState (laneGraph, reservations, occupancy, labels) + NO_OVERLAYS
│   ├── overlayLayers.ts      Three.js occupancy plates and state labels (read the SceneModel at display time)
│   ├── equipmentDims.ts      STS / SHC proportions shared by the renderer and picking
│   ├── shortcuts.ts          SHORTCUT_HELP table + shortcutFor(key event) (ignores typing targets)
│   └── time.ts               Start date default (Mon 08:00), datetime-local helpers
├── store/twinStore.ts        Pinia facade (small reactive UI state; controller/view kept raw)
├── worker/                   Engine Web Worker (same ESLint bans as engine/)
│   ├── engine.worker.ts      Entry; serialises requests
│   ├── engineHost.ts         Serves requests via the public engine API; builds compact Deltas
│   └── protocol.ts           Request/reply/Delta types (internal, not a public seam)
├── dev/devApi.ts             window.__tt (dev builds only)
├── dev/AssetViewer.vue       Dev asset viewer (?viewer=<asset>|yard); assetViewerScene.ts; assetViewerApi.ts (window.__ttAssets)
```

## Browser host (TT-02)

- **Threads.** The engine runs in a Web Worker (`worker/engine.worker.ts`), driven only through the public engine API (`runUntilAsync`, `step`, `query`, `inject`, …). The main thread renders and runs the UI. The worker answers each request with a **Delta**: new motion plans per STS (diffed by `StsState.motion` identity), custody changes (with the grounding X for ground positions), STS/vessel status changes, the last 200 summarised events, and per-type counts. It also sends `EngineInfo` (engine time, status, end time, moves, hash).
- **Playback clock** (`TwinController`). `displayTime` advances by wall time × speed. It is clamped to the **engine horizon** (`info.now`) and to the scenario end. While playing, the controller keeps the engine a look-ahead ahead (`max(5 s, 1.5 s × speed)`) with `advance` requests, so the motion segments for the displayed instant are already known. That keeps animation smooth up to ×600. **While paused it does not run ahead**, so the scene and dev-API queries describe the same instant.
- **Flat-out runs.** "Run to…", `__tt.runUntil` and `__tt.step` send `run`/`step`. Rendering is skipped while `busy`. The delta is compacted to the latest plan, custody and status per entity, and the display jumps to the target (Run to…) or to the engine time (runUntil/step, which also pause). The Run to… popover also has "Next vessel departure" (`TwinController.runToNextDeparture`, `store.runToNextDeparture`, `data-testid="tt-run-to-departure"`): flat out to the next `VesselDeparted` the engine has not yet processed (the engine may be a look-ahead ahead of the display), then playback resumes.
- **Scene model.** `SceneModel` keeps per-axis segment lists and custody/status timelines and prunes history older than the display time. `positionAt` interpolates the crane, and a carried box follows the spreader. Display time never goes backwards, except on reset/load, which build a new model; a generation counter drops replies that belong to the old scenario.
- **Rendering.** Containers are drawn by `ContainerInstancer`: procedural boxes until the GLBs load, then one `InstancedMesh` per size × LOD with a livery per instance (see [Phase 2 asset pipeline](assets-pipeline.md#phase-2-asset-pipeline)). STS, hulls and the quay are shared low-poly boxes. Three.js objects never enter Vue reactivity; the store mirrors only the clock, speed, engine info and selection.
- **Setup dialog.** It lists fixtures plus the `presets` registry, with an editable seed (re-roll) and start date/time (default Monday 08:00 of the current week, local time). Start = `store.startScenario({ name, seed, startDateTime })`. The start date changes only the clock, not the run.

- Browser: `runUntil({ time })` leaves `now = time`, so the engine horizon is exact. Playback in time slices gives the same hash as one run (`tests/live-driving.test.ts`).
- Browser: injected events are extra roots, so `why` on them (or their descendants) ends at the injected event, not at `ScenarioStarted`.
- Browser: deltas in a flat-out run are compacted per entity. Large Run to… jumps at TTI scale may still need a smarter "final state only" message (TT-19).
- Smoke tests: `playwright.config.ts` starts a Vite dev server (port 5199) and builds plus previews production (`.smoke-dist/`, port 5198) every run. Chromium falls back to `/opt/pw-browsers/chromium` like `npm run screenshot`.
- Three objects never go into Vue reactivity (`markRaw` or module scope), and large collections live in `shallowRef(markRaw(...))` plus one `triggerRef` per frame. The shared `src/composables/useThreeScene.ts` is too limited for the twin (far plane 1000, no OrbitControls, deprecated `THREE.Clock`), hence `composables/useTwinScene.ts`.
- Worker build: `vite.config.ts` sets `worker.format = 'es'`; the worker must not import `three`; create it as `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })` (the URL literal in the same expression); the worker entry carries `/// <reference lib="webworker" />`.
- Design tokens: the sim uses the `src/assets/main.css` tokens but must not use `--font-retro` (Press Start 2P); there are no mono, warning or spacing tokens, so define sim-local ones.
- Smoke specs import JSON with `with { type: 'json' }` (Playwright ESM); frame-count assertions (for example at least 10 frames/s) can fail when the machine is busy: rerun on a quiet machine.

### Locale, units, message catalogue, shortcuts (TT-20)

- **Message catalogue.** Every user-visible string in the sim's `.vue` files comes from `i18n/messages.ts` via `t('key', { param })`. `tests/message-catalogue.test.ts` parses every SFC (template text, `title`/`aria-label`/`placeholder`/`alt`/`label`, string literals in `<script>` and template expressions that read as UI text) and fails on hard-coded text. Add the key first, then use it. Ids, fixture names and engine values are data, not text.
- **Display settings** (`DisplaySettings {locale, units}`, type in `scenario/types.ts`): `store.display`, `store.fmt` (a `Formatter`), `store.setDisplay(partial)`. They default from `navigator.languages` on first open (US region → imperial, else metric; bare `en` → US), are remembered in `localStorage` (`terminal-twin.display`), and are written into the run's config as `config.display` (`store.config`, the SI config a save should store). Changing them applies live (the setup dialog's select/radios call `setDisplay` immediately; Cancel keeps them).
- **Units are display-only.** Engine, configs, snapshots stay SI. Format with `store.fmt.length(m)`, `.speed(m/s)` (km/h or **mi/h**; never "mph", which means crane moves per hour), `.mass(t)` (t or US tons), `.number(n, digits)`, `.movesPerHour`, `.teu`, `.clock(startIso, t)`, `.dateTime(date)`, `.firstDayOfWeek()`, `.weekdayName(d)`. Never format numbers or dates with `toFixed`/`toLocale*` in components.
- **Shortcuts** (`modules/shortcuts.ts` table → `composables/useTwinShortcuts.ts`): Space pause/resume, 1–9 = ×1…×600, 0 = pause, `.` single-step (`store.step()`, pauses), F follow selection (`store.following`; the scene loop re-aims the camera each frame), Esc closes help else deselects (stops following), D `store.toggleDashboard()` (the dashboard tab, TT-16), O `store.overlaysVisible` (master switch of the TT-18 overlays, plus a toast), E / I toggle the event feed and inspector panels (TT-18), `?` help overlay (`store.helpOpen`; also the top bar `?` button). Ignored with Ctrl/Meta/Alt, in inputs/selects/textareas/contenteditable, on key repeat (except `.`), and while the setup dialog is open. Space calls `preventDefault` so a focused button is not also clicked. The help overlay renders `SHORTCUT_HELP`, so add new shortcuts there.
- **God mode:** the shared `useGodModeHotkey` ("god" typed anywhere) is not mounted by Terminal Twin. Don't add it: its `o`/`d` keys would also toggle overlays and the dashboard.

- Locale: `<input type="datetime-local">` (setup start, Run to…) is rendered by the browser in the *browser's* locale, not the chosen one; the clock, preview and readouts follow the chosen locale.
- ICU differences: `de` weekday "Mo" vs "Mo." (match loosely in tests). Node 22 lacks `Intl.Locale#getWeekInfo`, so `i18n/format.ts` falls back to a region table.

### Dev API (`window.__tt`, dev builds only)

`dev/devApi.ts` is dynamically imported inside `if (import.meta.env.DEV)`, so production builds don't contain it (checked by `terminal-twin.prod.smoke.ts`). Every call is async-safe from `page.evaluate`:

```js
await __tt.load('tracer-1sts-10-boxes', { seed?, startDateTime?, autoplay?, overrides? })  // default: fixture's own seed, paused
await __tt.runUntil({ time?, eventType?, moves?, vesselsCompleted?, maxEvents? }) // no arg = to the end; pauses
await __tt.runTo(600); await __tt.step()
await __tt.query('summary' | 'kpis' | 'containers' | 'stsList' | 'vessels' | 'vesselSlots' | 'invariants' | 'eventLog')
await __tt.query('container' | 'vessel' | 'sts' | 'groundPosition', id)
await __tt.inject('VesselBerthed', 120, { vessels: ['V001'] }, { vesselId: 'V001', berthX: 50 })  // new root event
await __tt.snapshot(); await __tt.why(eventId)
__tt.select(id | null); __tt.cameraTo(id); __tt.setSpeed(600); __tt.pause(); __tt.play(); await __tt.reset(); __tt.newScenario()
await __tt.query('shc' | 'wtpPad', id); await __tt.query('shcList' | 'reservations')
__tt.overlays({ laneGraph?, reservations?, occupancy?, labels? })   // toggles 3D overlays, returns the state
await __tt.load('shc-1sts-2shc-1wtp', { shc: { count: 3, kinematics } })  // SHC fleet override, like the setup dialog
__tt.clock()       // { displayTime, speed, paused, busy, engine: EngineInfo }
__tt.scene()       // rendered { containers, sts, shcs, vessels, overlays, reservedZones, frames,
                   //   containerLods: { lod0, lod1 }, containerAssets: 'placeholder'|'loaded',
                   //   shcLods: { lod0, lod1, lod2 }, shcAssets: 'placeholder'|'loaded',
                   //   ascLods: { lod0, lod1, lod2 }, ascAssets: 'placeholder'|'loaded' }
__tt.sceneState()  // what the scene shows: custody per box, status + pose per STS and SHC, status per vessel,
                   //   active reservations, liveries: { [containerId]: { index (atlas tile), size, lod } } as drawn,
                   //   shcRigs: { [shcId]: { lod, steerRad, wheelRollRad, hoistM, carrying } } as drawn,
                   //   ascRigs: { [ascId]: { lod, gantryZ, trolleyX, hoistM, ropeScale, scaleY, carrying } } as drawn
__tt.cameraTo(id, distanceM?)  // aim at any entity the inspector shows (also a block, transfer stall, WTP pad, 'gate'; false only for unknown ids), optionally from a distance (60 → LOD0, 600 → LOD1)
__tt.display(); __tt.setDisplay({ locale: 'de-DE', units: 'imperial' })  // live locale/units
__tt.config()      // loaded scenario config (SI) + current display settings
__tt.ui()          // { selectedId, following, overlaysVisible, dashboardOpen, helpOpen, feedOpen, inspectorOpen }
__tt.dashboard()   // { open, tab, group, bucketing, rendered } (TT-16); await __tt.openDashboard({ tab, group, bucketing })
await __tt.addBreakpoint('eventType' | 'container' | 'equipment' | 'decision', value); await __tt.removeBreakpoint(id); await __tt.clearBreakpoints(); __tt.breakpoints()
await __tt.inspectEvent(eventId)   // opens the inspector on the event and its cause chain
__tt.debug()       // { breakHit, paused, inspectedEvent: { id, type, chain: [{id, type, causedBy}] }, entity: { kind, id, status } }
__tt.screenPoint(id); __tt.pickAt(clientX, clientY); __tt.cameraTarget()   // 3D picking and the follow camera, client coordinates
```

## Debugger and inspection UI (TT-18)

- **Panels.** `E` toggles the left panel (`EventFeedPanel`: Step, Continue, breakpoints, filter, event feed), `I` the right panel (`InspectorPanel`). Both start collapsed. Clicking something, or a breakpoint hit, opens the inspector. They overlay the 3D view (the canvas is not resized). The top bar has a Step button as well as `.`.
- **Breakpoints** (`modules/breakpoints.ts`): on an event type, a container id, an equipment id or a decision point (matches `DecisionRequested/Resolved/Failed` of that point). The list lives in the store and is sent to the worker (`setBreakpoints`), which keeps it across load/reset. `eventMatchesBreakpoint` is the stop `predicate` of every `advance`/`run`/`step`, so the engine stops right after the matching event and `Delta.breakpoint` names it. The controller keeps it as `pendingBreak` until the display reaches that event (look-ahead), then pauses with `breakHit` set, and the store opens the inspector on it. `play()`, a speed button, Run to… and step clear `breakHit`. A breakpoint added while the engine is already ahead of the display (look-ahead, at most `max(5 s, 1.5 s × speed)`) only catches events that have not been processed yet.
- **Single-step** is one engine event per press at any speed (it pauses). The inspector shows the stepped event. With the engine ahead of the display after a pause, the display jumps to that event's time (see the debugger gotchas at the end of this section).
- **Event feed** (`modules/eventFeed.ts`): the store keeps the last `FEED_BUFFER_CAP` (1000) summarised events; the panel rebuilds its rows every `FEED_REFRESH_MS` (250 ms, never per frame), shows only events up to the display time, newest first, at most `FEED_MAX_ROWS` (150). From ×60 (`FEED_SUMMARY_MIN_SPEED`) while playing, runs of three or more events of one type collapse into a "N × Type" row. The filter takes space-separated terms that must all occur in the event type or a subject id.
- **Event inspector** (`modules/eventInspector.ts`): payload (motion segments summarised), clickable subjects, and for decision events the handler, outcome, request and reply. The cause chain comes from the engine's `why` through the worker (`op: 'why'`), newest first and ending at the root `ScenarioStarted` (or an injected root); clicking an entry shows that event while keeping the chain.
- **Selection** (`modules/picking.ts`): `entityBounds(model, id, t)` gives each container, SHC, ASC, STS and vessel an oriented box (also the selection outline). `pickEntity` returns the nearest container the ray hits, else the nearest equipment or vessel (their boxes enclose their boxes). A click (under 5 px and 600 ms) selects; a click on nothing deselects; dragging orbits as before. `store.select(id)` opens the inspector and `refreshEntity()` queries the engine (`container`, `sts`, `shc` + `shcJobs`, `asc`, `vessel`); the inspector refreshes twice a second. It shows the engine's state (which may be slightly ahead of the display while playing); the container custody history is the engine's full history. For equipment and vessels, "history" is the recent events that name the id (from the feed buffer).
- **Follow camera.** The Follow button in the inspector or `F`. The scene loop re-aims the orbit target at the selection every frame, keeping the viewing offset.
- **Overlays** (`modules/overlays.ts`, `OverlayToggles.vue`): `laneGraph`, `reservations`, `occupancy`, `labels`, independent of each other; `O` is the master switch. Occupancy tints WTP pads free/occupied and marks boxes standing on STS ground positions; labels float above each STS, SHC, ASC and berthed or anchored vessel with its status. Both read the `SceneModel` at the display time (`OverlayLayers`), and `scene().layers` reports the counts for tests. An overlay for the ASC reserved rail segments is not built: the ASCs (TT-06) do not reserve rail segments yet, so add it with the ticket that introduces them.

- Debugger: the engine runs ahead of the display while playing, so `query` and the inspector describe the engine's time, not the displayed instant, and a pause followed by Step jumps the display to the next unprocessed event.
- Debugger: a breakpoint can only stop events not yet processed; the feed and the inspector never show events later than the display time, except the one that hit a breakpoint (the display is moved to it).
- Debugger: the picking boxes are generous (cranes and hulls enclose everything under them); containers always win. A box on an SHC or inside a crane is picked, the carrier itself by clicking its frame.
- Shortcut `.` while playing pauses and steps the engine's next event, which is beyond the look-ahead, so the display jumps forward slightly. Pause first (Space/0) to step event by event.
- The overlay toggle bar is bottom-centre; new UI must not clash with the E and I panels or their shortcuts.

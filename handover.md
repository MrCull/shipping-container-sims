# Terminal Twin — implementation handover

Handover for the next agent continuing the Terminal Twin build (the `/implement-spec` workflow). Delete this file before the PR merges to `main`.

## Where things are

- **Spec:** MrCull/shipping-container-sims#24. **Tickets:** #25–#52 (each has `## Blocked by`).
- **Integration branch:** `claude/fervent-dijkstra-cmzk4u` (this branch). **Draft PR:** MrCull/shipping-container-sims#54. It closes #24–#52 and must stay a draft until every ticket is in and the code review is done.
- **Sim code:** `src/sims/terminal-twin/`.
- **Sim guide:** `src/sims/terminal-twin/terminal-twin-AGENTS.md`. Read it first; it has "How to prove a change works".
- **Glossary:** `GLOSSARY.md`.
- **Checks:** at handover, `npm run verify` passes (0 lint errors, 4 old box-empire warnings, build OK, 156 Vitest tests). `npm run test:smoke` is the Playwright browser suite. It is not in CI.

## Ticket status

Updated 2026-10-28 (after merging TT-18 and TT-25). Merged on the integration branch: #25–#35, #38, #39, #41 (TT-01–09, 16, 18, 20, 22, 25). `npm run verify` passes (345 tests).

| Ticket | Issue | State |
|---|---|---|
| TT-23 STS model | #36 | MERGED (tt/36-sts-model-v2) |
| TT-27 vessel hulls | #37 | MERGED (tt/37-vessel-hulls-v2) |
| TT-10 export load flow | #40 | MERGED (tt/40-export-load-flow-v2) |
| TT-24 ASC model | #42 | MERGED (tt/42-asc-model) |
| #43, #44 | | in progress |
| #45–#52 | | not started (blocked, see graph) |

**WIP is NOT on GitHub.** It lives only in git worktrees under `.claude/worktrees/agent-*` of the orchestrating session's container (branches `tt/36…`–`tt/39…` above; the merged `tt/33`, `tt/34`, `tt/35` branches are also there). A 5-hour API rate limit stopped all six implementers at once (limit reset at 12:10 UTC). If you can't see those branches, restart those tickets from the integration tip. Implementer subagents can be resumed with SendMessage if the session is still alive.

### Dependency graph (ticket ← blockers)

```
36←32,30  37←32,30
38←33  40←30    41←38  42←32,39
43←40  44←40  45←39,43  46←43,45  47←32,45
48←46  49←48  50←48  51←48  52←32,45,51
```

Frontier: #36, #37, #40, #42. After #38: #41. Then follow the graph.

## Process that worked

1. Run one implementer subagent per frontier ticket, each in its own git worktree (`isolation: worktree`) on branch `tt/<issue>-<slug>`, in the background. Give it the brief below plus the ticket number.
2. When it reports, merge its branch into the integration branch, run `npm run verify` and push. Most merges fast-forward, because the implementer merges the integration tip into its branch first.
3. When a ticket lands with breaking engine changes, message the agents still running so they merge the tip early. TT-03 and TT-09 were like this.
4. Once every ticket is in, run the `code-review` skill on the branch, fix the findings in one pass, mark PR #54 ready, then remove the worktrees.

### Implementer brief (give this to each subagent)

- **Read first:** issue #24 (spec), the ticket issue, this file's "Notes from merged tickets", the sim guide and `GLOSSARY.md`.
- **Branch:** confirm the worktree is based on the integration branch tip, then create `tt/<N>-<slug>`.
- **Build:** run `npm install`, then call the `tdd` skill and build test-first through the public seams: the headless engine API, decision-point handlers, the browser dev API `window.__tt`, and asset outputs.
- **Isolation:** keep everything inside `src/sims/terminal-twin/`. Update the sim guide and glossary for anything you add.
- **Verify:** `npm run verify` must pass. UI tickets also run the smoke tests with unique ports: `SMOKE_DEV_PORT=$((5200+RANDOM%500)) SMOKE_PROD_PORT=$((5800+RANDOM%500)) npm run test:smoke`. Check `npm run screenshot -- --path /sim/terminal-twin`.
- **Commits:** commit with the session's attribution trailer. Don't push and don't touch issues; the orchestrator does that.
- **Before reporting:** merge the current integration tip into your branch, re-verify, and write short notes for later tickets.

### Standing rules learned

- **UI text:** all of it goes through the message catalogue (`src/sims/terminal-twin/i18n/`) and the shared locale/unit formatter. A Vitest check fails on hard-coded strings in `.vue` files.
- **Hotkey:** never mount `useGodModeHotkey` in Terminal Twin; it clashes with the D/O shortcuts.
- **Smoke tests:** specs are in `src/sims/terminal-twin/tests/browser/*.smoke.ts`; prod-only specs are `*.prod.smoke.ts`.
- **Goldens:** regenerate only on purpose (`UPDATE_GOLDEN=1 npm test` or `npm run tt:golden -- --update`), and say why in the commit.
- **Assets:** never commit `.blend` files or reference photos. `npm run tt:assets -- --python <bpy python>` regenerates GLBs (needs `pip install bpy`). Blender's Draco export is broken, so the pipeline uses gltf-transform meshopt + WebP. The CI budget check reads only committed GLBs and sidecars.
- **Reference pack:** the TTI Algeciras pack (dimensions, workflows) was a user upload and is not in the repo. Ask the user for it if a model ticket needs it; the spec (#24) carries the key figures.
- **Lint:** ESLint ignores `.claude/**`, because agent worktrees live there.
- **GitHub MCP:** the github MCP server may fail to connect (bad Authorization header). Read issues with `gh api repos/MrCull/shipping-container-sims/issues/<n>` instead.
- **Credit limit:** when near the session's usage limit, do not spawn new subagents (it leaves several tickets half done). Finish and merge what exists, and update this file.
- **After a merge:** the main checkout needs `npm install` before `npm run verify`.

## Open follow-ups noted by implementers

- **Stale/failing smoke tests (fix in the final review pass):** `terminal-twin-shc.smoke.ts` "lane-graph and reservation overlays toggle" expects an overlay object without `ascRail` (TT-08 added it); `terminal-twin-debugger.smoke.ts` "clicking a container in 3D selects it" fails at the final empty-sky click; `container-assets.smoke.ts` 18k-yard budget sees 26 draw calls vs limit 20 (cause unconfirmed, possibly SHC models); the ×600 frame-count test is load-flaky.
- **SHC cornering:** SHCs stop at every turn instead of cornering at speed.
- **WTP pad choice:** it is part of the `shcDispatch` reply; there is no separate decision point.
- **Container orientation:** containers are drawn with position plus optional yaw only.
- **Frame rate:** an 18k-box yard is unconfirmed on real GPU hardware (TT-19).
- **Invariant cost:** invariants scan the whole state after every event. Revisit in TT-19.
- **Date pickers:** `datetime-local` inputs show the browser locale, not the chosen one.
- **Flaky test:** a frame-count smoke test can flake on a heavily loaded machine.

---

## Notes from merged tickets

These are the implementers' notes, copied verbatim.

### explore-browser

### Codebase recon for browser tickets (26, 31, 32, 34, 41)

#### Registration / routing
- useSimRegistry.ts:8-20 eager-globs `@/sims/*/definition.ts` -> keep definition.ts light; lazy component `() => import('./TerminalTwin.vue')`, logo via `?url` (see box-empire/definition.ts).
- SimDefinition: src/types/sim.ts:5-19 (status must be 'playable' to render).
- SimPage.vue: ~50px header above sim (sim area isn't full viewport). AudioControls overlay at z140 for all sims except box-empire (`simId !== 'box-empire'`, :87-99) -> add terminal-twin to that condition.
- Add /sim/terminal-twin to public/sitemap.xml. Guide: .ai/skills/adding-a-sim/SKILL.md.

#### Three
- Shared src/composables/useThreeScene.ts is too limited (far=1000, no OrbitControls, deprecated THREE.Clock warns -> use THREE.Timer). Write TT's own scene composable, box-empire style (box-empire/composables/useThreeScene.ts: WebGL probe + fallback :277-290, ACES/sRGB/shadows :292-312, OrbitControls :313-325, dispose :422-454).
- Never put Three objects in Vue reactivity (markRaw / module scope).
- No sim uses InstancedMesh yet; don't copy box-empire containerRenderer (Group per container).
- GLB loader pattern: box-empire/modules/modelLoader.ts; URLs via `new URL('../assets/models/x.glb', import.meta.url).href` or `?url`. Meshopt decoder: three/examples/jsm/libs/meshopt_decoder.module.js.

#### Store/loop
- Box Empire store: big collections in `shallowRef(markRaw([]))` + `triggerRef` (gameStore.ts:69-75,177-183). Batch worker deltas into raw structures; triggerRef once per frame.
- GameCanvas.vue drains pending events per frame for SFX — model for consuming worker deltas.
- Audio: box-empire/composables/useAudio.ts (mp3 ES imports, pool, swallow autoplay errors); global mute src/stores/audio.ts.

#### Vite / TS for Worker
- Add `worker: { format: 'es' }` to vite.config.ts (iife default breaks build if worker code-splits). Top-level manualChunks don't apply to workers. Worker must not import three.
- `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })` — literal in same expression.
- tsconfig.app.json: lib ES2020+DOM, no WebWorker. In worker entry use `/// <reference lib="webworker" />` + `declare const self: DedicatedWorkerGlobalScope`, or separate tsconfig. ES2020 lib lacks .at/Object.hasOwn/structuredClone types — bump lib or avoid.
- noUncheckedSideEffectImports is on.

#### Design tokens (src/assets/main.css)
- --color-bg #0a0e1a, --color-bg-card #111827, --color-bg-card-hover #1f2937, --color-primary #3b82f6, --color-accent #f59e0b, --color-text #e5e7eb, --color-text-muted #9ca3af, --color-border #374151, --color-success #10b981, --color-danger #ef4444, --font-body Inter. --font-retro (Press Start 2P) must NOT be used by TT. No mono/warning/spacing tokens — define TT-local ones.

#### Playwright
- scripts/screenshot.mjs spawns Vite dev (dev-only `window.__tt` works); `--eval`, `--wait-for`, `--fail-on-error`. scripts/** is ESLint-ignored.
- No playwright.config / tests folder. CI runs `npm test --if-present`; decide whether browser smoke tests run in `npm test` (CI has no preinstalled chromium unless `npx playwright install chromium` added) — suggest separate `npm run test:smoke`.

#### Misc
- useGodModeHotkey (src/composables) is global — check clashes with TT shortcuts (ticket 31).
- ECharts (41) must be lazy `import()`; check it doesn't land in main chunk.

### ticket-25

### Ticket 25 (TT-01) — headless engine tracer: what later tickets build on

Branch `tt/25-headless-engine-tracer`. Full guide: `src/sims/terminal-twin/terminal-twin-AGENTS.md`; terms: root `GLOSSARY.md`.

#### Public API (import ONLY from `src/sims/terminal-twin/engine/index.ts`)
- `createSimulation(config, handlers?: Partial<HandlerSet>, { seed?, invariants?: {enabled?, failFast?} })` → `Simulation`
  - `step()`, `runUntil({time?, eventType?, vesselsCompleted?, moves?, maxEvents?, predicate?})` → `{reason: 'condition'|'ended'|'failed'|'idle'|'max-events', eventsProcessed, now}`; no arg = run to the end
  - `snapshot()` (JSON-safe `SimSnapshot`) / `restore(snap)` / `restoreSimulation(snap, handlers?, opts?)`
  - `query.{now,container,containers,vessel,vesselSlot,sts,groundPosition}` (live read-only views)
  - `why(eventId)` → `[event, parent, …, ScenarioStarted]`; `subscribe(fn, {types?})` → unsubscribe
  - `eventLog()`, `eventLogHash()` (14 hex chars), `kpiReport()`, `invariantReport()`, `status`, `firstError`, `now`
- `summarizeRun(sim)` → `RunSummary` (= CLI `--out` = golden format)
- Kinematics (pure): `travelTime(d, {vMax, accel, decel})`, `planSegment(entityId, axis, from, to, t0, profile)`, `positionAt(seg, t)` ← TT-02 renderer interpolation, setup-dialog cycle-time readout

#### Extension points
- Events: add to `EventPayloads` (`engine/events.ts`). Envelope `{id, seq, t, type, causedBy, subjects, payload}`; id at schedule, seq at processing.
- Behaviour: a `ReactorMap` per subsystem in `engine/subsystems/*.ts`, registered in `REACTORS` (`simulation.ts`). Reactors get an `EngineContext` with `{state, config, handlers, query, current, schedule(type, at, subjects, payload), random(), transferCustody(id, owner)}`. `schedule` sets `causedBy` automatically.
- Payload convention: an equipment event's `segments` is the motion that led up to it (planned when it was scheduled). The live plan is in `StsState.motion`, which the TT-02 worker can diff for "new motion segments".
- TOS seam: `HandlerSet` in `engine/handlers.ts` has a single sync decision point, `stsGroundPosition(req, query) → {groundPositionId|null}`. TT-03 replaces it with request/reply + correlation ids + strategy registry; keep it plain JSON.
- Custody: `CustodyKind` in `state.ts`. Add new holders to `custodyHolders()` in `invariants.ts`.
- Invariants: append to `INVARIANTS` (`engine/invariants.ts`) with a dotted id. A violation is logged as an `InvariantViolated` event caused by the offending event; fail-fast sets status `failed` and `firstError`.
- End conditions: `config.endConditions {vesselsCompleted?, simDurationS?, moves?}` → a committed `ScenarioEnded` event (not queued).
- Snapshots: `SNAPSHOT_SCHEMA_VERSION = 1`, `ENGINE_VERSION = '0.1.0'` (restore throws on a mismatch; TT-17 adds the warning/migration). `SimState` must stay plain JSON. The snapshot includes the full log.

#### Scenario
- `scenario/types.ts` `ScenarioConfig` (schemaVersion 1, SI). `scenario/builder.ts` `ScenarioBuilder` (fluent; `DEFAULT_STS_KINEMATICS` [A], `LINE_OWNER_PREFIX`). `scenario/iso6346.ts`.
- Fixtures: define in `scenario/fixtures/definitions.ts`, run `npm run tt:fixtures` (writes JSON), register in `fixtures/index.ts` (static JSON import works in Vite + tsx). Test `tracer.test.ts` fails if JSON ≠ definition.
- Golden: `<name>.golden.json`, checked by `tests/golden.test.ts`; regenerate with `UPDATE_GOLDEN=1 npm test` (TT-04 can build on this flag).
- `scenario/presets.ts`: empty `presets` registry for TT-15. The CLI `--preset` already reads it.
- Tracer fixture: `tracer-1sts-10-boxes`, seed 42, 10% move variation, STS01 with **10** ground positions (nothing clears them before SHCs). Golden hash `15489ee6002065`, 35 events, ends at 1168.805 s, ~32.9 gross moves/h.

#### CLI (`src/sims/terminal-twin/cli/`, Node-only)
- `npm run tt:run -- --fixture <name|file.json> | --preset <name> [--seed n] [--until end|time:s|moves:n|vessels:n|event:Type] [--handlers default|broken-first-lane] [--no-fail-fast] [--out f.json] [--events f.jsonl]`
- `runCli(argv, print) → exitCode` (0 ok / 1 violation or error / 2 usage) is testable without spawning. `handlerSets.ts` holds named handler sets for the CLI.

#### Tooling / gotchas
- `npm test` = `vitest run` (`vitest.config.ts`, include `src/**/*.test.ts`, node env). Added devDeps vitest ^5, tsx ^4.
- `tsconfig.tools.json` type-checks `*.test.ts` and `src/sims/*/cli/**` (Node types, ES2023, no DOM). They are excluded from `tsconfig.app.json`, so put Node-only code in `cli/` or tests.
- ESLint (scoped to `terminal-twin/engine/**` and `scenario/**`) bans vue/pinia/three, node built-ins, `@/` and `cli/` imports, window/document/process, and `Math.random`.
- There is no `definition.ts` yet (deliberate: no home card until TT-02).
- The CLI test spawns `npx tsx` once (~1 s).
- Invariants scan the whole state after every event, so watch this for TTI scale (TT-19).

### ticket-26

### Ticket 26 (TT-02): browser tracer. What later tickets build on

Branch `tt/26-browser-tracer`, which includes TT-03 and TT-04. Guide: `terminal-twin-AGENTS.md` § "Browser host (TT-02)" and § "Dev API". Terms: GLOSSARY (engine horizon, display time, look-ahead, delta, dev API).

#### Files (all under src/sims/terminal-twin/)
- `definition.ts` (order 4, status playable) and `TerminalTwin.vue` (root: TopBar, scene host, SetupDialog, end banner; installs `window.__tt` when DEV).
- `worker/engine.worker.ts` is the entry and serialises requests. `worker/engineHost.ts` serves them, using only the public engine API: `runUntilAsync` for advance/run, `step`, `inject`, `query`, `snapshot`, `why`. `worker/protocol.ts` holds the internal types.
  - Delta = `{motion: MotionPlan[], custody: CustodyChange[] (+x for ground positions), entities: sts/vessel status changes, events: EventSummary[] (cap 200), eventCounts}`.
  - Motion plans are found by diffing `StsState.motion` array identity, and statuses by scanning all `config.sts` and `config.vessels` after every event.
  - New equipment kinds (ASC, SHC, …) need: motion and status diffing in `observe()`, timelines in `SceneModel`, and meshes in `SceneRenderer`.
- `modules/twinController.ts` is the non-reactive orchestrator: the playback clock, the look-ahead (only while playing), `runTo`/`runUntil`/`step` (flat out, `busy` skips rendering), and a generation guard against stale replies. `SPEEDS` lives here.
- `modules/engineClient.ts` wraps the worker in promises. `request(req)` resolves to `{result, delta, info}`.
- `modules/sceneModel.ts` is pure TS. It holds per-axis segment timelines plus custody and status timelines, and provides `stsPose(id,t)`, `containerCentre(id,t)`, `custodyAt`, `statusAt`, `entityCentre` and `prune(t)`. `CONTAINER_DIMS` lives here.
- `modules/sceneRenderer.ts` (Three.js): procedural quay, water, rails, lane lines, STS (legs, boom, trolley, ropes, spreader), vessel hull, and one InstancedMesh for all containers with livery colours per line. Plus a selection wireframe, `stats()` and `overviewTarget()`.
- `composables/useTwinScene.ts`: renderer, camera, OrbitControls and ResizeObserver. Each RAF does `controller.tick` → `store.sync()` → `view.update` → render. It registers a `TwinView` (`cameraTo`, `stats` + frames) with the store. Click picking and follow camera are NOT built (inspector ticket).
- `store/twinStore.ts` (Pinia `terminal-twin`):
  - state: `phase`, `choice{name,seed,startDateTime}`, `hasScenario`, `loading`, `displayTime`, `speed`, `paused`, `busy`, `info` (EngineInfo), `error`, `selectedId`, and `recentEvents` (shallowRef, cap 500; for the event feed ticket);
  - actions: `startScenario`, `reset`, `newScenario`, `cancelSetup`, `setSpeed`, `togglePause`, `runTo`, `select`;
  - helpers: `scenarioCatalogue()` / `resolveScenario(name)` (fixtures + `presets` registry), and `controller()` / `view()` getters.
- `components/TopBar.vue`: clock (weekday, date, hh:mm:ss, T+elapsed), Pause plus ×1…×600, a Run to… popover (datetime-local), Reset, New Scenario and a status pill. A sound toggle and save/load/export are NOT there yet.
- `components/modals/SetupDialog.vue`: `role=dialog` named "New scenario". It has fixture/preset radios, a seed with ↻ Re-roll, a datetime-local start (default Monday 06:00 local of the current week), Start and Cancel.
- `modules/time.ts`: `defaultStartDate`, `toLocalInputValue`/`fromLocalInputValue`, `clockParts`.
- `dev/devApi.ts`: `TwinDevApi` type plus `declare global Window.__tt`. Methods: load, step, runUntil, runTo, query, inject, snapshot, why, select, cameraTo, setSpeed, pause, play, reset, newScenario, clock, scene, sceneState.

#### Engine change (minimal)
- `Simulation.inject(type, at, subjects, payload)` schedules an extra root event (`causedBy` null) and throws if `at` < now. Tested in `tests/live-driving.test.ts`, alongside "time-sliced runUntil({time}) = golden hash".

#### Tooling
- `npm run test:smoke` = `playwright test` (`playwright.config.ts`, root). Specs are `src/**/*.smoke.ts`, and `*.prod.smoke.ts` runs against a production build.
  - It starts its own servers: dev on 5199; prod is built to `.smoke-dist/` and served on 5198. Both are git- and ESLint-ignored, and output goes to `.smoke-results/`.
  - Not in `npm test` or CI. About 30 s, including the prod build.
- Smoke specs import JSON with `with { type: 'json' }` (Playwright ESM). Typing comes from `import type {} from '../../dev/devApi'`.
- `tsconfig.tools.json` now has the DOM lib and includes `*.smoke.ts`. `tsconfig.app.json` excludes `*.smoke.ts`. `tsconfig.node.json` includes `playwright.config.ts`.
- `vite.config.ts` sets `worker.format = 'es'`. The ESLint engine-ban block also covers `worker/**`. `SimPage.vue` hides the global AudioControls overlay for terminal-twin; the TT sound toggle comes later. `public/sitemap.xml` now has the route.

#### Gotchas
- While paused, the engine does not run ahead, so `__tt.clock().engine.now === displayTime` after runTo/runUntil/step. While playing, the engine is up to `max(5, 1.5 × speed)` sim s ahead. Compare the scene with the engine only when paused.
- After load/reset the engine is at t=0 with ScenarioStarted still queued (eventsTotal 0) until you play/step/run.
- `__tt.load(name)` defaults to the fixture's own seed (so the golden hash reproduces) and starts paused. The UI Start autoplays at ×10.
- Run to… jumps compact deltas (latest plan/custody/status per entity). The full motion history between jumps is not rendered (by design).
- The start date only affects the clock, never the event-log hash.
- The default camera is aimed at STS 0. A mid-run screenshot command is in the guide's "How to prove" table.

### ticket-27

### Ticket 27 (TT-03) — decision-point framework: what later tickets build on

Branch `tt/27-decision-points` (merged with integration tip 95302c5, incl. TT-04). Full docs: `terminal-twin-AGENTS.md` § "Decision points (TOS seams)" (how to add a decision point and a strategy); terms in `GLOSSARY.md`.

#### Files
- `engine/decisions/types.ts`: `DecisionRequests` / `DecisionReplies` catalogue (keyed by decision point), `DECISION_CONTRACT_VERSIONS`, `DECISION_POINT_IDS`, `DecisionRequestMessage`, `DecisionHandler`, `HandlerSet`, `DecisionsConfig` (`asyncMode`, `simSecondsPerWallSecond`, `points.<dp>.{strategy, fallbackStrategy, timeoutMs, latency}`), `DEFAULT_DECISION_TIMEOUT_MS = 5000`.
- `engine/decisions/strategies.ts`: the `strategies` registry (`{default, strategies: {name: {description, handler}}}`), `getStrategy(dp, name)` and `defaultHandlers`. stsGroundPosition has `lowest-free-lane` (default) and `highest-free-lane`.
- `engine/decisions/runtime.ts`: dispatch, async modes, timeouts/fallback and KPIs, with state in `SimState.decisions`. `engine/decisions/latency.ts`: the injector, on its own RNG stream.
- `engine/handlers.ts` is now only re-exports. Everything is exported from `engine/index.ts`.

#### Contract
- Handler: `(msg: {correlationId, decisionPoint, version, t, payload}, query) => reply | Promise<reply>`.
  - **Breaking change from TT-01:** `req.groundPositions` is now `msg.payload.groundPositions`.
- Reactors call `ctx.requestDecision(dp, request, { equipment: [waitingId], ... })` (`ctx.handlers` is gone). They handle the reply in their own subsystem's `DecisionResolved` reactor: narrow on `e.payload.decisionPoint`; the payload has `request` and `reply`.
- Events, all carrying `correlationId` (`<dp>-<n>`):
  - `DecisionRequested`
  - `DecisionFailed {failure: timeout|error, message, fallback}`
  - `DecisionResolved {outcome: ok|fallback, handler: 'strategy:x'|'custom'|'fallback:x', request, reply}`
- Handlers passed to `createSimulation` override the config strategy and are labelled `custom`.

#### Engine API additions
- `SimulationOptions.asyncMode`, `sim.asyncMode`, `sim.runUntilAsync(cond)`, and `StopReason 'waiting-for-decision'`.
- `kpiReport().handlers[dp]` = {handler, calls, resolved, ok, fallbacks, timeouts, errors, lateReplies, pending, maxPending, simLatencyS{mean,max}, wallLatencyMs{mean,max}, equipmentIdleS}. It is in the golden and in the CLI `TOS handlers:` block.
- `ScenarioConfig.decisions?` is optional; schemaVersion stays 1. `ENGINE_VERSION` is now `0.2.0`.
- `StsStatus` adds `waiting-for-decision`: the STS holds the box after StsPicked until the reply.
- CLI `tt:run` options: `--async-mode`, `--strategy dp=name` (repeatable), `--latency dp=<none|fixed:ms|uniform:a-b|exp:mean>[,timeout:%][,error:%][,timeoutMs:ms]`. All three are rejected together with `--from-snapshot`.
- `tt:diff --b-handlers highest-free-lane` still works (that handler set now wraps the registry strategy).

#### Semantics / gotchas
- Built-ins are sync, so resolution happens at the same sim t and both modes give identical logs.
- Injected latency is simulated, not real waiting:
  - keep-running: the reply lands `ms/1000 × simSecondsPerWallSecond` sim s later;
  - pause: the reply lands at the same t, and wall latency counts only in KPIs.
- A delay of at least `timeoutMs` is a timeout. Set `timeoutMs` when you inject long delays.
- In keep-running, the reply is computed at request time and delivered later, so it may be stale.
- Async (Promise) handlers:
  - In-flight Promises live outside state. A settled reply is applied at the engine's current `now` on the next step/runUntil (`drain`).
  - `runUntil({time})` in keep-running lets the clock pass an in-flight reply. This is the hook for the TT-02 worker pacing. In pause mode the clock stays frozen.
  - Real timeouts use `setTimeout` in wall time. Late replies are counted, not applied.
  - Restore re-sends in-flight async requests.
- The tracer golden went 35 → 55 events (hash `15fe2f67b6318f` before TT-04's merge; check the golden file). KPIs are unchanged.
- Run-diff of two strategies now diverges first at `DecisionResolved` (`payload.reply.groundPositionId`, `payload.handler`).
- Log subsystem for decision events is `decision` (from the name). `DecisionFailed` logs at `warn`.
- UI for these settings is not built yet (setup-dialog tickets). `DecisionsConfig` is the shape the dialog should edit.

#### Tests
- `tests/decisions.test.ts` (seam 2): scripted handler swap, strategy selection, both modes identical, keep-running latency/idle, pause latency hash equality, timeouts/errors/fallback, async handlers (pacing, pause, wall timeout + late reply, reject, snapshot with pending).

### ticket-28

### Ticket 28 (TT-04) — headless debug tooling: what later tickets build on

Branch `tt/28-debug-tooling` (one commit on top of TT-01). Guide: `terminal-twin-AGENTS.md` → "How to prove a change works" lists every command.

#### Engine (exported from `engine/index.ts`)
- `engine/logging.ts`: `createSimulation(config, handlers, { log: { verbosity?: string|LogVerbosity, write(record) } })`
  adds an internal subscriber (simulation.ts: 1 import, 1 option field, 1 line). `restoreSimulation` passes it too.
  - `LogRecord {t, eventId, seq, subsystem, level, type, subjects, causedBy?, payload?}` (causedBy/payload only when that subsystem's verbosity is `debug`).
  - Levels `off|error|warn|info|debug`. `parseLogVerbosity('asc=debug,shc=info,*=warn')` (bare level = default; default `info`; throws on bad level).
  - Subsystem = lower-cased first word of the event type (`AscMoveStarted` → `asc`), level `info`, unless overridden in
    `EVENT_LOG_META` (Partial record → new event types need NO change). Now: StsMoveStarted=debug, StsWaitingForGroundPosition=warn, InvariantViolated → `invariants`/error.
  - Browser debugger/settings (TT-02/31) can reuse `toLogRecord(event, verbosity)` on worker events.
- `engine/runDiff.ts`: `diffEventLogs(a, b, {context=3})` → `{diverged:false, commonEvents}` or
  `{diverged:true, seq, commonEvents, a, b (null if a run ended), differences: dotted paths, before, afterA, afterB}`.
  Compares full JSON envelopes index by index. `jsonDifferences(x, y)` → dotted leaf paths (reused by goldens).

#### CLI (Node-only, `cli/`)
- `tt:run` new flags: `--log <file> --log-level <spec>`, `--snapshot <file>` (snapshot where the run stopped),
  `--from-snapshot <file>` (mutually exclusive with --fixture/--preset/--seed; `--handlers` must be passed again — handlers aren't in snapshots).
  `--events`/`--log` now contain only events processed in THIS invocation (whole run when starting at t=0). Summary KPIs/hash stay cumulative.
  Output gained a `Started:` line. `runCli.ts` now exports `UsageError`, `loadScenario`, `parseUntil`, `formatSimTime`.
- `tt:diff` (`cli/diff.ts` → `diffCli.ts`, `runDiffCli(argv, print)`): two `.jsonl`/snapshot files, or `--fixture|--preset` with
  `--seed/--a-seed/--b-seed`, `--handlers/--a-handlers/--b-handlers`, `--until`, `--context`. Exit 0 same / 1 diverged / 2 usage.
- `tt:golden` (`cli/golden-cli.ts` → `golden.ts`): `runGoldenCli`, `checkGolden(file, summary, {update})` →
  `{status: match|drift|missing|created|updated, report}`, `checkFixtureGolden(name, {update, dir?})`, `GOLDEN_DIR`.
  Drift report = `path: golden X → actual Y` lines + how to diff/update. `tests/golden.test.ts` uses it; `UPDATE_GOLDEN=1 npm test` still works.
- `cli/handlerSets.ts` gained `highest-free-lane` (valid alternative strategy used by diff tests). TT-03: when the strategy
  registry lands, map `--handlers`/`--a-handlers` onto it and keep a second valid ground-position strategy for `run-diff.test.ts`.

#### Tests
`tests/logging.test.ts`, `run-diff.test.ts`, `time-window.test.ts`, `golden-update.test.ts` (all via engine API / runCli-style functions, no spawning).

#### Gotchas
- `runUntil({time: T})` leaves now = T; window = events with `t > T`.
- Logs come only from committed events; no free-text reactor logging (`ctx.log`) exists. Add one to EngineContext if a subsystem needs non-event debug lines.
- Piping tt:run into `head` gives a harmless EPIPE stack trace.

### ticket-29

### Ticket 29 (TT-05) — SHC horizontal transport: what later tickets build on

Branch `tt/29-shc-transport` (merged with integration tip incl. TT-20, TT-22, TT-09). Guide: `terminal-twin-AGENTS.md` § "Horizontal transport: SHCs (TT-05)"; GLOSSARY: lane graph, conflict zone, reservation, job, pull dispatch, trip, clear position, subsystem mode, overlay.

#### Config (all optional; tracer golden unchanged)
- `shcs: [{id}]`, `kinematics.shc` (`DEFAULT_SHC_KINEMATICS` in builder; accel matters: SHCs stop at every turn), `yard.blocks: [{id, x, wtpPads}]`, `apron` (`DEFAULT_APRON_LAYOUT` in `engine/laneGraph.ts`), `driverVariabilityPct`, `subsystems: {shc, asc}`.
- Builder: `.shcs(n, kin?)`, `.block(id, {x, wtpPads})`, `.driverVariability(pct)`, `.subsystems({...})`; `withShcFleet(config, n, kin?)` (JSON-copies, safe on Vue proxies).
- Fixture `shc-1sts-2shc-1wtp` (vessel call, feeder 10 × 40 ft, STS01 3 GPs, block B01 west, ends `simDurationS 1800`). Golden in repo. Other fixtures (no SHCs) keep TT-09's generous GP counts on purpose: nothing clears them.

#### Engine
- `engine/laneGraph.ts` (redesigned for TT-09's moving cranes): one continuous +X STS lane per GP lane index along the whole quay (-15 m … L+15 m); stations every `stationSpacingM` (25) with a down spine `D<k>:<lane>` (westbound apron → lanes) and an up spine `U<k>:<lane>` 5 m on (lanes → apron); apron loop `AW@x`/`AE@x`; WTP spurs `AE → C:<pad> → P:<pad>`; parking `S:<shc>`. Zones: nodes, lane sections `L<lane>@<x>`, pads. `laneAccess(graph, lane, x)` → lane walk around a box; `laneZonesAt(graph, lane, x, half)`; `validateLaneLayout` (lanes must stay clear of the apron: ≤ 10 GP lanes by default). `laneGraphOf(config)` WeakMap cache — don't mutate a config after createSimulation. Dijkstra with a heap, cached per pair.
- `engine/reservations.ts`: `earliestStart(state, windows, now)`, `reserve(state, holder, windows, start)` (prunes ended), `overlappingReservations`. Half-open windows, zero-length ignored. Whole trip reserved before departure; conflicts delay departure only. With SHCs (mode ≠ off), `planDrop` in quay.ts reserves the lane sections under the box for the carry + set-down (no effect on fixtures without SHCs, so TT-09 goldens are unchanged).
  → TT-06 ASC rail segments / TT-10 transfer stalls: add zones + use the same functions; invariant `reservation.no-overlap` covers everything in `state.reservations`.
- `engine/subsystems/shc.ts`: jobs released on `StsGrounded` (`state.shcJobs`, `J<n>`), `maybeDispatch(ctx)` (exported; call when a pad frees or an SHC idles), `shcDispatch` DP (strategies `oldest-job` default, `nearest-job`; reply `{jobId, wtpPadId}`; engine trusts it). Trip = `TripBuilder` (runs rest-to-rest, `ShcState.motion` axes `x`/`z`/`lift`, `ShcState.plan` phase chain). Events `ShcJobAssigned … ShcDroppedAtWtp → ShcCleared`, `ShcRoutingToParking → ShcParked`.
- `engine/subsystems/ascStub.ts`: ASC `instant` → `AscPicked` (custody pad → `asc` `<block>-ASC1`) + `AscStacked` (→ `yardSlot` `<block>:I<n>`) at the drop time; `off` → pads fill. **TT-06 replaces this** with the real ASC raising the same events; `resolveSubsystemModes` throws on asc `real` until then (state.ts) — remove that throw.
- STS waiting: null GP reply → `StsWaitingForGroundPosition`; `resumeStsWaitingForGroundPosition(ctx, stsId)` (quay.ts) on ShcPicked → `StsGroundPositionWaitEnded {stsId, containerId (first carried box without a drop), waitedS}` → re-request. Jobs use `StsGrounded.x` (twin-20 offset included).
- Modes: `SimulationOptions.subsystems` > `config.subsystems`, resolved into `SimState.subsystems` (in snapshots). SHC instant = same logic with zero durations.
- Custody kinds now: vesselSlot, sts, groundPosition, shc, wtpPad, asc, yardSlot (holders in invariants.ts). Invariants added: `reservation.no-overlap`, `claim.single-holder`; double-occupied GP/pad shows as `custody.single-owner` "… is double-occupied".
- KPIs: `kpiReport().horizontal` (only with SHCs) {boxesToWtp, shcs{jobs, emptyDistanceM, loadedDistanceM, reservationWaitS}, stsGroundPositionWaitS}. `kpis.handlers` now OMITS never-called decision points. ENGINE_VERSION 0.3.0.
- `positionAt`: checks `t >= t1` first (zero-duration segments land at `to`).
- Query: `shc(id) shcs() shcJobs() wtpPad(id) reservations()`.

#### Browser
- Delta: `motion` includes SHCs, `entities` kind `'shc'`, new `reservations[]`. Query kinds `shc shcList wtpPad reservations`.
- `SceneModel`: `graph`, `shcIds`, `shcPose(id,t)` {x,z,lift,heading}, `containerPose` (adds `yaw`), `activeReservations(t)`; generic per-entity axis timelines (`emptyAxes()`).
- `SceneRenderer`: procedural SHC groups, pads/block slabs, lane overlay, zone plates; `setOverlays`. `ContainerInstancer.push(..., yaw = 0)` (added optional yaw).
- Store: `overlays`, `setOverlays`, `hasShcs`; `ScenarioChoice.shc {count, kinematics}` → `withShcFleet` after `runConfigFor`. O shortcut (`overlaysVisible`) masters the overlays.
- Dev API: `__tt.overlays({...})`, `scene()` adds `shcs overlays reservedZones`, `sceneState()` adds `shcs reservations`, `load(name, {shc})`.
- Setup dialog SHC section (count ≤120, speeds/accels in display units, catalogue keys `setup.shc.*`); `OverlayToggles.vue` (`overlays.*`).
- Smoke: `tests/browser/terminal-twin-shc.smoke.ts`. `SMOKE_DEV_PORT`/`SMOKE_PROD_PORT` env override ports (parallel worktrees).

#### Gotchas / follow-ups
- Vehicles stop at every turn (rest-to-rest segments); real SHCs corner at speed — a TT-19/realism follow-up.
- A vehicle waiting at a pad clear position holds no reservation (rarely visible ghosting).
- Lane-node count grows with quay length × GP lanes (2 km quay, 3 lanes ≈ 1,000 nodes): fine with path caching; watch at TTI scale (TT-19).
- Pad choice is part of the `shcDispatch` reply (no separate WTP-pad selection DP yet).
- Load flakes: frame-count smoke assertions (≥10 frames/s) can fail when the machine is busy; rerun.

### ticket-30

### Ticket 30 (TT-09): vessels, berthing, continuous quay, crane split — what later tickets build on

Branch `tt/30-vessels-berthing` (merged with integration tip incl. TT-20, TT-22). Guide: `terminal-twin-AGENTS.md` § "Vessels, berthing and the STS rail (TT-09)". Glossary: cell, bay plan, berth, anchorage, rail reservation, vessel call, crane split, twin-20, deck before hold.

#### Breaking changes (merge hazards for TT-05 and later)
- `ScenarioConfig`: `vessels` are now vessel CALLS `{id,name,arrivalS,sizeClass,discharge,load,transshipment,maxSts,sizeMix?}`; `berthAtS/berthX/stsIds/bays/rows/...` gone. `config.containers` REMOVED; new `cargo {lines,sizeMix,emptyShare}`; `quay` = `{lengthM,berthGapM,mooringS,unmooringS,stsMinSpacingM,twinLift}`.
- Builder: `.vessel()`/`.dischargeBoxes()` gone → `.vesselCall(id, {sizeClass, discharge, ...})`, `.quay(len, ops)`, `.cargo()`, `.vessels(list)`, `.decisions()`. `makeVesselCall`, `DEFAULT_QUAY`, `DEFAULT_MAX_STS`. `LINE_OWNER_PREFIX` moved to `scenario/lines.ts` (re-exported by builder).
- `StsState.carrying` is `string[]` (twin-20); new `railIndex, bays, workQueue, railLo/railHi, railTargetX, drops`. Statuses add `waiting-for-rail`, `repositioning`.
- `VesselState`: `dischargeQueue` gone → per-crane `StsState.workQueue`; new `sizeClass, arrivedAt, berthX, anchorageWaitS, stsIds, stsHistory, remainingDischarge, ...`. Statuses: scheduled → at-anchorage → mooring → berthed → unmooring → departed.
- Events: `StsMoveStarted.containerIds`, `StsPicked.twin?`, `StsGrounded.x`. New `VesselArrived, VesselAtAnchorage, BerthAllocated, VesselWorkComplete, StsWaitingForRail, StsRepositionStarted/Completed`. `ScenarioStarted` → `VesselArrived` is scheduled by `subsystems/berth.ts` (REACTORS = [berth, quay]).
- Every run now has 2+ extra decision pairs (berthAllocation, craneSplit) before the first STS move: tests that grab "the first DecisionRequested/Resolved" must filter on `payload.decisionPoint` (see `gpEvent`/`gpOfType` in `tests/decisions.test.ts`).
- `Invariant.check(state, config)` (config added; old 1-arg checks still type-check). `ENGINE_VERSION 0.3.0`. No end condition configured → ends when all vessels departed.

#### Where things are
- `scenario/vesselClasses.ts`: `VESSEL_CLASSES`, `slotX/slotZ/tierBaseY/slotCentre`, `vesselSlotId/parseVesselSlotId` (`V001:BB-RR-TT[a|f]`), `CONTAINER_HEIGHT_M`, `HALF_OFFSET_M`, `FENDER_GAP_M`. TT-27 (hulls) must match this grid.
- `scenario/bayPlan.ts`: `planCargo(config, seed)` (own RNG stream `seed ^ 0x9e3779b9`), `pickWeighted`. Called by `createInitialState` AND `SceneModel` (no bay plan over the worker protocol). Slots carry `purpose: discharge|load|transshipment`; load/TS slots are reserved empty for TT-10.
- `scenario/vesselGenerator.ts` `generateVessels(opts)`; `scenario/overrides.ts` `applyOverrides`, `validateOverrides` (returns message keys), `spreadSts`, `LIMITS`.
- `engine/subsystems/berth.ts` (berth queue FIFO, one berth decision and one split decision pending at a time; `validateBerth`, `validateSplit` throw → run fails), `quay.ts` (`continueWork`, `workOrder`, twin-20, ground-position requests per box with reserved lanes shown as occupied), `rail.ts` (`reserveRail`, `releaseRail`, `wakeRail`, `startReposition`, `gantryPositionAt`, `railOrder`).
- Decision points `berthAllocation` (`first-fit`, `best-fit`) and `craneSplit` (`balanced-moves`, `equal-bays`) in `decisions/quayStrategies.ts`.
- Invariants `sts.rail-order`, `berth.no-overlap`. Query: `vessels()`, `vesselSlots(vesselId?)`, `stsList()` (rail order).
- KPIs: `sts.*.{cycles,twinLifts,railWaitS}`, `vessels.*.{sizeClass,arrivedAtS,anchorageWaitS,berthX,sts}`, `quay.{vesselsWaited,anchorageWaitS}` (in goldens).
- Fixtures: `two-vessels-compete-for-berth`, `crane-split-4sts` (seed 1 so the two split strategies differ), `twin-20-lift`; tracer and TT-22's `liveries-mixed` rebuilt on vessel calls. Ground positions per STS are generous (10–30) until SHCs clear them — TT-05 should lower them.
- Browser: `EntityStateChange.berthX` (vessels), `CustodyChange.dx` (twin box offset on the spreader), `compactMotion` keeps the latest segment PER AXIS on Run-to. `SceneModel(config, seed)`; `vesselPlacement(id,t)` (berth or anchorage row offshore). Hulls per class in `SceneRenderer.addVessel` (colour from the livery atlas by the vessel name's line prefix). Setup dialog: quay length, STS count, `components/setup/VesselTable.vue` + generator; `ScenarioChoice.overrides`; `__tt.load(name, { overrides })`; `__tt.query('vesselSlots', vesselId?)`.

#### Gotchas
- Twin-20 boxes are released one after another (two `StsGrounded`) within one cycle [A].
- A crane only gantries after reserving the rail; reservations shrink at `StsPicked`. New gantry-moving equipment logic must keep `railLo ≤ position ≤ railHi` or `sts.rail-order` fires.
- Free cranes yield only if their other neighbour leaves room; busy cranes are never pushed.
- Strict FIFO berth queue: a vessel longer than the quay blocks it for good (dialog warns).
- Smoke tests use fixed ports 5199/5198: parallel agents collide ("port already used") — just retry.

### ticket-31

### Ticket 31 (TT-20): locale, units, message catalogue, shortcuts

Branch `tt/31-locale-units-shortcuts`. Guide: `terminal-twin-AGENTS.md` § "Locale, units, message catalogue, shortcuts (TT-20)". GLOSSARY: Display settings, Message catalogue.

#### Files (src/sims/terminal-twin/)
- `i18n/messages.ts`: `t(key, params)` with `{name}` placeholders; `MessageKey` type; `catalogues` (en only).
  **Every user-visible string in a .vue must be a catalogue key.** `tests/message-catalogue.test.ts` parses every SFC under the sim and fails on:
  template text with letters, static title/aria-label/placeholder/alt/label, and string literals that look like UI text (2+ words or one Capitalised word) in `<script>` or template expressions.
  Workarounds that fail: `'Paused'`, `'Start…'`, `` `Elapsed ${x}` ``. Fine: ids, CSS classes, lowercase keys, `t(\`status.${s}\`)`.
- `i18n/format.ts`: `createFormatter({locale, units})` → `clock(startIso, t)` {day,date,time,elapsed}, `dateTime`, `number(n, digits)`, `length(m)`, `speed(m/s)` (km/h | mi/h), `mass(t)` (t | US tons), `movesPerHour`, `teu`, `firstDayOfWeek()`, `weekdayName(d)`. Also `firstDayOfWeek(locale)`, `localeRegion`, `canonicalLocale`.
- `i18n/display.ts`: `browserDisplayDefaults(languages)` (US → imperial), `loadDisplaySettings(storage, languages)` / `saveDisplaySettings` (localStorage key `terminal-twin.display`), `runConfigFor(base, startIso, display)`.
- `scenario/types.ts`: `ScenarioConfig.display?: DisplaySettings {locale, units: 'metric'|'imperial'}` (engine ignores it; hash unchanged; schemaVersion still 1). `DisplaySettings`/`UnitSystem` types live here.
- `modules/time.ts`: `clockParts` removed (use `store.fmt.clock`).
- `modules/shortcuts.ts`: `SHORTCUT_HELP` (help rows), `shortcutFor(KeyLike)`, `isTypingTarget`. `composables/useTwinShortcuts.ts` maps actions to store (mounted in TerminalTwin.vue).
- `components/modals/ShortcutHelp.vue` (role=dialog "Keyboard shortcuts"); TopBar has a `?` button (`data-testid=tt-help-button`).
- SetupDialog: "Display" fieldset (select `tt-locale`, radios `tt-units-metric|imperial`, preview `tt-display-preview`) and an "At a glance" summary (`tt-summary-{quay,sts,containers,gantry,trolley,hoist}`).

#### Store additions (twinStore)
- `display`, `fmt` (computed Formatter), `config` (SI run config + current display = what TT-17 save should store), `setDisplay(partial)` (live, remembered, patches `config.display`).
- `following`, `toggleFollow()` (needs selection; scene loop re-aims each frame), `overlaysVisible` + `toggleOverlays()` (state + toast only; TT-18 overlays should read it), `dashboardOpen` + `toggleDashboard()` (placeholder `<section data-testid=tt-dashboard>` in TerminalTwin.vue; TT-16 replaces it), `helpOpen`/`setHelpOpen`, `toast` + internal `showToast(key)`.
- `setSpeedStep(i)`, `pause()`, `step()`. `select(null)` also stops following.

#### Shortcut mapping
Space toggle; `1`–`9` = SPEEDS ×1…×600 (plays); `0` = pause; `.` step; F; Esc (close help, else deselect); D; O; `?`. Ignored: modifiers, typing targets (any input/select/textarea/contenteditable), key repeat (except `.`), setup phase. Space preventDefault (no button double-activation).
`useGodModeHotkey` is NOT mounted in TT (would clash with o/d) — keep it that way.

#### Dev API additions
`__tt.display()`, `__tt.setDisplay({locale?, units?})`, `__tt.config()`, `__tt.ui()` → `{selectedId, following, overlaysVisible, dashboardOpen, helpOpen}`.

#### Tests
- Vitest: `tests/display-format.test.ts`, `display-settings.test.ts` (incl. SI config + same hash imperial/metric), `message-catalogue.test.ts`.
- Playwright: `tests/browser/terminal-twin-display.smoke.ts` (uses `test.use({ locale, timezoneId: 'UTC' })`; tracer ends ~1169 s so clock tests use a 13:45 start).

#### Gotchas
- ICU differences: de weekday "Mo" vs "Mo." — match loosely. Node 22 lacks `Intl.Locale#getWeekInfo`; region-table fallback.
- datetime-local inputs render in the browser locale, not the chosen one.
- New readouts (cycle time TT setup, KPI strip, inspector) must use `store.fmt` + catalogue labels or the audit test fails.

### ticket-32

### Ticket 32 (TT-22): phase 2 asset pipeline + container models — what later tickets build on

Branch `tt/32-container-assets`. Full docs: `terminal-twin-AGENTS.md` § "Phase 2 asset pipeline"; glossary § "3D assets (phase 2)".

#### Commands
- `npm run tt:assets -- --python <bpy python>` (or `TT_BPY_PYTHON`): bpy generators → staging → gltf-transform `dedup+prune+meshopt` → replaces `assets/models/<group>/` wholesale → budget check. ~80 s. Here: `--python $SP/toolcheck/venv/bin/python`.
  - `--check` byte-compares a fresh regeneration with the commit (passes: deterministic). `--no-previews` keeps committed previews.
- `npm run tt:assets:check` = budget check (also Vitest `tests/asset-budgets.test.ts` + a PR CI step). JSON chunk only, no Blender.
- `npm run tt:assets:shots` → `.screenshots/assets/<asset>-lod0/1.png` + `yard.png` (headless viewer).
- Viewer: `/sim/terminal-twin?viewer=<asset>|yard` (dev only; `window.__ttAssets` in `dev/assetViewerApi.ts`).

#### Files
- `assets/generators/build.py` (entry, `GROUPS`), `tt_assets/blender.py` (MeshBuilder quads w/ per-corner UVs, `textured_material`, `export_glb`, previews), `containers.py`, `liveries.py` (LIVERIES = atlas index order, atlas regions, normal map), `fonts/` (OFL TTFs + licences), `requirements.txt` (bpy==5.2.3, Python 3.13).
- `assets/budgets.json`: kinds container (+ STS/ASC/SHC/truck/vessel/building pre-filled from spec table), `requiredNodes`, `requiredMetaFields`, 15 MB library.
- `assets/models/containers/`: `container-{20,40,40hc}.glb` + `.meta.json`, `livery-atlas.json`, `previews/*.webp`.
- `cli/assets/`: `build.ts`, `budgetCheck.ts` (`checkAssetLibrary(dir?, budgets?)`, `runBudgetCli`), `glb.ts` (JSON-chunk reader, `subtreeStats`), `check.ts`, `screenshots.ts`.
- `modules/containerAssets.ts`: `loadContainerAssets()` (cached per page; meshopt decoder from three; LOD0 body+doors merged), `liveryMaterial()` (UV tile shift via `liveryIndex` attribute + `liveryBase` uniform), `liveryIndexForLine`, `loadGltf`, `bakeLod`.
- `modules/containerInstancer.ts`: placeholders → per size×LOD InstancedMesh; `begin/push(key,size,centre,livery)/end(cameraPos)`; `DEFAULT_LOD_OPTIONS` {lod0Cap 300, 140 m, hysteresis 1.15}; `cost()`, `renderedContainer(key)`.
- `dev/AssetViewer.vue`, `dev/assetViewerScene.ts` (rig sliders generated from sidecar `travelLimits`).

#### Conventions (reuse for STS/ASC/SHC/truck/vessel)
- Root node = asset name; `LOD0/LOD1(/LOD2)` children; rig nodes named per spec with origin at pivot; every non-root node listed in sidecar `nodes` (check fails otherwise).
- glTF +Y up, metres, origin at ground contact; Blender authoring Z-up (glTF Z = −Blender Y). Rotation about Blender +Z = glTF +Y.
- Sidecar fields: asset, kind, dimensions, axes, nodes, travelLimits ({type rotation minDeg/maxDeg | translation minM/maxM, axis, rest}), attachPoints, groundContact, lods, provenance [{fact, tag V/P/A/M, source|reason}].
- Textures: Blender exporter WebP (`export_image_format='WEBP'`); never Draco/KTX2 (check rejects them).

#### Dev API / renderer changes
- `SceneRenderer.update(t, selectedId, cameraPosition)` (camera now required). `scene()` adds `containerLods {lod0,lod1}`, `containerAssets 'placeholder'|'loaded'`. `sceneState().liveries[id] = {index,size,lod}`. `cameraTo(id, distanceM?)` (TwinView too).
- LINE_COLOURS removed from sceneRenderer; colours come from `livery-atlas.json`.
- Twin sun: `shadow.normalBias 0.35` (needed against corrugation acne).
- New fixture `liveries-mixed` (12 boxes, 10 lines, sizes 20/40/40HC) + golden.
- Viewer strings are in `i18n/messages.ts` (`assetViewer.*`): the TT-20 audit covers dev/*.vue too.

#### Gotchas
- Containers in the twin are translation-only instances (no yaw); add a rotation to `push()` when yard/vessel orientation matters.
- Yard 18k boxes: 264k container tris, 14 draw calls/frame; SwiftShader fps ~0.3 (meaningless). TT-19 fps target not checked on a GPU.
- `.gitignore` has `out` (CRA leftover): don't name asset dirs `out`. Also ignores `*.blend`, `__pycache__/`, `.venv-bpy/`.
- npm devDeps added: @gltf-transform/{core,extensions,functions} ^4.5, meshoptimizer ^1.3 (sharp comes in as optional).
- Smoke: `tests/browser/container-assets.smoke.ts` (liveries, LOD switch, offline asset requests, viewer per asset, yard budget; ~50 s).

### ticket-33 (TT-06): ASC block storage

Branch `tt/33-asc-block-storage`, merged (5f944e4). Guide: `terminal-twin-AGENTS.md` § "ASC block storage (TT-06)". Replaces `ascStub.ts`; the asc `real` throw is gone.

- **Engine:** `engine/subsystems/asc.ts`, `engine/yardLayout.ts` (slot ids like `B01:03-5-2`: 8 rows, 20 ft bays, tiers; a 40 ft box covers two bays, named by its lower bay). Default ASC mode is `real` when SHCs and blocks exist.
- **Flow:** `ShcDroppedAtWtp` asks the `yardAllocation` DP (v1; strategies `random`, `nearest-wtp` default, `group-by-vessel`; use `candidateSlots(request)`). One request at a time per block. `ShcCleared` makes the box eligible; the ASC picks the oldest allocated, cleared job unless an older claim shares its stack (`claimSeq`).
- **ASC events:** `AscJobAssigned → AscRoutingToPad → AscPositioningAtPad → AscLocking → AscPicked → AscRoutingToSlot → AscPositioningAtSlot → AscUnlocking → AscStacked → AscReady`, each carrying the gantry (Z), trolley (X) and hoist segments. The ASC reserves the pad zone via `reservations.ts`.
- **State:** `SimState.yardSlots`, `SimState.yardBlocks` (claimed heights, `topVessels`), `ascJobs` (deleted at `AscStacked`). Invariants: `yard.slot-bounds`, `yard.stack-height`, `yard.no-floating`, `yard.no-double-occupied`, `yard.no-mixed-length-overlap`, `asc.wtp-handover`. `kpiReport().yard`; queries `asc ascs ascJobs yardBlock(s) yardSlot(s)`. ENGINE_VERSION 0.4.0.
- **Config:** `BlockConfig` adds `bays, tiers, transferStalls`; `kinematics.asc`, `DEFAULT_ASC_KINEMATICS`; builder `.block() .ascKinematics()`, `withYard()`. Fixture `asc-1sts-10-boxes-1block`. The SHC fixture `shc-1sts-2shc-1wtp` is pinned to `asc:'instant'` (its golden was regenerated on purpose).
- **Browser:** worker deltas for ASC motion/status, query kinds `asc ascList yardBlocks yardSlots`, `SceneModel.ascPose`, procedural blocks and ASCs, setup fieldset "Yard blocks and ASC", `__tt.load(name,{yard})`, `sceneState().ascs`. Smoke: `tests/browser/terminal-twin-asc.smoke.ts`.
- **For later tickets:** nothing frees stack space yet (a full block leaves boxes on pads: `allocationFailures`). Retrieval must delete the slot, lower `heights`/`topVessels` and add rehandle events. Reuse `AscTrip`, `install`, `scheduleNext`, `advance`, the pad-zone reservation pattern, `ascPoseAt`, `shcPositionAt`. More ASCs per block need an ASC-ASC rail reservation like `rail.ts`; `ascIdOf(blockId)` assumes one ASC (`B01-ASC1`) and `SceneModel.blockOfAsc` strips `-ASC<n>`. Transfer stalls (TT-13) exist in config and drawing only; the truck flow needs a custody kind `truck` plus `custodyHolders` entries. Max 5 pads/stalls per block (enforced only by the setup dialog). The yardAllocation request carries two arrays of bays × 8 entries: revisit in TT-19.

### ticket-34 (TT-18): debugger and inspection UI

Merged. Guide: `terminal-twin-AGENTS.md` (debugger sections), GLOSSARY.

- **Panels:** `E` = left panel (Step, Continue, breakpoints, event feed), `I` = right panel (event inspector, entity inspector). Overlay toggle bar is bottom-centre; new UI must not clash with the panels or the E/I shortcuts.
- **Breakpoints** (`modules/breakpoints.ts`): event type, container id, equipment id, decision point. `eventMatchesBreakpoint` is the worker's stop predicate; `Delta.breakpoint` reports a hit (all hand-built `Delta` objects in tests need `breakpoint: null`). A breakpoint only catches events not yet processed (the engine runs up to `max(5 s, 1.5 s × speed)` ahead while playing).
- **Picking/inspector:** `modules/picking.ts` (oriented boxes), `modules/entityInspector.ts`, `modules/overlayLayers.ts`, `modules/equipmentDims.ts` (STS/SHC/ASC dimensions; keep in sync with the 3D models since picking uses them; SHC there is still the placeholder 9.2 × 4.9 × 6.2 m, not the TT-25 rig box). **New equipment kind:** add it in `entityBounds` and `pickEntity` (picking.ts), `entityKind` and `describeEntity` (entityInspector.ts), the labelled-id list in overlayLayers.ts, and catalogue keys `inspector.kind.*` / `inspector.fact.*`.
- **Overlays:** `laneGraph`, `reservations`, `occupancy`, `labels`; `O` masters them. Not built: an ASC reserved-rail-segment overlay (add it with TT-08, which introduces ASC rail reservations).
- **Feed:** `store.recentEvents` capped at 1000 (`FEED_BUFFER_CAP`); TT-16 replaces the `store.dashboardOpen` placeholder.
- **Dev API:** `addBreakpoint removeBreakpoint clearBreakpoints breakpoints inspectEvent debug pickAt screenPoint cameraTarget`; `ui()` adds `feedOpen inspectorOpen`.
- **Smoke:** 9 new debugger specs. Three older smoke tests failed under load (clock ratio, SHC ×600 frame count, 18k-yard draw-call budget: 26 vs limit 20, also failing on the base). Rerun on a quiet machine.

### ticket-35 (TT-25): SHC 3D model

Merged. Guide: `terminal-twin-AGENTS.md` § "SHC model (TT-25)".

- **Asset:** `assets/models/shc/shc.glb` + sidecar + previews; generators `tt_assets/shc.py` (geometry) and `shc_meta.py`; `budgets.json` shc entry; `tt:assets -- --only <group>`. Proportions are tagged `A` (the TTI reference pack is not in the repo); tune the constants at the top of `shc.py`.
- **Renderer:** `modules/shcAssets.ts` (`loadShcModel`, `ShcRig`, `SHC_RIG`) loads the GLB behind the procedural placeholder; LODs 0–2 at 110 m / 380 m. `ShcPose` adds `yaw steerRad odometerM travelling`; `ContainerPose.carriedBy`. Dev API: `scene().shcLods/shcAssets`, `sceneState().shcRigs`, viewer `?viewer=shc`.
- **Conventions for the STS/ASC/truck models:** every LOD repeats the rig node names (GLTFLoader renames duplicates; look nodes up via `userData.name` and animate every node of that name). Blender object names carry an `@LODn` suffix that `build.py strip_lod_suffix` removes from the GLB JSON. `container_attach` is the top of the carried box. Move the `Part` helpers (beam, plate, revolve) from `shc.py` into a shared module before the STS/ASC models. Use `liveries._Canvas` and `shc_meta.render_atlas` for swatch atlases.
- **Gotchas:** SHC corners are visual only (the engine still stops at each turn). `tt:assets` is slow when several Blender jobs share the CPU; use `--only`. A bpy 5.2.3 venv (Python 3.13) is needed for regeneration. Don't use `pkill -f` patterns that match your own shell.

### ticket-39 (TT-08): paired ASCs per block

Merged. Guide: `terminal-twin-AGENTS.md` § "Paired ASCs (TT-08)".

- `yard.ascsPerBlock` 1|2 (engine default 1, setup dialog default 2). Ids `<block>-ASC1` (waterside), `-ASC2` (landside); `ascIdOf(blockId, n)`, `ascIndexOf`.
- **Rail:** half-bay segments, zone `<block>:R<k>`, min ASC centre separation 12 m (assumed 8 m portal + 4 m gap). Each trip reserves its window per segment via `reservations.ts`; an idle ASC holds an open-ended park hold (`PARK_UNTIL_S` = 1e9). Conflicts delay the trip (rail wait) or make an idle ASC step aside (`AscYieldAssigned`). Invariant `asc.no-passing` (real mode only).
- **Dispatch:** `ascDispatch` DP v1 (`waterside-first` default, `balanced`); not called with one ASC. Default sends everything to ASC1, so ASC2 idles until TT-13 transfer-stall work (`job.kind 'transfer'` goes to the landside ASC).
- **For TT-10/12:** rehandles go through `planJob` / `maybeDispatchAsc` and the same segment windows (`occupancyPieces`, `pieceWindows`). Rail extends 16 m past the pads (`RAIL_MARGIN_M`). KPIs add `railWaitS busyS yields` for twin blocks. `ascRail` overlay in `modules/overlays.ts`; `scene().reservedRailSegments`. Fixture `asc-2asc-block-conflict`.
- Smoke: run with `--reporter=list` redirected to a file when the machine is loaded.

### ticket-38 (TT-07): KPIs, end conditions, final report

Merged. Guide: `terminal-twin-AGENTS.md` § "KPIs, end conditions and final report (TT-07)".

- **Collector:** `engine/kpi/collector.ts` + `clock.ts`, `Simulation.kpiSeries()`; a pure fold over committed events, rebuilt by replaying the log on restore; no effect on the hash or goldens. Per-hour components, so shift/whole-run ratios are exact. Add a KPI = a row in `KPI_DEFS` + an `observe` case. **TT-10/13 retrieval must lower `yard.fill-pct`** (it only grows on `AscStacked` now).
- **Buckets:** shifts 3 × 8 h (06-14, 14-22, 22-06); `config.kpi {startTimeOfDayS?, shiftStartHour?}` (optional, schemaVersion still 1); `runConfigFor` sets it from local time.
- **UI:** `components/KpiStrip.vue` (thresholds are illustrative, not from the spec), `components/FinalReport.vue` (docked panel, JSON/CSV exports via `engine/export.ts`), setup "End conditions" fieldset (`modules/endConditions.ts`). `store.runEnded` is the single "run over" flag: any new transport or time control must no-op when true.
- **CLI:** `--kpi-json --kpi-csv --events-json --events-csv`, `--end moves:n|vessels:n|time:s`, `Headline KPIs:` block.
- **Gotchas:** an unreachable end condition just idles. Setup number inputs must not carry `min`/`step` (native validation hides the catalogue errors).

### ticket-41 (TT-16): dashboard tab

Merged. Guide: `terminal-twin-AGENTS.md` § "Dashboard (TT-16)".

- `D` / top-bar button opens it (Charts + Final report tabs); it auto-opens on the report tab once when a run ends. `echarts@6` is lazy via `modules/chartLib.ts` (own 646 kB chunk; a source-scan test and a prod smoke test guard that it is not fetched until opened). Worker query `dashboard`; `engine/kpi/timeline.ts` `buildTimeline(events, now)` feeds the Gantt. Dev API `__tt.openDashboard({tab, group, bucketing})`, `__tt.dashboard()`.
- **New KPI row** in `KPI_DEFS` fails `tests/dashboard-model.test.ts` until listed in `KPI_GROUPS` (`modules/dashboardModel.ts`) and given a `dashboard.kpi.<id>` catalogue key. New equipment kinds need nothing. New Gantt phases: extend `buildTimeline`, `PHASE_COLOURS/PATTERNS`, `dashboard.gantt.*` keys, and re-validate the palette (dark-only, validated with the dataviz validator).
- The dashboard overlay is z-index 8 over `.scene`, below the top bar; the docked `FinalReport` is hidden while it is open. Yard fill heatmap uses `blockFillPct` (drops on retrieval); the KPI `yard.fill-pct` gauge still only grows.

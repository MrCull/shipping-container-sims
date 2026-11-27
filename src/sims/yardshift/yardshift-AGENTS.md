# Yardshift, agent guide

Phone-first container yard puzzle (spec #374). Collect containers in number order into the collection truck,
rehandle the ones in the way, clear the yard. Behavioural baseline: the V20 prototype (see the spec); not its code.

## Architecture: three layers, two pure seams

1. **Engine** (`modules/engine.ts`, types in `types/engine.ts`): pure TS, no DOM, timers or `Date.now`.
   `createShift(level)` returns a `Shift` with `dispatch(action)` (next state and events, or a typed `Rejection`
   with a reason code and message; a rejection changes nothing), `tick(dtMs)` (the injected clock, see Clocks),
   read-only `state`, the `events` log and `onEvent(listener)`. `rejectionFor(state, action)` is the single
   legality rule set; the presentation layer and the solver reuse it. `applyAction(state, action)` is the pure
   transition (no legality check) that `dispatch` and the solver share. Actions so far: `collect` (with `from`, or
   without to collect the exposed next container), `rehandle(from, to)`, `receive(to)`.
   - **Heavy rule:** a heavy container (`level.heavy`) goes only on an empty stack or another heavy container, for
     rehandles and receipts alike (reason `heavy`).
   - **Receipt rule core (#382, gameplay in #384):** the state carries `receipts` (trucks served) and `deadline` (moves
     left on the waiting truck, null when none). A truck activates when none waits and `collected >= arrival.after`,
     at the start and after every move; collections and rehandles count the deadline down before activation, so the
     triggering move never counts; receipts do not count; deadline 0 rejects everything but `receive`
     (`receive-first`); completion needs every truck served. Events `received`, `arrival` and `deadline-zero` (once,
     when the waiting truck becomes mandatory, including an arrival with 0 moves).
   - **Blocked failure (#384):** after every move and at the start, a playing shift with no legal collect, rehandle
     or receive (`hasLegalMove`, pauses ignored) fails with `failure.reason` `blocked` and a `failed` event; the
     message names the mandatory receipt when the deadline is 0 (no legal space for its cargo).
2. **Presentation** (`modules/presentation.ts`, types in `types/presentation.ts`): pure TS.
   `present(state, ui, viewport)` returns the view-model (containers with labels, selection, legal destinations,
   HUD strings, hint, hit regions). Hit regions come from `layoutFor(stackCount, viewport)` only, never from
   container or animated positions. `input(ui, event, state)` returns the next UI state and at most one engine action
   (it takes the state too, to tell a collect tap from a select tap). `hitTest(regions, x, y)` maps a point to a
   target; regions never overlap, so the collection and receipt bays never resolve to each other.
3. **Renderers** (thin): `composables/useYardScene.ts` (Three.js, fixed orthographic camera pitched down and
   turned a little sideways, two truck bays; every object is placed by projecting a layout point onto the ground, so
   it sits inside its hit region; renders only when the view-model, the crane move or the size changes; see Scene),
   `Yardshift.vue` and `components/ui/YardHud.vue` (Vue HUD). Pointer and key events go to the store
   (`pointerDown`/`pointerMove`/`pointerUp`, `key`, `tapAt`) and from there to `input`; nothing else interprets them.

`store/yardshiftStore.ts` (Pinia) is glue: it holds the `Shift`, UI state and viewport.

## Scene (review of #374)

- Scene adapter: `build` makes the meshes once per layout key (surface width and height, stack count, capacity; a
  new key also puts the trolley back over the yard centre) and `update` only sets transforms, colours, label maps and
  visibility each render. `disposeTree` disposes each geometry and material once even when meshes share them (the
  gantry legs, the label meshes). Never create geometry or materials in `update`.
- Containers: bodies are one `InstancedMesh` (instance colour: sequence colour, grey, selected gold, arrival orange,
  darkened when `dimYard`, mixed 35 % toward red when `urgent`) with one shared canvas corrugation normal map.
  `containerMesh(built, slot, draw, now)` draws yard containers, the receipt cargo and the container on the hook
  alike. Each container's label is one mesh (its top and front faces merged) with a transparent texture of the
  number, the gold medallion (`bonus`) and the "H" tile (`heavy`); the cache key is the label and badges only, so it
  holds at most one texture per id and badge pair of a level.
- `ContainerView.heavy` (and `ReceiptCargoView.heavy`) draw the H badge, also buried or grey. `ContainerView.glint`
  (a bonus container on top of its stack, false under reduced motion) rocks the container a few degrees and sweeps a
  gold flash over its label; render only, hit regions unchanged.
- Cheap extras: baked contact-shadow quads (one `InstancedMesh`: the two trucks, each non-empty stack, a lifted
  container) and a harbour backdrop behind the yard (apron, water, quay edge, three ship-to-shore crane and two ship
  silhouettes merged into one mesh). About 30 draw calls on a level of 16 containers.
- Smoke frame cost: the tutorial spec went from 8.1 s to 4.6 s and the receipt spec from 4.2 and 5.5 s to 1.4 and
  2.0 s (`--repeat-each=2`, dev project) once the scene stopped rebuilding every frame.
- Screenshot: `docs/prototypes/review-374/level-11-heavy-harbour.png` (level 11 at 390 px).

## Clocks and the crane (#383)

- State holds `shiftMs`, `truckMs`, `truckAllowanceMs`, `operations` (collections plus receipts), `overtime`,
  `pauses` and `failure`. `tick(dtMs)` caps each step at `MAX_STEP_MS` (100 ms) and does nothing while any pause
  reason is held or the shift is over. Allowances come from `level.truckSeconds` (tutorial 30/20/15, others
  `truckSecondsFrom(first)`: x1, 0.5, 0.28); a collect or receive resets the next-truck clock to the next allowance,
  a rehandle adds `REHANDLE_CREDIT_MS` (+1 s, `time-credit` event) and never touches the shift. With the truck clock
  at 0 the part of a step past it drains the shift at `level.overtimeMultiplier` (`overtime-start`/`-end` events).
  Shift 0 sets status `failed` with `failure.reason` `timeout` (`failed` event). Clocks never go negative.
- Pause reasons (`pause`/`resume` actions, each held on its own): `intro`, `player`, `animation`, `hidden`. While
  `animation` is held every move is rejected as `crane-busy`, and `input` drops taps (no queued double move).
- `clocksView(state)` (presentation) gives both HUD clocks: text, bar fraction (truck: value over
  max(allowance, value), never above 1), red, shake (overtime on both). `craneDurationMs(dx)` is
  330 + |dx| x 0.38 ms, capped at `CRANE_MAX_MS` 460 (story 20; a desktop yard would otherwise reach 600 ms), with `moveSpan(layout, action, state)` giving the screen x travel.
- Host: `Yardshift.vue` runs a requestAnimationFrame loop calling `store.frame(now)` and forwards
  `visibilitychange` to `store.setHidden`. `store.startMove` holds `animation`, animates `store.move.progress`
  0..1 (the scene draws the gantry phases: travel, lower, lift, travel, lower, release), then releases the pause
  and dispatches the action. Reduced motion dispatches at once. The dev hook's `applyActions` skips the animation.
  The intro screen holds `intro`, the pause menu and level picker hold `player` (#386).

## Receipts in the UI (#384)

- `UiState.selection` is a stack index, `'receipt'` (the waiting truck is selected) or null. `input`: a receipt bay tap
  selects the waiting truck (again, or with no truck, clears); truck then stack sends `receive(to)`; truck then
  collection only clears; at deadline 0 a stack tap with nothing selected does nothing (the hint names the truck).
- `present` adds `receiptCargo` (the waiting container, drawn on the receipt truck bed in arrival orange),
  `incoming` (`status` none, optional or mandatory; band text "↑ RECEIPT #8 · 3 MOVES LEFT" or "· MANDATORY"; bay
  status "NO TRUCK", "n MOVE(S) LEFT", "MANDATORY NOW"), and `dimYard` and `arrow` (`'receipt'`), both set only at
  deadline 0 while the truck is not selected. With the truck selected, `destinations` are the stacks `receive` accepts.
- `Yardshift.vue` draws the incoming band (fixed 26 px height, always present, so an arrival never moves the layout;
  `layoutFor` never depends on receipts), the dim overlay over `layout.yard`, the bobbing arrow over the receipt bay
  (static under reduced motion) and the arrival announcement (`store.announcement`, 1.6 s, set on every `arrival` event
  and on level load with a truck waiting; it neither pauses the clocks nor blocks input). The scene darkens yard boxes
  when dimmed and tints the receipt bay red when mandatory.
- The receipt crane move: `CraneMove.from` is `RECEIPT_TRUCK` (-2); the crane lifts the cargo off the truck bed and
  lowers it onto the stack. `moveSpan` runs from the receipt bay centre to the column.

## Score, combo, colours and bonuses (#385)

- Engine (`withScore` in `modules/engine.ts`, judged against the state before the move): state `score` (can go
  negative), `combo`, `bestCombo`, `golds`, `bonusMs`. Receipt +100; collection `collectPoints(combo)`
  (100 + 50 x (min(combo, 5) - 1)); rehandle `rehandlePoints(from, to)` (-25 - 5 x stack distance); rehandles and
  receipts reset the combo. Shift time: +0.35 s (`QUICK_SERVICE_MS`) for a collect or receive started outside
  overtime, plus `comboShiftMs(combo)` (min(2 s, combo x 0.4 s) from the second collection in a chain). No shift cap.
- Bonus window: `state.bonusMs` is the window left for the next required container (0 = not eligible). It opens
  (`bonus-window` event) when a collect makes a `level.bonusIds` container next, with `level.bonusWindowSeconds`;
  `tick` counts it down except while a pause is held or the deadline is 0 (forced receipt); receipts and rehandles
  leave it alone. Collecting with `bonusMs > 0` adds +250 and +5 s and a gold (`bonus-awarded`); reaching 0 emits
  `bonus-missed` once. Undo (#386) keeps the smaller of now and the snapshot's `bonusMs` (no farming).
  Stars never read score or golds.
- Presentation: `ContainerView.slot` (0..5 or null), `colour` (`SEQUENCE_COLOURS` or `GREY`), `bonus` (medallion:
  a later bonus id, or the current one while its window is open, so it shows buried or grey and vanishes on a miss),
  `border` (selection only, never the current container). `view.queue` is the six HUD positions (empty slot `–`
  past the last container), `view.bonus` the open window (`{ id, text }`), `hud.score` and `hud.combo` (`×n`).
- Renderers: the scene paints each face texture in the container colour with the number and, on bonus containers,
  a gold star medallion; `components/ui/YardQueue.vue` shows queue, bonus countdown, score and combo; the store's
  `bonusPulse` replays a gold burst and "+250 · +5s" float over the collection bay. Sounds: see Audio cues.

## Undo, progress and screens (#386)

- **Undo** (`{ type: 'undo' }`, `undoRejection(state)`): every accepted move stores the state before it as
  `state.undoSnapshot` (whose own snapshot is null, so no chain). One per shift (`undosLeft`), allowed while playing and
  after a blocked failure, never after a timeout or completion. It returns to the snapshot (puzzle, combo, golds,
  receipts, deadline, rehandles) with score snapshot - 25, shift min(now, snapshot) - 3 s, truck clock, bonus window
  and `earnedMs` each min(now, snapshot) (no refund, no farming), clears the selection, re-runs the blocked check and
  re-announces (`arrival` event) a truck the undone move had served. Rejections: `nothing-to-undo`, `undo-used`,
  `undo-low-time` (shift 3 s or less). Event `undone`.
- `state.earnedMs`: shift time earned (quick service, combo, bonus), shown as "time earned" on the result screen.
- **Progress** (`modules/progress.ts`): `{ version, unlocked, levels: { [n]: { stars, score } } }` in
  `storage.sims.yardshift` of `src/utils/localStorage.ts`. `parseProgress` discards another version or a bad shape;
  `recordCompletion` keeps best stars and best score independently and unlocks the next level; `saveProgress` catches
  refused writes. Only level 1 starts unlocked; `unlockAllRequested(search, DEV, MODE)` honours `?unlock=all` in dev
  and smoke builds only. The store records a completion on the `completed` event.
- **Screens** (`modules/screens.ts`, rendered by `components/modals/YardScreens.vue`): `introView` (title, objective,
  three-star target and max, shift, tip), `resultView` (stars, verdict, actual and minimum rehandles, score, best combo,
  bonuses, time earned, `hasNext`), `failView` (title, reason, containers left, `canUndo` after a blocked failure),
  `pickerRows` (best stars, best score, locks), `undoView` (enabled, label, reason). Store `overlay`: `intro`, `pause`
  or `levels`; result and fail follow the shift status. The route opens on the intro of the highest unlocked level;
  `store.loadLevel(n, { intro: true })` holds the `intro` pause until `startShift`. The control bar under the hint has
  Pause, Undo (reason shown at 3 s or less) and Restart (restart skips the intro). U calls `store.undo()`; Esc opens the pause menu, and closes it (or the level
  picker) again.

## Input, urgency and coaching (#387)

- `UiEvent`: `tap`, `drag-start` (from), `drag-move` (over), `drag-end` (target) and `key` (`KeyboardEvent.key`).
  One resolution for all three: a key is a tap on its target (1 to 9 stacks, C collection, R receipt); a drag start
  selects its source (the waiting truck, or a non-empty stack unless the deadline is 0) and a drop is a tap on the
  target with that selection, except that a drop on the source, on nothing or on the receipt bay only clears. So the
  receipt and collection bays never resolve to each other by any input. U emits the engine's `{ type: 'undo' }`
  (`UiAction` is `ShiftAction`); Esc clears a selection or drag first, then
  sends `pause`/`resume` with reason `player`. Input is dropped while the crane animates.
- Store: a pointer moving more than `DRAG_THRESHOLD_PX` (6) from where it went down starts a drag; otherwise
  pointer up is a tap. `Yardshift.vue` listens for game keys on `window` (not while typing in a field).
- Urgency (`urgencyRisk(state, current)`, V20): every container takes the shift-end risk (0 above 9 s, 1 at 3 s);
  the current container (the next one, or the receipt cargo at deadline 0) also takes 0.08 from the start of its
  turn, rising to 1 as the next-truck clock falls from 35% of its allowance to 0. `ContainerView` and
  `ReceiptCargoView` carry `shake` (risk; 0 under reduced motion) and `urgent` (reduced motion and risk at least
  `URGENT_RISK` 0.5). `UiState.reducedMotion` comes from `setReducedMotion`. The scene offsets the mesh only
  (amplitude 0.65 + 3.35 x risk px) or adds a static red glow; hit regions never move.
- Coaching (hint): `tutorialCoaching` levels coach collect #1, move the blocker to an empty stack, then collect in
  order; `heavyHints` levels (11, 12) say "Heavy #n · Choose a highlighted stack: heavy on heavy or empty." or
  "... No valid stack. Make space first." while heavy cargo is selected; 13 has none. Rejection messages (the store's
  `message`, shown over the hint) stay on every level.

## Screen layout, phone first (#389)

- `modules/screenLayout.ts` (pure): `screenLayout(box, insets)` stacks the HUD, queue, incoming band, play surface,
  hint and control bar top to bottom inside the safe area (`box` minus `insets`). Fixed band heights come from
  `bandHeights(width)` (the HUD takes two rows below `WIDE_PX` 620, one row above); the surface takes the rest
  (never under `MIN_SURFACE_PX` 200), so the yard is the hero. On a desktop the column is at most `MAX_COLUMN_PX`
  880 wide, centred. Helpers `overlaps`, `contains`, `offset` (surface rect to page rect).
- `Yardshift.vue` measures its root (top edge to the window bottom, so the page never scrolls) and the safe-area
  insets (a hidden probe padded with `env(safe-area-inset-*)`), places every band absolutely at its rect
  (`overflow: hidden`), and gives the store the surface size as the presentation viewport. `SimPage.vue` uses
  `100dvh` and hides its centred sim name below 480 px (it was clipped and sat under the menu button).
- `layoutFor` uses whole-pixel column edges (neighbours share an edge, no float overlap). `view.arrowAt` is the
  mandatory-receipt arrow's box: inside the receipt bay, under its label, never over a stack or the yard.
- `modules/screenLayout.test.ts`: at 390 px (under the site header, and full screen with notch insets), tablet and
  two desktop sizes, no band overlaps another or leaves the safe area, the surface is the tallest band and over 55 %
  of the safe height, every level's stack and bay regions sit inside the surface without overlapping, the arrow is
  in the receipt bay; plus singular and plural copy ("1 MOVE LEFT", "1 rehandle", "1 star bonus").
- Scene: the gantry beam runs along the slanted row of stacks (first to last column, legs just outside) and moves
  across it with the trolley; the trolley rest point resets when the surface size or stack count changes.
- Cover: `assets/cover.png` is a 640x360 capture of level 6 at 1280 px (8-bit palette, about 19 KB); recapture with
  `pnpm run screenshot --path "/sim/yardshift?unlock=all" --width 1280 --height 760 --scale 2` plus
  `window.__ys.loadLevel(6)` and the first four fixture actions, then crop the game column to 16:9.

## Audio cues (#388)

- Engine threshold events: `shift-low` (`seconds`, at each of `SHIFT_LOW_SECONDS` 9, 5, 3, 2, 1 s crossed going down),
  `truck-low` (the next-truck clock crosses `TRUCK_LOW_SHARE` 35 % of the same allowance) and `deadline-one` (moves
  left drops to 1). Each fires once per crossing, from `tick` and from `dispatch` (undo can cross a shift threshold),
  never per frame (`modules/clocks.test.ts`).
- `modules/audioCues.ts` (pure): `cuesForStep(after, events)` maps one engine step's events (a `dispatch` or a
  `tick`) to cues in event order (collect, combo, receive, rehandle, arrival, deadline-one, deadline-zero, overtime
  start and end, bonus window, jackpot, bonus missed, truck-low, `shift-tick` from `shift-low`, win, timeout,
  blocked, undo). It never diffs states.
  `rejectionCue()` (invalid), `craneStartCue()`, `comboCue(c)` (pitch 660 + min(c, 8) x 65 Hz, ascending) and
  `craneCues(before, after)` (pick at progress `PICK_AT` 0.30, land at `LAND_AT` 0.88). Tones are V20's
  `tone(f0, f1, dur, vol, delay, type)` with `vol` a relative sound gain.
- Store: `step()` wraps every dispatch and tick and sends its cues to `onCue` listeners; `startMove` sends the
  crane start, `frame` the pick and land crossings; reduced motion sends only the landing.
- `composables/useYardAudio.ts` (mounted by `Yardshift.vue`): one Web Audio bus `GainNode` set from
  `gainFor(1, 'sfx')` and watched, so the shared sliders and mute change every sound live; the context starts on the
  first pointer or key press. No fixed volumes. Every oscillator or buffer source and its envelope gain disconnect on
  `onended` (`releaseOnEnded`, `composables/useYardAudio.test.ts`).
- Samples in `assets/audio/` (mono 64 kbit/s, trimmed with a fade out from `available-media/sound-samples`):
  `crane-pick.mp3` (first 0.6 s of `container-loaded-to-ship.mp3`), `crane-land.mp3` (first 0.7 s of
  `container-set-down-on-ship.mp3`), `truck.mp3` (1.6 s from 0.5 s of `quiet-truck-engine.mp3`; on arrival and
  receipt).
- **Music (#390):** `composables/useYardMusic.ts` (mounted by `Yardshift.vue`) loops one `Audio` element through
  `followMasterGain(element, MUSIC_GAIN, 'music')` (`MUSIC_GAIN` 0.3 in `modules/music.ts`), so the master and music
  sliders and mute change it live. `musicPlaying(state)` (pure, `modules/music.test.ts`): plays while the shift status
  is `playing` with no pause but `animation`; the intro, pause menu, level picker, a hidden tab and the end of the
  shift pause it. Unmount stops it and releases the element; the menu music stops when the home page unmounts. A
  blocked autoplay retries on the next pointer or key press.
- Track: `assets/audio/music-light-piano.mp3`, `available-media/sound-samples/background-gaming-light-piano.mp3`
  (60 s loop, the one candidate no other sim uses) re-encoded to 80 kbit/s stereo with metadata stripped (600 KB).
  Source and licence: the repo's pre-sourced `available-media/` set; `available-media/README.md` records no source
  or licence for the sound samples (as for the music in Stowage Master and Contenga), so confirm one before a
  public release.

## Levels

`modules/levels.ts` holds all 13 V20 levels exactly (`levels.test.ts` checks them against the V20 array). V20's code
rules keyed on the level index are explicit fields on each row, never chosen from the level number (a test scans the
source): `truckSeconds` (tutorial `[30, 20, 15]`, else `truck(first)`: first, x0.5, x0.28), `bonusEvery` (3 from
level 2, giving `bonusIds`), `bonusWindowSeconds`, `overtimeMultiplier` (2 on the tutorial, 3 elsewhere),
`tutorialCoaching`, `heavyHints` (11 and 12) and `tip`. There is no hand-entered minimum: the star target comes from
the solver fixture. Start a level in dev with `window.__ys.loadLevel(n)` (no intro) or the level picker. Arrival levels
(4, 6, 8, 9, 10, 13) start with a truck waiting.

## Solver and stars

- `modules/solver.ts`: `solve(level)` is A* over engine states (rehandle cost 1, collect and receive 0) with the
  engine's `rejectionFor` and `applyAction`, clocks ignored. Key: stacks as an unordered multiset, next, receipts and
  deadline. Heuristic: containers above a lower-numbered one (admissible and consistent). Returns null when no
  completion fits the rehandle cap. All 13 levels solve in under 15 ms each.
- `pnpm run ys:solve [n...]` writes `fixtures/level-NN.json` (minimum and one optimal action list); `--check` writes
  nothing and exits 1 on a missing or stale fixture, 2 on an unsolvable level. Re-run it after any level or rule change.
- `modules/fixtures.ts` loads the fixtures (Vite glob); `modules/stars.ts`: three stars at or below the fixture
  minimum, two at minimum + 1, one otherwise. Proven minima (#382) equal the V20 targets for all 13 levels:
  1, 3, 5, 3, 3, 6, 9, 6, 7, 11, 1, 4, 7.

## Colours

`styles/palette.css` (loaded by `Yardshift.vue`, scoped to `.yardshift`) holds the sim's own palette as `--ys-*`
properties: the six sequence colours, grey, gold, arrival orange, red and the panel shades. Background, text and muted
text use the shared tokens of `src/assets/main.css`. Components use those or `--ys-*`, never hex
(`modules/palette.test.ts`, which also keeps `--ys-seq-*` and `--ys-grey` equal to `SEQUENCE_COLOURS` and `GREY`). The
WebGL scene keeps its colours in TS.

## Dev hook

`window.__ys` (`dev/devApi.ts`), installed only when `import.meta.env.DEV || import.meta.env.MODE === 'smoke'` (as
Terminal Twin's `window.__tt`): `loadLevel(n)` (skips the intro), `applyActions(actions)` (undo too), `state()`, `solution(n)` (fixture actions),
`progress()`, and `hitRegions()` in client
coordinates so smoke tests tap real points.

## Tests and budget

- Unit tests (vitest, node environment, no DOM or WebGL): `modules/engine.test.ts`, `modules/presentation.test.ts`,
  `modules/receiptsView.test.ts`, `modules/screenLayout.test.ts`, `modules/clocks.test.ts`, `modules/clocksView.test.ts`, `modules/levels.test.ts`, `modules/scoring.test.ts`,
  `modules/presentationScore.test.ts`, `modules/inputCoaching.test.ts`, `modules/undo.test.ts`,
  `modules/progress.test.ts`, `modules/screens.test.ts`, `modules/audioCues.test.ts`, `store/yardshiftStoreAudio.test.ts`,
  `modules/music.test.ts`, `composables/useYardMusic.test.ts` (happy-dom), `composables/useYardAudio.test.ts`,
  `modules/palette.test.ts`,
  `modules/solver.test.ts` (every fixture replayed through the engine, and the solver
  re-proving every level), `modules/stars.test.ts`. The whole suite runs in about 2.1 s wall time (#391) through
  `pnpm test:sim yardshift` (#389); no test over 15 ms.
  Run `pnpm test:sim yardshift`. **Budget: the whole Yardshift suite under 5 s, no test over 1 s** (spec #374).
- Browser smoke (`@yardshift` group, `smoke:yardshift` label, `tests/browser/`): spec 1
  `yardshift-tutorial.smoke.ts` (phone viewport, home tile to route, tutorial won by touch taps); spec 2
  `yardshift-receipt.smoke.ts` (level 4 driven to a mandatory receipt through `window.__ys`: arrow over the receipt bay
  and dimming, both cleared by a real tap on the receipt truck); spec 3 `yardshift-progress.smoke.ts` (desktop
  viewport: level 1's fixture through `window.__ys` gives the result screen, the reload opens on level 2 and the
  picker shows level 1's stars and level 2 unlocked). Each spec under 10 s. Spec 1 taps "Start shift" first.
  Timings (review of #374, `--repeat-each=2`, dev project): tutorial 4.6 to 4.7 s, receipt 1.4 to 2.0 s, progress
  2.8 to 3.0 s (before the scene rework: 8.1, 4.2 to 5.5 and 2.3 to 2.9 s). A software-GL frame was about 140 ms there and a touch tap costs about 5 frames, so spec 1 reads the tap
  points once and waits for each crane move with a `raf`-polled `waitForFunction`, not `expect` retries.
- Music has no smoke spec (spec #374 allows three): `composables/useYardMusic.test.ts` (happy-dom, a fake `Audio`)
  covers the loop, the music channel, the sliders and mute, pause and unmount.

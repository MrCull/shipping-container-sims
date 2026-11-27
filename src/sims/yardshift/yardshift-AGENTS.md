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
3. **Renderers** (thin): `composables/useYardCanvas.ts` (Canvas 2D, see Renderer), `Yardshift.vue` and
   `components/ui/YardHud.vue`, `YardQueue.vue` (Vue HUD). Pointer and key events go to the store
   (`pointerDown`/`pointerMove`/`pointerUp`, `key`, `tapAt`) and from there to `input`; nothing else interprets them.

`store/yardshiftStore.ts` (Pinia) is glue: it holds the `Shift`, UI state and viewport.

## Renderer (2D canvas, owner decision)

The owner rejected the Three.js yard on the phone ("It looks shit!! Try implement it 2d like the original reference
prototype"), so the yard is a flat illustration in the style of `docs/prototypes/yardshift/target-look.jpg`, drawn
with Canvas 2D. Canvas rather than SVG: one paint pass per change with no DOM node per shape, cheap per-frame shake
and crane frames, and a backing store scaled by `devicePixelRatio` (capped at 3) for crisp lines.

- `modules/yardGeometry.ts` (pure) places every shape from `layoutFor`'s layout and the capacity (art pass 3,
  orchestrator review of pass 2): boxes are sized from the column width first (side 0.86 of the column, door end 0.06,
  top rise 0.08), as tall as `ASPECT_MIN` 1.8:1 allows (`boxHFor`); a short room narrows a box rather than flattening
  it past `ASPECT_MAX` 2.4. The stacks need full capacity plus one box of crane headroom (a carried box, `carryY`,
  clears a full stack); the gantry beam (`beamHFor`) sits just above that with spreader room only, under a sky strip
  of at least `SKY_MIN`. The concrete floor starts just above the top slot, so the backdrop band (sky, beam,
  headroom) never leaves bare concrete. `yardFit(colW, capacity, maxH)` gives the box height and the yard that fits it
  exactly. Each bay's truck (`truckIn(bay, geo, facing)`): tractor cab at the end it faces (the receipt truck faces
  right with its cab under `arrowBox`, the collection truck faces left), a heavy skeletal trailer, three axles, cargo
  a yard box scaled up to `MAX_CARGO_SCALE` 1.4, the whole truck filling most of the bay width and centred
  vertically between the bay title and status rows. `boxAt(geo, layout, stack, tier, lift)` is a container's box;
  `boxBounds` its whole drawn area. `modules/yardGeometry.test.ts` proves, for every level and five surfaces, that
  every slot (the top one lifted too) lies inside its own column hit region and under the beam, the box aspect stays
  1.8 to 2.4 (under 1.9 on a phone), full stacks take over 85 % of the concrete, the carried box clears a full stack
  and the beam sits within 10 px above it, the legs touch no column, and each truck (both facings) lies inside its
  bay, fills most of its width, is vertically centred, has its cab ahead of the trailer and its wheels on the road,
  with the cargo on the trailer and the arrow over the receipt cab, clear of the cargo.
- `layoutFor(stackCount, viewport, capacity)` (`present` passes the capacity): the bays take `BAY_SHARE` (22 %, at
  least 84 px) of the surface and the yard exactly what `yardFit` needs. Height left on a tall phone goes first to the
  bays (up to 26 %), then to the sky strip (up to 45 % of the fitted yard), and the rest centres the play area in the
  surface. Hit regions still come from the layout only. Without the capacity the bays take their old share.
- `modules/yardEffects.ts` (pure, `yardEffects.test.ts`): every render-only effect as a function of time.
  `urgencyStyle(container, current, reducedMotion)`: the current container on a calm turn (risk at `FOCUS_BASE_RISK`)
  glows with a breathing white outline; once the next-truck clock is low it vibrates (`vibrateX`: horizontal only,
  1 to 2 px at `VIBRATE_HZ` 27 Hz, never a rotation) with a pulsing red outline; in the last 9 s of the shift every
  container vibrates with rising amplitude; under reduced motion nothing moves and the `urgent` flag gives a static
  red outline. Effects in flight (`Fx`, durations `FX_MS`): `land` (squash about the bottom centre plus a dust puff,
  after each crane move onto a stack), `collect` (the collection truck bounces, drives off left with the box and
  comes back empty, clipped to its bay), `bonus` (gold flash over the collection bay and a coin and star `burst`),
  `bonus-miss` (the gold fades to the box's own colour with a poof), `reject` (a refused move shakes the tapped
  container sideways in red, `rejectX`). `sparkles` and `shineAt` drive the gold shine.
- `composables/useYardCanvas.ts` only paints: a quiet backdrop (sky, a hazy horizon, faint distant STS crane
  silhouettes at 28 % alpha, the quay edge; no ship), floor, dashed slot outlines up to capacity, "YARD 01" and "n
  FREE SLOT(S)" captions, the two bays (dashed border, painted stall corner marks so an empty bay still reads as one,
  teal collection, orange receipt, red at deadline 0), illustrated trucks (rounded cab roof, windscreen and side
  window, livery stripe, grille, headlight, bumper, exhaust stack, mudguards, tyres with light hubs, skeletal
  trailer with a heavy beam, cross members and yellow twist-lock posts, soft road shadow; the collected box rides
  the trailer while the truck drives off; white cab facing left for collection, orange cab facing right for
  receipt, none in the receipt bay with no truck), containers (corrugated ribs, top and bottom rails, door end with
  locking bars and handles, four corner castings, a few bold ribs, thin top face, big dark number with a light halo; a bonus box is
  smooth two-tone metallic gold (faint wide ribs) with its sequence colour along the bottom rail, a gold glow, and a
  star badge on its top-left corner casting, drawn in a second pass over every box so it never covers a number; an
  exposed one also gets a shine sweep every 1.6 s, up to three big sparkles at the box ends and a bouncing badge, and the open bonus window adds a countdown ring round the badge, a brighter halo and faster
  sparkles; "H" tile for `heavy`), ghost drop boxes on `destinations`, the blue gantry and the yellow trolley with
  hoist cables and a spreader as long as a box whose twist-lock legs drop when it grips. Selection lifts the box
  `LIFT` (0.3 of its height) with a white rim. The crane move (`cranePhase`, 330 to 460 ms) slides the trolley to the
  source, lowers, lifts, travels, lowers and releases; the trolley rests where the last move ended.
- It renders on a change of the view-model or the crane move (the store's frame loop drives both while playing) and
  schedules its own frames only while something animates (vibration, glow, gold shine, an effect in flight). Its
  options: `reducedMotion` (no effects, static cues) and `subscribe` (the store's `onYardEvent`: every engine event
  plus `{ type: 'rejected', action }` for a refused move).
- DOM over the canvas (`Yardshift.vue`): stack numbers, bay titles, "LOAD #n" and the receipt status
  (`ys-receipt-status`) at the bay's bottom-left, the dim overlay (`ys-dim`), the bobbing arrow (`ys-arrow`), the
  arrival announcement (36 px down, clear of the beam), the bonus "+250" pop (overshoot scale bounce) in the middle of
  the collection bay, clear of its labels, and the "+5s" (`fly-time`, outside the surface) starting just above the bay
  and flying to the shift clock; bonus queue chips are the yard boxes' metallic gold with a small star; the
  combo number pops when it changes (`YardQueue.vue`, re-keyed). Reduced motion: no fly, no pop.
- HUD in the target's style: wordmark and uppercase level title, big shift and next-truck numbers with bars, LOADED
  with "n/max REHANDLES" under it; queue chips with a top lip and lower rail (gold for a bonus, its sequence colour
  kept as the rail). Band heights: `bandHeights` (HUD 108 px narrow, 74 wide; queue 54; incoming 28).
- Screenshots: `docs/prototypes/2d/` (art pass 2, phone 390x844 at 2x: level 3 start, level 2 bonus window open and
  bonus collect mid-burst, level 4 mandatory receipt; desktop 1280x800 level 4).

## Playtest fixes (spec #374 phase 1)

The Three.js details below (`Built.*`, `ch`, `cargoScale`) are history: the 2D renderer replaced that scene and
keeps the behaviours (lift and rim, ghosts, slot outlines, stack labels, arrow beside the cab).


- Selection never changes a container's colour (the gold matched the yellow sequence slot): the selected stack top
  or receipt cargo lifts `SELECTED_LIFT` (0.3 of its height) and gets a white back-face rim shell (`Built.rim`).
- Legal destinations: a translucent green ghost container at the drop height of each (`Built.ghosts`, one
  `InstancedMesh`), as well as the green column pad. Capacity: dashed outlines of every slot up to `capacity` (one
  merged `LineSegments`, `LineDashedMaterial`), and `view.stackLabels` ("01".."0n") drawn under each column.
- Fit: `layoutFor` gives the bays a fixed share (24 to 25 % of the surface) right under the yard (6 px gap);
  the scene sizes containers from the column width (0.9) and the yard height at full capacity (`ch` 0.36 to 0.8 of
  `cw`). The harbour backdrop is a strip behind the gantry: its quay edge is placed just above the gantry top on
  screen (projected), not at a fixed share of the yard. Trucks take 60 to 85 % of the bay length; their heights and the
  receipt cargo scale by `Built.cargoScale` (0.3 to 1.4) so the loaded truck fits under the bay label.
- Bay labels sit top-left on a scrim pill; `arrowBox` puts the mandatory arrow beside the cab (bay's right end), so
  it never covers the cargo number. The empty receipt bed is grey (no truck). The bonus glint flashes the body, never
  the label, so numbers stay dark navy; the open bonus window draws a gold countdown ring round the first queue chip
  (`view.bonus.fraction`). The "+250 · +5s" float starts 36 px above the collection bay.
- At deadline 0 a stack tap sends `collect(from)`, which the engine rejects with "Receive truck #n first."
  (`receive-first`), so the message and the invalid cue fire. The store clears the arrival announcement on
  `deadline-zero`, and clears a rejection message whenever an input changes the selection (`send`). With no truck waiting the incoming band reads "COLLECT #n · READY".
- Pause keeps no focus ring after a click (`:focus-visible` only); the timeout message is "Shift time ran down before
  the yard was clear." (the fail title is "Time's up").
- Tests: `modules/playtestFixes.test.ts`, `store/yardshiftStoreAnnounce.test.ts`. Before and after phone captures:
  `docs/prototypes/playtest/`.

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
- Cover: `assets/cover.png` is a 640x360 capture of level 6 at 1280x760, scale 2 (8-bit palette, about 24 KB):
  `window.__ys.loadLevel(6)` and the first four fixture actions, wait about 2 s so no announcement or message shows,
  then crop the 880 px game column from the incoming band down to 16:9 (no toast, no control bar).

## Audio cues (#388)

- Engine threshold events: `shift-low` (`seconds`, at each of `SHIFT_LOW_SECONDS` 9, 5, 3, 2, 1 s crossed going down),
  `truck-low` (the next-truck clock crosses `TRUCK_LOW_SHARE` 35 % of the same allowance) and `deadline-one` (moves
  left drops to 1). Each fires once per crossing, from `tick` and from `dispatch` (undo can cross a shift threshold),
  never per frame (`modules/clocks.test.ts`).
- `modules/audioCues.ts` (pure): `cuesForStep(after, events)` maps one engine step's events (a `dispatch` or a
  `tick`) to cues in event order (collect, combo, receive, rehandle, arrival, deadline-one, deadline-zero, overtime
  start and end, bonus window, jackpot, bonus missed, truck-low, `shift-tick` from `shift-low`, win, timeout,
  blocked, undo). It never diffs states.
  `rejectionCue()` (invalid), `craneStartCue()`, `comboCue(c)` (one C major pentatonic step per combo,
  `pentatonicNote(min(c, 8) - 1)`: D5 at 2 up to E6 at 8, so chains play a tune) and
  `craneCues(before, after)` (pick at progress `PICK_AT` 0.30, land at `LAND_AT` 0.88). Tones are V20's
  `tone(f0, f1, dur, vol, delay, type)` with `vol` a relative sound gain.
- Bonus sounds (owner feedback: phone clicker game mini sounds): `jackpot` (on `bonus-awarded`) keeps the fanfare
  chord and layers `coinLayer()` over it, tagged by `Tone.role`: a `pop` for the +250 float (same event, no cue of
  its own), six quick `coin` notes rising E6 to E7 on the pentatonic, then a `shimmer` of high detuned sine pairs.
  `bonus-window` is a soft twinkle (G6, C7, E7 sines with faint detuned twins); `bonus-missed` a gentle two-step
  downward sine blip. Level budget: no cue's summed envelope peaks exceed 0.306 (the jackpot before this pass; its
  low thump went 0.09 to 0.08 and its arpeggio 0.045 to 0.04 to make room), checked in `audioCues.test.ts`.
- Store: `step()` wraps every dispatch and tick and sends its cues to `onCue` listeners; `startMove` sends the
  crane start, `frame` the pick and land crossings; reduced motion sends only the landing.
- `composables/useYardAudio.ts` (mounted by `Yardshift.vue`): one Web Audio bus `GainNode` set from
  `gainFor(1, 'sfx')` and watched, so the shared sliders and mute change every sound live; the context starts on the
  first pointer or key press. No fixed volumes. Every oscillator or buffer source and its envelope gain disconnect on
  `onended` (`releaseOnEnded`; `playTone` is exported, and `composables/useYardAudio.test.ts` plays the whole jackpot
  through a fake context and checks every node reaches the bus and disconnects).
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
(`scripts/check-no-hex-colours.mjs` in verify); `modules/palette.test.ts` keeps `--ys-seq-*` and `--ys-grey` equal to `SEQUENCE_COLOURS` and `GREY`. The
canvas yard keeps its colours in `modules/yardPalette.ts`, each mirrored as `--ys-yard-*` in the palette and kept
equal by the same test.

## Dev hook

`window.__ys` (`dev/devApi.ts`), installed only when `import.meta.env.DEV || import.meta.env.MODE === 'smoke'` (as
Terminal Twin's `window.__tt`): `loadLevel(n)` (skips the intro), `applyActions(actions)` (undo too), `state()`, `solution(n)` (fixture actions),
`progress()`, and `hitRegions()` in client
coordinates so smoke tests tap real points.

## Tests and budget

- Unit tests (vitest, node environment, no DOM or WebGL): `modules/engine.test.ts`, `modules/presentation.test.ts`,
  `modules/receiptsView.test.ts`, `modules/playtestFixes.test.ts`, `store/yardshiftStoreAnnounce.test.ts`, `modules/screenLayout.test.ts`, `modules/clocks.test.ts`, `modules/clocksView.test.ts`, `modules/levels.test.ts`, `modules/scoring.test.ts`,
  `modules/presentationScore.test.ts`, `modules/inputCoaching.test.ts`, `modules/undo.test.ts`,
  `modules/progress.test.ts`, `modules/screens.test.ts`, `modules/audioCues.test.ts`, `store/yardshiftStoreAudio.test.ts`,
  `modules/music.test.ts`, `composables/useYardMusic.test.ts` (happy-dom), `composables/useYardAudio.test.ts`,
  `modules/palette.test.ts`, `modules/yardGeometry.test.ts`, `modules/yardEffects.test.ts`,
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

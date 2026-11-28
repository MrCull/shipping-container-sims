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
  orchestrator review of pass 2; owner art pass 3 of the 2D yard, back to the v1 look in
  `docs/prototypes/2d/`): chunky boxes sized from the column width first (front 0.74 of the column, end face 0.17,
  top rise 0.12), as tall as `ASPECT_MIN` 1.3:1 allows (`boxHFor`); a short room narrows a box rather than flattening
  it past `ASPECT_MAX` 1.45. `numberSize(box)` is `NUMBER_SHARE` (58 %) of the box height. `chevronAt(geo, layout,
  stack, height)` places the NEXT chevron just above the stack top, inside its column, under the road strip, with
  `CHEVRON_BOUNCE` (3 px) room each way. Owner round 5 (trucks above the yard): the road strip (`layout.road`, drawn
  as asphalt with kerbs and a dashed lane line) is just the two truck bays side by side under the beam, right over
  the stacks; there is no sky band and never bare road. The gantry beam (`beamHFor`) spans the top, over the road, with the
  legs running down beside the bays and the full yard; the trolley rides the beam and its cables hang down across
  the road to the spreader. The yard has a `CAPTION_PX` (16 px) row at its top for "YARD 01" and "n FREE SLOTS",
  then the crane headroom: the carry height `carryY` sits just under the road (caption and spreader room), always at
  least one box over a full stack. At rest the spreader parks just under the trolley (`parkY`, in the 6 px between
  beam and road), so no cables hang through the bays; the cables pay out only during a move: down to the source,
  then the box travels at `carryY`, or level with the truck when one end is a truck (`min(carryY, src.y, dst.y)`),
  and after the release the spreader rises back to its park. A collect lifts the box from its stack up to the
  collection truck's trailer, a receive lowers the receipt cargo from its truck down into the yard. `yardFit(colW, capacity, maxH)` gives the
  box height and the yard that fits it exactly. Each bay's truck (`truckIn(bay, geo, facing)`): tractor cab at the end it faces (the receipt truck faces
  right with its cab under `arrowBox`, the collection truck faces left), a heavy skeletal trailer, three axles, cargo
  a yard box scaled up to `MAX_CARGO_SCALE` 1.6, the cab up to 28 % of the bay width, the whole truck filling most of the bay width and centred
  vertically between the bay title and status rows. `boxAt(geo, layout, stack, tier, lift)` is a container's box;
  `boxBounds` its whole drawn area. `modules/yardGeometry.test.ts` proves, for every level and five surfaces, that
  every slot (the top one lifted too) lies inside its own column hit region and under the road, the box aspect stays
  1.3 to 1.45 (under 1.35 on a phone), the number 55 to 60 % of the box, the chevron inside its column clear of the
  stack top and the road at every stack height, the beam above both bays and the road (which holds both bays) above
  the yard, the carried box clears a full stack and hangs 8 to 25 px under the road, the parked spreader sits
  between the beam and the road, each truck's cargo slot sits
  above the carry height, under the beam and between the legs (the crane carries a box up to it), the legs touch no
  column, and each truck (both facings) lies inside its
  bay, fills most of its width, is vertically centred, has its cab ahead of the trailer and its wheels on the road,
  with the cargo on the trailer and the arrow over the receipt cab, clear of the cargo.
- `layoutFor(stackCount, viewport, capacity)` (`present` passes the capacity), top to bottom (owner round 5): 2 % margin
  and `BEAM_ROOM_PX` (26) for the beam and the parked spreader, the road strip (just the two bays side by side), a
  6 px gap, then the yard down to the bottom margin. The bays take `BAY_SHARE` (22 %, at least 84 px) of the surface
  and the yard at least what `yardFit` needs. Height left on a tall phone goes first to the bays (up to
  `MAX_BAY_SHARE`, 24 %; the trucks scale with them), then to the yard's concrete headroom (orchestrator review:
  never to bare road above the bays). The canvas always fills the whole play surface: no dark gaps (`playtestFixes.test.ts`). Hit regions
  still come from the layout only and move with the bays; the road itself is paint, never a target. Without the
  capacity the bays sit right under the beam and the yard fills the rest. The arrival announcement pill sits at the
  top of the yard, clear of the bays.
- `modules/yardEffects.ts` (pure, `yardEffects.test.ts`): every render-only effect as a function of time.
  `urgencyStyle(container, current, reducedMotion)`: the next container glows from the start of its turn (art pass 3:
  a thick white outline with a breathing outer glow, static under reduced motion), bobs `nextBob` (`BOB_PX` 2 px,
  1 Hz, vertical paint offset only) and a NEXT chevron bounces over its stack (`chevronBounce`); both are 0 under
  reduced motion; once the next-truck clock is low it vibrates (`vibrateX`: horizontal only,
  1 to 2 px at `VIBRATE_HZ` 27 Hz, never a rotation) with the urgency outline (owner round 5: a thick white outline
  with a red one flashing over it, never a plain red outline, since red is sequence colour #1); in the last 9 s of the
  shift every container vibrates with rising amplitude; under reduced motion nothing moves and the `urgent` flag gives
  a static white outline with a thin red inner line. Effects in flight (`Fx`, durations `FX_MS`): `land` (squash about the bottom centre plus a dust puff,
  after each crane move onto a stack), `collect` (the collection truck bounces, drives off left with the box and
  comes back empty: it drives along the road strip out past its left edge and returns into its bay from the right,
  clipped to the road up to the bay's right edge so it never shows over the receipt bay), `bonus` (gold flash over the collection bay and a coin and star `burst`),
  `bonus-miss` (the gold fades to the box's own colour with a poof), `reject` (a refused move shakes the tapped
  container sideways in red, `rejectX`). `sparkles` and `shineAt` drive the gold shine.
- `composables/useYardCanvas.ts` only paints: the road strip (asphalt from the beam down, kerbs, a dashed lane line
  along the trucks' wheels), floor, dashed slot outlines up to capacity,
  "YARD 01" and "n FREE SLOT(S)" captions along the top of the concrete, the two bays painted over the road (dashed
  border, painted stall corner marks so an empty bay still reads as one, teal collection, slate receipt, red at
  deadline 0; labels "▲ COLLECTION" and "▼ RECEIPT"), illustrated trucks (rounded cab roof, windscreen and side
  window, livery stripe, grille, headlight, bumper, exhaust stack, mudguards, tyres with light hubs, skeletal
  trailer with a heavy beam, cross members and yellow twist-lock posts, soft road shadow; the collected box rides
  the trailer while the truck drives off; white cab facing left for collection, steel blue cab (`cab-steel`) facing
  right for receipt, none in the receipt bay with no truck; the receipt cargo is a steel/white container
  (`receipt-cargo`) with a bold dark "IN" tag astride its top right edge, so it never reads as a sequence colour), containers (art pass 3, the v1 look: a flat front in its colour, one light top
  face, a darker end face, a few soft ribs, two subtle door bars, thin rails, corner castings, a big bold number with
  a light halo; the next box is slightly brighter. A bonus box keeps its sequence colour with a static star badge on
  its top-left corner, inside its column, drawn in a second pass so it never covers a number. Only the active bonus
  (`bonusActive`: next, window open) is bright metallic gold (owner round 5, never brown: a light `gold-body` #ffd84a
  face with a white `gold-shine` highlight band across its upper third, a warm `gold-deep` #f0b428 foot and end face;
  `palette.test.ts` keeps every gold face at relative luminance 0.45 or more; the sequence colours hold no yellow)
  with its sequence colour along the bottom rail, a gold halo, a shine sweep every 1.6 s, up to three sparkles at the
  box ends, a bouncing badge and the countdown ring; "H" tile for `heavy`), the NEXT chevron (white, outlined,
  striped in the next box's colour; hidden while the crane works that stack), ghost drop boxes on `destinations`, the blue gantry and the yellow trolley with
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
  and flying to the shift clock; bonus queue chips keep their colour with a small static star, and only the active bonus's chip (`QueueItem.active`)
  is metallic gold; the
  combo number pops when it changes (`YardQueue.vue`, re-keyed). Reduced motion: no fly, no pop.
- HUD in the target's style: wordmark and uppercase level title, big shift and next-truck numbers with bars, LOADED
  with "n/max REHANDLES" under it; queue chips with a top lip and lower rail (gold only for the active bonus, its sequence
  colour kept as the rail). Band heights: `bandHeights` (HUD 108 px narrow, 74 wide; queue 54; incoming 28).
- View-model for the art (art pass 3, `presentationScore.test.ts`): `ContainerView.next` from the start of each turn
  (#1 included, false once the shift ends), `bonusActive` and `glint` (active bonus, no glint under reduced motion),
  `QueueItem.active`, and `ViewModel.nextMarker` (`{ stack, buried }`, null when the shift is over, the next box is
  not in the yard, or a receipt is mandatory). Hit regions stay layout-only (tested calm, urgent, reduced and selected).
- Screenshots: `docs/prototypes/2d/` (art pass 3, phone 390x844 at 2x: level 3 after one rehandle, the owner's
  `owner-2d-v3` state; level 2 bonus window open on #3; level 4 mandatory receipt; tutorial start; tutorial with #4's bonus window open
  and its coaching line; desktop 1280x800 level 4). Re-captured in owner round 5 (five rainbow colours, bright gold,
  trucks above the yard), 8-bit palette PNGs.
- Active bonus shine (owner round 4): the sweep is clipped inside the front face's outline, and the next box's white
  rim and glow are clipped to outside the box silhouette (`clipOutside`), so neither draws a pale band over the dark
  end face or past the box's right edge.

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
- `present` adds `receiptCargo` (the waiting container, drawn on the receipt truck bed as a steel "IN" box),
  `incoming` (`status` none, optional or mandatory; band text "↓ RECEIPT #8 · 3 MOVES LEFT" or "· MANDATORY", the
  arrow pointing down at the receipt bay under the band; bay
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
- Presentation: `ContainerView.slot` (0..4 or null), `colour` (`SEQUENCE_COLOURS` or `GREY`), `bonus` (medallion:
  a later bonus id, or the current one while its window is open, so it shows buried or grey and vanishes on a miss),
  `border` (selection only, never the current container). `view.queue` is the five HUD positions (empty slot `–`
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
  order, and while a bonus window is open (level 1's #4) say "Gold bonus! Load #4 fast for +250"; `heavyHints` levels (11, 12) say "Heavy #n · Choose a highlighted stack: heavy on heavy or empty." or
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
- Cover: `assets/cover.png` (re-cut in owner round 5) is the play surface of the desktop level 4 capture
  (1280x800 at 1x, `loadLevel(4)`: crop x 200 to 1080, y 212 to 707, both trucks over the stacks) scaled to 640x360,
  8-bit palette, about 30 KB.

## Audio cues (#388)

- Engine threshold events: `shift-low` (`seconds`, at each of `SHIFT_LOW_SECONDS` 9, 5, 3, 2, 1 s crossed going down),
  `truck-low` (the next-truck clock crosses `TRUCK_LOW_SHARE` 35 % of the same allowance) and `deadline-one` (moves
  left drops to 1). Each fires once per crossing, from `tick` and from `dispatch` (undo can cross a shift threshold),
  never per frame (`modules/clocks.test.ts`).
- `modules/audioCues.ts` (pure): `cuesForStep(after, events)` maps one engine step's events (a `dispatch` or a
  `tick`) to cues in event order (collect, combo, receive, rehandle, arrival, deadline-one, deadline-zero, overtime
  start and end, bonus window, jackpot, bonus missed, truck-low, `shift-tick` from `shift-low`, win, timeout,
  blocked, undo, plus the collection truck's `truck-off`, `truck-in` and `next-ready`). Given `before` (the store
  passes it), it adds `deadline-two` when a move drops the moves-left count from above 2 to 2 (not on an arrival
  at 2); that is the one state diff, since the engine has no such event. `winCue(stars)` scales the fanfare by the
  stars (`starsFor` with the level's solver fixture; 3 for a level with none). `uiCue(e)` plays the store-level
  `UiSoundEvent`s.
  `rejectionCue()` (invalid), `craneStartCue()`, `comboCue(c)` (one C major pentatonic step per combo,
  `pentatonicNote(min(c, 8) - 1)`: D5 at 2 up to E6 at 8, so chains play a tune) and
  `craneCues(before, after)` (pick at progress `PICK_AT` 0.30, land at `LAND_AT` 0.88). Tones are V20's
  `tone(f0, f1, dur, vol, delay, type)` with `vol` a relative sound gain, plus two optional fields: `attack` (the
  envelope's swell, 8 ms by default) and `lowpass` (a low-pass cutoff in Hz after the source).
- **Levels (owner round 4):** effects are louder and the music quieter. `tone()` and `sampleGain()` multiply every
  design level by `SFX_BOOST` 1.5, still relative sound gains under the `'sfx'` bus (`gainFor`), so the sliders and
  mute govern them; `MUSIC_GAIN` went 0.3 to 0.18. The per-cue peak cap is `CUE_PEAK_CAP` (the old 0.306 times
  `SFX_BOOST`, about 0.46) and the step budgets (bonus collect step 0.45, last-collection bonus step with the
  fanfare 0.6) are scaled the same way.
- **Levels (owner round 5):** "music still too loud, effects still too quiet". `MUSIC_GAIN` is 0.08. The effects
  are doubled after the sliders, not in the cues: the sfx chain (`createSfxChain` in `composables/useYardAudio.ts`)
  is bus `GainNode` (`gainFor(1, 'sfx')`) into a makeup gain `SFX_MAKEUP_GAIN` 2 into a `DynamicsCompressorNode`
  limiter (`SFX_LIMITER`: threshold -10 dB, knee 0, ratio 12, attack 3 ms, release 250 ms) into the destination.
  The cue levels, `CUE_PEAK_CAP` and the step budgets in `audioCues.test.ts` are measured before the makeup gain and
  the limiter; the limiter keeps the doubled sums of overlapping cues from clipping. Mute and the sliders still act
  on the bus, so a muted bus stays silent.
- **Move sounds and levels (owner round 6):** "the container moving noise is horrible" and "music still too loud".
  The crane start whine and the `crane-pick.mp3` / `crane-land.mp3` samples are gone (files deleted): every move
  sound is synth, short, low and soft (sound table below). `audioCues.test.ts` checks the three move cues carry no
  sample, no tone (frequency or low-pass) above 2 kHz, each peaks under the collect chime and all three summed still
  do. `MUSIC_GAIN` is 0.035: the track is mastered hot (about -15.4 LUFS integrated, -0.8 dBFS peak), so the gain is
  the fix, not a new file; at the default sliders (master `DEFAULT_VOLUME` 0.4, music 1) the element plays at
  0.035 x 0.4 = 0.014 (it was 0.032).
- **Collect reward (owner round 4, "dopamine"):** every collect plays the trailer clunk then a bright rising
  three-note pentatonic `chime` (root, +2, +4 steps) whose root climbs with the collection index,
  `collectLadderStep(k, count)`: 0 (C5) on the first collection up to `COLLECT_LADDER_SPAN` 7 (E6) on the last,
  spread over the level's count, so each shift plays a level-up ladder (non-decreasing; strictly rising up to 8
  containers). The combo ladder still plays on top. The last collection of a shift adds a `flourish`: a quick
  triangle run C7 to C8 into a held C8 bell pair.
- Bonus sounds (owner feedback: phone clicker game mini sounds; round 4: "epically when a bonus one gets done"):
  `jackpot` (on `bonus-awarded`) is the most epic cue (`audioCues.test.ts` checks it has the most tones, the highest
  peak and lasts 0.8 to 1.2 s; it ends at about 1.17 s), layered by `Tone.role`: a low thump and a `pop` for the
  +250 float (same event, no cue of its own), the rising fanfare `arpeggio` with octave sparkle, a `coin` cascade
  of ten pentatonic notes E6 to D8 32 ms apart, a short `power` chord hit (C3, G3, C4 sawtooth plus triangle) at
  0.3 s under the held chord, then a `shimmer` of six high detuned sine pairs ringing out. `bonus-window` is a soft
  twinkle (G6, C7, E7 sines with faint detuned twins); `bonus-missed` a gentle two-step downward sine blip.
- Store: `step()` wraps every dispatch and tick and sends its cues to `onCue` listeners; `startMove` sends the
  crane start, `frame` the pick and land crossings; reduced motion sends only the landing. Store-level UI events
  (`UiSoundEvent`, also sent to `onYardEvent` listeners, which ignore types they do not know): `selected`
  (`target` a stack or `'receipt'`) and `deselected` from `send` when the selection changes with no action (a
  selection a move clears leaves the sound to the move), `paused` from `pause()` and `resumed` from `resume()` when
  the player pause was held. Each fires once per outcome (`store/yardshiftStoreAudio.test.ts`).
- **Sound table (art pass 3 audit, round 4).** Every outcome has its own sound; `audioCues.test.ts` checks no two
  cues share pitches, timbre and rhythm (the last collection's flourish included), that every `CueName` is covered,
  and that none sums over `CUE_PEAK_CAP`. `tone(f0>f1, dur, vol, delay, type)`, Hz and seconds; `type` `noise` is
  white noise through a band-pass swept f0 to f1 (`playTone`); all through `gainFor(..., 'sfx')` via the bus.

  | Event (source) | Cue | How it is made |
  | --- | --- | --- |
  | Select a container (store `selected`) | `select` | one short high sine click, E6 to 1250 Hz, 35 ms |
  | Select the receipt truck (store `selected` `'receipt'`) | `receipt-select` | two triangle clicks G5 then C6 |
  | Deselect or cancel (store `deselected`) | `deselect` | one soft falling sine 880 to 600 Hz |
  | Invalid tap (store `rejected`) | `invalid` | soft buzz: two short low square pulses, 150 and 140 Hz falling |
  | Crane accepts a move (`startMove`) | `crane-start` | quiet motor whirr under the move: sawtooth 78 to 92 Hz plus its sine octave, low-passed at 420 Hz, swelling over 0.14 s and fading by 0.42 s (round 6) |
  | Crane pick (`frame` crossing `PICK_AT`) | `pick` | muffled clunk: sine thump 120 to 70 Hz, 0.12 s, a triangle 240 to 150 Hz under it and a noise click (1.4 to 0.9 kHz, low-passed at 1.8 kHz) (round 6) |
  | Crane land (`frame` crossing `LAND_AT`) | `land` | soft wooden thock: triangle knock 440 to 310 Hz, sine body 170 to 115 Hz, muffled noise tick (1 to 0.7 kHz, low-passed at 1.5 kHz) (round 6) |
  | Collect (`collected`) | `collect` | trailer clunk (triangle 150 to 60 Hz) then a rising three-note pentatonic chime whose root climbs C5 to E6 over the shift; a low tail on the first two operations; the last collection adds a run into a high bell |
  | Combo chain (`collected`, combo 2+) | `combo` | one pentatonic step per combo, D5 up to E6 |
  | Collection truck drives off (`collected`) | `truck-off` | quiet sawtooth rumble falling 120 to 70 Hz at 0.25 s |
  | New collection truck arrives (`collected`, not the last) | `truck-in` | sawtooth rumble rising 70 to 115 Hz at 0.84 s, brake squeak |
  | Next container ready (`collected`, not the last) | `next-ready` | very soft G6 sine ding at 1.38 s, as the new truck stops |
  | Receipt truck arrives (`arrival`) | `arrival` | `truck.mp3`, an air-brake hiss at 0.3 s (noise band-passed 3.2 to 1.6 kHz) and a two-tone horn: F4 plus A4 at 0.78 s then a longer D4 plus F#4 at 1.0 s (sawtooth over triangle) |
  | Receipt placed (`received`) | `receive` | trailer clunk then a settling falling pair E5, C5, with `truck.mp3` |
  | Rehandle (`rehandled`) | `rehandle` | short rising sine 550 to 740 Hz |
  | Deadline 2 (moves-left drops to 2) | `deadline-two` | two soft triangle ticks at 620 Hz |
  | Deadline 1 (`deadline-one`) | `deadline-one` | one louder sine drop 510 to 390 Hz |
  | Deadline 0 (`deadline-zero`) | `deadline-zero` | alarm: four fast triangle pulses alternating 880 and 660 Hz |
  | Next-truck clock low (`truck-low`) | `truck-low` | short sine drop 700 to 540 Hz |
  | Overtime start (`overtime-start`) | `overtime-start` | siren: sawtooth sweeping 440 to 660 and back, twice |
  | Overtime end (`overtime-end`) | `overtime-end` | sine rise 300 to 520 Hz |
  | Shift ticks at 9, 5, 3, 2, 1 s (`shift-low`) | `shift-tick` | short triangle tick rising G5 (9 s) to G6 (1 s) |
  | Bonus window opens (`bonus-window`) | `bonus-window` | twinkle: G6, C7, E7 sines with detuned twins |
  | Bonus collected (`bonus-awarded`) | `jackpot` | the most epic cue, about 1.2 s: thump and pop, rising fanfare arpeggio, ten-coin cascade, power chord hit at 0.3 s under the held chord, detuned shimmer |
  | Bonus missed (`bonus-missed`) | `bonus-missed` | gentle two-step downward sine blip |
  | Undo (`undone`) | `undo` | rewind swoosh: triangle sweep 1400 to 260 Hz, then a short rising flick |
  | Pause (store `paused`) | `pause` | triangle E5 then A4 |
  | Resume (store `resumed`) | `resume` | triangle A4 then E5 |
  | Level complete (`completed`) | `win` | triangle arpeggio, 4 notes at 1 star, 5 plus a held chord at 2, 6 plus chord and a high sparkle at 3 |
  | Fail, shift out (`failed` `timeout`) | `timeout` | low triangle drop then three falling notes |
  | Fail, blocked (`failed` `blocked`) | `blocked` | sawtooth then triangle drops, low thud |
  | Time credit (`time-credit`) | none | the rehandle sound covers it |
- `composables/useYardAudio.ts` (mounted by `Yardshift.vue`): one Web Audio bus `GainNode` set from
  `gainFor(1, 'sfx')` and watched, so the shared sliders and mute change every sound live, then the makeup gain
  and limiter (owner round 5, above). No fixed volumes.
- **Unlock (iOS, art pass 3 item 5):** `installAudioUnlock(window, context)` listens (capture, passive) to
  `pointerdown`, `touchend` and `keydown` for the whole mount. Each gesture while the context is not `running`
  (`suspended` before the first gesture, `interrupted` on iOS after a call or backgrounding) calls `resume()`
  inside the gesture; the first gesture with a context also plays a one-sample silent buffer to the destination,
  which iOS Safari needs to unlock Web Audio. `play` also resumes a context that is not running. Unit-tested with
  a fake context in `useYardAudio.test.ts`. **The iPhone silent (ring/silent) switch mutes Web Audio**: with it on,
  Yardshift's effects are silent even when unlocked (the `Audio` element music may still play); a tester who hears
  nothing on an iPhone should check the switch first. Every oscillator or buffer source and its envelope gain disconnect on
  `onended` (`releaseOnEnded`; `playTone` is exported, and `composables/useYardAudio.test.ts` plays the whole jackpot
  through a fake context and checks every node reaches the bus and disconnects).
- Samples in `assets/audio/` (mono 64 kbit/s, trimmed with a fade out from `available-media/sound-samples`):
  `truck.mp3` (1.6 s from 0.5 s of `quiet-truck-engine.mp3`; on arrival and receipt), the only one. The crane
  pick and land samples were deleted in owner round 6 (the move sounds are synth now).
- **Music (#390):** `composables/useYardMusic.ts` (mounted by `Yardshift.vue`) loops one `Audio` element through
  `followMasterGain(element, MUSIC_GAIN, 'music')` (`MUSIC_GAIN` 0.035 in `modules/music.ts`: 0.3, then 0.18 in owner round 4, 0.08 in round 5, 0.035 in round 6), so the master and music
  sliders and mute change it live. `musicPlaying(state)` (pure, `modules/music.test.ts`): plays while the shift status
  is `playing` with no pause but `animation`; the intro, pause menu, level picker, a hidden tab and the end of the
  shift pause it. Unmount stops it and releases the element; the menu music stops when the home page unmounts. A
  blocked autoplay retries on the next pointer or key press.
- **Sound on entry (owner round 5):** the home page starts muted by default (AGENTS.md, "Volume and mute");
  entering Yardshift unmutes for the visit: `useYardMusic` takes `holdSoundMuted(false)` from the audio store and
  releases it on unmount. The stored mute and the sliders are not written, so leaving restores the stored mute; a
  mute or unmute the player chooses inside Yardshift ends the hold and is kept (`useYardMusic.test.ts`).
- Track: `assets/audio/music-light-piano.mp3`, `available-media/sound-samples/background-gaming-light-piano.mp3`
  (60 s loop, the one candidate no other sim uses) re-encoded to 80 kbit/s stereo with metadata stripped (600 KB).
  Source and licence: the repo's pre-sourced `available-media/` set; `available-media/README.md` records no source
  or licence for the sound samples (as for the music in Stowage Master and Contenga), so confirm one before a
  public release.

## Levels

`modules/levels.ts` holds all 13 V20 levels exactly (`levels.test.ts` checks them against the V20 array). V20's code
rules keyed on the level index are explicit fields on each row, never chosen from the level number (a test scans the
source): `truckSeconds` (tutorial `[30, 20, 15]`, else `truck(first)`: first, x0.5, x0.28), `bonusEvery` (3 from
level 2, giving `bonusIds`), `bonusIds` (an explicit list in place of the cadence), `bonusWindowSeconds`, `overtimeMultiplier` (2 on the tutorial, 3 elsewhere),
`tutorialCoaching`, `heavyHints` (11 and 12) and `tip`. There is no hand-entered minimum: the star target comes from
the solver fixture. Start a level in dev with `window.__ys.loadLevel(n)` (no intro) or the level picker. Arrival levels
(4, 6, 8, 9, 10, 13) start with a truck waiting.

| Level | Bonus ids | Bonus window |
| --- | --- | --- |
| 1 (tutorial) | #4 only (`bonusIds: [4]`, the last container) | 2.0 s |
| 2 | every third (`bonusEvery: 3`) | 1.6 s |
| 3, 4 | every third | 1.3 s |
| 5 to 13 | every third | 1.1 s |

Level 1's bonus is an owner decision (round 4) deviating from V20, where the tutorial had none; `levels.test.ts`
records it. The bonus does not change rehandles, so the solver fixtures are unchanged.

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
properties: the five sequence colours in rainbow order, so the sequence reads like a spectrum (owner round 5: #1 red
`#ef5b52`, #2 orange `#f59a3a`, #3 green `#4cc265`, #4 blue `#4b9cf0`, #5 purple `#a985ee`; every container after
#5 is grey `#84949c` and the queue shows five chips; yellow stays out so gold is only ever the active bonus; each
holds the dark number ink at 4.5:1 or more, `presentationScore.test.ts`). Because red and orange are sequence colours,
urgency is a white outline flashing red, the receipt cargo is steel with an "IN" tag, the receipt bay slate and the
receipt truck cab steel blue; the deadline arrow stays red. The HUD's shift bar uses `--ys-seq-2` (green). Also grey,
gold, red and the panel shades. Background, text and muted
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

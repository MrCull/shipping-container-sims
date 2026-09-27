# 04 — Jev UI and controller (next move / play all)

> Part of the **Stowage Master × Jev** plan set. Read [00-jev-overview.md](00-jev-overview.md) first.
> Depends on: 01, 02, 03. Blocks: 05.

## 4.1 Visibility rules (keep it subtle)

| Jev state | What the player sees |
|---|---|
| Never enabled (default) | Only a tiny, low-contrast `Jev` link in the bottom-right corner of the Start screen modal (opacity ~0.35, small font, `--font-body`, no icon, no colour). Nothing in-game. |
| Enabled, no key this session (e.g. after a refresh) | Start-screen link reads `Jev · key needed`. The in-game `JevPanel` shows only an `Enter Jev key` button. |
| Enabled with key | Start-screen link reads `Jev ✓`. The in-game `JevPanel` shows the controls. The inspector drawer appears only if `showInspector` is on. |

Mount the in-game Jev components with `v-if="jev.enabled"`, so disabled players don't create the controller's watchers or hotkeys. Don't add any Jev content to the briefing, the level complete/failed modals or KeyboardHint unless Jev is enabled.

## 4.2 `components/jev/JevStartToggle.vue`

- Rendered inside `StartScreen.vue`, positioned absolutely at the bottom-right of `.modal-content.start-screen`. Check it doesn't overlap the vessel columns on narrow screens; at mobile width, place it below the columns.
- Clicking it:
  - **Not enabled**: `jev.openKeyDialog()`.
  - **Enabled**: toggle a small popover containing:
    - Status: key set ✓ / key needed; credit remaining if known (`keyLimitRemaining`; `null` = unlimited or unknown).
    - Checkbox **Show Jev details (inspector)** → `showInspector`.
    - Number/slider **Pause between Jev moves**, 0–2000 ms (default 350) → `settleDelayMs`.
    - Checkbox **Pause play-all when confidence is below…**, off by default, with a slider from 0.1 to 0.9 → `minConfidenceToAutoplay` (02 §2.6).
    - Buttons: **Enter / replace key**, **Forget key**, **Disable Jev**.
- Scoped styles, using design tokens from `src/assets/main.css`.

## 4.3 `components/jev/JevKeyDialog.vue`

A modal matching the existing modal styling (`modal-overlay` / `modal-content` patterns from `components/modals/*`). Content:

- **Title:** "Enable Jev assist".
- **One-paragraph explanation:** Jev (TypeSafe, via OpenRouter) is a decision model that can pick moves for you. It sees the rules, the ship and the cargo, and returns a choice with probabilities. It does not explain its choices.
- **Key field:** "OpenRouter API key". `type="password"`, `autocomplete="off"`, `spellcheck="false"`, with a show/hide toggle. Link to `https://openrouter.ai/keys` (`target="_blank" rel="noopener noreferrer"`).
- **Disclosure bullets:**
  - "Your key is kept only in this browser tab's memory. It is never saved, and it is cleared when you refresh or close the page."
  - "Each Jev move sends the current game state (no personal data) to OpenRouter/TypeSafe."
  - "Cost is charged to your OpenRouter account: roughly $0.0001–0.0004 per move (under $0.10 for the largest level) at current pricing."
- **Buttons:** `Cancel`, and `Verify & enable` (primary).
  - Verify calls `validateApiKey(key)`. Show a spinner and disable the buttons while it runs.
  - On success: `setApiKey(key)`, `jev.setKey(limitRemaining)`, `jev.enable()`, clear the input ref, close.
  - On failure: show the mapped message (auth: "Key not recognised"; network: "Couldn't reach OpenRouter"). **Do not** store the key.
- Escape and Cancel close without enabling. Swallow keydown events inside the dialog so WASD/arrow camera keys and the game's hotkeys don't fire while typing (`useThreeScene` listens on `window`). Check that listener and add a guard if needed: ignore key events whose `target` is an `input`/`textarea`.
- Mount once in `StowageMaster.vue` (`v-if="jev.isKeyDialogOpen"`) so it can open from the start screen or in-game.

## 4.4 `components/jev/JevPanel.vue` (in-game)

Shown when `jev.enabled` and `store.phase` is `discharge_selecting`, `discharge_animating`, `restow_selecting`, `restow_animating`, `selecting` or `animating`. Keep it hidden during `briefing`. Keep it visible, but with controls disabled, during `disaster`/`complete`/`failed`, so the last status message is readable until the modal takes over.

- **Position:** right side, above `KeyboardHint` (`right: 12px; bottom: ~64px`). `LastPlacement` sits at `top: 230px; right: 12px`, so check they don't overlap on 768px-tall viewports. If they do, collapse the panel to a single row.
- **Compact layout (~220px wide):**
  ```
  ┌ JEV ─────────────────── ⚙ ┐
  │ [ Next move (J) ] [ ▶ Play all (⇧J) ] │   ← Play all becomes [ ■ Stop ] while running
  │ Thinking… / Moving 07-02-04 / Paused: Rate limited — [Resume] │
  │ Jev moves: 14 · Session cost: $0.0041 │
  │ [Details ▸] (only if showInspector)   │
  └───────────────────────────┘
  ```
- **Disabled states:**
  - Both buttons are disabled when there's no key (show `Enter Jev key` instead), when the phase isn't a `*_selecting` phase (in single-step mode), or during the `requesting` status.
  - "Next move" is disabled while play-all is running.
- **Hotkeys**, registered only while the panel is mounted: `J` = next move, `Shift+J` = toggle play-all. Ignore them when the target is an input, when a modal is open, or when there's no key. Confirm neither key clashes with `useThreeScene` (WASD/arrows/±) or god-mode hotkeys (`src/composables/useGodModeHotkey.ts`). Add "J Jev move" to `KeyboardHint` **only when Jev is enabled**.
- **Status copy:** show the mapped `lastError.message` and a **Resume** button when paused (play-all), or **Retry** (single step). Auth errors show **Enter key** instead.
- **Highlight:** when Jev's choice arrives, briefly pulse the chosen slot indicator before executing (optional nicety; reuse the existing hover highlight via a `jev.highlightSlotId` ref watched in GameCanvas → `setHoveredIndicator`). It must not delay execution by more than `settleDelayMs`.

## 4.5 `composables/useJevController.ts`

Instantiate it **once** in `StowageMaster.vue` (inside a `v-if="jev.enabled"` child component, or guarded internally) and expose `requestNextMove()`, `startAutoPlay()`, `stopAutoPlay()` and `resume()` through the Jev store or provide/inject, so `JevPanel` can call them.

### Single step: `requestNextMove()`

```
guard: hasKey, phase ∈ {selecting, discharge_selecting, restow_selecting}, status idle/paused
status = 'requesting'
snapshot = buildSnapshot(gameStore)                          // 02 §2.1
body     = { model, state: buildJevState(snapshot), questions: { move: buildJevQuestion(snapshot) } }
moveKey  = computeMoveKey(gameStore)                          // 02 §2.8
attempt loop (max 1 + JEV_CONFIG.retriesPerMove):
  try   res = await requestDecision(body, abort.signal)       // 01
  catch JevError e:
        if e.kind === 'cancelled' → status idle; return
        if !e.retryable or attempts exhausted → pause(e); return
        await delay(e.retryAfterMs ?? 1000); rebuild snapshot/body if moveKey unchanged; continue
  if computeMoveKey(gameStore) !== moveKey or phase mismatch → record 'stale'; status idle; return
  v = validateDecision(res, snapshot.legalSlotIds)            // 02 §2.5
  if !v.ok → treat as retryable invalid_answer (loop)
  if autoplay && prefs.minConfidence && v.answer.confidence < min → pause('low confidence'), set highlight; return
  status = 'executing'
  id = jev.issueCommand(snapshot.kind, v.answer.choice)       // 03 §3.2
  accepted = await waitForAck(id)
  if !accepted → treat as retryable invalid_answer (loop)
  movesByJevThisLevel++; sessionCostUsd += res.usage?.cost ?? 0
  record exchange (05)
  await waitForPhase(p => p is *_selecting or terminal)       // animation finished + finalize ran
  status = 'settling'; await delay(settleDelayMs)
status = 'idle'
```

Notes:

- **Discharge → restow chaining.** If Jev picks a transit container, the phase becomes `restow_selecting` straight away (the lift has no animation to wait for). In single-step mode, **one "Next move" press also places the lifted container**, so the game isn't left with a hovering box. Do this by running a second step immediately when the phase is `restow_selecting` after a discharge pick. Play-all handles it naturally.
- **Manual restow during single-step.** If the player lifted a transit container themselves, "Next move" in `restow_selecting` asks Jev only for the destination.
- **The retry rebuilds the snapshot** only if the game hasn't moved on. With the timer still running (user decision), the `level.timer_seconds_remaining` value changes, but that doesn't change `moveKey`.
- Use one `AbortController` per request, stored in a closure variable (not Pinia).

### Play all: `startAutoPlay()`

```
jev.autoPlay = true
while jev.autoPlay:
  if phase terminal (complete/failed/disaster) or phase ∈ {start, briefing}: stop('level ended'); break
  if phase is *_animating: await waitForPhase(*_selecting | terminal); continue
  await requestNextMove()        // returns after settle
  if status === 'paused': jev.autoPlay = false; break   // retry-once-then-pause already applied
```

- **Stop conditions:**
  - The user presses Stop.
  - A terminal phase: complete, failed (score or time), or disaster ("ship lost"). Record it as the final exchange note.
  - Leaving the level: `returnToStartMenu`, a new `startLevel`, or component unmount.
  - `jev.disable()`, or the key being forgotten.
- **On stop:** abort any in-flight request, set `autoPlay = false`, `status = 'idle'` (or leave it `paused` with the error), and clear `highlightSlotId`.
- Don't auto-dismiss the briefing or auto-advance to the next level. Play-all works within one level.
- **Discharge-only levels** end on the last discharge. **Standard levels** move from discharge to load automatically (the phase becomes `selecting`), and play-all carries on.
- **Tab hidden:** `requestAnimationFrame` pauses, so the animations and `waitForPhase` pause with it. That's fine: no extra handling beyond the request timeout.
- **Per-level counters:** reset `movesByJevThisLevel` in a watcher on `gameStore.currentLevel` / `startLevel` (watch the phase changing to `briefing`).

### Helpers

- `waitForAck(id)` returns a Promise that resolves from a `watch` on `jev.lastCommandResult` with matching `id`, with a 2 s safety timeout (→ `invalid_answer`).
- `waitForPhase(predicate)` is a Promise built on `watch(() => gameStore.phase)`, with a generous timeout (15 s). If it times out, pause with "Move animation did not finish". Always stop the watcher.
- Every watcher and timer is cleaned up in `onScopeDispose`.

## 4.6 Interaction with the timer, scoring and progress

- **Timer:** no change. It keeps running during requests (user decision). Expiry sets `phase = 'failed'`. The stale guard discards any in-flight answer, and play-all stops.
- **Scoring, bests, unlocks:** no change (user decision: they count normally).
- **Analytics:** don't add Jev events, and never send the key or Jev payloads to `trackEvent`.

## Acceptance criteria

- With Jev disabled: the start screen shows only the faint link, there is no in-game Jev UI, and the J key does nothing.
- **Enable flow:**
  - A bad key shows an error and nothing is stored.
  - A good key enables Jev.
  - After a refresh the panel shows `Enter Jev key` and the key is gone.
- **Next move** works in all three phases, including one press lifting a transit container and placing it.
- **Play all:**
  - Level 1 (discharge-only) plays to completion.
  - Level 3 (discharge + load) plays through the phase change to completion or failure.
  - Level 5 (hazmat) either completes or ends in a disaster, and in both cases stops cleanly.
- Stop mid-request: no move is executed afterwards (the stale or cancelled answer is discarded).
- Simulate offline (devtools): one retry, then pause with a message, and Resume works after going back online.
- A forged 401 (bad key set via console in dev) pauses, forgets the key and prompts for a key.
- Pointer clicks do nothing during play-all and during an in-flight single step.
- `npm run lint` and `npm run build` pass.

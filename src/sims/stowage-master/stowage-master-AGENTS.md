# Stowage Master — Agent Guide

## Overview

**Stowage Master** is a 10-level puzzle/strategy sim: "Tetris meets real-world container logistics." Players load containers onto a vessel while managing weight distribution (list, trim, VCG), port rotation order, hazmat separation, and discharge overstow. Built with Three.js + Vue 3 + Pinia.

**Entry point:** `StowageMaster.vue`  
**Store:** `store/gameStore.ts`  
**Sim ID:** `stowage-master`

---

## Folder layout

```
stowage-master/
├── definition.ts               Sim metadata (SimDefinition)
├── StowageMaster.vue           Root component — mounts canvas + all UI
├── components/
│   ├── GameCanvas.vue          Three.js canvas + main game loop callback
│   ├── TopBar.vue              Level name, phase badge, score/target
│   ├── ContainerInfo.vue       Current container (weight, port, hazmat)
│   ├── LoadList.vue            Next 6 containers in queue
│   ├── PortLegend.vue          Port color swatches
│   ├── ShipStatus.vue          List/trim/VCG gauges
│   ├── LastPlacement.vue       Score breakdown after placement
│   ├── LastDischarge.vue       Score breakdown after discharge
│   ├── ScorePopup.vue          Float-up "+N pts" feedback
│   ├── MoveCounter.vue         Progress bar (moves / total containers)
│   ├── TimerWidget.vue         Countdown (red when critical)
│   ├── EventFeed.vue           Last 5 events
│   ├── ui/
│   │   ├── DischargeBar.vue    Discharged N/total progress
│   │   ├── MeterBar.vue        Horizontal gauge component
│   │   ├── StarRating.vue      1–5 stars + title
│   │   └── KeyboardHint.vue    Context-sensitive key hints
│   ├── modals/
│   │   ├── StartScreen.vue     Level select with star ratings + unlock state
│   │   ├── SceneLoading.vue    "Loading assets…" overlay
│   │   ├── LevelBriefing.vue   Multi-page instructional modal
│   │   ├── LevelComplete.vue   Stars, score, best record, next level
│   │   ├── LevelFailed.vue     Reason + retry button
│   │   └── DisasterOverlay.vue Disaster name + dramatic message during FX
│   └── jev/                    Optional Jev assist UI — see § Jev assist (optional)
│       ├── JevStartToggle.vue  Low-key link + settings popover on StartScreen
│       ├── JevKeyDialog.vue    API key entry, disclosure, validation
│       ├── JevPanel.vue        In-game controls, status and "Details ▸" link
│       └── JevInspector.vue    Request/response inspector drawer
├── composables/
│   ├── useThreeScene.ts        Renderer, camera, OrbitControls, keyboard
│   ├── useGameLoop.ts          requestAnimationFrame loop with deltaTime cap
│   ├── useAudio.ts             SFX + synthesised placement tone
│   ├── useGameMusic.ts         Shared background track (survives rebuilds)
│   ├── useSlotPicking.ts       Raycasting for slot click/hover
│   └── useJevController.ts     Jev "next move" / "play all" orchestration — see § Jev assist
├── modules/
│   ├── config.ts               All constants (SHIP_PRESETS, PHYSICS, SCORING, etc.)
│   ├── levels.ts               10 LevelConfig objects (LevelConfig[])
│   ├── containerFactory.ts     ISO 6346 ID generation + weight distribution
│   ├── shipGrid.ts             Slot layout, available-slot queries, stack helpers
│   ├── dischargeManifest.ts    Pre-load imports/transit into grid before level start
│   ├── physics.ts              List, trim, VCG calculations + disaster checks
│   ├── scoring.ts              Placement, discharge, restow score calculation
│   ├── disasters.ts            Four disaster animations + sound sequences
│   ├── containerRenderer.ts    Canvas-textured PBR container meshes
│   ├── containerMaterials.ts   Per-color material/canvas cache + liveries
│   ├── sceneBuilder.ts         Sky, ocean, dock, lighting, foam particles
│   ├── shipRenderer.ts         Procedural hull OR GLB loader + tilt interpolation
│   ├── craneSystem.ts          STS crane model + placement/discharge animations
│   ├── truckRenderer.ts        GLB truck assembly + inbound/outbound queue
│   └── jev/                    Jev client, config, key vault, rules, state/question builders,
│                               decision validation, summaries — see § Jev assist (optional)
├── store/
│   ├── gameStore.ts            Central Pinia store (all game state)
│   └── jevStore.ts             Jev enabled flag, prefs, status, command channel, exchange history
├── types/
│   ├── index.ts                Container, Slot, GamePhase, LevelConfig, etc.
│   └── jev.ts                  Jev request/response/error/command/exchange types
└── assets/                     Audio (MP3), ship GLBs, truck GLBs
```

---

## Game phase state machine

```
START SCREEN
  ↓ select level
BRIEFING  (multi-page modal; confirmBriefing() advances)
  ↓
DISCHARGE_SELECTING   ← only when imports were pre-loaded
  ├─ click import → DISCHARGE_ANIMATING → DISCHARGE_SELECTING
  ├─ click transit blocking import → RESTOW_SELECTING
  │   ├─ click restow slot → RESTOW_ANIMATING → DISCHARGE_SELECTING
  │   └─ (cancel) → DISCHARGE_SELECTING
  ↓ all imports discharged
SELECTING  (loading phase)
  ├─ click valid slot → ANIMATING → SELECTING
  ├─ physics violation → DISASTER
  ↓ all containers placed
COMPLETE  (score ≥ targetScore, perfect-balance bonus applied)
  or
FAILED    (score < target OR timer expired)
  or
DISASTER  (animation plays, then end state)
```

---

## Key types (`types/index.ts`)

```typescript
type GamePhase =
  | 'start' | 'briefing'
  | 'discharge_selecting' | 'discharge_animating'
  | 'restow_selecting' | 'restow_animating'
  | 'selecting' | 'animating'
  | 'complete' | 'failed' | 'disaster'

type DisasterType = 'capsize' | 'founder' | 'collapse' | 'explosion'

interface Container {
  id: string              // ISO 6346 with check digit
  weight: number          // 4–30 tonnes
  weightCategory: 'light' | 'medium' | 'heavy'
  port: string
  portColor: number       // Three.js hex
  portHex: string         // CSS hex
  portOrder: number       // discharge sequence index
  isHazmat: boolean
  isImport: boolean       // discharged at this port (pre-loaded)
  isTransit?: boolean     // stays on board
  isBeingRestowed?: boolean
}

interface Slot {
  id: string              // "BB-RR-TT" (zero-padded bay-row-tier)
  bay, row, tier: number  // structural (tiers are even: 2,4,6,8)
  bayIndex, rowIndex, tierIndex: number  // 0-based
  xOffset, yOffset, zOffset: number     // world position
  container: Container | null
}
```

**Slot ID format:** `"BB-RR-TT"` — all three segments zero-padded to 2 digits. Tiers use even numbers (2, 4, 6, 8) to match ISO bay/row/tier conventions.

---

## Store (`store/gameStore.ts`)

Key state groups:

| Group | Fields |
|---|---|
| Phase/progress | `phase`, `currentLevel`, `score`, `moveCount`, `elapsedSeconds`, `timerRemaining` |
| Containers | `containers[]`, `currentContainerIndex` |
| Grid | `grid: Record<string, Slot>` (keyed by slot ID) |
| Ship | `shipConfig`, `shipList`, `shipTrim`, `shipVCG` |
| Ports | `currentPorts[]` |
| Events | `events[]` (max 5, newest first) |
| Discharge | `dischargeCount`, `dischargedCount`, `dischargeScore` |
| Restow | `restowContainer`, `restowFromSlotId`, `restowSlots[]` |
| Persistence | `levelBests{}` (localStorage), `completedLevelIds[]` |
| Dev | `isGodMode` (unlocks all levels) |

Home-card progress is read by `modules/progressStorage.ts` from the existing `stowage-master-progress` and `stowage-master-level-bests` local-storage keys. It reports the highest unlocked/reached level for display only. Opening Stowage Master must continue to show the `start` phase level-select screen so the player can choose any unlocked level.

Key actions:

| Action | What it does |
|---|---|
| `startLevel(id)` | Init level, generate containers, setup grid, pre-load manifest |
| `placeContainer(slotId)` | Transition to `animating`, validate |
| `finalizePlacement(slotId)` | Update physics, check disaster, score, advance phase |
| `pickDischargeContainer(slotId)` | Discharge import or initiate restow of transit |
| `finalizeDischarge/RestowScore()` | Score and advance discharge/restow |
| `tickTimer(deltaSeconds)` | Countdown; triggers warnings; emits `'timer-warning'` |
| `addEvent(msg, type)` | Append to event feed (max 5) |
| `confirmBriefing()` | Advance from briefing to first active phase |
| `getStarRatingResult()` | Score % → star count + title string |

**Score targets:**  
`perfectScore = containerCount × 100 + hazmatCount × 25`  
`targetScore = perfectScore × 0.70`

---

## Modules

### `config.ts`
Single source of truth for all tuning constants. Edit here, not inline:
- `SHIP_PRESETS` — `small`, `medium`, `medium-carrier`, `large`
- `PHYSICS` — list/trim warning/critical/disaster thresholds + multipliers
- `SCORING` — point values for every rule
- `STAR_THRESHOLDS` — boundaries for 0–5 stars
- `CONTAINER` — physical size (2.55 × 2.65 × 6.1 units), weight ranges
- `PORT_SEQUENCES` — port colors per vessel type
- `CRANE`, `TRUCK`, `OUTBOUND_TRUCK` — animation parameters

### `levels.ts`
Array of 10 `LevelConfig` objects. Each specifies: vessel preset, `importCount`, `transitCount`, `loadCount`, `timerSeconds`, `hazmatRate`, `transitGrouping` (`'random'|'grouped-by-pod'`), `importPlacement` (`'default'|'upper-tiers'`), `placementSpread` (0–1), and multi-page `briefing` with optional sound cues.

| Level | Vessel | Focus |
|---|---|---|
| 1 | small | Discharge-only tutorial |
| 2 | small | Load tutorial (no physics stress) |
| 3 | small | Discharge + load |
| 4 | small | Grouped transit, restow introduced |
| 5 | small | First hazmat level |
| 6 | medium-carrier | Discharge-only, medium vessel |
| 7 | medium-carrier | Load around onboard transit |
| 8 | medium-carrier | Full port call |
| 9 | medium-carrier | Double feeder workload |
| 10 | medium-carrier | Endgame (240 containers) |

### `physics.ts`
Pure functions — no side effects:
- `calculateList(grid, preset)` → signed float (positive = starboard heavy)
- `calculateTrim(grid, preset)` → signed float (positive = bow heavy)
- `calculateVCG(grid)` → float
- `checkDisasters(grid, preset, newContainer, slotId)` → `DisasterType | null`

Disaster thresholds (absolute values, from `config.PHYSICS` — the source of truth):
- List: warning ≥ 5, critical ≥ 8, **disaster ≥ 12**
- Trim: warning ≥ 4, critical ≥ 7, **disaster ≥ 10**
- Hazmat explosion: two hazmat containers within bay diff < 2, row diff < 1.5, tier diff < 2
- Stack collapse: column weight > `preset.maxStackWeight`

> **Known discrepancy:** `gameStore.ts`'s `isWarning` / `isCritical` computed properties still
> hardcode older thresholds (list ≥ 8 / ≥ 12, trim ≥ 6 / ≥ 9) instead of reading `PHYSICS`. This
> means the ship-status warning/critical UI styling can disagree slightly with the disaster
> thresholds above and with `scoring.ts` (which does use `PHYSICS.*Warning`). This is a **known,
> separate issue** — not fixed here, since fixing it changes gameplay (when the warning-zone
> scoring penalty and status colours kick in). Flagged for a follow-up.

### `scoring.ts`
Pure functions returning `{ score, reasons }`:
- `calculatePlacementScore(container, slotId, grid, shipList, shipTrim, preset)` — penalties for heavy-high, heavy-outboard, warning-zone, hazmat proximity; bonus for safe hazmat placement
- `calculateDischargeScore(container, slotId, grid, shipList, shipTrim)` — bonuses for top pick, physics improvement, hazmat; penalty for blocked pick
- `calculateRestowScore(container, newSlotId, grid)` — base −15 pts + bonuses for low placement, safe hazmat; penalty for new overstow

### `dischargeManifest.ts`
Called by `startLevel()` to fill the grid before play:
1. Place `importCount` containers (gold) at lower tiers (or upper if `'upper-tiers'`).
2. Place `transitCount` containers on top of imports to create overstow.
3. `transitGrouping: 'grouped-by-pod'` clusters transit by port within assigned bays.

Helpers used during discharge phase:
- `getDischargeableSlots(grid)` → top containers in each column (actionable)
- `getRestowSlots(grid, fromSlotId, importSlots)` → valid destinations (excludes same bay/row as imports)

### `containerFactory.ts`
- Generates ISO 6346 IDs with correct check digit (session-scoped serial counter).
- Weight distribution: 30% light (4–10t), 40% medium (11–20t), 30% heavy (21–30t).
- Assigns port cyclically from the level's port list.

### `shipGrid.ts`
- `generateSlots(preset)` → creates full `Record<string, Slot>` map.
- Supports `bayXOffsets[]` and `bayYBaseOffsets[]` for non-uniform bay geometry.
- `getAvailableSlots(grid)` → empty slots at ground level or directly above a filled slot.
- `getStackWeight(grid, bay, row)` → sum weight in a column.
- `isOutermostRow(rowIndex, totalRows)`, `isTopThird(tierIndex, totalTiers)` for scoring helpers.

### `disasters.ts`
Four animation factories, each returning `{ update(dt: number): boolean, cleanup(): void }`:
- `capsize` — roll 75° right + sink 10 m over 5 s
- `founder` — pitch 50° forward + sink 12 m over 5 s
- `collapse` — containers explode outward with gravity over 4 s
- `explosion` — fireball, smoke, shockwave, containers scatter, ship sinks over 6 s

Disaster sound sequences are defined inside this module (timed via `setTimeout`).

### `containerRenderer.ts` / `containerMaterials.ts`
- `createContainerMesh(container)` → `THREE.Group` with 6-face PBR material array.
- Long walls: corrugation, ISO code, operator badge, warning triangle.
- Door ends: panel detail, hazard stripe, CSC plate, height markings.
- Hazmat: orange band + four rotating diamond symbols (pulsed emissive in game loop).
- `SHIPPING_LINE_LIVERY` maps port → primary color (Maersk blue, Evergreen green, COSCO red, Hapag orange, HMM purple).
- Canvas textures cached by color hex — call `disposeContainerMaterials()` on level teardown to free GPU memory.

### `sceneBuilder.ts`
World geometry factories: `createSkyDome()`, `createOcean()`, `createDock()`, `createLighting()`, `createFoamParticles()`. Each returns an animate function or an `{ animate }` object for the game loop.

Ocean waves: `y = A*sin(kx - ωt) + B*cos(k'z - ω't)` updated per-frame on vertex positions.

### `shipRenderer.ts`
- `loadShipGLB(path, preset)` — async load + cache; clone on reuse.
- `createShip(preset)` — procedural hull (tapered prism, deck, superstructure, hatch covers, masts, rigging, fenders).
- `updateShipTilt(ship, targetList, targetTrim, dt)` — lerp rotation toward physics target.
- `snapShipTilt(ship, list, trim)` — instant (used on `startLevel`).

**GLB quirk:** Most ships rotate 90° around Y on load (so model's Z → game's X). The `medium-carrier` uses 0° rotation (different export orientation). See `config.SHIP_PRESETS[*].modelRotationY`.

### `craneSystem.ts`
- `createCrane(preset)` → portal frame + operator cab + boom + trolley + spreader + hoist cables.
- `createPlacementAnimation(crane, slot, containerMesh)` → trolley traverses to slot, cables lower, container descends; ~1.2 s.
- `createDischargeAnimation(crane, slot, containerMesh)` → reverse sequence.
- Returns `{ update(dt): boolean, cleanup() }`.

### `truckRenderer.ts`
- `loadTruckGLBs()` — pre-warm trailer + cab into cache.
- `createTruckGLB()` — assemble trailer + cab with proper offsets.
- `createOutboundTruckQueue(n)` — spawn N trucks in dock formation; each departs with container after discharge animation.

---

## Composables

### `useThreeScene`
Initializes `WebGLRenderer` (ACES tone mapping, log depth), `PerspectiveCamera` (FOV 48°), `OrbitControls` with damping. Keyboard pan (WASD/arrows) and zoom (±/numpad). Handles resize. Call `dispose()` on unmount.

### `useGameLoop`
Wraps `requestAnimationFrame`. Caps `deltaTime` at 0.1 s. Provides `start(callback)` / `stop()`. Cleans up on unmount.

### `useAudio`
Loads all MP3 assets asynchronously (graceful degradation if load fails). Key methods: `playSound(name, volume)`, `playPlacementSound()` (synthesised 220→110 Hz sweep), `playDisasterSequence(type)`. Ambient seagulls on ~60 s jitter. Respects `globalSettings.soundMuted`.

### `useGameMusic`
Single shared `HTMLAudioElement` (persists across level reloads). Auto-plays; falls back to waiting for user gesture. Respects `globalSettings.musicMuted`.

### `useSlotPicking`
Raycast-based click/hover. Searches meshes with `userData.isSlotIndicator` or `userData.isImportContainer`. Attach/detach per phase to enable/disable input. Exposes `hoveredSlotId` for highlight feedback.

---

## Physics reference

Thresholds below are `config.PHYSICS` — the source of truth for stowage-master's physics.
`store.isWarning` / `isCritical` still hardcode the older values (list ≥ 8 / ≥ 12, trim ≥ 6 / ≥ 9);
see the callout under § Modules → `physics.ts` above.

| Metric | Warning | Critical | Disaster |
|---|---|---|---|
| List (°) | ≥ 5 | ≥ 8 | ≥ 12 |
| Trim (°) | ≥ 4 | ≥ 7 | ≥ 10 |

List formula: `(Σ weight·zOffset) / (totalWeight · beamFactor) · multiplier · 100`  
Trim formula: `(emptyTrimMoment + Σ weight·xOffset) / (totalWeight · lengthFactor) · multiplier · 100`  
Physics multiplier is per-preset (larger ships less reactive).

---

## Scoring reference

| Rule | Points |
|---|---|
| Base placement | +100 |
| Hazmat placed safely | +25 |
| Heavy too high (>20t, top third) | −35 |
| Heavy outboard (>15t, outer row) | −25 |
| Hazmat too close | −50 (blocks placement) |
| Blocked earlier-discharge cargo | −25 per blocked |
| Ship in warning zone at placement | −35 |
| Perfect balance bonus (end of level) | +50 |
| Base discharge | +60 |
| Top-tier pick | +20 |
| Improves list or trim | +20 |
| Restow base cost | −15 |

Star rating (score / targetScore):

| % | Stars | Title |
|---|---|---|
| < 20% | 0 | Absolute Maritime Disaster |
| 20–40% | 1 | Landlubber |
| 40–60% | 2 | Deck Hand |
| 60–80% | 3 | Solid Stevedore |
| 80–95% | 4 | Harbor Master |
| ≥ 95% | 5 | Perfect Planner |

---

## Ship presets (`config.SHIP_PRESETS`)

| Key | Bays | Rows | Tiers | GLB | Notes |
|---|---|---|---|---|---|
| `small` | 3 | 3 | 4 | `container-ship-small-empty-no-containers.glb` | Feeder |
| `medium` | 6 | 5 | 5 | none (procedural) | — |
| `medium-carrier` | 12 (split) | 4 | 4 | `medium-vessel-no-containers.glb` | Bay gap + raised forecastle (bays 10–11 higher Y), 0° model rotation |
| `large` | 8 | 7 | 6 | none (procedural) | — |

`medium-carrier` quirks:
- 12 bays split into two groups (stern 0–5, bow 6–11) separated by `bayXOffsets[]` gap of ~9 units.
- Bays 10–11 have higher `bayYBaseOffset` to model the raised forecastle.
- GLB uses 0° model rotation (differs from other ships that rotate 90°).

---

## Jev assist (optional)

Stowage Master can optionally hand a phase's move ("which legal slot?") to **Jev**
(TypeSafe System One, via OpenRouter's Decisions API) instead of the player clicking it
themselves. Most players never see this — the only visible sign when it's off is a small,
low-contrast `Jev` link on the Start screen. See [.ai/plans/stowage-master/00-jev-overview.md](../../../.ai/plans/stowage-master/completed/00-jev-overview.md)
(moved to `completed/` once implemented) for the full design and
[.agents/skills/jev-integration/SKILL.md](../../../.agents/skills/jev-integration/SKILL.md) for
the provider-level rules this integration follows.

### File map

```
types/jev.ts                          Request/response/error/command/exchange types
modules/jev/
  jevConfig.ts                        Endpoint, model id, timeouts, limits, versions
  jevKeyVault.ts                      Module-scoped in-memory API key holder
  jevClient.ts                        fetch wrapper, key validation, error taxonomy
  jevRules.ts                         Rules/briefing text for Jev, generated from PHYSICS/SCORING
  jevStateBuilder.ts                  Game snapshot → Jev `state` object (+ token-budget degrade)
  jevQuestionBuilder.ts               Phase → Choice question with legal options only
  jevDecision.ts                      Response validation, ranking, stale-response guard, policy
  jevSummaries.ts                     Human-readable request/response summaries for the inspector
store/jevStore.ts                     Enabled flag, prefs, status, command channel, exchange history
composables/useJevController.ts       "Next move" / "play all" orchestration, retry/pause policy
components/jev/
  JevStartToggle.vue                  Low-key link + settings popover on StartScreen
  JevKeyDialog.vue                    API key entry, disclosure, validation
  JevPanel.vue                        In-game controls, status, "Details ▸" link
  JevInspector.vue                    Request/response inspector drawer (evidence + probabilities)
```

### The command-channel pattern (never call store actions from Jev code directly)

`useJevController.ts` never calls `gameStore.placeContainer()` / `pickDischargeContainer()` /
etc. directly. Doing so would skip the crane/truck animation the same move gets from a mouse
click. Instead:

1. The controller snapshots the game, builds the Jev request and validates the response against
   the legal slot set (`store.availableSlots` / `dischargeableSlots` / `availableRestowSlots`).
2. It calls `jevStore.issueCommand(kind, slotId)`, which sets `jevStore.pendingCommand` — a
   plain-data command, not a direct mutation.
3. `GameCanvas.vue` watches `pendingCommand` and executes it through the **same** `execute*`
   functions a mouse click uses (animation, `finalizePlacement`/`finalizeDischarge`/etc.), then
   calls `jevStore.ackCommand(id, accepted)`.
4. The controller awaits the ack (`waitForAck`) before moving on.

Code owns legality, execution, staleness and retries. Jev only answers "which of these legal
slots?" — never call a `gameStore` mutation from `modules/jev/*` or `useJevController.ts` other
than through this channel.

### Key handling

The API key lives **only** in a module-scoped variable in `jevKeyVault.ts` — never in
localStorage, sessionStorage, a Pinia store, a cookie, a file or a log. It is lost on page
refresh by design (`jevStore.hasKey` becomes `false`; the player is re-prompted). Persisted
Jev *preferences* (`enabled`, `showInspector`, `settleDelayMs`, `minConfidenceToAutoplay`) live in
localStorage under `JEV_CONFIG.prefsStorageKey` — the key itself must never be added there.

### The raw-state boundary

Jev is given roughly what a human sees on screen, plus the rules — vessel geometry, current
list/trim/VCG, the bay plan, the container to move, the load list, and legal slot descriptions.
Code does **not** precompute per-candidate outcomes (resulting list/trim, disaster flags, score
previews) and does **not** filter dangerous slots out of the option list — only rule-legal slots
are offered, exactly the slots a human could click, and Jev can still sink the ship. Never add
predicted-outcome fields to `jevStateBuilder.ts` or `jevQuestionBuilder.ts` without revisiting
this boundary (see 02 §2.9 for the "assisted mode" idea, deliberately not built).

### Versioning

Bump these whenever the corresponding shape or wording changes, so historical exchanges and any
recorded evaluation baseline (§ below) can be told apart from a differently-behaving build:
- `JEV_CONFIG.stateSchemaVersion` — the `state` object's shape (`jevStateBuilder.ts`)
- `JEV_CONFIG.questionVersion` — the Choice question's instructions/criteria wording (`jevQuestionBuilder.ts`)
- `JEV_CONFIG.model` — the pinned Jev model build (`typesafe/jev-1.13` at time of writing)

### Provider endpoint gotcha

The Decisions API is `POST https://openrouter.ai/api/alpha/decisions` — **`/api/alpha/...`**, not
`/api/v1/...` (the key-check endpoint, `GET /api/v1/key`, is the only `/api/v1/` call this
integration makes). Hitting `/api/v1/decisions` 404s.

### The exchange/inspector pipeline

Every request `useJevController.ts` sends is recorded via `jevStore.recordExchange()` before the
`fetch` call (a `JevExchange` with `outcome: 'pending'`), then patched via `jevStore.updateExchange()`
as the response, validation, execution and game result arrive (`outcome` becomes one of
`executed | stale | rejected | error | cancelled | paused_low_confidence`). History is
newest-first, capped at `JEV_CONFIG.historyLimit` (50), held in `shallowRef` so large request/
response bodies aren't deep-proxied, and is in-memory only — cleared whenever Jev is disabled.
`JevPanel.vue`'s "Details ▸" link (shown only when the "Show Jev details" preference is on)
toggles `jevStore.isInspectorOpen`, which `JevInspector.vue` reads to render itself as a drawer.
The inspector shows the evidence sent and the probabilities returned — it never invents or
displays a rationale for Jev's choice, because Jev doesn't return one.

### Manual QA checklist

There is no automated test runner in this repo, and Jev needs a live browser session (an
OpenRouter key, `npm run dev`) to exercise — this cannot be verified by lint/build/type-check
alone. The checklist below has **not been run** as part of this change; run it in Chrome (plus
Firefox for the key dialog and CORS) before relying on Jev in a real session:

- **Hidden by default:** with cleared site data, the Start screen shows only the faint `Jev`
  link and there's no Jev UI in-game; `J` / `Shift+J` do nothing.
- **Key handling:** a junk key errors with no key persisted anywhere in devtools storage; a
  valid key enables Jev and shows remaining credit; after a refresh Jev stays enabled but the
  key is gone; Forget key and Disable both work (Disable also hides the panel and clears history).
- **Single step:** L1 discharges an import with full crane/truck animation and a score popup;
  L4 lifts a transit container and places it (both in one press, and split across two presses);
  L2 loads a container with hazmat alerts/score reasons intact.
- **Play all:** L1 and L3 run to completion (L3 crosses from discharge to load unattended); L5
  or L8 runs to complete/failed/disaster and stops cleanly, with the disaster overlay and failed
  modal working as usual; L10 completes ~130–200 moves with no memory growth (history capped at
  50) or stray meshes; stopping mid-request leaves nothing moving afterwards; a timer expiry
  during a request discards the answer and stops play-all.
- **Failures:** offline gives one retry then pauses with Resume working; a 401 (key revoked
  mid-run) pauses, forgets the key and re-prompts.
- **Inspector:** summaries are readable, probability bars sum to ~100%, raw JSON copy works,
  there is no `Authorization` field anywhere in the drawer, and the cost total matches the
  OpenRouter activity page.
- **Budget:** inspector `estTokens` vs. the response's `usage.input_tokens` on L10 stays under
  24K; if the estimate is far off, adjust the divisor in `jevStateBuilder.ts`.
- **Regression:** normal mouse play on L1, L4, L5 and L8 is unchanged with Jev disabled **and**
  enabled-but-idle.
- **Build:** `npm run lint` and `npm run build` pass (verified for this change; see repo history).

### Evaluation baseline (not yet recorded)

The skill recommends recording a raw-mode play-quality baseline (play-all 3× each on L2, L5, L8;
completion rate, disaster rate, average score % of target, average confidence, cost), tagged with
`stateSchemaVersion`, `questionVersion` and the model build, to judge whether a future "assisted"
mode (state/02 §2.9) is worth building. This requires the manual QA session above and has not
been run yet — add the results table here once it has.

---

## Known patterns and pitfalls

1. **No Vue reactivity on Three.js objects.** Use plain variables for scene objects; never store `Mesh` / `Group` in a Pinia store or `ref`. Proxy overhead causes performance degradation.
2. **Grid keyed by slot ID string.** Always use `"BB-RR-TT"` format (zero-padded, 2 digits each). Use `shipGrid.ts` helpers to generate IDs rather than constructing strings manually.
3. **Tier numbering is even** (2, 4, 6, 8). When iterating tiers arithmetically, use `tierIndex` (0-based) for array ops and `tier` for display/ID only.
4. **Container material cache.** Call `disposeContainerMaterials()` on level end/restart to avoid GPU memory leaks. The canvas cache survives intentionally (same colors reused across levels).
5. **GLB model cache.** `shipRenderer` caches loaded GLBs by path. Calling `loadShipGLB()` twice for the same path returns a clone.
6. **Audio context resume.** Browsers block audio until a user gesture. `useAudio` queues sounds and retries on first interaction — do not assume immediate playback.
7. **Restow slot validation.** `getRestowSlots()` excludes the same bay/row as imports to prevent creating new overstow chains. Don't bypass this validation.
8. **Hazmat proximity uses halved thresholds.** Real bay and tier numbers use odd/even spacing; the proximity check compensates by using `bayDiff < 2` and `tierDiff < 2` (not 1).
9. **`isBeingRestowed` flag.** A shallow copy of the container is created with this flag set during lift. The original slot is cleared. If restow is cancelled, the container must be returned and the flag cleared.
10. **`perfectScore` recalculation.** After pre-loading the manifest, `hazmatCount` is known — `perfectScore` and `targetScore` are (re)calculated then. Do not cache these before `startLevel` completes.

---

## Extending the sim

### Add a new level
1. Append a `LevelConfig` to `LEVELS` in `modules/levels.ts`.
2. Set `preset`, container counts, `timerSeconds` (0 = no timer), `hazmatRate`, grouping flags.
3. Write `briefing` pages (title, bullets, optional icon + sound).
4. Adjust `placementSpread` (0 = deterministic, 1 = fully random) for difficulty.

### Add a new ship preset
1. Add a `ShipPreset` entry to `SHIP_PRESETS` in `config.ts`.
2. Supply GLB path + scale/rotation/offset or leave `modelPath` empty for procedural hull.
3. If the hull has non-uniform bay geometry (gap, raised area), populate `bayXOffsets[]` and `bayYBaseOffsets[]`.
4. Add a corresponding entry in `PORT_SEQUENCES`.

### Add a new disaster type
1. Extend `DisasterType` in `types/index.ts`.
2. Implement animation in `modules/disasters.ts` (return `{ update(dt): boolean, cleanup() }`).
3. Add trigger condition in `physics.checkDisasters()`.
4. Add case in `DisasterOverlay.vue` for display text.

### Add a new scoring rule
1. Add constant to `config.SCORING`.
2. Add condition + `reasons.push(...)` in the relevant `calculate*Score` function in `modules/scoring.ts`.
3. Update `perfectScore` formula in the store if the new rule affects the maximum achievable score.

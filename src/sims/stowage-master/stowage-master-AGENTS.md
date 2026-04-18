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
│   ├── ui/
│   │   ├── TopBar.vue          Level name, phase badge, score/target
│   │   ├── ContainerInfo.vue   Current container (weight, port, hazmat)
│   │   ├── LoadList.vue        Next 6 containers in queue
│   │   ├── PortLegend.vue      Port color swatches
│   │   ├── ShipStatus.vue      List/trim/VCG gauges
│   │   ├── LastPlacement.vue   Score breakdown after placement
│   │   ├── LastDischarge.vue   Score breakdown after discharge
│   │   ├── ScorePopup.vue      Float-up "+N pts" feedback
│   │   ├── MoveCounter.vue     Progress bar (moves / total containers)
│   │   ├── TimerWidget.vue     Countdown (red when critical)
│   │   ├── DischargeBar.vue    Discharged N/total progress
│   │   ├── EventFeed.vue       Last 5 events
│   │   ├── MeterBar.vue        Horizontal gauge component
│   │   ├── StarRating.vue      1–5 stars + title
│   │   └── KeyboardHint.vue    Context-sensitive key hints
│   └── modals/
│       ├── StartScreen.vue     Level select with star ratings + unlock state
│       ├── SceneLoading.vue    "Loading assets…" overlay
│       ├── LevelBriefing.vue   Multi-page instructional modal
│       ├── LevelComplete.vue   Stars, score, best record, next level
│       ├── LevelFailed.vue     Reason + retry button
│       └── DisasterOverlay.vue Disaster name + dramatic message during FX
├── composables/
│   ├── useThreeScene.ts        Renderer, camera, OrbitControls, keyboard
│   ├── useGameLoop.ts          requestAnimationFrame loop with deltaTime cap
│   ├── useAudio.ts             SFX + synthesised placement tone
│   ├── useGameMusic.ts         Shared background track (survives rebuilds)
│   └── useSlotPicking.ts       Raycasting for slot click/hover
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
│   └── truckRenderer.ts        GLB truck assembly + inbound/outbound queue
├── store/
│   └── gameStore.ts            Central Pinia store (all game state)
├── types/
│   └── index.ts                Container, Slot, GamePhase, LevelConfig, etc.
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

Disaster thresholds (absolute values):
- List: warning ≥ 8, critical ≥ 12, **disaster ≥ 12**
- Trim: warning ≥ 6, critical ≥ 9, **disaster ≥ 10**
- Hazmat explosion: two hazmat containers within bay diff < 2, row diff < 1.5, tier diff < 2
- Stack collapse: column weight > `preset.maxStackWeight`

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

| Metric | Warning | Critical | Disaster |
|---|---|---|---|
| List (°) | ≥ 8 | ≥ 12 | ≥ 12 |
| Trim (°) | ≥ 6 | ≥ 9 | ≥ 10 |

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

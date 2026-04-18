# Container Stack / Contenga - Agent Guide

## Sim overview

Contenga is a 3D Jenga-style shipping container stacking game. Players remove a container from the tower, drag it out, place it back on top, and try to complete timed level objectives before the stack collapses.

The sim is registered by `definition.ts` with id `container-stack`, title `Contenga`, and root component `ContainerStack.vue`.

## Local structure

```
src/sims/container-stack/
├── ContainerStack.vue          Root shell, HUD layout, modals, pause handling
├── definition.ts               Sim metadata for auto-discovery
├── components/
│   ├── GameCanvas.vue          Main Three.js canvas and pointer interaction bridge
│   ├── modals/                 Start, pause, level complete, level failed, game over
│   └── ui/                     Score, timer, stability, instructions, keyboard hint
├── composables/
│   ├── useThreeScene.ts        Renderer/camera/orbit setup and keyboard camera controls
│   ├── useContainerPicking.ts  Raycast picking for tower blocks
│   ├── useGameLoop.ts          Render + physics loop
│   ├── useAudio.ts             Gameplay sound facade
│   └── useGameMusic.ts         Background music lifecycle
├── modules/
│   ├── config.ts               Core dimensions, tuning constants, camera values
│   ├── towerBuilder.ts         Tower layers, slot positions, placement candidates
│   ├── physics.ts              Stability, support checks, wobble, collapse pieces
│   ├── scoring.ts              Move scoring and combo logic
│   ├── levelConfig.ts          Level and move timer scaling
│   ├── containerRenderer.ts    Container mesh/material creation
│   ├── placementMarkers.ts     Placement target visuals
│   ├── sceneBuilder.ts         Lights, ground, environment, tower pivot
│   ├── audio.ts                Sound registry
│   └── audioPlayer.ts          Low-level sound playback
├── store/gameStore.ts          Pinia state machine and gameplay actions
├── types/index.ts              Sim-specific TS types
└── assets/audio/               Bundled local gameplay audio
```

Keep all Contenga-specific logic, media, and UI inside this folder. Only extract code to shared project folders when another sim actually reuses it.

## Gameplay state model

`store/gameStore.ts` owns the game state. Treat it as the source of truth for phases, tower data, scoring, timers, floating containers, collapse pieces, and level progress.

The important phase flow is:

`start -> playing -> removing -> placing -> playing`

Failure and interruption phases branch off that flow:

- `paused` toggles from `playing` via Escape and returns to `playing`.
- `levelFailed` is used for move or level timeout failures.
- `collapsing` runs collapse visuals, then `gameOver`.
- `levelComplete` fires after `MOVES_PER_LEVEL` successful placements.

When adding gameplay behavior, prefer adding actions to the store rather than mutating layers or timers directly from components. `GameCanvas.vue` should translate pointer/canvas events into store actions, not become the gameplay rules engine.

## Tower and physics conventions

- Container dimensions are configured in `modules/config.ts` using 20-foot container proportions: width `2.44`, height `2.59`, length `6.06`.
- A tower layer has three slots. Orientations alternate by layer: `alongX`, then `alongZ`.
- `TowerLayer.slots` uses `null` for removed or empty slots. Preserve slot indices when moving containers.
- `slotWorldPosition()` in `towerBuilder.ts` is the canonical slot-to-world transform. Use it instead of duplicating position math.
- Structural support is sampled in `physics.ts` by checking each block footprint against occupied blocks below it.
- Stability combines center of mass, height penalty, incomplete layer penalties, and structural support.
- Collapse rendering uses `CollapsePiece.meshKey` for stable Three.js map keys. Do not rely only on container ids across games because ids reset.

## Rendering and interaction

`components/GameCanvas.vue` coordinates render-only objects with the store:

- `blocksGroup` contains current tower block meshes under the tower pivot.
- `ghostGroup` contains the floating container during removal and placement.
- `placementMarkersGroup` contains clickable top-slot markers in placing mode.
- `collapseGroup` contains independent meshes for collapse animation.

`composables/useThreeScene.ts` owns renderer setup, camera framing, keyboard orbit/zoom, idle orbit, top-down placement mode, and disposal. Keep scene lifecycle work there unless it is tightly coupled to gameplay interaction.

Pointer interaction follows this pattern:

1. Raycast a removable block while `phase === 'playing'`.
2. Call `store.startRemoval()`.
3. Track drag jitter and slide progress while `phase === 'removing'`.
4. Call `store.finishSlideAndEnterPlacing()` after a successful slide, or `store.cancelRemoval()`.
5. In `placing`, raycast placement markers and call `store.placeOnTop(slotIndex)`.

## Audio

Audio assets are local to `assets/audio/`. Add new Contenga sounds there and register them through the existing audio modules. Keep user-gesture/browser autoplay constraints in mind: audio initialization is intentionally triggered from play/interaction paths.

## Tuning

Use these files for balance changes:

- `modules/config.ts` for block dimensions, tower height, physics constants, scoring constants, camera behavior, and drag thresholds.
- `modules/levelConfig.ts` for level time limits, move time limits, and moves required per level.
- `modules/scoring.ts` for score calculation and combo behavior.

Avoid scattering tuning constants through Vue components. If a visual depends on a gameplay dimension, import the relevant config value.

## Known pitfalls

- Do not mutate Three.js objects into Pinia state except for existing `Vector3` fields that the sim already uses. Keep meshes, materials, groups, and raycasters in component/composable scope.
- Always dispose geometries and materials when replacing Three.js object trees. `GameCanvas.vue` has local helpers for this.
- Preserve `floatingContainer` and `floatingFrom` consistency during removal, cancellation, placement, timer failure, and collapse.
- Recompute physics after any layer or slot mutation with `store.recomputePhysics()` or through existing store actions.
- Avoid changing `GamePhase` names without updating all watchers, modals, and interaction gates.
- Keep `wobbling` in the type only if needed for compatibility; current active flow uses wobble state while phases remain `playing`, `removing`, or `placing`.
- Timer failures (`timeoutMove`, `timeoutLevel`) and tower collapse are intentionally distinct outcomes. Do not route them through the same modal path unless the UX is also updated.

## Verification

After substantive changes, run the root project checks:

```
npm run lint
npm run build
```

For gameplay or rendering changes, also smoke-test `/sim/container-stack` in a browser. Check pointer removal, placement markers, Escape pause, level completion, timeout failure, collapse, and audio startup.

---
name: adding-a-sim
description: >-
  Add a new game or simulation to the Shipping Container Sims project.
  Use when the user asks to create, add, scaffold, or implement a new sim,
  game, or simulation, or when working inside src/sims/.
---

# Adding a New Sim / Game

## How auto-discovery works

`src/composables/useSimRegistry.ts` uses `import.meta.glob('@/sims/*/definition.ts')` to find every sim at build time. No manual registration is needed — drop a folder and it appears on the menu.

## Step-by-step

### 1. Create the sim folder

Each sim is a self-contained sub-folder. **All** sim-specific code, components, composables, stores, types, and media stay inside this folder — nothing leaks into the top-level `src/` directories.

```
src/sims/<sim-id>/
├── definition.ts            # Required — metadata & lazy component import
├── <SimName>.vue            # Required — root component for the game
├── components/              # Sim-specific Vue components
│   ├── ui/                  #   UI widgets (meters, popups, overlays)
│   └── modals/              #   Modal dialogs (start screen, level complete)
├── composables/             # Sim-specific composables (scene, audio, game loop)
├── modules/                 # Pure-TS logic (scoring, physics, levels, renderers)
├── store/                   # Pinia store(s) for this sim's state
├── types/                   # Sim-specific TypeScript interfaces
└── assets/                  # Sim-specific media (3D models, sounds, textures)
```

`<sim-id>` must be lowercase kebab-case (e.g. `cargo-rush`).

**Example** — the existing `stowage-master` sim uses this layout:

```
src/sims/stowage-master/
├── definition.ts
├── StowageMaster.vue
├── components/
│   ├── GameCanvas.vue
│   ├── TopBar.vue, LoadList.vue, ContainerInfo.vue, ...
│   ├── ui/StarRating.vue, ui/MeterBar.vue
│   └── modals/StartScreen.vue, modals/LevelComplete.vue, ...
├── composables/
│   ├── useThreeScene.ts     # sim's own Three.js scene setup
│   ├── useGameLoop.ts
│   ├── useAudio.ts
│   └── useSlotPicking.ts
├── modules/
│   ├── config.ts, levels.ts, scoring.ts, physics.ts
│   ├── shipGrid.ts, shipRenderer.ts, containerFactory.ts, containerRenderer.ts
│   ├── craneSystem.ts, sceneBuilder.ts, disasters.ts
│   └── audio.ts
├── store/gameStore.ts
└── types/index.ts
```

### 2. Write `definition.ts`

Export a `definition` constant that satisfies the `SimDefinition` interface:

```ts
import type { SimDefinition } from '@/types/sim'

export const definition: SimDefinition = {
  id: 'cargo-rush',
  title: 'Cargo Rush',
  tagline: 'Short punchy hook for the card',
  description: 'A longer description shown on the sim card and coming-soon page.',
  icon: '🏗️',
  status: 'coming-soon',  // 'playable' | 'coming-soon' | 'wip'
  color: '#10b981',        // accent colour for the card border/glow
  tags: ['3D', 'Action'],
  component: () => import('./CargoRush.vue'),
}
```

#### `SimDefinition` fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Must match the folder name |
| `title` | `string` | Display name |
| `tagline` | `string` | One-liner shown under the title |
| `description` | `string` | Longer blurb for the card body |
| `icon` | `string` | Single emoji |
| `status` | `SimStatus` | `'playable'` makes it clickable; others show as locked |
| `color` | `string` | Hex colour for card accent |
| `tags` | `string[]` | Category labels shown as chips |
| `component` | `() => Promise<{ default: Component }>` | Dynamic import of the root Vue component |

### 3. Create the root component

At minimum:

```vue
<script setup lang="ts">
// Game logic goes here
</script>

<template>
  <div class="my-sim">
    <!-- game UI -->
  </div>
</template>

<style scoped>
.my-sim {
  flex: 1;
  display: flex;
}
</style>
```

The component is rendered inside a flex container that fills the viewport below the header bar. Use `flex: 1` on the root element.

### 4. Using Three.js

Import the shared composable — it handles setup, resize, render loop, and disposal:

```ts
import { ref } from 'vue'
import { useThreeScene } from '@/composables/useThreeScene'

const canvas = ref<HTMLCanvasElement | null>(null)

const ctx = useThreeScene(canvas, (ctx, delta) => {
  // per-frame update logic
})
```

Pair it with `<canvas ref="canvas" />` in the template.

### 5. Mark as playable

When the game is ready, change `status` in `definition.ts`:

```ts
status: 'playable',
```

The landing page will automatically move the card from "Coming Soon" to "Ready to Play".

## Conventions

- **Sim isolation is the #1 rule.** All code, components, composables, stores, types, and media for a sim live inside its own `src/sims/<sim-id>/` folder. This keeps sims independently deletable and avoids cross-sim coupling.
- Sim-specific Vue components go in `<sim-id>/components/` (with `ui/` and `modals/` sub-folders as needed).
- Sim-specific composables go in `<sim-id>/composables/`.
- Pure-TS logic (scoring, physics, level data, renderers) goes in `<sim-id>/modules/`.
- Sim-specific Pinia stores go in `<sim-id>/store/`.
- Sim-specific TypeScript interfaces go in `<sim-id>/types/`.
- Sim-specific media (3D models, sounds, textures) go in `<sim-id>/assets/`. Copy from `available-media/` as needed.
- Only logic that is genuinely reused by **multiple** sims belongs in the top-level `src/composables/` or `src/components/`.
- Use Vue 3 Composition API with `<script setup lang="ts">` and TypeScript strict mode.
- Use Pinia for any state that needs to persist across components within a sim.

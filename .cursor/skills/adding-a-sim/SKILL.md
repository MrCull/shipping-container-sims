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

```
src/sims/<sim-id>/
├── definition.ts       # Required — metadata & lazy component import
├── <SimName>.vue        # Required — root component for the game
└── ...                  # Optional — composables, sub-components, assets, etc.
```

`<sim-id>` must be lowercase kebab-case (e.g. `cargo-rush`).

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

- Keep all code for a sim inside its own `src/sims/<sim-id>/` folder.
- Shared logic across sims belongs in `src/composables/`.
- Shared UI components belong in `src/components/`.
- Sim-specific composables, helpers, or sub-components stay inside the sim folder.
- Use Vue 3 Composition API with `<script setup lang="ts">` and TypeScript strict mode.
- Use Pinia for any state that needs to persist across components within a sim.

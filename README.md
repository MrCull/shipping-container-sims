# Shipping Container Sims

A collection of shipping-container-themed simulations and games built with **Vue 3**, **Three.js**, and **Pinia**.

## Quick Start

```bash
npm install
npm run dev
```

## Project Structure

```
src/
├── assets/          # Global CSS
├── components/      # Shared UI components
├── composables/     # Reusable composition functions
│   ├── useSimRegistry.ts   # Auto-discovers & registers all sims
│   └── useThreeScene.ts    # Three.js scene lifecycle helper
├── pages/           # Route-level page components
├── router/          # Vue Router configuration
├── sims/            # ★ Each sim/game lives in its own folder
│   ├── stowage-master/
│   │   ├── definition.ts       # SimDefinition metadata
│   │   └── StowageMaster.vue   # Root game component
│   └── box-empire/
│       ├── definition.ts
│       └── BoxEmpire.vue
├── stores/          # Pinia stores
│   └── sims.ts      # Central sim registry store
└── types/           # Shared TypeScript types
    └── sim.ts       # SimDefinition interface
```

## Adding a New Sim

1. Create a folder under `src/sims/<your-sim-id>/`
2. Add a `definition.ts` that exports a `SimDefinition` object
3. Add a root Vue component for the game
4. The sim is auto-discovered — no other files need editing

### Example `definition.ts`

```ts
import type { SimDefinition } from '@/types/sim'

export const definition: SimDefinition = {
  id: 'my-sim',
  title: 'My Sim',
  tagline: 'A short hook',
  description: 'Longer description shown on the card.',
  icon: '🎮',
  status: 'coming-soon',   // 'playable' | 'coming-soon' | 'wip'
  color: '#3b82f6',
  tags: ['3D', 'Puzzle'],
  component: () => import('./MySim.vue'),
}
```

## Tech Stack

- **Vue 3** (Composition API + `<script setup>`)
- **Vite** — dev server & build
- **TypeScript** — strict mode
- **Pinia** — state management
- **Vue Router** — SPA routing
- **Three.js** — 3D rendering

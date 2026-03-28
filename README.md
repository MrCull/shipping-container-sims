# Shipping Container Sims

A Vue 3 + TypeScript web app hosting shipping-container-themed simulations and games. Each sim is auto-discovered and self-contained, with a shared framework for 3D rendering, state management, and routing.

## Current Sims

- **Stowage Master** — Tetris meets real-world container logistics. Plan and optimise the stowage of shipping containers on a vessel. Balance weight distribution, cargo class restrictions, and port rotation to become the ultimate stowage planner. *(3D, Puzzle, Logistics)*

- **Contenga** — How high can you stack before the tower falls? A 3D Jenga-style game with shipping containers. Slide blocks out, stack them on top, and keep the tower balanced — poor support under the stack will bring it down. *(3D, Physics, Puzzle)*

- **Box Empire** — Build your shipping empire from a single container. Start with one rusty container and grow a global logistics empire. Buy routes, upgrade ports, manage fleets, and outsmart rival shipping companies in this strategic tycoon sim. *(Strategy, Tycoon, Management)*

All sims are playable at **[container-games.net](https://container-games.net)**.

## Quick Start

```bash
npm install
npm run dev
```

The app starts at `http://localhost:5173/` with a home page listing all available sims. Click any card to launch the game.

```bash
npm run build      # Production build
npm run lint       # ESLint checks
npm run lint:fix   # ESLint with auto-fixes
```

## Tech Stack

- **Vue 3** — Composition API with `<script setup lang="ts">`
- **Vite** — dev server & build
- **TypeScript** — strict mode
- **Pinia** — state management
- **Vue Router** — SPA routing (`/` home, `/sim/:simId` game page)
- **Three.js** — 3D rendering (via `useThreeScene` composable)
- **ESLint** — static analysis for JS/TS/Vue

## Project Structure

```
src/
├── assets/              # Global CSS, fonts, design tokens
├── components/          # Shared UI components (SimCard, HeroBackground, etc.)
├── composables/         # Shared composables
│   ├── useThreeScene.ts      # Three.js scene lifecycle & utilities
│   ├── useSimRegistry.ts     # Auto-discovers & registers all sims
│   └── useMenuMusic.ts       # Background music control
├── pages/               # Route-level views (HomePage, SimPage)
├── router/              # Vue Router config
├── stores/              # Shared Pinia stores
├── types/               # Shared TypeScript interfaces (SimDefinition)
└── sims/                # ★ Each sim/game in its own self-contained folder
    ├── box-empire/
    │   ├── definition.ts           # SimDefinition metadata (auto-discovered)
    │   ├── BoxEmpire.vue           # Root game component
    │   ├── components/             # Sim-specific Vue components
    │   │   ├── ui/                 # UI widgets (meters, bars, popups)
    │   │   └── modals/             # Modal dialogs (start, level-complete, fail)
    │   ├── composables/            # Sim-specific composables
    │   ├── modules/                # Pure TypeScript logic (scoring, physics, levels)
    │   ├── store/                  # Sim-specific Pinia store(s)
    │   ├── types/                  # Sim-specific TypeScript interfaces
    │   ├── assets/                 # Sim-specific media (3D models, sounds, textures)
    │   └── box-empire-AGENTS.md    # Sim architecture guide
    ├── stowage-master/
    ├── container-stack/
    └── [more sims...]

available-media/        # Pre-sourced assets (shared library)
├── 3d-models/          # GLB, FBX, OBJ container & equipment models
└── sound-samples/      # Sound effects & ambient tracks

knowledge-base/         # Domain reference (dk_*.md files)
```

## Key Architecture Principles

### Sim Auto-Discovery

Sims are auto-discovered at build time via `import.meta.glob('@/sims/*/definition.ts')`. Just add a folder under `src/sims/<sim-id>/` with a `definition.ts` — no manual imports needed.

### Sim Isolation (★ Core Rule)

**All** code, components, composables, stores, types, and media for a sim live inside `src/sims/<sim-id>/`. Only logic genuinely reused by multiple sims belongs in top-level `src/composables/` or `src/components/`. When a sim needs media, copy files from `available-media/` into the sim's own `assets/` folder.

### Code Style & Tooling

- **Vue**: Composition API only — always use `<script setup lang="ts">`. No Options API.
- **TypeScript**: Strict mode enabled (`noUnusedLocals`, `noUnusedParameters`, `strict`).
- **Styles**: Use `<style scoped>` in all components. Reference CSS variables from `src/assets/main.css` (e.g., `--color-primary`, `--font-retro`).
- **Linting**: Run `npm run lint` after substantive changes. Use `npm run lint:fix` for auto-fixes.

## Adding a New Sim

1. Create `src/sims/<your-sim-id>/`
2. Add `definition.ts`:
   ```ts
   import type { SimDefinition } from '@/types/sim'

   export const definition: SimDefinition = {
     id: 'my-sim',
     title: 'My Sim',
     tagline: 'A short hook',
     description: 'Longer description shown on the card.',
     icon: '🎮',
     status: 'playable',  // 'playable' | 'coming-soon' | 'wip'
     color: '#3b82f6',
     tags: ['3D', 'Puzzle'],
     component: () => import('./MySim.vue'),
   }
   ```
3. Add a root Vue component (`MySim.vue`)
4. **Done** — the sim is auto-discovered and appears on the home page

For detailed guidance on sim architecture, 3D rendering, entity design, and domain knowledge, see **[AGENTS.md](AGENTS.md)**.

## Available Resources

- **Sim-specific guides**: Each mature sim has its own `*-AGENTS.md` (e.g., `box-empire-AGENTS.md`)
- **Domain knowledge**: Reference files in `knowledge-base/` (containers, vessels, equipment, operations, economics)
- **Pre-sourced assets**: `available-media/3d-models/` and `available-media/sound-samples/` 
- **Skill guides**: `.ai/skills/` (entity design, operations, rendering, economics, adding new sims)

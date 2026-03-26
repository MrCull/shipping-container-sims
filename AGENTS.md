# Shipping Container Sims — Agent Guide

## Project overview

A Vue 3 + TypeScript web app that hosts shipping-container-themed simulations and games. Each sim lives in its own folder under `src/sims/` and is auto-discovered at build time.

## Tech stack

- **Vue 3** — Composition API, `<script setup lang="ts">`
- **Vite** — dev server & build
- **TypeScript** — strict mode
- **Pinia** — state management
- **Vue Router** — SPA routing (`/` home, `/sim/:simId` game page)
- **Three.js** — 3D rendering (shared via `useThreeScene` composable)

## Project structure

```
src/
├── assets/          Global CSS & fonts
├── components/      Shared UI components
├── composables/     Reusable composition functions
├── pages/           Route-level views (HomePage, SimPage)
├── router/          Vue Router config
├── sims/            ★ Each sim/game gets its own sub-folder
│   └── <sim-id>/
│       ├── definition.ts    Metadata (SimDefinition)
│       └── <SimName>.vue    Root game component
├── stores/          Pinia stores
└── types/           Shared TypeScript interfaces
```

## Key conventions

- **Auto-discovery**: Sims are registered via `import.meta.glob('@/sims/*/definition.ts')`. No manual imports needed — just add a folder.
- **Isolation**: All sim-specific code stays inside its `src/sims/<sim-id>/` folder. Shared utilities go in `composables/` or `components/`.
- **Composition API only**: Always use `<script setup lang="ts">`. No Options API.
- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters`, `strict` are all enabled.
- **Scoped styles**: Use `<style scoped>` in all components.
- **CSS variables**: Use the design tokens defined in `src/assets/main.css` (e.g. `--color-primary`, `--font-retro`).

## Skills

- **[Adding a sim](.cursor/skills/adding-a-sim/SKILL.md)** — How to add a new game or simulation to the project. Follow this when creating, scaffolding, or implementing a new sim.

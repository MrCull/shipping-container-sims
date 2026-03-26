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
- **ESLint** — static analysis for JS/TS/Vue (`eslint.config.js`; Vue + TypeScript recommended presets)

## Linting

After making substantive code changes, run **`npm run lint`** to catch issues.

To apply ESLint auto-fixes (including many Vue template and style rules), use **`npm run lint:fix`**.

**npm and `--fix`:** Arguments after `npm run <script>` are **not** passed to the underlying command unless you insert **`--`**. For example, **`npm run lint --fix`** only runs `eslint .` — it does **not** pass `--fix` to ESLint. Either run **`npm run lint:fix`**, or pass the flag explicitly: **`npm run lint -- --fix`**.

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
- **Keep this guide current**: When project-wide details change or new tooling, conventions, or structure are added that affect how agents or contributors work, update **AGENTS.md** in the same change (or a follow-up) so it stays accurate.

## Skills

- **[Adding a sim](.cursor/skills/adding-a-sim/SKILL.md)** — How to add a new game or simulation to the project. Follow this when creating, scaffolding, or implementing a new sim.

## Cursor Cloud specific instructions

- **Single service**: This is a purely client-side SPA — no backend, database, or external services required. The only process to run is the Vite dev server.
- **Dev server**: `npm run dev` (defaults to `http://localhost:5173`). Use `npm run dev -- --host 0.0.0.0` to expose on all interfaces.
- **Build**: `npm run build` runs `vue-tsc -b && vite build`. The TypeScript check is strict; fix all type errors before committing.
- **Lint**: `npm run lint` / `npm run lint:fix`. See the Linting section above for the `--` caveat with npm.
- **No secrets or environment variables** are needed.
- **No automated test suite** exists yet — verify changes via `npm run lint`, `npm run build`, and manual browser testing.

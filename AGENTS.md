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

### Services

This is a client-side-only SPA with no backend, database, or external API dependencies. The only service to run is the **Vite dev server**.

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run build` | Type-check (`vue-tsc`) then production build |
| `npm run lint` | ESLint static analysis |
| `npm run lint:fix` | ESLint with auto-fix |

### Running the dev server

Use `npm run dev -- --host 0.0.0.0` to make it accessible outside localhost (needed for browser testing in Cloud VMs). The app will be available at `http://localhost:5173`.

### Notes

- No `.env` files or secrets are required.
- The Three.js 3D sims require a WebGL-capable browser (Chrome is pre-installed in Cloud VMs).
- The `npm run build` warning about chunk size (Three.js > 500 kB) is expected and not an error.

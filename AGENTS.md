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
- **Vitest** — unit/integration tests (`npm test`); **tsx** — runs headless TypeScript CLIs

## Linting and verification

After making substantive code changes, run **`npm run lint`** to catch issues.

Before handing work back after code changes, run **`npm run verify`**: the dependency check (`node scripts/check-deps.mjs`), then lint, then build (catches TypeScript or Vite errors that linting may miss), then tests when a `test` script exists. Pull requests to `main` run the same checks in CI (`.github/workflows/pr-checks.yml`).

**Tests:** `npm test` runs **Vitest** (`*.test.ts` under `src/`, Node environment); `npm run test:watch` for watch mode. Test files (`*.test.ts`, `*.smoke.ts`) and Node-only CLI code (`src/sims/*/cli/`) are type-checked by `tsconfig.tools.json` (Node types; DOM lib only for `page.evaluate` callbacks) and excluded from `tsconfig.app.json`. Headless TypeScript scripts run with **`tsx`** (e.g. `npm run tt:run -- --help`).

**Terminal Twin scripts** (`npm run tt:*`: headless runs, goldens, benchmark, asset pipeline): the sim guide's "How to prove a change works" lists them.

To apply ESLint auto-fixes (including many Vue template and style rules), use **`npm run lint:fix`**.

**npm and `--fix`:** Arguments after `npm run <script>` are **not** passed to the underlying command unless you insert **`--`**. For example, **`npm run lint --fix`** only runs `eslint .` — it does **not** pass `--fix` to ESLint. Either run **`npm run lint:fix`**, or pass the flag explicitly: **`npm run lint -- --fix`**.

## Agent tooling

- **Cloud sessions**: a SessionStart hook (`.claude/hooks/session-start.sh`) runs `npm install` in Claude Code cloud sessions, so lint/build/test work immediately. It does nothing locally.
- **Visual checks**: `npm run screenshot -- --path /sim/<sim-id> --wait 8000` starts a Vite dev server on a free port, opens the route in headless Chromium (WebGL works via software rendering), saves a PNG to `.screenshots/` (git-ignored) and reports page errors. Use `--out <file>`, `--wait-for <selector>`, `--eval "<js>"` (e.g. drive a dev-only debug API before the shot), `--full-page`, `--fail-on-error`, or `--base <url>` to use an already-running server. If Playwright's bundled Chromium isn't installed it falls back to `CHROMIUM_PATH` or the cloud image's preinstalled `/opt/pw-browsers/chromium`.
- **Browser smoke tests**: `npm run test:smoke` runs Playwright specs `src/**/*.smoke.ts` (`playwright.config.ts`). The `dev` project uses a Vite dev server, so dev-only APIs work; the `prod` project (`*.prod.smoke.ts`) uses a fresh production build served by `vite preview`. They are not part of `npm test`/`verify`; CI does not run them on every push (they take about 15 minutes and bill Actions minutes): the `smoke` job in `.github/workflows/pr-checks.yml` runs from the Actions tab ("Run workflow") or while a PR carries the `smoke` label, and should be green before merging UI changes; specs titled `@load` (they need a real frame rate) never run in CI, so run them locally. Frame-based assertions are ratios over a minimum wall-clock window (`tests/browser/frameSampling.ts`), never absolute frame counts, so they hold on a loaded 2-core runner. Ports default to 5199 (dev) / 5198 (prod); set `SMOKE_DEV_PORT` / `SMOKE_PROD_PORT` to run two checkouts at once. Chromium falls back the same way as the screenshot tool.
- **README media**: `npm run capture-readme-media` (needs `npm run build && npm run preview` first) regenerates the README screenshots.

## Project structure

```
src/
├── assets/              Global CSS & fonts
├── components/          Shared UI components (SimCard, HeroBackground)
├── composables/         Shared composables (useThreeScene, useSimRegistry, useMenuMusic)
├── pages/               Route-level views (HomePage, SimPage)
├── router/              Vue Router config
├── stores/              Shared Pinia stores
├── types/               Shared TypeScript interfaces (SimDefinition)
└── sims/                ★ Each sim/game gets its own self-contained sub-folder
    └── <sim-id>/
        ├── definition.ts        Metadata (SimDefinition) — auto-discovered
        ├── <SimName>.vue        Root component for the game
        ├── components/          Sim-specific Vue components
        │   ├── ui/              UI widgets (meters, bars, popups)
        │   └── modals/          Modal dialogs (start, level-complete, fail)
        ├── composables/         Sim-specific composables (scene, audio, game loop)
        ├── modules/             Pure-TS logic (scoring, physics, levels, renderers)
        ├── store/               Sim-specific Pinia store(s)
        ├── types/               Sim-specific TypeScript interfaces
        └── assets/              Sim-specific media (3D models, sounds, textures)

available-media/
├── 3d-models/       Pre-sourced 3D assets (inventory: `available-media/README.md`)
└── sound-samples/   Sound effects for gameplay feedback

knowledge-base/      Domain knowledge reference files (dk_*.md)
```

**Sim isolation is the #1 structural rule.** All code, components, composables, stores, types, and media for a sim live inside its own `src/sims/<sim-id>/` folder. Only logic genuinely reused by multiple sims belongs in the top-level `src/composables/` or `src/components/`. When a sim needs media from `available-media/`, copy the files into the sim's own `assets/` folder.

## Sim-specific agent guides

Each sim that has grown beyond a trivial prototype maintains its own agent guide alongside its code:

- **[Box Empire](src/sims/box-empire/box-empire-AGENTS.md)** — Terminal operations tycoon sim. Architecture, modules, components, composables, layout, assets, shipping-line liveries, and known behaviours.
- **[Container Stack / Contenga](src/sims/container-stack/AGENTS.md)** — 3D Jenga-style container stacking game. Phase state machine, Three.js rendering split, pointer interaction, stability physics, scoring, level timers, audio, and known pitfalls.
- **[Stowage Master](src/sims/stowage-master/stowage-master-AGENTS.md)** — Container stowage puzzle sim. Phase state machine, physics (list/trim/VCG), scoring, disaster system, 10 levels, ship presets, rendering modules, optional Jev assist, and known pitfalls.
- **[Terminal Twin](src/sims/terminal-twin/terminal-twin-AGENTS.md)** — Event-driven automated-terminal digital twin / TOS test bench. Headless engine API, events and causality, invariants, fixtures and golden summaries, CLI runner, browser host (Web Worker, 3D view, time controls, `window.__tt` dev API), phase 2 asset pipeline (Blender `bpy` generators, `npm run tt:assets`, asset budget check in CI, dev asset viewer), and "How to prove a change works". Per-topic detail is in its `docs/` folder, reached by pointers in the guide. Domain terms: **[GLOSSARY.md](GLOSSARY.md)**.

## Key conventions

- **Auto-discovery**: Sims are registered via `import.meta.glob('@/sims/*/definition.ts')`. No manual imports needed — just add a folder.
- **Sim isolation**: All sim-specific code, components, composables, stores, types, and media stay inside `src/sims/<sim-id>/`. Use the sub-folder layout (`components/`, `composables/`, `modules/`, `store/`, `types/`, `assets/`) to keep things organised. Only logic genuinely reused by multiple sims belongs in top-level `src/composables/` or `src/components/`.
- **Composition API only**: Always use `<script setup lang="ts">`. No Options API.
- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters`, `strict` are all enabled.
- **Scoped styles**: Use `<style scoped>` in all components.
- **CSS variables**: Use the design tokens defined in `src/assets/main.css` (e.g. `--color-primary`).
- **Keep this guide current**: When project-wide details change or new tooling, conventions, or structure are added that affect how agents or contributors work, update **AGENTS.md** in the same change (or a follow-up) so it stays accurate.

## Plans

All agent plans should be created in the **`.ai/plans/`** folder at the repo root.

## Skills

Agent-facing skill files live in **`.ai/skills/`** at the repo root (Markdown `SKILL.md` per topic). Each file documents conventions, schemas, or patterns for this codebase.

New skills go under **`.agents/skills/`** instead — the repo's new top-level naming/location standard for agent-facing content. Existing `.ai/skills/` entries have not been migrated yet.

**`.claude/skills/`** holds Matt Pocock's engineering-workflow skills (vendored from upstream, see `.claude/skills/UPSTREAM.md`), invoked as slash commands in Claude Code: e.g. `/grill-me`, `/to-spec`, `/to-tickets`, `/implement`, `/tdd`, `/diagnosing-bugs`, `/code-review`, `/pr`. They read their per-repo configuration from `docs/agents/` (see § Agent skills).

Each folder holds one `SKILL.md` per topic with its own description: list them with `ls .ai/skills .agents/skills`.

### Project workflow

- **[Adding a sim](.ai/skills/adding-a-sim/SKILL.md)** — How to add a new game or simulation to the project. Follow this when creating, scaffolding, or implementing a new sim.

### Domain knowledge & entity design

These skills provide TypeScript interfaces, default value ranges, factory functions, and design guidance drawn from the `knowledge-base/` domain files. Use them when building simulation entities, operational logic, or 3D scenes.

- **[Container & Cargo Entities](.ai/skills/container-cargo-entities/SKILL.md)** — Physical specs (20ft/40ft/HC), ISO 6346 identity, logical attributes, lifecycle state machine, hazardous cargo (IMDG), hold/release logic, yard grouping heuristics, and factory functions.
- **[Vessel Entities](.ai/skills/vessel-entities/SKILL.md)** — Vessel classes (Feeder → ULCV), bay-row-tier coordinates, stowage slots, simplified stability model, voyage/manifest, vessel generation algorithms, and factory functions.
- **[Terminal Equipment Entities](.ai/skills/terminal-equipment-entities/SKILL.md)** — STS quay cranes (5 size classes), RMG/ASC/RTG yard cranes, reach stackers, terminal tractors, four-lens model (appearance/movement/capabilities/stop conditions), cycle times, animation state machines, and factory functions.
- **[Terminal Infrastructure](.ai/skills/terminal-infrastructure/SKILL.md)** — Berths, yard blocks, stacking rules & rehandle model, four layout archetypes (parallel RTG, perpendicular ASC, straddle, U-type), road network model, gatehouse infrastructure, terminal generation presets, and factory functions.
- **[Terminal Operations](.ai/skills/terminal-operations/SKILL.md)** — End-to-end container flows (import/export/transshipment), vessel loading/discharge sequences, crane cycle model, gatehouse processes, staff roles & shifts, KPIs with target ranges, EDI message types, simulation event system, and factory functions.
- **[Terminal Economics](.ai/skills/terminal-economics/SKILL.md)** — Tariff structure, base handling charges, surcharges, tiered storage/dwell fees, optional services, cargo-class modifiers, revenue/cost tracking, invoice generation, regional presets (Europe/Asia/Americas), and factory functions.

### Rendering & animation

- **[Three.js + Vue 3 Animation](.ai/skills/threejs-vue3-animation/SKILL.md)** — Four-layer architecture (domain → app state → scene adapter → render loop), scene conventions (units, axes, origins), `InstancedMesh` for containers, asset pipeline (glTF/Draco/KTX2), camera patterns, equipment animation state machines, container stack positioning, lighting, fidelity tiers, data-driven scene generation, and common pitfalls.

### Third-party integrations

- **[Jev integration](.agents/skills/jev-integration/SKILL.md)** — When and how to use Jev (TypeSafe System One) for bounded semantic decisions (Choice/Score/Noul questions), state design, provider API access, and turning judgments into application policy.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `MrCull/shipping-container-sims`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Implementing a spec

For `/implement-spec`, the orchestrator steps and the implementer brief are in `docs/agents/implementing.md`.

### Domain docs

Single-context: one root [`GLOSSARY.md`](GLOSSARY.md) (currently Terminal Twin terms) plus `docs/adr/`, created lazily. See `docs/agents/domain.md`.

## Available media

Pre-sourced 3D models and sound effects live in `available-media/`; copy only what a sim needs into its own `assets/`. Inventory, format notes and ideas for more: [available-media/README.md](available-media/README.md).

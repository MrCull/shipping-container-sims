# Shipping Container Sims

**Play free in your browser — no install, no signup:** **[container-games.net](https://container-games.net)**

This is a small **Vue 3** hub for three standalone **3D browser games**, all themed around shipping containers. Open the site, choose a card on the home page, and you are in the sim within seconds — everything runs locally in the tab with **WebGL (Three.js)** under the hood.

**What is here**

- **Stowage Master** — a planning puzzle: weight, cargo compatibility, and port rotation on a real bay layout.
- **Contenga** — a physics stacker: pull and pile containers without collapsing the tower.
- **Box Empire** — a terminal tycoon: routes, upgrades, fleets, and rivals on a stylised map.

Below you will see the **home portal** first, then each game with **live gameplay**
## Main menu

![Home portal — choose a game](docs/readme/home-portal.png)

---

## Stowage Master

*Tetris meets real-world container logistics — 3D puzzle*

![Stowage Master — gameplay ~15s after starting Level 1](docs/readme/stowage-master-gameplay.png)

**What you do:** Place containers on the ship’s bays with an eye on **weight**, **cargo classes** (what can sit next to what), and **port rotation** (unload in the right order). You’re optimising a real stowage puzzle, not just filling slots.

**Vibe:** Calm planning, spatial reasoning, and “one more level” optimisation.

---

## Contenga

*Jenga with containers — 3D physics*

![Contenga — gameplay after pressing Play](docs/readme/contenga-gameplay.png)

**What you do:** Pull blocks from the stack and **pile them on top** without letting the tower collapse. **Poor support** and bad balance bring the whole thing down — it’s tactile, risky, and very satisfying when it holds.

**Vibe:** Quick rounds, physics tension, and “just one more pull.”

---

## Box Empire

*Terminal tycoon — strategy and economy*

![Box Empire — gameplay after starting the tutorial](docs/readme/box-empire-gameplay.png)

**What you do:** Start from a **single container** and grow a **logistics empire**: buy **routes**, **upgrade ports**, manage **fleets**, and stay ahead of **rivals**. Numbers, maps, and narrative beats frame a management sim built around real terminal ideas.

**Vibe:** Longer sessions, progression, and empire-building.

---

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173/` — the home page lists every sim; open any card to play.

```bash
npm run build      # Production build
npm run lint       # ESLint checks
npm run lint:fix   # ESLint with auto-fixes
```

### Regenerate README screenshots

Requires a production preview and **ffmpeg** (for the Contenga GIF). Default wait is **10 seconds** for Contenga and Box Empire; **Stowage Master** waits **15 seconds** so the README frame shows richer 3D gameplay (override with `STOWAGE_MASTER_WAIT_MS`).

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
# in another terminal:
npm run capture-readme-media
# optional: BASE_URL=http://127.0.0.1:4173 GAMEPLAY_WAIT_MS=12000 STOWAGE_MASTER_WAIT_MS=18000 npm run capture-readme-media
```

## For developers

This repo is a **Vue 3 + TypeScript** app: **Vite**, **Pinia**, **Vue Router**, **Three.js** for 3D sims, **ESLint** for static analysis. Each game lives in its own folder under `src/sims/` and is **auto-discovered** at build time — no manual registration.

### Project structure (summary)

```
src/
├── assets/              # Global CSS, fonts, design tokens
├── components/          # Shared UI (SimCard, HeroBackground, …)
├── composables/         # useThreeScene, useSimRegistry, useMenuMusic
├── pages/               # HomePage, SimPage
├── router/
├── stores/
├── types/               # SimDefinition, etc.
└── sims/                # ★ One folder per game (isolated code & assets)
    ├── stowage-master/
    ├── container-stack/ # Contenga
    └── box-empire/

available-media/         # Shared 3D/sound library (copy into a sim when needed)
knowledge-base/          # Domain reference (containers, terminals, …)
```

### Core rules

- **Sim isolation:** All game-specific code, components, stores, and media stay under `src/sims/<sim-id>/`. Only truly shared logic belongs in top-level `composables/` or `components/`.
- **Auto-discovery:** Add `src/sims/<id>/definition.ts` — the home page picks it up via `import.meta.glob`.
- **Style:** Composition API only (`<script setup lang="ts">`), strict TypeScript, scoped styles, design tokens from `src/assets/main.css`.

### Add a new sim

1. Create `src/sims/<your-sim-id>/`
2. Add `definition.ts` with a `SimDefinition` (id, title, tagline, description, component loader, …)
3. Add the root `YourSim.vue`

Full conventions, 3D patterns, and domain skills: **[AGENTS.md](AGENTS.md)** and **`.ai/skills/`**.

## Experiment: agentic AI and a four-day timebox

This repository was a **personal experiment** to see what could be shipped by leaning on **agentic, AI-assisted development** — combining **Claude Code**, **Cursor AI**, **OpenAI Codex**, and **GitHub Copilot** for iterative, “vibe-coded” building rather than hand-typing every line. I set a **four-day timebox** for myself and wanted to learn how much of a cohesive, playable browser game collection could land in that window. The stack, structure, and rough edges are honest artefacts of that sprint, not a polished studio roadmap.

## More resources

- **Sim guides:** e.g. `src/sims/box-empire/box-empire-AGENTS.md`
- **Domain knowledge:** `knowledge-base/`
- **Pre-sourced assets:** `available-media/3d-models/`, `available-media/sound-samples/`

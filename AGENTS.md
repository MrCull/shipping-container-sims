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
├── 3d-models/       Pre-sourced 3D assets (see § Available media below)
└── sound-samples/   Sound effects for gameplay feedback

knowledge-base/      Domain knowledge reference files (dk_*.md)
```

**Sim isolation is the #1 structural rule.** All code, components, composables, stores, types, and media for a sim live inside its own `src/sims/<sim-id>/` folder. Only logic genuinely reused by multiple sims belongs in the top-level `src/composables/` or `src/components/`. When a sim needs media from `available-media/`, copy the files into the sim's own `assets/` folder.

## Key conventions

- **Auto-discovery**: Sims are registered via `import.meta.glob('@/sims/*/definition.ts')`. No manual imports needed — just add a folder.
- **Sim isolation**: All sim-specific code, components, composables, stores, types, and media stay inside `src/sims/<sim-id>/`. Use the sub-folder layout (`components/`, `composables/`, `modules/`, `store/`, `types/`, `assets/`) to keep things organised. Only logic genuinely reused by multiple sims belongs in top-level `src/composables/` or `src/components/`.
- **Composition API only**: Always use `<script setup lang="ts">`. No Options API.
- **Strict TypeScript**: `noUnusedLocals`, `noUnusedParameters`, `strict` are all enabled.
- **Scoped styles**: Use `<style scoped>` in all components.
- **CSS variables**: Use the design tokens defined in `src/assets/main.css` (e.g. `--color-primary`, `--font-retro`).
- **Keep this guide current**: When project-wide details change or new tooling, conventions, or structure are added that affect how agents or contributors work, update **AGENTS.md** in the same change (or a follow-up) so it stays accurate.

## Skills

Agent-facing skill files live in **`.ai/skills/`** at the repo root (Markdown `SKILL.md` per topic). Each file documents conventions, schemas, or patterns for this codebase.

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

## Available media

The `available-media/` folder contains pre-sourced assets that can be copied into a sim's folder or referenced at build time. Assets are **not** bundled automatically — import only what a sim needs.

### 3D models (`available-media/3d-models/`)

| Asset | Format | Description |
|-------|--------|-------------|
| `20-foot-container.obj`, `20-foot-container-2.obj` | OBJ | Basic 20ft container geometry |
| `20-foor-container-blue.FBX` | FBX | Blue 20ft container |
| `20-foot-container-green.fbx` | FBX | Green 20ft container |
| `20-foot-container-reefer-white-dirty.fbx` | FBX | White reefer container (weathered) |
| `20-foot-container-damaged.fbx` | FBX | Damaged 20ft container (large file ~75 MB) |
| `20-foot-containers-various-colors.fbx` | FBX | Multiple colour variants in one file (~70 MB) |
| `20-foot-shipping-container-old.FBX` | FBX | Aged/rusted 20ft container |
| `container-on-trailer-all-white.glb` | GLB | Container mounted on a trailer chassis |
| `container-trailer-chassis-empty.glb` | GLB | Empty trailer chassis (~45 MB) |
| `container-ship-large-empty-no-containers.glb` | GLB | Large vessel hull (no cargo) |
| `container-ship-small-empty-no-containers.glb` | GLB | Small vessel hull (no cargo, ~17 MB) |
| `container-ship-large/` | FBX + textures | Large container ship with full PBR texture set (hull, bridge, containers) |
| `container-ship-medium-with-own-cranes/` | GLB + textures | Medium vessel with onboard cranes and branded container textures |
| `quay-cranes-six-different-types.glb` | GLB | Six STS quay crane variants (~56 MB) |
| `crane-rubber-tired-gantry-rtd.glb` | GLB | RTG yard crane (~36 MB) |
| `reach-stacker-spreaker.glb` | GLB | Reach stacker with spreader (~47 MB) |
| `truck-no-trailer.glb`, `truck-no-trailer2.glb` | GLB | Terminal tractor / truck cab (no chassis) |
| `toll-which-might-be-able-to-be-used-as-gatehouse.glb` | GLB | Toll booth structure, usable as a gatehouse (~37 MB) |

**Format notes:** GLB files can be loaded directly with Three.js `GLTFLoader`. FBX files need `FBXLoader`. OBJ files use `OBJLoader`. For best runtime performance, convert FBX/OBJ assets to GLB with Draco compression before bundling into a sim (see the [Three.js + Vue 3 Animation skill](.ai/skills/threejs-vue3-animation/SKILL.md) for pipeline guidance).

### Sound effects (`available-media/sound-samples/`)

| Asset | Description |
|-------|-------------|
| `container-loaded-to-ship.mp3` | Metallic thud — container placed on vessel |
| `large-ship-three-horns-in-a-row.mp3` | Three deep ship horn blasts |
| `small-ship-three-horns-in-a-row.mp3` | Three higher-pitched ship horn blasts |
| `quiet-truck-engine.mp3` | Idling truck / terminal tractor engine loop |
| `correct-ding.mp3` | Short success chime |
| `gaming-bonus-sound.mp3` | Bonus / power-up jingle |
| `gaming-negative-event-sound.mp3` | Negative event / error tone |
| `group-yay-cheer.mp3` | Crowd cheer for big achievements |
| `horns-level-up.mp3` | Fanfare — level completion |
| `level-passed-ok.mp3` | Subtle level-passed confirmation |
| `level-up.mp3`, `level-up2.mp3`, `level-up-quick-sound.mp3` | Level-up stingers (varying lengths) |
| `money-increase-ca-ching-.mp3` | Cash register / revenue earned |
| `money-increase-game-sound.mp3` | Coin / money gain |

### What else could go here

As new sims are developed, `available-media/` is the right place for additional pre-sourced assets that may be shared across sims:

- **More 3D models** — 40ft / 45ft / high-cube containers, ASC (automated stacking crane), RMG (rail-mounted gantry), AGVs, straddle carriers, empty handlers, forklifts, fender systems, bollards, lashing bridges, hatch covers, buildings (office, workshop, control tower), yard lighting masts, road barriers, rail tracks, berth/quay wall sections, water/sea plane meshes.
- **Textures & materials** — Shipping line liveries (Maersk blue, Evergreen green, MSC navy, Hapag-Lloyd orange), rust/weathering overlays, concrete/asphalt ground, water surfaces, hazmat placards (IMDG diamond labels), container ISO markings decals, night-time emissive textures for lights/signals.
- **Skyboxes / HDR environments** — Port-side panoramas, overcast maritime, clear day, night with port lighting, sunset/golden hour.
- **Sound effects** — Crane motor hum, spreader lock/unlock clank, container touchdown impact, hatch cover slide, lashing chains, reversing beeper, gate barrier lift, rain/wind ambient, seagulls, port ambient, radio chatter, alarm/siren.
- **UI assets** — Container status icons, equipment silhouettes for dashboards, hazmat class diamond PNGs, map/minimap tiles, font files.
- **Animation data** — Pre-baked crane cycle animations, truck driving loops, wave motion for vessels at berth, smoke/exhaust particle sprite sheets.

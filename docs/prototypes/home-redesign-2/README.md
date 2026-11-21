# Home page redesign mockups, round 2

Four more static mockups of the main menu (`src/pages/HomePage.vue`), a follow-up to the three in `docs/prototypes/home-redesign/` (PR #278). Nothing here is wired into the app.

| File | Direction |
|---|---|
| `d-cinema.html` | Full-width hero that cross-fades between the four games (CSS only), a game switcher strip on its bottom edge, then a row of four screenshot cards |
| `e-bridge.html` | One big screen, four channels: a numbered list of games on the left, one large preview that follows the selection (radio buttons and `:has()`, no script); a row of tabs on a phone |
| `f-bento.html` | Poster wall: uneven tiles where the screenshots are the page and the words sit on the picture; planned games are quiet chips |
| `g-hybrid.html` | Mockup A's arcade layout with a little of mockup B's yard: stencil logo, hazard stripe, each game in its own container colour with an ISO 6346 plate; the featured game is the player's last one |

`shots/` holds each one rendered at 1440 px and 390 px. `img/` holds the new in-game screenshots:

- **Stowage Master** (`stowage-ship.jpg`, `stowage-deck.jpg`): level 8 with the loaded feeder, so the ship is full instead of an empty hull.
- **Box Empire** (`boxempire-wide.jpg`, `boxempire-quay.jpg`, `boxempire-low.jpg`): sandbox mode with two mobile harbour cranes working a laden feeder, three reach stackers and a truck, HUD hidden.
- **Contenga** and **Terminal Twin**: the crops from PR #278.

### Colour schemes for F

`f-bento.html` takes `?scheme=` (or use the switcher strip at the top of the page). Every colour is a CSS variable, so a scheme is one block of overrides:

| `?scheme=` | Look |
|---|---|
| `night` (default) | The original: near-black navy with amber |
| `day` | Light page (paper and navy) with signal orange; tiles keep a dark scrim so the words stay readable |
| `hazard` | Black and safety yellow, square corners, stencil headings |
| `sea` | Dark teal with a coral call to action, matching the sims' blue water |
| `rust` | Warm corten brown, cream text, teal buttons |
| `livery` | Graphite, and each game wears its container colour from mockup G (blue, orange, red, green) as a corrugated top edge and button |

Renders: `shots/f-scheme-<name>-{desktop,phone}.jpg`, and all six side by side in `shots/f-schemes-sheet.jpg`.

Progress lines ("level 3", "14 moves") and the build stamp are example values.

## How the screenshots were taken

Headless Chromium with software WebGL against the dev server, HUD hidden. Stowage Master: unlock the levels by setting `stowage-master-progress` in local storage, then call `startLevel(7)` and `confirmBriefing()` on the `stowage-master-game` Pinia store (reached through `#app.__vue_app__.config.globalProperties.$pinia._s`). Box Empire: Sandbox Mode, then `spawnReachStacker`, `spawnMobileHarborCrane`, `spawnVessel`, `openExportGate`, `openImportGate` on the `box-empire-game` store and run at 10x for about 90 s of wall time. In a sandbox without access to `gstatic.com`, serve the Draco decoder from `node_modules/three/examples/jsm/libs/draco/gltf/` through a Playwright route, or the 3D models never finish loading.

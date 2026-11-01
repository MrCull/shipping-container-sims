# Available media

The `available-media/` folder contains pre-sourced assets that can be copied into a sim's folder or referenced at build time. Assets are **not** bundled automatically, import only what a sim needs.

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
| `container-loaded-to-ship.mp3` | Metallic thud, container placed on vessel |
| `large-ship-three-horns-in-a-row.mp3` | Three deep ship horn blasts |
| `small-ship-three-horns-in-a-row.mp3` | Three higher-pitched ship horn blasts |
| `quiet-truck-engine.mp3` | Idling truck / terminal tractor engine loop |
| `correct-ding.mp3` | Short success chime |
| `gaming-bonus-sound.mp3` | Bonus / power-up jingle |
| `gaming-negative-event-sound.mp3` | Negative event / error tone |
| `group-yay-cheer.mp3` | Crowd cheer for big achievements |
| `horns-level-up.mp3` | Fanfare, level completion |
| `level-passed-ok.mp3` | Subtle level-passed confirmation |
| `level-up.mp3`, `level-up2.mp3`, `level-up-quick-sound.mp3` | Level-up stingers (varying lengths) |
| `money-increase-ca-ching-.mp3` | Cash register / revenue earned |
| `money-increase-game-sound.mp3` | Coin / money gain |

### What else could go here

As new sims are developed, `available-media/` is the right place for additional pre-sourced assets that may be shared across sims:

- **More 3D models**, 40ft / 45ft / high-cube containers, ASC (automated stacking crane), RMG (rail-mounted gantry), AGVs, straddle carriers, empty handlers, forklifts, fender systems, bollards, lashing bridges, hatch covers, buildings (office, workshop, control tower), yard lighting masts, road barriers, rail tracks, berth/quay wall sections, water/sea plane meshes.
- **Textures & materials**, Shipping line liveries (Maersk blue, Evergreen green, MSC navy, Hapag-Lloyd orange), rust/weathering overlays, concrete/asphalt ground, water surfaces, hazmat placards (IMDG diamond labels), container ISO markings decals, night-time emissive textures for lights/signals.
- **Skyboxes / HDR environments**, Port-side panoramas, overcast maritime, clear day, night with port lighting, sunset/golden hour.
- **Sound effects**, Crane motor hum, spreader lock/unlock clank, container touchdown impact, hatch cover slide, lashing chains, reversing beeper, gate barrier lift, rain/wind ambient, seagulls, port ambient, radio chatter, alarm/siren.
- **UI assets**, Container status icons, equipment silhouettes for dashboards, hazmat class diamond PNGs, map/minimap tiles, font files.
- **Animation data**, Pre-baked crane cycle animations, truck driving loops, wave motion for vessels at berth, smoke/exhaust particle sprite sheets.

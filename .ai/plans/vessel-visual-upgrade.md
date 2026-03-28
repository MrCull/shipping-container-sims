# Tutorial Vessel ("Tiny Feeder") Visual Upgrade

## Context
The procedural Three.js tutorial vessel in Box Empire is already better than the equipment was before their upgrades, but it's still missing key visual components that make a container ship look realistic: no bulwarks, no lashing bridges between hatch covers, windows only on one face of the superstructure, no bridge wings, no bollards, no navigation lights, no rudder, and the bow tapers to an unrealistic knife-edge. The knowledge base (`dk_vessels__physical_classes_and_structure.md`) lists mandatory visible components that are currently missing.

## File to modify
`src/sims/box-empire/modules/vesselRenderer.ts` — the 4 builder functions: `buildHull()`, `buildDeck()`, `buildSuperstructure()`, `buildDeckFittings()`

## What stays unchanged
- `createVesselMesh()` return type and rotation (group with rotation.y = PI)
- DECK_Y = 5.4 and all container positioning logic
- Shake animation (rotation.z/x on outer group)
- `getMaterials()` signature (extended, not changed)
- `makeTaperedPrism()` utility function

## Vessel reference dimensions (L=50, W=12, H=5)
- depth = 9, deckY (local) = 1.5, midLen = 31, bowLen = 10, sternLen = 5
- sternX = -19, mid-hull center X = -4.5
- Superstructure accY after 3 floors = 16.25
- Funnel center Y = 21.25, mast Y = 29.25, radar Y = 37.25

---

## Changes by builder function

### 1. `buildHull()` — bulwarks, wider bow, panel lines

**Widen bow tip**: Change `makeTaperedPrism` wTip from `0.6` to `1.8` — eliminates unrealistic knife-edge

**Add bulwarks** (raised hull lip above deck, 2 meshes):
- BoxGeometry(midLen + bowLen * 0.6, 1.2, 0.25) at (bowLen*0.15 - L*0.09, deckY + 0.6, ±W*0.435) in hullMat

**Add hull panel lines** (4 thin darker strips, 2 per side):
- BoxGeometry(midLen * 0.95, 0.08, 0.08) at (-L*0.09, deckY - depth*0.25/0.55, ±W*0.502)
- Material: MeshPhongMaterial({ color: 0x0f1a28 }) — slightly darker than hull

### 2. `buildDeck()` — lashing bridges, bollards, windlass

**Lashing bridges** between hatch covers (4 bridges × 3 parts = 12 meshes):
- Cross-beam: BoxGeometry(0.3, 1.6, W*0.68) at (midpoint between hatches, deckY + 1.07, 0)
- 2 vertical supports: BoxGeometry(0.25, 1.6, 0.25) at port/starboard (±W*0.32)
- Top rail: BoxGeometry(0.15, 0.12, W*0.68) at (same X, deckY + 1.95, 0)
- Material: new `lashBridgeMat` (0x5a5a5a)

**Mooring bollards** (6 bollards with caps = 12 meshes):
- Body: CylinderGeometry(0.20, 0.28, 0.8, 10), cap: SphereGeometry(0.24, 10, 8)
- Bow: 4 bollards at (L*0.32, deckY+0.57, ±W*0.30) and (L*0.37, deckY+0.57, ±W*0.25)
- Stern: 2 bollards at (-L*0.44, deckY+0.57, ±W*0.28)
- Material: new `bollardMat` (0x2b2b2b)

**Windlass** at bow (2 meshes):
- Drum: CylinderGeometry(0.5, 0.5, 1.2, 12) rotated Z=PI/2 at (L*0.36, deckY+0.65, 0)
- Base: BoxGeometry(1.0, 0.4, 1.4) at (L*0.36, deckY+0.20, 0)
- Material: new `windlassMat` (0x444444)

### 3. `buildSuperstructure()` — all-face windows, bridge wings, funnel detail, lifeboats, rudder, nav light

**Windows on all 4 faces** of each of 3 floors (+9 meshes, modify existing loop):
- Back (-X): BoxGeometry(f.l*0.09, f.h*0.30, f.w*0.75) at (sternX - f.l*0.52, ...)
- Port (-Z): BoxGeometry(f.l*0.75, f.h*0.30, f.w*0.09) at (..., -f.w*0.52)
- Starboard (+Z): same at +f.w*0.52

**Bridge wings** (6 meshes — platforms + railings, one per side):
- Platform: BoxGeometry(2.5, 0.2, 2.0) at (sternX, 14.25, ±3.28) in metalMat
- Side railing: BoxGeometry(2.5, 0.8, 0.08) at (sternX, 14.65, ±4.28)
- Front railing: BoxGeometry(0.08, 0.8, 2.0) at (sternX + 1.25, 14.65, ±3.28)

**Funnel cap + exhaust pipe** (2 meshes):
- Cap: CylinderGeometry(1.1, 0.85, 0.4, 12) at (sternX, 26.95, 0) in funnelMat
- Exhaust: CylinderGeometry(0.25, 0.3, 1.5, 8) at (sternX, 27.85, 0) in metalMat

**Lifeboats + davits** (4 meshes, 1 per side):
- Davit arm: BoxGeometry(0.15, 2.5, 0.15) at (sternX-0.75, 10.5, ±2.94) tilted outward
- Lifeboat: BoxGeometry(3.0, 1.0, 1.0) at (sternX-0.75, 9.0, ±3.8) in orange (0xff6600)

**Rudder** (1 mesh):
- BoxGeometry(0.2, 3.0, 1.5) at (-L*0.49, deckY-2.5, 0) in hullMat

**Masthead nav light** (1 mesh):
- SphereGeometry(0.15, 6, 6) at (sternX, accY + H*4.5, 0) in navWhiteMat

**Radar scanner bar** (1 mesh):
- BoxGeometry(3.5, 0.12, 0.35) at same Y as radar sphere in metalMat

### 4. `buildDeckFittings()` — jackstaff, hawse pipes, nav lights, extended railings, stern name

**Jackstaff at bow** (1 mesh):
- CylinderGeometry(0.04, 0.06, 2.5, 6) at (L*0.42, deckY+1.42, 0)

**Hawse pipes** (2 meshes, enhance existing fairleads):
- CylinderGeometry(0.3, 0.3, 1.2, 8) angled into hull at (L*0.41, deckY-0.5, ±W*0.38)

**Navigation lights** (3 meshes):
- Port (red): SphereGeometry(0.12) at (L*0.30, deckY+1.3, -W*0.44) — emissive red
- Starboard (green): SphereGeometry(0.12) at (L*0.30, deckY+1.3, +W*0.44) — emissive green
- Stern (white): SphereGeometry(0.12) at (-L*0.46, deckY+1.0, 0) — emissive white

**Extended railings** (~10 meshes):
- Forecastle: rail + 2 stanchions per side at X ≈ L*0.35
- Bow transverse: rail across bow at X = L*0.41
- Stern: short rails aft of superstructure at X ≈ -L*0.44

**Stern name plate** (1 mesh):
- BoxGeometry(0.08, 1.5, W*0.45) at (-L*0.465, deckY-1.5, 0) — slightly lighter than hull with subtle emissive

## Materials to add to `getMaterials()`
- `bollardMat` (0x2b2b2b), `lashBridgeMat` (0x5a5a5a), `windlassMat` (0x444444)
- Nav light materials can be inline (single-use emissive)

## Performance
- Adds ~79 meshes to current ~30 = ~109 total. Only 1 vessel in scene. Negligible impact.

## Verification
1. Run `npm run dev` and open Box Empire
2. Start tutorial — vessel should arrive with visible bulwarks, lashing bridges, bridge wings, bollards, navigation lights
3. Verify deck containers still position correctly on hatches
4. Verify MHC crane can still pick/place containers (no geometry collision)
5. Verify vessel shake animation still works when containers are placed
6. Verify vessel departure animation (sails away without errors)
7. Check no console errors from Three.js

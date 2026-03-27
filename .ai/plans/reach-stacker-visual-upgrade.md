# Reach Stacker Visual Upgrade

## Context
The procedural Three.js reach stacker in Box Empire looks toy-like and blocky — every component is a single BoxGeometry with no surface detail. The goal is to make it look like a convincing reach stacker (Kalmar/Liebherr style) while staying fully procedural (GLB was tried before at 48MB, too large).

## File to modify
`src/sims/box-empire/modules/equipmentRenderer.ts` — `createReachStacker()` method (lines 23-106)

Reference: `src/sims/box-empire/modules/truckRenderer.ts` for style conventions and `darken` utility

## Approach

Replace the current ~18-mesh single-box-per-component model with a ~55-60 mesh layered approach. All changes are inside `createReachStacker()`. The animation interface (`boomGroup` pivot, position, parts return type) stays identical.

### 1. Materials — hoist to module/class level, add new ones
- Move existing materials out of the function (share across instances)
- Add: `orangeDarkMat` (panel lines), `grillMat` (0x222222), `stepMat` (0x666666), `rubberMat` (0x1a1a1a), `redMat` with emissive for tail lights

### 2. Chassis — 3-layer body instead of 1 box
- Lower chassis: BoxGeometry(3.4, 1.2, 5.0) at y=1.0
- Upper body: BoxGeometry(3.2, 0.8, 4.6) at y=2.0 (slightly narrower = panel line)
- Side skirts: BoxGeometry(3.5, 0.4, 4.8) at y=0.6 in orangeDarkMat

### 3. Engine hood — multi-part with grilles
- Hood main (slightly smaller), dark top cap
- Side intake grilles (left + right) in grillMat
- Rear radiator grille with 3 chrome slats

### 4. Exhaust — dual stacks with caps
- Two chrome cylinders with dark caps instead of one

### 5. Cab — ROPS frame, sun visor, more windows
- Cab body + separate roof with overhang
- Sun visor protruding forward over windscreen
- ROPS posts (2 vertical + 1 horizontal top bar) in orange
- Rear window added
- Door handle detail

### 6. Boom — I-beam cross-section + hydraulic rams (highest impact)
- Replace solid box with 4-part I-beam: top/bottom chord + 2 side webs (orangeDarkMat for webs = depth)
- Same for telescoping inner section
- Add pivot housing block + chrome pin at boom root
- 2 hydraulic cylinder pairs (cylinder + rod) in chrome, aligned along Z under the boom

**Critical: all parts stay as children of `boomGroup` at (0.9, 3.3, 2.2) — animation unchanged**

### 7. Spreader — more substantial
- Thicker main beam (0.30 height instead of 0.22)
- Top plate in orangeDarkMat
- Yellow guide rail corners at each end
- Central mechanism block in darkMat

### 8. Wheels — add fenders
- Keep existing wheel + rim geometry
- Add rear fenders (outer mudguard + top plates) in orangeMat per side
- Add front fenders
- Front axle bar in darkMat

### 9. Surface details — ladder, lights, hazard markings
- Access ladder on left side: 2 rails + 4 rungs in stepMat
- Headlights (front, emissive yellow)
- Tail lights (rear, emissive red)
- Hazard stripe plates on counterweight rear (yellow/dark alternating)
- Warning beacon upgraded: cylinder base + sphere dome

### 10. Counterweight — 2-part
- Main weight + lip/base plate for more visual mass

## Performance notes
- ~55-60 meshes per stacker, 3-4 stackers max = ~240 meshes. Very manageable for Three.js.
- Share geometries (module-level) for wheels, fenders, boom chords — same pattern as existing `wheelGeo`/`rimGeo`.
- Share materials at module/class level instead of per-call.

## Verification
1. Run `npm run dev` and open Box Empire
2. Check reach stacker appearance — should have visible panel lines, I-beam boom, fenders, cab detail
3. Verify boom raise/lower animation still works (pick up and place a container)
4. Verify movement/rotation still works (assign a job)
5. Check no console errors from Three.js
6. Verify container pickup alignment unchanged (spreader at z=9.2 in boom space)

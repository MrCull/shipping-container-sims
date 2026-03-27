# Mobile Harbor Crane (MHC) Visual Upgrade

## Context
The MHC in Box Empire is the quay-side crane used for vessel loading/discharging. It currently looks very blocky — a solid rectangular tower, a single-box jib, and minimal detail. The reach stacker was recently upgraded with layered geometry and surface details; the MHC deserves the same treatment to match visual quality.

## File to modify
`src/sims/box-empire/modules/equipmentRenderer.ts` — `createMobileHarborCrane()` method (lines 299-369)

Reference material: `knowledge-base/dk_equipment__quay_cranes_sts.md` — component list, silhouette anchors, mandatory 3D components

## Animation interface to preserve
- `mhcSpreader`: `THREE.Group` — position animated via `eq.spreaderZ` (Z-axis trolley travel along jib)
- `mhcCable`: `THREE.Mesh` — `scale.y` animated for hoist drop length, `position.y` set to `-drop/2`
- Return type: `{ group, parts: { mhcSpreader, mhcCable } }` — unchanged
- Update logic at lines 406-414 — unchanged

## Approach

Replace the current ~20-mesh model with a ~65-75 mesh layered approach. All changes inside `createMobileHarborCrane()`.

### 1. Materials — expand palette, add new tones
- Keep: `blueMat`, `redMat`, `yellowMat`, `darkMat`, `greyMat`, `glassMat`
- Add: `blueDarkMat` (darker blue for panel lines/tower webs), `blueLight` (lighter blue for highlights), `grillMat` (0x222222), `stepMat` (0x666666), `chromeMat`, `beaconMat` (yellow emissive for warning lights), `cableMat` (dark grey, low shininess for wire ropes), `cwMat`/`cwDarkMat` (counterweight greys)

### 2. Base undercarriage — multi-layer
Current: single BoxGeometry(4.2, 1.2, 4.2)

- Lower frame: BoxGeometry(4.4, 0.6, 4.4) at y=0.3 in darkMat — wider, flatter base
- Upper frame: BoxGeometry(4.0, 0.6, 4.0) at y=0.9 in darkMat — stepped profile
- Side skirt plates: 2x BoxGeometry(0.08, 0.5, 4.2) at x=±2.15 in darkMat

### 3. Crawler tracks — keep existing, add track pad detail
Current crawlers are decent (box + rollers). Enhance:

- Add drive sprocket at front: CylinderGeometry(0.35, 0.35, 1.05, 10) at each track front end
- Add idler wheel at rear: CylinderGeometry(0.32, 0.32, 1.05, 10) at each track rear end
- Add track shoe texture suggestion: 3-4 thin horizontal BoxGeometry strips along each track top surface in slightly darker material

### 4. Rotating platform — more substantial
Current: single BoxGeometry(4.0, 0.55, 4.0)

- Main platform: BoxGeometry(4.2, 0.4, 4.2) at y=1.4 in blueMat
- Platform lip/edge: BoxGeometry(4.4, 0.15, 4.4) at y=1.2 in blueDarkMat — wider overhang
- Slew ring suggestion: CylinderGeometry(1.8, 1.8, 0.15, 16) at y=1.18 in greyMat — visible turntable

### 5. Tower — lattice/box-section instead of solid block (highest impact)
Current: single BoxGeometry(2.2, 13, 2.2) — the main eyesore

Replace with a 4-post lattice tower:

- 4 corner posts: BoxGeometry(0.3, 13, 0.3) at (±0.9, 8.3, ±0.9) in blueMat — the main structural members
- Horizontal tie beams every ~3m (4 levels): 4x BoxGeometry(1.5, 0.15, 0.15) per level, connecting posts on each face — creates visible lattice rings
  - At y = 3.0, 6.0, 9.0, 12.0
  - Front/back ties: BoxGeometry(0.15, 0.15, 1.5)
  - Left/right ties: BoxGeometry(1.5, 0.15, 0.15)
- Diagonal cross-bracing on two visible faces (front + one side):
  - Use thin rotated BoxGeometry(0.10, 3.5, 0.10) with rotation to suggest X-bracing between each tier
  - 2 diagonals per face per tier = approx 8-12 braces total
- Tower top cap: BoxGeometry(2.0, 0.3, 2.0) at y=14.85 in blueMat — solid top plate where jib connects
- Machinery house on tower rear: BoxGeometry(2.0, 2.0, 1.5) at (0, 13.5, 1.2) in blueDarkMat — houses the hoist winch

### 6. A-frame braces — more structural
Current: 2x simple angled boxes

- Replace with 4 diagonal struts (2 per side) forming a proper A:
  - Inner struts: BoxGeometry(0.18, 8, 0.18) at (±1.0, 7.5, ±0.4) with slight Z rotation
  - Outer struts: BoxGeometry(0.14, 6, 0.14) at (±1.8, 6, ±0.4) with more Z rotation
- Horizontal cross-tie between strut pairs: BoxGeometry(0.12, 0.12, 1.0) at (±1.4, 5, 0.4)

### 7. Operator cab — more detail
Current: single yellow box + windscreen

- Cab body: BoxGeometry(2.0, 1.8, 1.6) at (0, 13.9, 1.2) in yellowMat — slightly adjusted
- Cab roof: BoxGeometry(2.1, 0.12, 1.8) at (0, 14.86, 1.2) in yellowMat — overhang
- Front windscreen: BoxGeometry(1.7, 1.2, 0.07) at (0, 13.9, 2.03) in glassMat
- Bottom window (for seeing loads below): BoxGeometry(1.2, 0.07, 1.0) at (0, 13.0, 1.2) in glassMat — characteristic of crane cabs
- Side windows: 2x BoxGeometry(0.07, 1.0, 1.2) at (±1.03, 13.9, 1.2) in glassMat
- Sun visor: BoxGeometry(1.8, 0.06, 0.3) at (0, 14.8, 2.2) in darkMat
- Warning beacon on cab roof: CylinderGeometry(0.10, 0.14, 0.18, 8) + SphereGeometry(0.10, 8, 6) at (0.7, 15.1, 1.2) in beaconMat

### 8. Jib (waterside boom) — truss/I-beam instead of solid bar
Current: single BoxGeometry(0.5, 0.5, 16)

Replace with a box-truss profile:
- Top chord: BoxGeometry(0.45, 0.10, 16) at (0, 14.7, -6) in redMat
- Bottom chord: BoxGeometry(0.45, 0.10, 16) at (0, 14.3, -6) in redMat
- Left web: BoxGeometry(0.08, 0.50, 16) at (-0.18, 14.5, -6) in redMat (slightly darker or same)
- Right web: BoxGeometry(0.08, 0.50, 16) at (0.18, 14.5, -6) in redMat
- Trolley rail suggestion: 2x BoxGeometry(0.06, 0.06, 16) at (±0.15, 14.25, -6) in greyMat — visible rail under jib
- Jib tip (tapers): BoxGeometry(0.35, 0.35, 1.0) at (0, 14.5, -14.5) in redMat — slight taper at end
- Jib head sheave block: BoxGeometry(0.4, 0.3, 0.3) at (0, 14.2, -14.0) in greyMat — pulley housing at tip

### 9. Counterjib — more detail
Current: single box + counterweight

- Counterjib beam: BoxGeometry(0.35, 0.35, 6) at (0, 14.3, 4) in greyMat — slightly thinner
- Counterjib top tie: BoxGeometry(0.12, 0.12, 6) at (0, 14.6, 4) in greyMat — parallel upper member
- Vertical ties connecting top/bottom (every 2m): 3x BoxGeometry(0.08, 0.35, 0.08) at z=2, 4, 6 in greyMat
- Counterweight main: BoxGeometry(2.0, 1.0, 1.8) at (0, 14.4, 6.5) in cwMat
- Counterweight base plate: BoxGeometry(2.2, 0.15, 2.0) at (0, 13.85, 6.5) in cwDarkMat

### 10. Spreader group — more substantial (keep animation interface)
Current: bar + twist locks + cable

All children of `mhcSpreader` group (position animated at runtime):
- Main beam: BoxGeometry(6.8, 0.28, 0.50) in greyMat — slightly thicker
- Top plate: BoxGeometry(6.6, 0.06, 0.40) at y=0.17 in blueDarkMat
- Twist-lock posts: 2x BoxGeometry(0.25, 0.85, 0.35) at ±3.2 in greyMat
- Guide rail corners: 4x BoxGeometry(0.12, 0.65, 0.08) at (±3.35, -0.5, ±0.22) in yellowMat
- Center block: BoxGeometry(0.3, 0.15, 0.5) at (0, -0.5, 0) in darkMat
- Cable stays unchanged (mhcCable) — animation depends on it

### 11. Hoist ropes — additional visual cables
Current: single thin cable box

Add 2 extra thin rope lines alongside the main cable (children of `mhcSpreader`):
- BoxGeometry(0.04, 1, 0.04) at (±0.2, -0.5, 0) in cableMat — these scale with the main cable

**Note: these extra cables also need their scale.y and position.y updated in the `update()` method alongside `mhcCable`. Store references in parts or handle via children traversal.**

Alternative simpler approach: add the extra cables as children of `mhcSpreader` and update them in the same block as `mhcCable`. Add them to parts as `mhcCableL` and `mhcCableR`.

### 12. Surface details — ladders, walkways, lights, cable reels
- Access ladder on tower (front face): 2 rails BoxGeometry(0.04, 10, 0.04) + 15 rungs BoxGeometry(0.04, 0.04, 0.20) at x=0.5, spaced every 0.65m from y=2 to y=12 in stepMat
- Jib walkway suggestion: BoxGeometry(0.5, 0.04, 14) at (0, 14.15, -6) in stepMat — grating surface on jib underside
- Cable reel (at tower base, landside): CylinderGeometry(0.5, 0.5, 0.3, 10) at (1.5, 2.0, 1.5) rotated in greyMat
- Floodlight cluster at jib (pointing down): 2x small BoxGeometry(0.15, 0.12, 0.10) at (±0.3, 14.2, -4) in yellowMat with emissive

### Parts interface change
Update `EquipmentParts` or the update logic to handle the extra cable meshes. Two options:
- **Option A (simpler):** Add `mhcCableL` and `mhcCableR` to `EquipmentParts` and update them in the same block as `mhcCable`
- **Option B (simplest):** Skip extra cables, keep single cable — saves code complexity

**Recommended: Option A** — small code addition for noticeable visual improvement.

If Option A: add to `EquipmentParts`:
```typescript
mhcCableL?: THREE.Mesh
mhcCableR?: THREE.Mesh
```
And in update() alongside the existing mhcCable block:
```typescript
for (const c of [p.mhcCableL, p.mhcCableR]) {
  if (c) { c.scale.y = drop; c.position.y = -drop / 2 }
}
```

## Performance notes
- ~65-75 meshes per MHC. Only 1 MHC in the scene typically. Very manageable.
- The tower lattice is the biggest mesh-count increase (~20+ meshes for posts + ties + braces) but provides the single biggest visual improvement.
- Share materials at function scope (same pattern as current code).

## Verification
1. Run `npm run dev` and open Box Empire
2. Check MHC appearance — lattice tower, truss jib, detailed cab, crawler detail
3. Verify spreader moves along jib Z-axis during vessel operations (discharge/load cycles)
4. Verify cable drop animation works (hoist up/down)
5. Verify extra cables (if Option A) animate in sync with main cable
6. Check no console errors from Three.js
7. Verify container pickup/placement alignment unchanged

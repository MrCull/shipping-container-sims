// ---------------------------------------------------------------------------
// Box Empire — Equipment mesh management (improved quality)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Equipment, Container } from '../types'
import { CONTAINER_HEIGHT, CONTAINER_WIDTH } from './config'
import { createContainerGroup } from './containerRenderer'
import { disposeContainerMaterials } from './containerMaterials'

interface EquipmentParts {
  boomGroup?: THREE.Group
  mhcSpreader?: THREE.Group
  mhcCable?: THREE.Mesh
  mhcCableL?: THREE.Mesh
  mhcCableR?: THREE.Mesh
}

export class EquipmentRenderer {
  private meshes = new Map<string, THREE.Group>()
  private parts = new Map<string, EquipmentParts>()
  private carriedMeshes = new Map<string, THREE.Group>()  // equipmentId → container group
  private scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  private createReachStacker(): { group: THREE.Group; parts: EquipmentParts } {
    const group = new THREE.Group()

    // ---- Materials ----------------------------------------------------------
    const orangeMat    = new THREE.MeshPhongMaterial({ color: 0xe8720c, specular: 0x883300, shininess: 50 })
    const orangeDkMat  = new THREE.MeshPhongMaterial({ color: 0xb45000, specular: 0x551100, shininess: 35 })
    const darkMat      = new THREE.MeshPhongMaterial({ color: 0x1c2833, specular: 0x112233, shininess: 35 })
    const blackMat     = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 60 })
    const rubberMat    = new THREE.MeshPhongMaterial({ color: 0x0e0e0e, shininess: 3 })
    const chromeMat    = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0xffffff, shininess: 140 })
    const glassMat     = new THREE.MeshPhongMaterial({ color: 0x4a90d9, specular: 0xaaccee, shininess: 160, transparent: true, opacity: 0.75 })
    const yellowMat    = new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x554400, emissiveIntensity: 0.35 })
    const hazBlkMat    = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 8 })
    const grillMat     = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 12 })
    const cwMat        = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 15 })
    const rimMat       = new THREE.MeshPhongMaterial({ color: 0xc8c8c8, specular: 0xffffff, shininess: 100 })
    const headLightMat = new THREE.MeshPhongMaterial({ color: 0xffffcc, emissive: 0x555500, emissiveIntensity: 0.5 })
    const tailLightMat = new THREE.MeshPhongMaterial({ color: 0xff2200, emissive: 0x550000, emissiveIntensity: 0.4 })
    const stepMat      = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 25 })

    // -------------------------------------------------------------------------
    // 1. MAIN FRAME — two side box-rails + cross members
    // -------------------------------------------------------------------------
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 6.2), orangeDkMat)
      rail.position.set(sx * 1.5, 1.52, -0.6); rail.castShadow = true; group.add(rail)
    }
    for (const fz of [1.55, -0.45, -2.45]) {
      const xb = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.40, 0.34), orangeDkMat)
      xb.position.set(0, 1.52, fz); group.add(xb)
    }

    // -------------------------------------------------------------------------
    // 2. MAIN BODY — engine + hydraulic bay
    // -------------------------------------------------------------------------
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.70, 3.8), orangeMat)
    body.position.set(0, 2.15, -0.65); body.castShadow = true; group.add(body)

    // Engine hood (raised rear section)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 1.5), orangeMat)
    hood.position.set(0, 3.08, -1.55); hood.castShadow = true; group.add(hood)
    const hoodCap = new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.10, 1.3), orangeDkMat)
    hoodCap.position.set(0, 3.33, -1.55); group.add(hoodCap)

    // Side grille panels + slats
    for (const sx of [-1, 1]) {
      const gp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.80, 1.2), grillMat)
      gp.position.set(sx * 1.35, 2.55, -1.55); group.add(gp)
      for (let i = 0; i < 4; i++) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 1.0), chromeMat)
        sl.position.set(sx * 1.40, 2.22 + i * 0.18, -1.55); group.add(sl)
      }
    }
    // Rear radiator grille
    const rGrille = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.80, 0.08), grillMat)
    rGrille.position.set(0, 2.55, -2.60); group.add(rGrille)
    for (let i = 0; i < 4; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.10), chromeMat)
      sl.position.set(0, 2.22 + i * 0.18, -2.64); group.add(sl)
    }

    // Exhaust stack (rear-left, single)
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.9, 10), chromeMat)
    exh.position.set(-0.9, 3.8, -1.8); group.add(exh)
    const exhCap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 10), darkMat)
    exhCap.position.set(-0.9, 4.76, -1.8); group.add(exhCap)

    // -------------------------------------------------------------------------
    // 3. OPERATOR CAB — right-forward, large glass
    // -------------------------------------------------------------------------
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.60, 1.65), darkMat)
    cab.position.set(0.82, 2.65, 0.72); cab.castShadow = true; group.add(cab)
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.11, 1.82), darkMat)
    cabRoof.position.set(0.82, 3.47, 0.72); group.add(cabRoof)
    // Visor overhang
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.07, 0.28), orangeMat)
    visor.position.set(0.82, 3.42, 1.62); group.add(visor)
    // Windscreen
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.28, 0.07), glassMat)
    ws.position.set(0.82, 2.75, 1.57); group.add(ws)
    // Side windows
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.10, 1.38), glassMat)
    sideWin.position.set(1.57, 2.75, 0.72); group.add(sideWin)
    const leftWin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.90, 1.10), glassMat)
    leftWin.position.set(0.07, 2.75, 0.80); group.add(leftWin)
    // Beacon
    const bBase = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.18, 8), yellowMat)
    bBase.position.set(0.82, 3.54, 0.55); group.add(bBase)
    const bDome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), yellowMat)
    bDome.position.set(0.82, 3.69, 0.55); group.add(bDome)
    // Cab steps (right side)
    for (let i = 0; i < 3; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.26), stepMat)
      step.position.set(1.55, 0.9 + i * 0.52, 1.25); group.add(step)
    }

    // -------------------------------------------------------------------------
    // 4. COUNTERWEIGHT — heavy rear block with hazard stripes
    // -------------------------------------------------------------------------
    const cw = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.80, 1.55), cwMat)
    cw.position.set(0, 1.50, -3.15); cw.castShadow = true; group.add(cw)
    const cwLip = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.30, 1.75), new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 10 }))
    cwLip.position.set(0, 0.55, -3.15); group.add(cwLip)
    // Hazard stripes on rear face
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.50, 1.55, 0.07), i % 2 === 0 ? yellowMat : hazBlkMat)
      stripe.position.set(-1.25 + i * 0.50, 1.5, -3.96); group.add(stripe)
    }
    for (const tx of [-1.5, 1.5]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.08), tailLightMat)
      tl.position.set(tx, 1.7, -3.96); group.add(tl)
    }

    // -------------------------------------------------------------------------
    // 5. BOOM LIFT CYLINDERS — two large chrome rams from body to boom pivot
    //    Fixed in main group; give the A-frame support visual.
    // -------------------------------------------------------------------------
    for (const bx of [-0.30, 0.30]) {
      // Cylinder body (dark steel)
      const cylB = new THREE.Mesh(new THREE.CylinderGeometry(0.130, 0.130, 2.10, 12), darkMat)
      cylB.rotation.x = 0.52   // ~30° forward lean
      cylB.position.set(bx, 2.25, 0.30); group.add(cylB)
      // Chrome rod extending from cylinder
      const cylR = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.45, 10), chromeMat)
      cylR.rotation.x = 0.52
      cylR.position.set(bx, 3.10, 0.78); group.add(cylR)
      // Pivot mount at top
      const pivotMount = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.22, 0.22), darkMat)
      pivotMount.position.set(bx, 3.60, 0.92); group.add(pivotMount)
    }

    // -------------------------------------------------------------------------
    // 6. TIRES — 4 large single tires (the most distinctive RS feature)
    // -------------------------------------------------------------------------
    const tyreR = 0.92      // ~1850mm OD — close to real Kalmar RS tyre
    const tyreW = 0.62
    const tyreGeo = new THREE.CylinderGeometry(tyreR, tyreR, tyreW, 22)
    const rimGeo  = new THREE.CylinderGeometry(0.45, 0.45, tyreW + 0.04, 16)
    const hubGeo  = new THREE.CylinderGeometry(0.17, 0.17, tyreW + 0.10, 8)

    for (const [sz, tx] of [[1.55, 1.95], [1.55, -1.95], [-2.20, 1.95], [-2.20, -1.95]] as [number, number][]) {
      const sign = tx > 0 ? 1 : -1
      // Tyre
      const tyre = new THREE.Mesh(tyreGeo, rubberMat)
      tyre.rotation.z = Math.PI / 2
      tyre.position.set(tx, tyreR, sz); tyre.castShadow = true; group.add(tyre)
      // Rim
      const rim = new THREE.Mesh(rimGeo, rimMat)
      rim.rotation.z = Math.PI / 2
      rim.position.set(tx, tyreR, sz); group.add(rim)
      // Hub
      const hub = new THREE.Mesh(hubGeo, blackMat)
      hub.rotation.z = Math.PI / 2
      hub.position.set(tx, tyreR, sz); group.add(hub)
      // 8 lug nuts on outer face
      for (let b = 0; b < 8; b++) {
        const ang = (b / 8) * Math.PI * 2
        const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 6), rimMat)
        lug.rotation.z = Math.PI / 2
        lug.position.set(tx + sign * (tyreW / 2 + 0.05), tyreR + Math.sin(ang) * 0.30, sz + Math.cos(ang) * 0.30)
        group.add(lug)
      }
      // Wheel arch (simple top fender)
      const archSide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 1.05), orangeMat)
      archSide.position.set(tx + sign * 0.46, tyreR + tyreR * 0.55, sz); group.add(archSide)
      const archTop = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 1.05), orangeMat)
      archTop.position.set(tx + sign * 0.06, tyreR * 1.78, sz); group.add(archTop)
    }

    // Axle bars
    const frontAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.65, 8), darkMat)
    frontAxle.rotation.z = Math.PI / 2; frontAxle.position.set(0, tyreR, 1.55); group.add(frontAxle)
    const rearAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.65, 8), darkMat)
    rearAxle.rotation.z = Math.PI / 2; rearAxle.position.set(0, tyreR, -2.20); group.add(rearAxle)

    // -------------------------------------------------------------------------
    // 7. HEADLIGHTS
    // -------------------------------------------------------------------------
    for (const hx of [-1.1, 1.1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.07), headLightMat)
      hl.position.set(hx, 1.85, 1.86); group.add(hl)
    }

    // -------------------------------------------------------------------------
    // 8. BOOM GROUP — wide box-section arm (pivot at top-center-front)
    //    Container positioning formula uses: pivot (0, 3.50, 0.90)
    // -------------------------------------------------------------------------
    const boomGroup = new THREE.Group()
    boomGroup.position.set(0, 3.50, 0.90)

    // Pivot pin + housing
    const pivHousing = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.55), orangeDkMat)
    pivHousing.position.set(0, 0, 0); boomGroup.add(pivHousing)
    const pivPin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 10), chromeMat)
    pivPin.rotation.z = Math.PI / 2; pivPin.position.set(0, 0, 0); boomGroup.add(pivPin)

    // Main boom — wide flat box section (real RS boom is wide in X, not tall)
    const boomOuter = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.55, 5.8), orangeMat)
    boomOuter.position.set(0, 0, 2.9); boomOuter.castShadow = true; boomGroup.add(boomOuter)
    const boomInner = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.35, 5.6), orangeDkMat)
    boomInner.position.set(0, 0, 2.9); boomGroup.add(boomInner)

    // Telescoping inner section
    const extOuter = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.46, 3.8), orangeMat)
    extOuter.position.set(0, 0, 7.1); extOuter.castShadow = true; boomGroup.add(extOuter)
    const extInner = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.30, 3.6), orangeDkMat)
    extInner.position.set(0, 0, 7.1); boomGroup.add(extInner)

    // Wear pad strips (telescoping slide interface)
    for (const bz of [5.65, 8.70]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.10, 0.28), darkMat)
      pad.position.set(0, -0.33, bz); boomGroup.add(pad)
    }

    // Hazard stripe band near pivot (safety marking)
    for (let i = 0; i < 4; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.58, 0.48), i % 2 === 0 ? yellowMat : hazBlkMat)
      stripe.position.set(0, 0, 0.55 + i * 0.48); boomGroup.add(stripe)
    }

    // rib stiffeners along the top of the boom
    for (const bz of [1.5, 2.5, 3.5, 4.5]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.07, 0.14), orangeDkMat)
      rib.position.set(0, 0.31, bz); boomGroup.add(rib)
    }

    // -------------------------------------------------------------------------
    // 9. SPREADER / HEADBLOCK — large frame with hazard markings
    //    Stays at boomGroup z=9.2 to keep container-positioning formula valid.
    // -------------------------------------------------------------------------
    // Main crossbar
    const spFrame = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.58, 0.62), darkMat)
    spFrame.position.set(0, -0.55, 9.2); boomGroup.add(spFrame)
    // Hazard stripes across crossbar
    for (let i = 0; i < 9; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.60, 0.64), i % 2 === 0 ? yellowMat : hazBlkMat)
      st.position.set(-3.42 + i * 0.76 + 0.38, -0.55, 9.2); boomGroup.add(st)
    }
    // Top cover plate
    const spTop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.10, 0.58), orangeDkMat)
    spTop.position.set(0, -0.27, 9.2); boomGroup.add(spTop)

    // Side end-arms + twist-locks
    for (const sx of [-3.7, 3.7]) {
      const sign = sx > 0 ? 1 : -1
      // End-arm box
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.62), darkMat)
      arm.position.set(sx, -0.55, 9.2); boomGroup.add(arm)
      // Twist-lock post
      const tw = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.82, 0.24), darkMat)
      tw.position.set(sx, -1.0, 9.2); boomGroup.add(tw)
      // Twist-lock tip (yellow)
      const twTip = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.12, 0.30), yellowMat)
      twTip.position.set(sx, -1.44, 9.2); boomGroup.add(twTip)
      // Guide cones (front and rear)
      for (const gz of [8.94, 9.46]) {
        const gc = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.28, 6), orangeDkMat)
        gc.position.set(sx, -0.92, gz); boomGroup.add(gc)
      }
    }

    boomGroup.scale.z = 0.5   // halve arm length (spreader stays at z=4.6 from pivot)
    boomGroup.rotation.x = -0.15
    group.add(boomGroup)

    return { group, parts: { boomGroup } }
  }

  private createMobileHarborCrane(): { group: THREE.Group; parts: EquipmentParts } {
    const group = new THREE.Group()

    // --- Materials ---
    const blueMat    = new THREE.MeshPhongMaterial({ color: 0x1a5276, specular: 0x224488, shininess: 55 })
    const blueDarkMat= new THREE.MeshPhongMaterial({ color: 0x0e2d42, specular: 0x112233, shininess: 35 })
    const redMat     = new THREE.MeshPhongMaterial({ color: 0xc0392b, specular: 0x441111, shininess: 45 })
    const yellowMat  = new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x554400, emissiveIntensity: 0.3 })
    const beaconMat  = new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x664400, emissiveIntensity: 0.6 })
    const darkMat    = new THREE.MeshPhongMaterial({ color: 0x1c2833, shininess: 22 })
    const greyMat    = new THREE.MeshPhongMaterial({ color: 0x888888, specular: 0xaaaaaa, shininess: 50 })
    const greyDarkMat= new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 20 })
    const glassMat   = new THREE.MeshPhongMaterial({ color: 0x4a90d9, emissive: 0x224466, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 })
    const stepMat    = new THREE.MeshPhongMaterial({ color: 0x666666, specular: 0x888888, shininess: 40 })
    const cableMat   = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 8 })
    const cwMat      = new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 20 })
    const cwDarkMat  = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 10 })

    // -------------------------------------------------------------------------
    // 1. BASE UNDERCARRIAGE — multi-layer stepped profile
    // -------------------------------------------------------------------------
    const lowerFrame = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.6, 4.4), darkMat)
    lowerFrame.position.y = 0.3; lowerFrame.castShadow = true; group.add(lowerFrame)

    const upperFrame = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.6, 4.0), darkMat)
    upperFrame.position.y = 0.9; upperFrame.castShadow = true; group.add(upperFrame)

    for (const sx of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 4.2), darkMat)
      skirt.position.set(sx * 2.15, 0.6, 0); group.add(skirt)
    }

    // -------------------------------------------------------------------------
    // 2. CRAWLER TRACKS — existing pattern + drive sprocket + idler + pads
    // -------------------------------------------------------------------------
    for (const sign of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.8, 1.0), darkMat)
      track.position.set(0, 0.4, sign * 2.2); group.add(track)

      // Rollers
      for (let i = -1.5; i <= 1.5; i += 0.5) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.05, 10), greyMat)
        roller.rotation.z = Math.PI / 2; roller.position.set(i, 0.32, sign * 2.2); group.add(roller)
      }

      // Drive sprocket (front) + idler (rear)
      const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.05, 10), greyDarkMat)
      sprocket.rotation.z = Math.PI / 2; sprocket.position.set(2.1, 0.45, sign * 2.2); group.add(sprocket)
      const idler = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.05, 10), greyDarkMat)
      idler.rotation.z = Math.PI / 2; idler.position.set(-2.1, 0.45, sign * 2.2); group.add(idler)

      // Track pad strips
      for (let p = -1.6; p <= 1.6; p += 0.8) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 1.05), greyDarkMat)
        pad.position.set(p, 0.82, sign * 2.2); group.add(pad)
      }
    }

    // -------------------------------------------------------------------------
    // 3. ROTATING PLATFORM — with slew ring
    // -------------------------------------------------------------------------
    const platformLip = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.15, 4.4), blueDarkMat)
    platformLip.position.y = 1.2; group.add(platformLip)

    const platform = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 4.2), blueMat)
    platform.position.y = 1.4; platform.castShadow = true; group.add(platform)

    const slewRing = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.15, 16), greyMat)
    slewRing.position.y = 1.18; group.add(slewRing)

    // -------------------------------------------------------------------------
    // 4. TOWER — 4-post lattice with horizontal ties + diagonal bracing
    // -------------------------------------------------------------------------
    // Corner posts
    for (const [px, pz] of [[-0.9, -0.9], [-0.9, 0.9], [0.9, -0.9], [0.9, 0.9]] as [number, number][]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 13, 0.3), blueMat)
      post.position.set(px, 8.3, pz); post.castShadow = true; group.add(post)
    }

    // Horizontal tie beams at 4 levels
    for (const ty of [3.0, 6.0, 9.0, 12.0]) {
      // Front/back (along Z)
      for (const tz of [-0.9, 0.9]) {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.15, 0.15), blueDarkMat)
        tie.position.set(0, ty, tz); group.add(tie)
      }
      // Left/right (along X)
      for (const tx of [-0.9, 0.9]) {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1.5), blueDarkMat)
        tie.position.set(tx, ty, 0); group.add(tie)
      }
    }

    // Diagonal cross-bracing on front face (z = -0.9) and left face (x = -0.9)
    const braceAngle = Math.atan2(1.8, 3.0)
    const braceLen = Math.sqrt(1.8 * 1.8 + 3.0 * 3.0)
    for (let tier = 0; tier < 4; tier++) {
      const baseY = 1.8 + tier * 3.0

      // Front face diagonals
      for (const dir of [-1, 1]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.10, braceLen, 0.10), blueDarkMat)
        brace.position.set(dir * 0.45, baseY + 1.5, -0.9)
        brace.rotation.z = dir * braceAngle
        group.add(brace)
      }

      // Left face diagonals
      for (const dir of [-1, 1]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.10, braceLen, 0.10), blueDarkMat)
        brace.position.set(-0.9, baseY + 1.5, dir * 0.45)
        brace.rotation.x = -dir * braceAngle
        group.add(brace)
      }
    }

    // Tower top cap
    const towerCap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 2.0), blueMat)
    towerCap.position.set(0, 14.85, 0); group.add(towerCap)

    // Machinery house (hoist winch) on tower rear
    const machHouse = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 1.5), blueDarkMat)
    machHouse.position.set(0, 13.5, 1.2); machHouse.castShadow = true; group.add(machHouse)

    // -------------------------------------------------------------------------
    // 5. A-FRAME BRACES — 4 struts forming proper A-frame
    // -------------------------------------------------------------------------
    for (const sign of [-1, 1]) {
      // Inner struts
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8, 0.18), greyMat)
      inner.position.set(sign * 1.0, 7.5, 0.4); inner.rotation.z = sign * 0.16; group.add(inner)
      // Outer struts
      const outer = new THREE.Mesh(new THREE.BoxGeometry(0.14, 6, 0.14), greyMat)
      outer.position.set(sign * 1.8, 6.0, 0.4); outer.rotation.z = sign * 0.28; group.add(outer)
      // Cross-tie
      const xtie = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.0), greyMat)
      xtie.position.set(sign * 1.4, 5.0, 0.4); group.add(xtie)
    }

    // -------------------------------------------------------------------------
    // 6. OPERATOR CAB — with roof, visor, multi-pane windows, beacon
    // -------------------------------------------------------------------------
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 1.6), yellowMat)
    cab.position.set(0, 13.9, 1.2); cab.castShadow = true; group.add(cab)

    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 1.8), yellowMat)
    cabRoof.position.set(0, 14.86, 1.2); group.add(cabRoof)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.3), darkMat)
    visor.position.set(0, 14.8, 2.2); group.add(visor)

    const frontWin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 0.07), glassMat)
    frontWin.position.set(0, 13.9, 2.03); group.add(frontWin)

    // Bottom observation window (characteristic of crane cabs)
    const bottomWin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 1.0), glassMat)
    bottomWin.position.set(0, 13.0, 1.2); group.add(bottomWin)

    // Side windows
    for (const sx of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 1.2), glassMat)
      sw.position.set(sx * 1.03, 13.9, 1.2); group.add(sw)
    }

    // Warning beacon on cab roof
    const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 0.18, 8), beaconMat)
    beaconBase.position.set(0.7, 15.02, 1.2); group.add(beaconBase)
    const beaconDome = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), beaconMat)
    beaconDome.position.set(0.7, 15.18, 1.2); group.add(beaconDome)

    // -------------------------------------------------------------------------
    // 7. JIB (WATERSIDE BOOM) — box-truss profile with trolley rails
    // -------------------------------------------------------------------------
    // Top and bottom chords
    const jibTop = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.10, 16), redMat)
    jibTop.position.set(0, 14.7, -6); jibTop.castShadow = true; group.add(jibTop)
    const jibBot = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.10, 16), redMat)
    jibBot.position.set(0, 14.3, -6); group.add(jibBot)

    // Side webs
    for (const jx of [-0.18, 0.18]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.50, 16), redMat)
      web.position.set(jx, 14.5, -6); group.add(web)
    }

    // Trolley rails under jib
    for (const jx of [-0.15, 0.15]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 16), greyMat)
      rail.position.set(jx, 14.25, -6); group.add(rail)
    }

    // Jib tip block
    const jibTip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 1.0), redMat)
    jibTip.position.set(0, 14.5, -14.5); group.add(jibTip)

    // Head sheave block (pulley housing at jib tip)
    const sheave = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), greyMat)
    sheave.position.set(0, 14.2, -14.0); group.add(sheave)

    // Jib walkway grating (underside surface)
    const walkway = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 14), stepMat)
    walkway.position.set(0, 14.15, -6); group.add(walkway)

    // Floodlights on jib underside
    const floodMat = new THREE.MeshPhongMaterial({ color: 0xffffcc, emissive: 0x444400, emissiveIntensity: 0.5 })
    for (const jx of [-0.3, 0.3]) {
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.10), floodMat)
      fl.position.set(jx, 14.2, -4); group.add(fl)
    }

    // -------------------------------------------------------------------------
    // 8. COUNTERJIB — dual-member truss with counterweight
    // -------------------------------------------------------------------------
    const cjibBot = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 6), greyMat)
    cjibBot.position.set(0, 14.3, 4); group.add(cjibBot)

    const cjibTop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 6), greyMat)
    cjibTop.position.set(0, 14.6, 4); group.add(cjibTop)

    // Vertical ties every 2m
    for (const ctz of [2, 4, 6]) {
      const vt = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), greyMat)
      vt.position.set(0, 14.45, ctz); group.add(vt)
    }

    // Counterweight
    const cwMain = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.8), cwMat)
    cwMain.position.set(0, 14.4, 6.5); cwMain.castShadow = true; group.add(cwMain)
    const cwBase = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 2.0), cwDarkMat)
    cwBase.position.set(0, 13.85, 6.5); group.add(cwBase)

    // -------------------------------------------------------------------------
    // 9. SURFACE DETAILS — tower ladder, cable reel
    // -------------------------------------------------------------------------
    // Access ladder on tower front face
    for (const lx of [0.48, 0.52]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 10, 0.04), stepMat)
      rail.position.set(lx, 7.0, -0.93); group.add(rail)
    }
    for (let ri = 0; ri < 15; ri++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.20), stepMat)
      rung.position.set(0.5, 2.0 + ri * 0.65, -0.94); group.add(rung)
    }

    // Cable reel at tower base (landside)
    const cableReel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10), greyMat)
    cableReel.rotation.z = Math.PI / 2; cableReel.position.set(1.5, 2.0, 1.5); group.add(cableReel)

    // -------------------------------------------------------------------------
    // 10. SPREADER GROUP (animated — position driven by eq.spreaderZ)
    // -------------------------------------------------------------------------
    const mhcSpreader = new THREE.Group()
    mhcSpreader.position.set(0, 14.5, -6)

    // Main beam
    const spreaderBar = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.28, 0.50), greyMat)
    mhcSpreader.add(spreaderBar)

    // Top plate
    const spreaderTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.06, 0.40), blueDarkMat)
    spreaderTop.position.set(0, 0.17, 0); mhcSpreader.add(spreaderTop)

    // Twist-lock posts
    for (const sx of [-3.2, 3.2]) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.85, 0.35), greyMat)
      tw.position.set(sx, -0.5, 0); mhcSpreader.add(tw)
    }

    // Guide rail corners
    for (const sx of [-3.35, 3.35]) {
      for (const gz of [-0.22, 0.22]) {
        const gr = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.08), yellowMat)
        gr.position.set(sx, -0.5, gz); mhcSpreader.add(gr)
      }
    }

    // Center mechanism block
    const centerBlock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.5), darkMat)
    centerBlock.position.set(0, -0.5, 0); mhcSpreader.add(centerBlock)

    // Hoist cables — main + left + right (all animated via scale.y)
    const mhcCable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), cableMat)
    mhcCable.position.set(0, -0.5, 0); mhcSpreader.add(mhcCable)

    const mhcCableL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), cableMat)
    mhcCableL.position.set(-0.2, -0.5, 0); mhcSpreader.add(mhcCableL)

    const mhcCableR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), cableMat)
    mhcCableR.position.set(0.2, -0.5, 0); mhcSpreader.add(mhcCableR)

    group.add(mhcSpreader)
    return { group, parts: { mhcSpreader, mhcCable, mhcCableL, mhcCableR } }
  }

  update(equipmentList: Equipment[], containers?: Container[]): void {
    for (const eq of equipmentList) {
      let mesh = this.meshes.get(eq.id)
      if (!mesh) {
        const r = eq.type === 'reach_stacker' ? this.createReachStacker() : this.createMobileHarborCrane()
        mesh = r.group
        mesh.name = eq.id
        this.scene.add(mesh)
        this.meshes.set(eq.id, mesh)
        this.parts.set(eq.id, r.parts)
      }

      mesh.position.set(eq.position.x, 0, eq.position.z)

      if (eq.type === 'reach_stacker') {
        // Use headingY from controller (updated to face target)
        if (eq.headingY !== undefined) {
          mesh.rotation.y = eq.headingY
        } else if (eq.targetPosition) {
          const dx = eq.targetPosition.x - eq.position.x
          const dz = eq.targetPosition.z - eq.position.z
          if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
            mesh.rotation.y = Math.atan2(dx, dz)
          }
        }
      }

      const p = this.parts.get(eq.id)

      if (p?.boomGroup && eq.type === 'reach_stacker') {
        const t = Math.min(1, eq.armTargetY / 9)
        p.boomGroup.rotation.x = -0.15 - t * 0.60

        // ---- Carried container: attach as child of RS group, hang under spreader ----
        const existingCarried = this.carriedMeshes.get(eq.id)
        if (eq.carriedContainerId && containers) {
          const container = containers.find(c => c.id === eq.carriedContainerId)
          if (container) {
            let cGroup = existingCarried
            if (!cGroup || cGroup.userData['containerId'] !== eq.carriedContainerId) {
              if (existingCarried) {
                mesh.remove(existingCarried)
                this.disposeContainerGroup(existingCarried)
              }
              cGroup = createContainerGroup(container)
              mesh.add(cGroup)
              this.carriedMeshes.set(eq.id, cGroup)
            }
            // Position container in RS-group local space so it hangs below the spreader.
            // boomGroup pivot: (0, 3.50, 0.90).  Spreader at boomGroup-local z=9.2;
            // scale.z=0.5 → visual z_scaled=4.6 from pivot.
            // Container centre is twistLockHeight (0.9m) + CONTAINER_HEIGHT/2 below spreader frame.
            // Shift ¾ container width back toward RS body for a natural carry position.
            const θ = p.boomGroup.rotation.x
            const cY_boom = -(0.55 + 0.9 + CONTAINER_HEIGHT / 2)  // ≈ -2.745
            const cZ_scaled = 9.2 * 0.5                            // = 4.6
            const zShift = CONTAINER_WIDTH * 0.75                  // ≈ 1.83m toward RS
            cGroup.position.set(
              0,      // boomGroup.position.x
              3.50 + cY_boom * Math.cos(θ) - cZ_scaled * Math.sin(θ),
              0.90 + cY_boom * Math.sin(θ) + cZ_scaled * Math.cos(θ) - zShift,
            )
          }
        } else if (existingCarried) {
          mesh.remove(existingCarried)
          this.disposeContainerGroup(existingCarried)
          this.carriedMeshes.delete(eq.id)
        }
      }

      if (p?.mhcSpreader && eq.type === 'mobile_harbor_crane') {
        const jibY = 14.5
        p.mhcSpreader.position.set(0, jibY, -6 + eq.spreaderZ)
        if (p.mhcCable) {
          const drop = Math.max(0.1, jibY - eq.armTargetY)
          p.mhcCable.scale.y = drop
          p.mhcCable.position.y = -drop / 2
          for (const c of [p.mhcCableL, p.mhcCableR]) {
            if (c) { c.scale.y = drop; c.position.y = -drop / 2 }
          }
        }

        // ---- Carried container: hang below cable bottom ----
        const mhcExisting = this.carriedMeshes.get(eq.id)
        if (eq.carriedContainerId && containers) {
          const container = containers.find(c => c.id === eq.carriedContainerId)
          if (container) {
            let cGroup = mhcExisting
            if (!cGroup || cGroup.userData['containerId'] !== eq.carriedContainerId) {
              if (mhcExisting) {
                mesh.remove(mhcExisting)
                this.disposeContainerGroup(mhcExisting)
              }
              cGroup = createContainerGroup(container)
              mesh.add(cGroup)
              this.carriedMeshes.set(eq.id, cGroup)
            }
            // Cable bottom is at armTargetY; container centre is half-height below that
            cGroup.position.set(
              0,
              eq.armTargetY - CONTAINER_HEIGHT / 2,
              -6 + eq.spreaderZ,
            )
          }
        } else if (mhcExisting) {
          mesh.remove(mhcExisting)
          this.disposeContainerGroup(mhcExisting)
          this.carriedMeshes.delete(eq.id)
        }
      }
    }
  }

  private disposeContainerGroup(group: THREE.Group): void {
    group.traverse(obj => {
      const m = obj as THREE.Mesh
      if (!m.geometry) return
      const bodyMats = m.userData['bodyMaterials'] as THREE.MeshStandardMaterial[] | undefined
      if (bodyMats) disposeContainerMaterials(bodyMats)
      else if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
        else m.material.dispose()
      }
      m.geometry.dispose()
    })
  }

  dispose(): void {
    for (const [eqId, cGroup] of this.carriedMeshes) {
      const mesh = this.meshes.get(eqId)
      if (mesh) mesh.remove(cGroup)
      this.disposeContainerGroup(cGroup)
    }
    this.carriedMeshes.clear()
    for (const mesh of this.meshes.values()) {
      mesh.traverse(obj => {
        const m = obj as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
          else m.material.dispose()
        }
      })
      this.scene.remove(mesh)
    }
    this.meshes.clear()
    this.parts.clear()
  }
}

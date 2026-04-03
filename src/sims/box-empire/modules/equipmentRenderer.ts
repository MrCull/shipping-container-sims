// ---------------------------------------------------------------------------
// Box Empire — Equipment mesh management (improved quality)
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Equipment, Container } from '../types'
import { CONTAINER_HEIGHT, CONTAINER_WIDTH, MHC_CYCLE_TIME } from './config'
import { createContainerGroup } from './containerRenderer'
import { disposeContainerMaterials } from './containerMaterials'

interface EquipmentParts {
  boomGroup?: THREE.Group
  mhcHouseGroup?: THREE.Group
  mhcBoomGroup?: THREE.Group
  mhcTrolley?: THREE.Group
  mhcSpreader?: THREE.Group
  mhcCables?: THREE.Mesh[]
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

    const blueMat = new THREE.MeshPhongMaterial({ color: 0x1f5f8b, specular: 0x265f92, shininess: 55 })
    const blueDarkMat = new THREE.MeshPhongMaterial({ color: 0x15384f, specular: 0x112233, shininess: 35 })
    const redMat = new THREE.MeshPhongMaterial({ color: 0xc44830, specular: 0x552218, shininess: 45 })
    const yellowMat = new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x5d4600, emissiveIntensity: 0.3 })
    const beaconMat = new THREE.MeshPhongMaterial({ color: 0xf4d03f, emissive: 0x775500, emissiveIntensity: 0.65 })
    const darkMat = new THREE.MeshPhongMaterial({ color: 0x1b232b, shininess: 20 })
    const steelMat = new THREE.MeshPhongMaterial({ color: 0x8fa4b2, specular: 0xcad4dc, shininess: 80 })
    const steelDarkMat = new THREE.MeshPhongMaterial({ color: 0x54616c, shininess: 30 })
    const glassMat = new THREE.MeshPhongMaterial({ color: 0x6fb4f5, emissive: 0x19324a, emissiveIntensity: 0.45, transparent: true, opacity: 0.78 })
    const cableMat = new THREE.MeshPhongMaterial({ color: 0x2f3438, shininess: 6 })
    const walkwayMat = new THREE.MeshPhongMaterial({ color: 0x777f85, shininess: 35 })
    const floodMat = new THREE.MeshPhongMaterial({ color: 0xffffd0, emissive: 0x444400, emissiveIntensity: 0.45 })

    const undercarriage = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.7, 4.8), darkMat)
    undercarriage.position.y = 0.35
    undercarriage.castShadow = true
    group.add(undercarriage)

    const machineryDeck = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.45, 4.0), steelDarkMat)
    machineryDeck.position.y = 1.0
    machineryDeck.castShadow = true
    group.add(machineryDeck)

    for (const sign of [-1, 1]) {
      const trackFrame = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.95, 1.1), darkMat)
      trackFrame.position.set(0, 0.48, sign * 2.1)
      trackFrame.castShadow = true
      group.add(trackFrame)

      for (let i = -2; i <= 2; i += 0.55) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.12, 14), steelDarkMat)
        roller.rotation.z = Math.PI / 2
        roller.position.set(i, 0.28, sign * 2.1)
        group.add(roller)
      }

      for (const x of [-2.45, 2.45]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 1.12, 14), steelMat)
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(x, 0.44, sign * 2.1)
        group.add(wheel)
      }
    }

    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as [number, number][]) {
      const outrigger = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 0.45), blueDarkMat)
      outrigger.position.set(sx * 2.0, 1.15, sz * 1.55)
      outrigger.castShadow = true
      group.add(outrigger)
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.38, 0.18, 10), steelMat)
      foot.position.set(sx * 2.0, 0.18, sz * 1.55)
      group.add(foot)
    }

    const slewRing = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.2, 22), steelMat)
    slewRing.position.y = 1.32
    group.add(slewRing)

    const houseGroup = new THREE.Group()
    group.add(houseGroup)

    const rotatingDeck = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.45, 4.2), blueMat)
    rotatingDeck.position.y = 1.55
    rotatingDeck.castShadow = true
    houseGroup.add(rotatingDeck)

    const machineryHouse = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.4, 2.5), blueDarkMat)
    machineryHouse.position.set(0, 3.0, 1.2)
    machineryHouse.castShadow = true
    houseGroup.add(machineryHouse)

    const engineRoof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.18, 2.7), blueMat)
    engineRoof.position.set(0, 4.28, 1.2)
    houseGroup.add(engineRoof)

    const counterweight = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 2.2), darkMat)
    counterweight.position.set(0, 2.4, 2.8)
    counterweight.castShadow = true
    houseGroup.add(counterweight)

    const towerLegs = [
      [-1.0, -0.95], [-1.0, 0.95], [1.0, -0.95], [1.0, 0.95],
    ] as [number, number][]
    for (const [px, pz] of towerLegs) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 13.2, 0.22), blueMat)
      leg.position.set(px, 8.0, pz)
      leg.castShadow = true
      houseGroup.add(leg)
    }

    for (const level of [2.8, 5.6, 8.4, 11.2, 14.0]) {
      const tieX = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.12, 0.12), blueDarkMat)
      tieX.position.set(0, level, -0.95)
      houseGroup.add(tieX)
      const tieXRear = tieX.clone()
      tieXRear.position.z = 0.95
      houseGroup.add(tieXRear)

      const tieZ = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.0), blueDarkMat)
      tieZ.position.set(-1.0, level, 0)
      houseGroup.add(tieZ)
      const tieZRight = tieZ.clone()
      tieZRight.position.x = 1.0
      houseGroup.add(tieZRight)
    }

    const faceBraceLength = Math.sqrt(2 * 2 + 2.8 * 2.8)
    const faceBraceAngle = Math.atan2(2, 2.8)
    for (let tier = 0; tier < 4; tier++) {
      const centerY = 4.2 + tier * 2.8
      for (const dir of [-1, 1]) {
        const frontBrace = new THREE.Mesh(new THREE.BoxGeometry(0.08, faceBraceLength, 0.08), steelMat)
        frontBrace.position.set(dir * 0.52, centerY, -0.95)
        frontBrace.rotation.z = dir * faceBraceAngle
        houseGroup.add(frontBrace)

        const sideBrace = new THREE.Mesh(new THREE.BoxGeometry(0.08, faceBraceLength, 0.08), steelMat)
        sideBrace.position.set(-1.0, centerY, dir * 0.48)
        sideBrace.rotation.x = -dir * faceBraceAngle
        houseGroup.add(sideBrace)
      }
    }

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.25, 1.65, 1.9), yellowMat)
    cab.position.set(0, 13.75, 1.35)
    cab.castShadow = true
    houseGroup.add(cab)

    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 2.0), yellowMat)
    cabRoof.position.set(0, 14.63, 1.35)
    houseGroup.add(cabRoof)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.08, 0.34), darkMat)
    visor.position.set(0, 14.5, 2.32)
    houseGroup.add(visor)

    const frontWin = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.05, 0.07), glassMat)
    frontWin.position.set(0, 13.75, 2.26)
    houseGroup.add(frontWin)

    const lowerWin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 1.08), glassMat)
    lowerWin.position.set(0, 12.85, 1.35)
    houseGroup.add(lowerWin)

    for (const sx of [-1, 1]) {
      const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 1.4), glassMat)
      sideWin.position.set(sx * 1.13, 13.7, 1.35)
      houseGroup.add(sideWin)
    }

    const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.18, 8), beaconMat)
    beaconBase.position.set(0.8, 14.78, 1.15)
    houseGroup.add(beaconBase)
    const beaconDome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), beaconMat)
    beaconDome.position.set(0.8, 14.95, 1.15)
    houseGroup.add(beaconDome)

    for (const lx of [-0.55, -0.35]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 10.5, 0.05), walkwayMat)
      rail.position.set(lx, 7.0, 1.02)
      houseGroup.add(rail)
    }
    for (let i = 0; i < 16; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.04), walkwayMat)
      rung.position.set(-0.45, 2 + i * 0.62, 1.04)
      houseGroup.add(rung)
    }

    const boomPivot = new THREE.Group()
    boomPivot.position.set(0, 14.35, 0.15)
    houseGroup.add(boomPivot)

    const boomLength = 9.5
    const boomGroup = new THREE.Group()
    boomPivot.add(boomGroup)

    for (const x of [-0.28, 0.28]) {
      const topChord = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, boomLength), redMat)
      topChord.position.set(x, 0.48, -boomLength / 2)
      topChord.castShadow = true
      boomGroup.add(topChord)

      const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, boomLength), redMat)
      bottomChord.position.set(x, -0.42, -boomLength / 2)
      bottomChord.castShadow = true
      boomGroup.add(bottomChord)
    }

    for (let i = 0; i <= 9; i++) {
      const z = -i * (boomLength / 9)
      const crossTie = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.08), redMat)
      crossTie.position.set(0, 0.02, z)
      boomGroup.add(crossTie)

      if (i < 9) {
        const panelLen = Math.sqrt((boomLength / 9) ** 2 + 0.9 ** 2)
        const braceA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, panelLen), steelMat)
        braceA.position.set(-0.15, 0.02, z - boomLength / 18)
        braceA.rotation.x = 0.08
        braceA.rotation.y = 0.36
        boomGroup.add(braceA)

        const braceB = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, panelLen), steelMat)
        braceB.position.set(0.15, 0.02, z - boomLength / 18)
        braceB.rotation.x = -0.08
        braceB.rotation.y = -0.36
        boomGroup.add(braceB)
      }
    }

    const walkway = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, boomLength - 1.2), walkwayMat)
    walkway.position.set(0, -0.56, -(boomLength - 1.2) / 2 - 0.3)
    boomGroup.add(walkway)

    const boomTip = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.62, 0.5), steelMat)
    boomTip.position.set(0, 0, -boomLength)
    boomGroup.add(boomTip)

    for (const x of [-0.25, 0.25]) {
      const sheave = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), steelMat)
      sheave.rotation.z = Math.PI / 2
      sheave.position.set(x, -0.08, -boomLength + 0.18)
      boomGroup.add(sheave)
    }

    const floodLeft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.11), floodMat)
    floodLeft.position.set(-0.34, -0.22, -5.4)
    boomGroup.add(floodLeft)
    const floodRight = floodLeft.clone()
    floodRight.position.x = 0.34
    boomGroup.add(floodRight)

    const aFrameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5.0, 0.12), steelMat)
    aFrameLeft.position.set(-0.8, 12.1, -0.6)
    aFrameLeft.rotation.z = 0.24
    houseGroup.add(aFrameLeft)
    const aFrameRight = aFrameLeft.clone()
    aFrameRight.position.x = 0.8
    aFrameRight.rotation.z = -0.24
    houseGroup.add(aFrameRight)

    const backstayLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 6.4), steelMat)
    backstayLeft.position.set(-0.28, 14.0, 3.4)
    backstayLeft.rotation.x = -0.55
    houseGroup.add(backstayLeft)
    const backstayRight = backstayLeft.clone()
    backstayRight.position.x = 0.28
    houseGroup.add(backstayRight)

    const counterJib = new THREE.Group()
    counterJib.position.set(0, 14.15, 0.75)
    houseGroup.add(counterJib)

    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 7.2), steelMat)
    counterTop.position.set(0, 0.45, 3.6)
    counterJib.add(counterTop)
    const counterBottom = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 7.2), steelDarkMat)
    counterBottom.position.set(0, 0, 3.6)
    counterJib.add(counterBottom)

    for (const z of [1.4, 3.1, 4.8, 6.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.08), steelMat)
      post.position.set(0, 0.22, z)
      counterJib.add(post)
    }

    const cwBase = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 2.5), steelDarkMat)
    cwBase.position.set(0, -0.35, 6.9)
    counterJib.add(cwBase)
    const cwMain = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.1), darkMat)
    cwMain.position.set(0, 0.25, 6.9)
    cwMain.castShadow = true
    counterJib.add(cwMain)

    const trolley = new THREE.Group()
    trolley.position.set(0, -0.34, -5.2)
    boomGroup.add(trolley)

    const trolleyBody = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 1.2), blueDarkMat)
    trolleyBody.castShadow = true
    trolley.add(trolleyBody)

    const trolleyWheelLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), steelMat)
    trolleyWheelLeft.rotation.z = Math.PI / 2
    trolleyWheelLeft.position.set(-0.33, -0.18, -0.35)
    trolley.add(trolleyWheelLeft)
    const trolleyWheelRight = trolleyWheelLeft.clone()
    trolleyWheelRight.position.x = 0.33
    trolley.add(trolleyWheelRight)
    const trolleyWheelRearL = trolleyWheelLeft.clone()
    trolleyWheelRearL.position.z = 0.35
    trolley.add(trolleyWheelRearL)
    const trolleyWheelRearR = trolleyWheelRight.clone()
    trolleyWheelRearR.position.z = 0.35
    trolley.add(trolleyWheelRearR)

    const mhcSpreader = new THREE.Group()
    mhcSpreader.position.set(0, -7.8, 0)
    trolley.add(mhcSpreader)

    const spreaderFrame = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.34, 0.62), steelMat)
    spreaderFrame.castShadow = true
    mhcSpreader.add(spreaderFrame)

    const spreaderTop = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.08, 0.46), blueDarkMat)
    spreaderTop.position.y = 0.21
    mhcSpreader.add(spreaderTop)

    for (const sx of [-3.2, 3.2]) {
      const endBox = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.62), darkMat)
      endBox.position.set(sx, 0, 0)
      mhcSpreader.add(endBox)

      const twistPost = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.82, 0.26), steelDarkMat)
      twistPost.position.set(sx, -0.56, 0)
      mhcSpreader.add(twistPost)

      for (const sz of [-0.22, 0.22]) {
        const guide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.08), yellowMat)
        guide.position.set(sx + (sx < 0 ? -0.1 : 0.1), -0.3, sz)
        mhcSpreader.add(guide)
      }
    }

    const centerBlock = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.24, 0.6), darkMat)
    centerBlock.position.set(0, -0.1, 0)
    mhcSpreader.add(centerBlock)

    const mhcCables: THREE.Mesh[] = []
    for (const [x, z] of [[-1.9, -0.14], [1.9, -0.14], [-1.9, 0.14], [1.9, 0.14]] as [number, number][]) {
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), cableMat)
      cable.position.set(x, -0.5, z)
      trolley.add(cable)
      mhcCables.push(cable)
    }

    boomPivot.rotation.x = -0.2

    return {
      group,
      parts: {
        mhcHouseGroup: houseGroup,
        mhcBoomGroup: boomPivot,
        mhcTrolley: trolley,
        mhcSpreader,
        mhcCables,
      },
    }
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
        const target = eq.targetPosition ?? {
          x: eq.position.x,
          y: CONTAINER_HEIGHT / 2,
          z: eq.position.z - 10,
        }
        const dx = target.x - eq.position.x
        const dz = target.z - eq.position.z
        const desiredSlew = Math.atan2(dx, dz) + Math.PI
        const desiredReach = THREE.MathUtils.clamp(Math.sqrt(dx * dx + dz * dz), 4.6, 9.2)
        const desiredLuff = THREE.MathUtils.clamp(
          -0.21 - ((desiredReach - 4.6) / 4.6) * 0.14 + (dz > 0 ? 0.045 : -0.015),
          -0.38,
          -0.14,
        )
        const idleHoistY = 10.5
        const desiredHoistY = eq.currentJobId ? eq.armTargetY : idleHoistY

        if (p.mhcHouseGroup) {
          p.mhcHouseGroup.rotation.y = THREE.MathUtils.lerp(p.mhcHouseGroup.rotation.y, desiredSlew, 0.18)
        }
        if (p.mhcBoomGroup) {
          p.mhcBoomGroup.rotation.x = THREE.MathUtils.lerp(p.mhcBoomGroup.rotation.x, desiredLuff, 0.14)
        }
        if (p.mhcTrolley) {
          p.mhcTrolley.position.z = THREE.MathUtils.lerp(p.mhcTrolley.position.z, -desiredReach, 0.2)
        }

        const boomPivotY = p.mhcBoomGroup?.position.y ?? 14.35
        const boomPitch = p.mhcBoomGroup?.rotation.x ?? desiredLuff
        const trolleyLocalY = p.mhcTrolley?.position.y ?? -0.34
        const trolleyLocalZ = p.mhcTrolley?.position.z ?? -desiredReach
        const trolleyWorldY = boomPivotY +
          trolleyLocalY * Math.cos(boomPitch) -
          trolleyLocalZ * Math.sin(boomPitch)
        const cableDrop = Math.max(
          2,
          (trolleyWorldY - desiredHoistY) / Math.cos(boomPitch),
        )
        p.mhcSpreader.position.y = -cableDrop
        p.mhcSpreader.rotation.x = -(p.mhcBoomGroup?.rotation.x ?? 0)

        for (const cable of p.mhcCables ?? []) {
          cable.scale.y = cableDrop
          cable.position.y = -cableDrop / 2
        }

        const mhcExisting = this.carriedMeshes.get(eq.id)
        if (eq.carriedContainerId && containers) {
          const container = containers.find(c => c.id === eq.carriedContainerId)
          if (container) {
            let cGroup = mhcExisting
            if (!cGroup || cGroup.userData['containerId'] !== eq.carriedContainerId) {
              if (mhcExisting) {
                p.mhcSpreader.remove(mhcExisting)
                this.disposeContainerGroup(mhcExisting)
              }
              cGroup = createContainerGroup(container)
              p.mhcSpreader.add(cGroup)
              this.carriedMeshes.set(eq.id, cGroup)
            }
            cGroup.position.set(0, -(0.55 + CONTAINER_HEIGHT / 2), 0)
            const isImportSetdown =
              container.visitType === 'import' &&
              eq.state === 'dropping' &&
              eq.targetPosition !== null &&
              eq.targetPosition.z >= 0
            const dropProgress = Math.min(1, eq.stateElapsed / (MHC_CYCLE_TIME / 2))
            const yaw = isImportSetdown ? dropProgress * (Math.PI / 4) : 0
            cGroup.rotation.set(0, yaw, 0)
          }
        } else if (mhcExisting) {
          p.mhcSpreader.remove(mhcExisting)
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

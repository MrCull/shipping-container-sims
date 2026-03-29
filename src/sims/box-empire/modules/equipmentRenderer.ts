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

    // --- Materials ---
    const orangeMat     = new THREE.MeshPhongMaterial({ color: 0xe67e22, specular: 0x994400, shininess: 45 })
    const orangeDarkMat = new THREE.MeshPhongMaterial({ color: 0xb85c10, specular: 0x662200, shininess: 30 })
    const darkMat       = new THREE.MeshPhongMaterial({ color: 0x2c3e50, specular: 0x112233, shininess: 35 })
    const yellowMat     = new THREE.MeshPhongMaterial({ color: 0xf1c40f, emissive: 0x554400, emissiveIntensity: 0.4 })
    const blackMat      = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 60 })
    const rubberMat     = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 5 })
    const chromeMat     = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, specular: 0xffffff, shininess: 120 })
    const glassMat      = new THREE.MeshPhongMaterial({ color: 0x4a90d9, specular: 0xaaccee, shininess: 160, transparent: true, opacity: 0.72 })
    const grillMat      = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 10 })
    const stepMat       = new THREE.MeshPhongMaterial({ color: 0x666666, specular: 0x888888, shininess: 40 })
    const redMat        = new THREE.MeshPhongMaterial({ color: 0xc0392b, shininess: 40 })
    const tailLightMat  = new THREE.MeshPhongMaterial({ color: 0xff2200, emissive: 0x440000, emissiveIntensity: 0.4 })
    const headLightMat  = new THREE.MeshPhongMaterial({ color: 0xffffcc, emissive: 0x444400, emissiveIntensity: 0.5 })
    const cwMat         = new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 20 })
    const cwDarkMat     = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 10 })
    const rimMat        = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, specular: 0xffffff, shininess: 80 })

    // -------------------------------------------------------------------------
    // 1. CHASSIS — 3-layer body for panel-line silhouette
    // -------------------------------------------------------------------------
    const lowerChassis = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 5.0), orangeMat)
    lowerChassis.position.set(0, 1.0, 0); lowerChassis.castShadow = true; group.add(lowerChassis)

    const upperBody = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 4.6), orangeMat)
    upperBody.position.set(0, 2.0, 0); upperBody.castShadow = true; group.add(upperBody)

    const sideSkirts = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 4.8), orangeDarkMat)
    sideSkirts.position.set(0, 0.6, 0); group.add(sideSkirts)

    // Panel-line strips on sides
    for (const sx of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 4.4), orangeDarkMat)
      pl.position.set(sx * 1.72, 1.6, 0); group.add(pl)
    }

    // -------------------------------------------------------------------------
    // 2. ENGINE HOOD — multi-part with grilles
    // -------------------------------------------------------------------------
    const hood = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.3, 1.5), orangeMat)
    hood.position.set(0, 2.45, -1.7); hood.castShadow = true; group.add(hood)

    const hoodCap = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.15, 1.3), orangeDarkMat)
    hoodCap.position.set(0, 3.15, -1.7); group.add(hoodCap)

    // Side intake grilles
    for (const sx of [-1, 1]) {
      const sg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 1.0), grillMat)
      sg.position.set(sx * 1.55, 2.3, -1.7); group.add(sg)
    }

    // Rear radiator grille + chrome slats
    const rearGrille = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.08), grillMat)
    rearGrille.position.set(0, 2.3, -2.48); group.add(rearGrille)
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.1), chromeMat)
      slat.position.set(0, 2.15 + i * 0.15, -2.49); group.add(slat)
    }

    // -------------------------------------------------------------------------
    // 3. EXHAUST — dual stacks with dark caps
    // -------------------------------------------------------------------------
    for (const ex of [-1.1, -0.7]) {
      const stk = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.13, 1.4, 8), chromeMat)
      stk.position.set(ex, 3.5, -1.5); group.add(stk)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), darkMat)
      cap.position.set(ex, 4.23, -1.5); group.add(cap)
    }

    // -------------------------------------------------------------------------
    // 4. OPERATOR CAB — with ROPS frame, sun visor, extra windows
    // -------------------------------------------------------------------------
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 1.5), darkMat)
    cab.position.set(-0.5, 3.15, 0.9); cab.castShadow = true; group.add(cab)

    // Cab roof with overhang
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 1.7), darkMat)
    cabRoof.position.set(-0.5, 3.96, 0.9); group.add(cabRoof)

    // Sun visor protruding forward
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), orangeMat)
    visor.position.set(-0.5, 3.9, 1.85); group.add(visor)

    // ROPS posts + top bar
    for (const px of [-1.45, 0.45]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.7, 0.10), orangeMat)
      post.position.set(px, 3.25, 0.2); group.add(post)
    }
    const ropsBar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.10, 0.10), orangeMat)
    ropsBar.position.set(-0.5, 4.05, 0.2); group.add(ropsBar)

    // Windscreen
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 0.06), glassMat)
    win.position.set(-0.5, 3.2, 1.68); group.add(win)

    // Side windows
    for (const sx of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 1.2), glassMat)
      sw.position.set(sx * 1.03 + (-0.5), 3.2, 0.85); group.add(sw)
    }

    // Rear window
    const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.06), glassMat)
    rearWin.position.set(-0.5, 3.4, 0.12); group.add(rearWin)

    // Door handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.18), chromeMat)
    handle.position.set(-1.52, 3.0, 1.0); group.add(handle)

    // -------------------------------------------------------------------------
    // 5. WARNING BEACON — cylinder base + sphere dome
    // -------------------------------------------------------------------------
    const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 0.20, 8), yellowMat)
    beaconBase.position.set(-0.5, 4.12, 0.8); group.add(beaconBase)
    const beaconDome = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), yellowMat)
    beaconDome.position.set(-0.5, 4.28, 0.8); group.add(beaconDome)

    // -------------------------------------------------------------------------
    // 6. COUNTERWEIGHT — 2-part for visual mass
    // -------------------------------------------------------------------------
    const cw = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 1.2), cwMat)
    cw.position.set(0, 1.2, -2.8); cw.castShadow = true; group.add(cw)
    const cwLip = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 1.4), cwDarkMat)
    cwLip.position.set(0, 0.55, -2.85); group.add(cwLip)

    // Tail lights
    for (const tx of [-1.2, 1.2]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.06), tailLightMat)
      tl.position.set(tx, 1.5, -3.42); group.add(tl)
    }

    // Hazard stripe plates (alternating yellow/dark on counterweight rear)
    const hazardYellow = new THREE.MeshPhongMaterial({ color: 0xf1c40f, shininess: 20 })
    for (const hx of [-0.8, 0.8]) {
      const hp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.06), hx < 0 ? hazardYellow : cwDarkMat)
      hp.position.set(hx, 1.2, -3.45); group.add(hp)
    }

    // -------------------------------------------------------------------------
    // 7. BOOM GROUP — I-beam cross-section + hydraulic rams
    //    Pivot position unchanged: (0.9, 3.3, 2.2)
    // -------------------------------------------------------------------------
    const boomGroup = new THREE.Group()
    boomGroup.position.set(0.9, 3.3, 2.2)

    // Pivot housing + pin
    const pivotBlock = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.5), orangeDarkMat)
    pivotBlock.position.set(0, 0, 0); boomGroup.add(pivotBlock)
    const pivotPin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8), chromeMat)
    pivotPin.rotation.z = Math.PI / 2; pivotPin.position.set(0, 0, 0); boomGroup.add(pivotPin)

    // Outer boom — I-beam (top/bottom chord + side webs)
    const boomTopChord = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.12, 6.0), orangeMat)
    boomTopChord.position.set(0, 0.20, 3.0); boomTopChord.castShadow = true; boomGroup.add(boomTopChord)
    const boomBotChord = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.12, 6.0), orangeMat)
    boomBotChord.position.set(0, -0.20, 3.0); boomGroup.add(boomBotChord)
    for (const bx of [-1, 1]) {
      const web = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.52, 6.0), orangeDarkMat)
      web.position.set(bx * 0.20, 0, 3.0); boomGroup.add(web)
    }

    // Inner telescoping section — I-beam
    const extTopChord = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.10, 3.4), orangeMat)
    extTopChord.position.set(0, 0.16, 7.7); boomGroup.add(extTopChord)
    const extBotChord = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.10, 3.4), orangeMat)
    extBotChord.position.set(0, -0.16, 7.7); boomGroup.add(extBotChord)
    for (const bx of [-1, 1]) {
      const ew = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.40, 3.4), orangeDarkMat)
      ew.position.set(bx * 0.14, 0, 7.7); boomGroup.add(ew)
    }

    // Hydraulic cylinders (2 pairs — cylinder body + extended rod)
    for (const hx of [-0.35, 0.35]) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.5, 8), chromeMat)
      cyl.rotation.x = Math.PI / 2; cyl.position.set(hx, -0.35, 2.0); boomGroup.add(cyl)
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6), chromeMat)
      rod.rotation.x = Math.PI / 2; rod.position.set(hx, -0.35, 4.6); boomGroup.add(rod)
    }

    // -------------------------------------------------------------------------
    // 8. SPREADER — thicker beam, guide rails, center block
    // -------------------------------------------------------------------------
    const spreaderFrame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.30, 0.55), redMat)
    spreaderFrame.position.set(0, -0.55, 9.2); boomGroup.add(spreaderFrame)

    const spreaderTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.06, 0.45), orangeDarkMat)
    spreaderTop.position.set(0, -0.37, 9.2); boomGroup.add(spreaderTop)

    for (const sx of [-3.2, 3.2]) {
      // Twist-lock posts
      const tw = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.35), redMat)
      tw.position.set(sx, -0.55, 9.2); boomGroup.add(tw)
      // Guide rail corners (front + rear)
      for (const gz of [9.0, 9.4]) {
        const gr = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.08), yellowMat)
        gr.position.set(sx > 0 ? sx + 0.15 : sx - 0.15, -0.55, gz); boomGroup.add(gr)
      }
    }

    // Center mechanism block
    const centerBlock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.6), darkMat)
    centerBlock.position.set(0, -0.75, 9.2); boomGroup.add(centerBlock)

    boomGroup.scale.z = 0.5   // halve arm length
    boomGroup.rotation.x = -0.15
    group.add(boomGroup)

    // -------------------------------------------------------------------------
    // 9. WHEELS — rear double axle + front steer (with fenders)
    // -------------------------------------------------------------------------
    const wheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.48, 16)
    const rimGeo   = new THREE.CylinderGeometry(0.30, 0.30, 0.50, 8)
    const hubGeo   = new THREE.CylinderGeometry(0.12, 0.12, 0.52, 6)

    for (const [sx, sz] of [[-1.72, -1.8], [-1.72, -2.7], [1.72, -1.8], [1.72, -2.7]] as [number, number][]) {
      const w = new THREE.Mesh(wheelGeo, rubberMat); w.rotation.z = Math.PI / 2
      w.position.set(sx, 0.62, sz); w.castShadow = true; group.add(w)
      const r = new THREE.Mesh(rimGeo, rimMat); r.rotation.z = Math.PI / 2
      r.position.set(sx, 0.62, sz); group.add(r)
      const h = new THREE.Mesh(hubGeo, blackMat); h.rotation.z = Math.PI / 2
      h.position.set(sx, 0.62, sz); group.add(h)
    }

    // Rear axle bar
    const rearAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), darkMat)
    rearAxle.rotation.z = Math.PI / 2; rearAxle.position.set(0, 0.62, -2.25); group.add(rearAxle)

    // Rear fenders
    for (const sx of [-1, 1]) {
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 2.2), orangeMat)
      fender.position.set(sx * 1.82, 1.3, -2.25); group.add(fender)
      const fenderTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.10, 2.2), orangeMat)
      fenderTop.position.set(sx * 1.62, 1.7, -2.25); group.add(fenderTop)
    }

    // Front steering wheels
    for (const sx of [-1.65, 1.65]) {
      const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.44, 16), rubberMat)
      fw.rotation.z = Math.PI / 2; fw.position.set(sx, 0.58, 1.8); fw.castShadow = true; group.add(fw)
      const fr = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.46, 8), rimMat)
      fr.rotation.z = Math.PI / 2; fr.position.set(sx, 0.58, 1.8); group.add(fr)
      const fh = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.48, 6), blackMat)
      fh.rotation.z = Math.PI / 2; fh.position.set(sx, 0.58, 1.8); group.add(fh)
      // Front fender
      const ff = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.6, 0.8), orangeMat)
      ff.position.set(sx * (Math.abs(sx) / sx) * 1.75, 1.1, 1.8); group.add(ff)
    }

    // Front axle bar
    const frontAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.0, 6), darkMat)
    frontAxle.rotation.z = Math.PI / 2; frontAxle.position.set(0, 0.58, 1.8); group.add(frontAxle)

    // -------------------------------------------------------------------------
    // 10. SURFACE DETAILS — headlights, ladder
    // -------------------------------------------------------------------------
    // Headlights (front of body)
    for (const hx of [-1.2, 1.2]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.06), headLightMat)
      hl.position.set(hx, 2.0, 2.52); group.add(hl)
    }

    // Access ladder (left side of cab)
    for (const lx of [0, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.04), stepMat)
      rail.position.set(-1.55, 2.2, 1.7 - lx * 0.25); group.add(rail)
    }
    for (let i = 0; i < 4; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.25), stepMat)
      rung.position.set(-1.55, 1.5 + i * 0.3, 1.575); group.add(rung)
    }

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
            // Spreader end is at boomGroup-local (0, -0.55, 9.2); scale.z=0.5 → z_scaled=4.6.
            // Container centre is twistLockHeight (0.9m) + CONTAINER_HEIGHT/2 below spreader frame.
            // Shift ¾ container width back toward RS body for a natural carry position.
            const θ = p.boomGroup.rotation.x
            const cY_boom = -(0.55 + 0.9 + CONTAINER_HEIGHT / 2)  // ≈ -2.745
            const cZ_scaled = 9.2 * 0.5                            // = 4.6
            const zShift = CONTAINER_WIDTH * 0.75                  // ≈ 1.83m toward RS
            cGroup.position.set(
              0.9,
              3.3 + cY_boom * Math.cos(θ) - cZ_scaled * Math.sin(θ),
              2.2 + cY_boom * Math.sin(θ) + cZ_scaled * Math.cos(θ) - zShift,
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

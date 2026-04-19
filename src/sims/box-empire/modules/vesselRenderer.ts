// ---------------------------------------------------------------------------
// Box Empire — Vessel mesh (inspired by stowage-master shipRenderer.ts)
// Procedural ship with tapered hull, antifouling band, hatch covers,
// accommodation block, funnel, and deck fittings.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { VesselVisit, Container } from '../types'
import type { RenderEntityIndexes } from './renderEntityIndexes'
import {
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_HEIGHT,
  TUTORIAL_VESSEL,
  VESSEL_GLB,
  VESSEL_CONTAINER_DECK_Y,
  CONTAINER_STACK_GAP_Y,
} from './config'
import { loadModel, getModelSync } from './modelLoader'
import { createContainerMaterials, disposeContainerMaterials } from './containerMaterials'

export const VESSEL_GLB_URL = new URL('../assets/models/container-ship-small-empty-no-containers.glb', import.meta.url).href

/**
 * Build a hull group from a cloned GLB root.
 * Rotates to align length along X, scales to loa, and centres.
 * The returned group is named 'vessel-glb-hull' for easy identification during swap.
 */
function buildVesselGLBHull(glbRoot: THREE.Group, loa: number): THREE.Group {
  glbRoot.rotation.y = VESSEL_GLB.rotationY

  // After rotation the length axis is X — scale to match loa
  const box = new THREE.Box3().setFromObject(glbRoot)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = loa / size.x
  glbRoot.scale.setScalar(scale)

  // Centre on X/Z, apply configurable Y offset so deck aligns with DECK_Y
  const scaledBox = new THREE.Box3().setFromObject(glbRoot)
  const center = new THREE.Vector3()
  scaledBox.getCenter(center)
  glbRoot.position.x = -center.x
  glbRoot.position.z = -center.z
  glbRoot.position.y = VESSEL_GLB.yOffset

  const hull = new THREE.Group()
  hull.name = ''
  hull.add(glbRoot)
  return hull
}

const DECK_Y = 5.4
// Container slot deck-Y constant (must match getVesselSlotPosition in vesselManager)
const CONTAINER_DECK_Y = VESSEL_CONTAINER_DECK_Y

function makeDeckContainer(container: Container): THREE.Group {
  const g = new THREE.Group()
  g.name = `deck-container-${container.id}`
  const mats = createContainerMaterials(container.ownerColor, container.id, container.shippingLine)
  const geo = new THREE.BoxGeometry(CONTAINER_LENGTH, CONTAINER_HEIGHT, CONTAINER_WIDTH)
  const mesh = new THREE.Mesh(geo, mats)
  mesh.castShadow = true
  mesh.userData['bodyMaterials'] = mats
  g.add(mesh)
  const edges = new THREE.EdgesGeometry(geo)
  g.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x08080c, transparent: true, opacity: 0.35 })))
  return g
}

// Shared materials — allocated once, reused
let hullMat: THREE.MeshPhongMaterial | null = null
let antifoulMat: THREE.MeshPhongMaterial | null = null
let deckMat: THREE.MeshPhongMaterial | null = null
let superMat: THREE.MeshPhongMaterial | null = null
let glassMat: THREE.MeshPhongMaterial | null = null
let metalMat: THREE.MeshPhongMaterial | null = null
let bollardMat: THREE.MeshPhongMaterial | null = null
let lashBridgeMat: THREE.MeshPhongMaterial | null = null
let windlassMat: THREE.MeshPhongMaterial | null = null

function getMaterials() {
  if (!hullMat) {
    hullMat      = new THREE.MeshPhongMaterial({ color: 0x1a2535, specular: 0x334455, shininess: 40, side: THREE.DoubleSide })
    antifoulMat  = new THREE.MeshPhongMaterial({ color: 0x8b1a1a, specular: 0x441111, shininess: 20 })
    deckMat      = new THREE.MeshPhongMaterial({ color: 0x4a3c28, specular: 0x221a10, shininess: 10 })
    superMat     = new THREE.MeshPhongMaterial({ color: 0xf0f0e8, specular: 0x888880, shininess: 55 })
    glassMat     = new THREE.MeshPhongMaterial({ color: 0x4488bb, emissive: 0x224466, emissiveIntensity: 0.5, specular: 0xaaccee, shininess: 180, transparent: true, opacity: 0.82 })
    metalMat     = new THREE.MeshPhongMaterial({ color: 0x5a5a5a, specular: 0x888888, shininess: 80 })
    bollardMat   = new THREE.MeshPhongMaterial({ color: 0x2b2b2b, shininess: 38 })
    lashBridgeMat= new THREE.MeshPhongMaterial({ color: 0x5a5a5a, specular: 0x777777, shininess: 60 })
    windlassMat  = new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 40 })
  }
  return { hullMat: hullMat!, antifoulMat: antifoulMat!, deckMat: deckMat!, superMat: superMat!, glassMat: glassMat!, metalMat: metalMat!, bollardMat: bollardMat!, lashBridgeMat: lashBridgeMat!, windlassMat: windlassMat! }
}

function makeTaperedPrism(
  xLen: number, h: number,
  wBack: number, wTip: number, tipZOffset: number,
  mat: THREE.MeshPhongMaterial,
): THREE.Mesh {
  const hw = xLen / 2; const hh = h / 2; const hbk = wBack / 2; const htp = wTip / 2
  const v = [
    hw, -hh, -hbk,  hw,  hh, -hbk,  hw,  hh,  hbk,  hw, -hh,  hbk,
    -hw, -hh, -htp + tipZOffset,  -hw,  hh, -htp + tipZOffset,
    -hw,  hh,  htp + tipZOffset,  -hw, -hh,  htp + tipZOffset,
  ]
  const idx = [0,2,1,0,3,2, 4,5,6,4,6,7, 0,4,7,0,7,3, 1,2,6,1,6,5, 3,7,6,3,6,2, 0,1,5,0,5,4]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = true
  return mesh
}

function buildHull(group: THREE.Group, L: number, W: number, H: number, mats: ReturnType<typeof getMaterials>): void {
  const { hullMat, antifoulMat } = mats
  const depth = H * 1.8
  const deckY = DECK_Y
  const midLen = L * 0.62
  const bowLen = L * 0.20
  const sternLen = L * 0.10
  const hullCenterX = -L * 0.09

  // Main hull body
  const mid = new THREE.Mesh(new THREE.BoxGeometry(midLen, depth, W), hullMat)
  mid.position.set(hullCenterX, -depth * 0.5 + deckY, 0)
  mid.castShadow = true; mid.receiveShadow = true
  group.add(mid)

  // Bow — tapered prism pointing in +X direction (bow faces +X on our rotated vessel)
  const bow = makeTaperedPrism(bowLen, depth, W, 1.8, 0, hullMat)  // widened from 0.6 to 1.8
  bow.position.set(hullCenterX + midLen / 2 + bowLen / 2, -depth * 0.5 + deckY, 0)
  group.add(bow)

  // Stern
  const stern = makeTaperedPrism(sternLen, depth, W, W * 0.72, 0, hullMat)
  stern.position.set(hullCenterX - midLen / 2 - sternLen / 2, -depth * 0.5 + deckY, 0)
  group.add(stern)

  // Anti-fouling red band
  const af = new THREE.Mesh(new THREE.BoxGeometry(L * 0.95, depth * 0.30, W * 0.97), antifoulMat)
  af.position.set(hullCenterX, -depth * 0.5 + deckY - depth * 0.62, 0)
  group.add(af)

  // White waterline stripe
  const wl = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.28, W * 0.97), new THREE.MeshPhongMaterial({ color: 0xffffff }))
  wl.position.set(hullCenterX, -depth * 0.5 + deckY - depth * 0.35, 0)
  group.add(wl)

  // Bulwarks — raised hull lip above deck level along both sides
  const bulwarkLen = midLen + bowLen * 0.6
  const bulwarkMat = hullMat
  for (const sign of [-1, 1]) {
    const bw = new THREE.Mesh(new THREE.BoxGeometry(bulwarkLen, 1.2, 0.25), bulwarkMat)
    bw.position.set(hullCenterX + bowLen * 0.15, deckY + 0.6, sign * W * 0.435)
    group.add(bw)
  }

  // Hull panel lines — thin darker horizontal strips on hull sides
  const panelLineMat = new THREE.MeshPhongMaterial({ color: 0x0f1a28 })
  for (const sign of [-1, 1]) {
    for (const frac of [0.25, 0.55]) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(midLen * 0.95, 0.08, 0.08), panelLineMat)
      pl.position.set(hullCenterX, deckY - depth * frac, sign * W * 0.502)
      group.add(pl)
    }
  }
}

function buildDeck(group: THREE.Group, L: number, W: number, mats: ReturnType<typeof getMaterials>): void {
  const { deckMat, metalMat, bollardMat, lashBridgeMat, windlassMat } = mats
  const deckY = DECK_Y

  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.90, 0.32, W * 0.87), deckMat)
  deck.position.y = deckY
  deck.castShadow = true; deck.receiveShadow = true
  group.add(deck)

  // Hatch covers + lashing bridges between them
  const numHatches = 5
  const hatchAreaL = L * 0.58
  const hatchLen = hatchAreaL / numHatches - 0.8
  const hatchMat = new THREE.MeshPhongMaterial({ color: 0x566470, specular: 0x223344, shininess: 22 })
  const hatchXPositions: number[] = []
  for (let i = 0; i < numHatches; i++) {
    const hx = (i - (numHatches - 1) / 2) * (hatchLen + 0.8) + L * 0.02
    hatchXPositions.push(hx)
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(hatchLen, 0.22, W * 0.70), hatchMat)
    hatch.position.set(hx, deckY + 0.27, 0)
    hatch.castShadow = true
    group.add(hatch)
    const coam = new THREE.Mesh(new THREE.BoxGeometry(hatchLen + 0.25, 0.30, W * 0.70 + 0.25), metalMat)
    coam.position.set(hx, deckY + 0.10, 0)
    group.add(coam)
  }

  // Lashing bridges — transverse frames between each pair of hatches
  for (let i = 0; i < numHatches - 1; i++) {
    const lx = (hatchXPositions[i] + hatchXPositions[i + 1]) / 2
    // Cross-beam
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, W * 0.68), lashBridgeMat)
    crossBeam.position.set(lx, deckY + 1.07, 0); group.add(crossBeam)
    // Vertical supports (port + starboard)
    for (const sign of [-1, 1]) {
      const vpost = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), lashBridgeMat)
      vpost.position.set(lx, deckY + 1.07, sign * W * 0.32); group.add(vpost)
    }
    // Top rail
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, W * 0.68), metalMat)
    topRail.position.set(lx, deckY + 1.95, 0); group.add(topRail)
  }

  // Mooring bollards — bow (4) and stern (2)
  const bollardBodyGeo = new THREE.CylinderGeometry(0.20, 0.28, 0.8, 10)
  const bollardCapGeo  = new THREE.SphereGeometry(0.24, 10, 8)
  const bowBollards: [number, number][] = [
    [L * 0.32, W * 0.30], [L * 0.32, -W * 0.30],
    [L * 0.37, W * 0.25], [L * 0.37, -W * 0.25],
  ]
  for (const [bx, bz] of bowBollards) {
    const body = new THREE.Mesh(bollardBodyGeo, bollardMat)
    body.position.set(bx, deckY + 0.57, bz); group.add(body)
    const cap = new THREE.Mesh(bollardCapGeo, bollardMat)
    cap.position.set(bx, deckY + 1.0, bz); group.add(cap)
  }
  for (const sign of [-1, 1]) {
    const body = new THREE.Mesh(bollardBodyGeo, bollardMat)
    body.position.set(-L * 0.44, deckY + 0.57, sign * W * 0.28); group.add(body)
    const cap = new THREE.Mesh(bollardCapGeo, bollardMat)
    cap.position.set(-L * 0.44, deckY + 1.0, sign * W * 0.28); group.add(cap)
  }

  // Windlass at bow — anchor chain winch
  const windlassDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 12), windlassMat)
  windlassDrum.rotation.z = Math.PI / 2
  windlassDrum.position.set(L * 0.36, deckY + 0.65, 0); group.add(windlassDrum)
  const windlassBase = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 1.4), windlassMat)
  windlassBase.position.set(L * 0.36, deckY + 0.20, 0); group.add(windlassBase)
}

function buildSuperstructure(group: THREE.Group, L: number, W: number, H: number, mats: ReturnType<typeof getMaterials>): void {
  const { superMat, glassMat, metalMat } = mats
  const deckY = DECK_Y
  // Stern is at -X end
  const sternX = -L * 0.38

  const floors = [
    { w: W * 0.50, l: L * 0.13, h: H * 1.2 },
    { w: W * 0.44, l: L * 0.11, h: H * 0.95 },
    { w: W * 0.38, l: L * 0.09, h: H * 0.80 },
  ]
  let accY = deckY
  for (const f of floors) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(f.l, f.h, f.w), superMat)
    m.position.set(sternX, accY + f.h / 2, 0)
    m.castShadow = true
    group.add(m)

    // Windows on all 4 faces
    // Front (+X face — existing)
    const winFront = new THREE.Mesh(new THREE.BoxGeometry(f.l * 0.09, f.h * 0.30, f.w * 0.88), glassMat)
    winFront.position.set(sternX + f.l * 0.54, accY + f.h * 0.62, 0); group.add(winFront)
    // Back (-X face)
    const winBack = new THREE.Mesh(new THREE.BoxGeometry(f.l * 0.09, f.h * 0.30, f.w * 0.75), glassMat)
    winBack.position.set(sternX - f.l * 0.52, accY + f.h * 0.62, 0); group.add(winBack)
    // Port (-Z face)
    const winPort = new THREE.Mesh(new THREE.BoxGeometry(f.l * 0.75, f.h * 0.30, f.w * 0.09), glassMat)
    winPort.position.set(sternX, accY + f.h * 0.62, -f.w * 0.52); group.add(winPort)
    // Starboard (+Z face)
    const winStbd = new THREE.Mesh(new THREE.BoxGeometry(f.l * 0.75, f.h * 0.30, f.w * 0.09), glassMat)
    winStbd.position.set(sternX, accY + f.h * 0.62, f.w * 0.52); group.add(winStbd)

    accY += f.h
  }

  // Bridge wings — platforms extending from sides of the top floor
  // accY is now at the top of floor 3. Top floor center Y = accY - floors[2].h/2
  const topFloor = floors[2]
  const topFloorCenterY = accY - topFloor.h / 2
  const railMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 48 })
  for (const sign of [-1, 1]) {
    // Platform
    const wingPlat = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 2.0), metalMat)
    wingPlat.position.set(sternX, topFloorCenterY, sign * (topFloor.w / 2 + 1.0))
    group.add(wingPlat)
    // Side railing
    const sideRail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 0.08), railMat)
    sideRail.position.set(sternX, topFloorCenterY + 0.4, sign * (topFloor.w / 2 + 2.0))
    group.add(sideRail)
    // Front railing of wing
    const frontRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 2.0), railMat)
    frontRail.position.set(sternX + 1.25, topFloorCenterY + 0.4, sign * (topFloor.w / 2 + 1.0))
    group.add(frontRail)
  }

  // Funnel
  const funnelMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e, shininess: 38 })
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.25, H * 2.2, 12), funnelMat)
  funnel.position.set(sternX, accY + H * 1.0, 0)
  funnel.castShadow = true
  group.add(funnel)

  // Funnel band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.90, 1.30, 0.55, 12), new THREE.MeshPhongMaterial({ color: 0xddaa00, emissive: 0x664400, emissiveIntensity: 0.2 }))
  band.position.set(sternX, accY + H * 1.1, 0)
  group.add(band)

  // Funnel cap (wider disc at top)
  const funnelTopY = accY + H * 1.0 + H * 1.1  // funnel center + half-height
  const funnelCap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.85, 0.4, 12), funnelMat)
  funnelCap.position.set(sternX, funnelTopY, 0); group.add(funnelCap)

  // Mast — kept short and proportional for a small feeder
  const mastHeight = H * 0.9
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, mastHeight, 8), metalMat)
  mast.position.set(sternX, accY + mastHeight / 2, 0)
  group.add(mast)

  // Radar sphere at mast top
  const radarY = accY + mastHeight
  const radar = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), new THREE.MeshPhongMaterial({ color: 0xf2f2f2 }))
  radar.position.set(sternX, radarY, 0)
  group.add(radar)

  // Lifeboats + davit arms (one per side, at 2nd-floor level)
  const lifeboatMat = new THREE.MeshPhongMaterial({ color: 0xff6600, shininess: 30 })
  const davitMat = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 50 })
  const floor2W = floors[1].w  // W * 0.44
  for (const sign of [-1, 1]) {
    const davit = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), davitMat)
    davit.position.set(sternX - floors[1].l * 0.3, deckY + floors[0].h + 1.5, sign * (floor2W / 2 + 0.3))
    davit.rotation.x = sign * 0.2
    group.add(davit)
    const lifeboat = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.0, 1.0), lifeboatMat)
    lifeboat.position.set(sternX - floors[1].l * 0.3, deckY + floors[0].h + 0.5, sign * (floor2W / 2 + 1.4))
    lifeboat.castShadow = true
    group.add(lifeboat)
  }

  // Rudder — flat plate behind propeller
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.0, 1.5), mats.hullMat)
  rudder.position.set(-L * 0.49, deckY - 2.5, 0); group.add(rudder)

  // Propeller
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.75, 0.65, 12), new THREE.MeshPhongMaterial({ color: 0xb8860b, shininess: 120 }))
  prop.rotation.z = Math.PI / 2
  prop.position.set(-L * 0.47, deckY - 1.6, 0)
  group.add(prop)
}

function buildDeckFittings(group: THREE.Group, L: number, W: number, mats: ReturnType<typeof getMaterials>): void {
  const { metalMat } = mats
  const deckY = DECK_Y + 0.17
  const railMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 48 })

  // Mid-ship railings (existing, port + starboard)
  for (const sign of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L * 0.63, 0.11, 0.11), railMat)
    rail.position.set(L * 0.02, deckY + 1.0, sign * (W * 0.42))
    group.add(rail)
    for (let i = -4; i <= 4; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), metalMat)
      st.position.set(i * (L * 0.08), deckY + 0.5, sign * (W * 0.42))
      group.add(st)
    }
  }

  // Forecastle railings (forward of mid-ship railings, port + starboard)
  for (const sign of [-1, 1]) {
    const fcRail = new THREE.Mesh(new THREE.BoxGeometry(L * 0.12, 0.11, 0.11), railMat)
    fcRail.position.set(L * 0.35, deckY + 1.0, sign * W * 0.42); group.add(fcRail)
    for (const sx of [L * 0.31, L * 0.39]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), metalMat)
      st.position.set(sx, deckY + 0.5, sign * W * 0.42); group.add(st)
    }
  }

  // Bow transverse railing
  const bowRail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, W * 0.75), railMat)
  bowRail.position.set(L * 0.41, deckY + 1.0, 0); group.add(bowRail)
  for (const sign of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.09), metalMat)
    st.position.set(L * 0.41, deckY + 0.5, sign * W * 0.28); group.add(st)
  }

  // Stern railings (aft of superstructure, port + starboard)
  for (const sign of [-1, 1]) {
    const stRail = new THREE.Mesh(new THREE.BoxGeometry(L * 0.06, 0.11, 0.11), railMat)
    stRail.position.set(-L * 0.44, deckY + 1.0, sign * W * 0.30); group.add(stRail)
  }

  // Bow anchor fairleads (existing torus rings)
  const fairMat = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 60 })
  for (const sign of [-1, 1]) {
    const fair = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.14, 8, 12), fairMat)
    fair.rotation.y = Math.PI / 2
    fair.position.set(L * 0.43, deckY + 0.28, sign * W * 0.34)
    group.add(fair)
  }

  // Hawse pipes — short cylinders angled into hull near bow
  for (const sign of [-1, 1]) {
    const hwp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8), metalMat)
    hwp.rotation.x = Math.PI / 4; hwp.rotation.z = sign * 0.3
    hwp.position.set(L * 0.41, deckY - 0.5, sign * W * 0.38); group.add(hwp)
  }

  // Jackstaff at bow tip
  const jackstaff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.5, 6), metalMat)
  jackstaff.position.set(L * 0.42, deckY + 1.42, 0); group.add(jackstaff)

  // Navigation lights
  const navRedMat   = new THREE.MeshPhongMaterial({ color: 0xff0000, emissive: 0x880000, emissiveIntensity: 0.8 })
  const navGreenMat = new THREE.MeshPhongMaterial({ color: 0x00ff00, emissive: 0x008800, emissiveIntensity: 0.8 })
  const navWhiteMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0xccccaa, emissiveIntensity: 1.0 })
  // Port (red, -Z side)
  const portLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), navRedMat)
  portLight.position.set(L * 0.30, deckY + 1.3, -W * 0.44); group.add(portLight)
  // Starboard (green, +Z side)
  const stbdLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), navGreenMat)
  stbdLight.position.set(L * 0.30, deckY + 1.3, W * 0.44); group.add(stbdLight)
  // Stern (white)
  const sternLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), navWhiteMat)
  sternLight.position.set(-L * 0.46, deckY + 1.0, 0); group.add(sternLight)

  // Stern name plate — subtle panel on stern face below deck
  const namePlateMat = new THREE.MeshPhongMaterial({ color: 0x2a3545, emissive: 0x0a0f15, emissiveIntensity: 0.15 })
  const namePlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, W * 0.45), namePlateMat)
  namePlate.position.set(-L * 0.465, deckY - 1.5, 0); group.add(namePlate)
}

export class VesselRenderer {
  private meshes = new Map<string, THREE.Group>()
  private scene: THREE.Scene
  // Track deck container groups per vessel: vesselId → Map<containerId, Group>
  private deckContainers = new Map<string, Map<string, THREE.Group>>()
  // Shake animation state per vessel: vesselId → { intensity, elapsed }
  private shakeState = new Map<string, { intensity: number; elapsed: number }>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  // Call this when a container is placed on the vessel (triggers shake + sound)
  triggerLoadShake(vesselId: string): void {
    this.shakeState.set(vesselId, { intensity: 0.018, elapsed: 0 })
  }

  private createVesselMesh(vessel: VesselVisit): THREE.Group {
    const group = new THREE.Group()
    // Rotate 180° so bow faces the correct world direction (same for both GLB and procedural)
    group.rotation.y = Math.PI

    const cached = getModelSync(VESSEL_GLB_URL)
    if (cached) {
      group.add(buildVesselGLBHull(cached, vessel.loa))
      group.userData['isGlb'] = true
    } else {
      // Procedural fallback while GLB is loading
      const L = vessel.loa
      const W = vessel.beam
      const H = 5  // deck height reference
      const mats = getMaterials()
      buildHull(group, L, W, H, mats)
      buildDeck(group, L, W, mats)
      buildSuperstructure(group, L, W, H, mats)
      buildDeckFittings(group, L, W, mats)
    }

    return group
  }

  update(vessels: VesselVisit[], containers?: Container[], dt?: number, indexes?: RenderEntityIndexes): void {
    const dtVal = dt ?? 0.016

    for (const vessel of vessels) {
      if (vessel.state === 'departed' && vessel.position.x < -80) {
        const mesh = this.meshes.get(vessel.id)
        if (mesh) {
          this.disposeDeckContainers(vessel.id)
          this.scene.remove(mesh)
          mesh.traverse(obj => {
            const m = obj as THREE.Mesh
            if (m.geometry) m.geometry.dispose()
          })
          this.meshes.delete(vessel.id)
          this.shakeState.delete(vessel.id)
        }
        continue
      }

      if (vessel.state === 'announced') continue

      let mesh = this.meshes.get(vessel.id)
      if (!mesh) {
        mesh = this.createVesselMesh(vessel)
        mesh.name = vessel.id
        this.scene.add(mesh)
        this.meshes.set(vessel.id, mesh)
        this.deckContainers.set(vessel.id, new Map())

        // Schedule async GLB swap if procedural was used (GLB not yet cached)
        if (!mesh.userData['isGlb']) {
          const vesselId = vessel.id
          const vesselLoa = vessel.loa
          loadModel(VESSEL_GLB_URL).then(glbRoot => {
            const existingMesh = this.meshes.get(vesselId)
            if (!existingMesh) return // vessel already departed

            // Remove and dispose procedural hull children, preserve deck containers
            const hullChildren = [...existingMesh.children].filter(c => !c.name.startsWith('deck-container-'))
            hullChildren.forEach(c => {
              existingMesh.remove(c)
              c.traverse(obj => {
                const m = obj as THREE.Mesh
                if (m.geometry) m.geometry.dispose()
                if (m.material) {
                  if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose())
                  else m.material.dispose()
                }
              })
            })

            // Add GLB hull
            existingMesh.add(buildVesselGLBHull(glbRoot, vesselLoa))
            existingMesh.userData['isGlb'] = true
          }).catch(e => console.warn('Box Empire: vessel GLB swap failed', e))
        }
      }

      // Update vessel position
      mesh.position.set(vessel.position.x, vessel.position.y, vessel.position.z)

      // Shake animation
      const shake = this.shakeState.get(vessel.id)
      if (shake) {
        shake.elapsed += dtVal
        const decay = Math.max(0, 1 - shake.elapsed / 0.7)
        mesh.rotation.z = Math.sin(shake.elapsed * 30) * shake.intensity * decay
        mesh.rotation.x = Math.cos(shake.elapsed * 22) * shake.intensity * 0.5 * decay
        if (decay <= 0) {
          mesh.rotation.z = 0
          mesh.rotation.x = 0
          this.shakeState.delete(vessel.id)
        }
      }

      // Update containers on deck
      if (containers) {
        this.updateDeckContainers(vessel, mesh, containers, indexes)
      }
    }
  }

  private updateDeckContainers(
    vessel: VesselVisit,
    vesselMesh: THREE.Group,
    containers: Container[],
    indexes?: RenderEntityIndexes,
  ): void {
    const deckMap = this.deckContainers.get(vessel.id)
    if (!deckMap) return

    // Find containers loaded on this vessel
    const candidateContainers = indexes?.containersByVesselId.get(vessel.id) ?? containers
    const loadedOnVessel = candidateContainers.filter(
      c => (c.lifecycleState === 'loaded_on_vessel' || c.lifecycleState === 'on_vessel') && c.vesselSlot?.vesselId === vessel.id,
    )

    const loadedIds = new Set(loadedOnVessel.map(c => c.id))

    // Remove deck groups for containers no longer on this vessel
    for (const [cid, cg] of deckMap) {
      if (!loadedIds.has(cid)) {
        vesselMesh.remove(cg)
        this.disposeDeckContainerGroup(cg)
        deckMap.delete(cid)
      }
    }

    // Add or keep deck groups for loaded containers
    for (const container of loadedOnVessel) {
      if (!deckMap.has(container.id)) {
        const cg = makeDeckContainer(container)
        const bay = container.vesselSlot?.bay ?? 1
        const row = container.vesselSlot?.row ?? 1
        const tier = container.vesselSlot?.tier ?? 1

        // Vessel group has rotation.y = pi, so local X/Z are inverted from world offsets.
        const bayOffset = TUTORIAL_VESSEL.bayXOffsets[bay - 1] ?? 0
        const rowOffset = TUTORIAL_VESSEL.rowZOffsets[row - 1] ?? 0
        const tierOffset = (tier - 1) * (CONTAINER_HEIGHT + CONTAINER_STACK_GAP_Y)
        const posX = -bayOffset
        const posY = CONTAINER_DECK_Y + tierOffset + CONTAINER_HEIGHT / 2
        const posZ = -rowOffset

        cg.position.set(posX, posY, posZ)
        cg.rotation.y = 0
        vesselMesh.add(cg)
        deckMap.set(container.id, cg)
      }
    }
  }

  private disposeDeckContainers(vesselId: string): void {
    const deckMap = this.deckContainers.get(vesselId)
    if (!deckMap) return
    for (const cg of deckMap.values()) {
      this.disposeDeckContainerGroup(cg)
    }
    deckMap.clear()
    this.deckContainers.delete(vesselId)
  }

  private disposeDeckContainerGroup(cg: THREE.Group): void {
    cg.traverse(obj => {
      const m = obj as THREE.Mesh
      if (!m.geometry) return
      const bodyMats = m.userData['bodyMaterials'] as THREE.MeshStandardMaterial[] | undefined
      if (bodyMats) disposeContainerMaterials(bodyMats)
      else if (m.material) {
        const mat = m.material
        if (Array.isArray(mat)) mat.forEach(x => x.dispose())
        else mat.dispose()
      }
      m.geometry.dispose()
    })
  }

  dispose(): void {
    for (const vid of this.meshes.keys()) {
      this.disposeDeckContainers(vid)
    }
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
    this.deckContainers.clear()
    this.shakeState.clear()
  }
}

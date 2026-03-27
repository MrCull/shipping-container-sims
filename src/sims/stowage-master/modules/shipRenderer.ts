import * as THREE from 'three'
import type { ShipPreset } from '../types'

// Shared materials (created once, reused)
let hullMat: THREE.MeshPhongMaterial | null = null
let antifoulingMat: THREE.MeshPhongMaterial | null = null
let deckMat: THREE.MeshPhongMaterial | null = null
let superstructureMat: THREE.MeshPhongMaterial | null = null
let glassMat: THREE.MeshPhongMaterial | null = null
let metalMat: THREE.MeshPhongMaterial | null = null

function getSharedMaterials() {
  if (!hullMat) {
    hullMat = new THREE.MeshPhongMaterial({
      color: 0x1a2535,
      specular: 0x334455,
      shininess: 40,
      flatShading: false,
    })
    antifoulingMat = new THREE.MeshPhongMaterial({
      color: 0x8b1a1a,
      specular: 0x441111,
      shininess: 20,
    })
    deckMat = new THREE.MeshPhongMaterial({
      color: 0x4a3c28,
      specular: 0x221a10,
      shininess: 10,
      flatShading: false,
    })
    superstructureMat = new THREE.MeshPhongMaterial({
      color: 0xf0f0e8,
      specular: 0x888880,
      shininess: 55,
    })
    glassMat = new THREE.MeshPhongMaterial({
      color: 0x4488bb,
      emissive: 0x224466,
      emissiveIntensity: 0.5,
      specular: 0xaaccee,
      shininess: 180,
      transparent: true,
      opacity: 0.85,
    })
    metalMat = new THREE.MeshPhongMaterial({
      color: 0x5a5a5a,
      specular: 0x888888,
      shininess: 80,
    })
  }
  return { hullMat: hullMat!, antifoulingMat: antifoulingMat!, deckMat: deckMat!, superstructureMat: superstructureMat!, glassMat: glassMat!, metalMat: metalMat! }
}

export function createShip(scene: THREE.Scene, shipConfig: ShipPreset): THREE.Group {
  const { hullMat, antifoulingMat, deckMat, superstructureMat, glassMat, metalMat } = getSharedMaterials()

  const group = new THREE.Group()
  group.name = 'ship'

  const { length, width, height } = shipConfig

  // ── Hull body ──────────────────────────────────────────────────────────────
  // Use tapered box segments to create a proper ship hull profile
  buildHull(group, length, width, height, hullMat, antifoulingMat)

  // ── Deck ───────────────────────────────────────────────────────────────────
  const deckGeo = new THREE.BoxGeometry(length * 0.92, 0.35, width * 0.88)
  const deck = new THREE.Mesh(deckGeo, deckMat)
  deck.position.y = height * 0.28
  deck.receiveShadow = true
  deck.castShadow = true
  group.add(deck)

  // Deck hatch covers (cargo hatches between bays)
  addHatchCovers(group, length, width, height, metalMat)

  // ── Superstructure (accommodation block) at stern ─────────────────────────
  addSuperstructure(group, length, width, height, superstructureMat, glassMat, metalMat)

  // ── Deck fittings ──────────────────────────────────────────────────────────
  addDeckFittings(group, length, width, height, metalMat)

  scene.add(group)
  return group
}

function buildHull(
  group: THREE.Group,
  length: number,
  width: number,
  height: number,
  hullMat: THREE.MeshPhongMaterial,
  antifoulingMat: THREE.MeshPhongMaterial
): void {
  const hullDepth = height * 1.6
  const bowLen = length * 0.18

  // Main hull body — centre section
  const midLen = length * 0.64
  const midGeo = new THREE.BoxGeometry(midLen, hullDepth, width)
  const mid = new THREE.Mesh(midGeo, hullMat)
  mid.position.set(-length * 0.1, -hullDepth * 0.5 + height * 0.28, 0)
  mid.castShadow = true
  mid.receiveShadow = true
  group.add(mid)

  // Bow section — tapered
  const bowShape = new THREE.Shape()
  bowShape.moveTo(0, -width / 2)
  bowShape.lineTo(bowLen, 0)
  bowShape.lineTo(0, width / 2)
  bowShape.lineTo(-midLen * 0.5, width / 2)
  bowShape.lineTo(-midLen * 0.5, -width / 2)
  bowShape.closePath()
  const bowExtrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: hullDepth,
    bevelEnabled: false,
  }
  const bowGeo = new THREE.ExtrudeGeometry(bowShape, bowExtrudeSettings)
  const bow = new THREE.Mesh(bowGeo, hullMat)
  bow.rotation.x = Math.PI / 2
  bow.rotation.z = Math.PI / 2
  bow.position.set(midLen * 0.12, height * 0.28, 0)
  bow.castShadow = true
  group.add(bow)

  // Stern section — slightly tapered
  const sternShape = new THREE.Shape()
  sternShape.moveTo(0, -width * 0.46)
  sternShape.lineTo(-length * 0.08, 0)
  sternShape.lineTo(0, width * 0.46)
  sternShape.lineTo(midLen * 0.5, width / 2)
  sternShape.lineTo(midLen * 0.5, -width / 2)
  sternShape.closePath()
  const sternExtrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: hullDepth,
    bevelEnabled: false,
  }
  const sternGeo = new THREE.ExtrudeGeometry(sternShape, sternExtrudeSettings)
  const stern = new THREE.Mesh(sternGeo, hullMat)
  stern.rotation.x = Math.PI / 2
  stern.rotation.z = -Math.PI / 2
  stern.position.set(-midLen * 0.72, height * 0.28, 0)
  stern.castShadow = true
  group.add(stern)

  // Red anti-fouling band
  const afGeo = new THREE.BoxGeometry(length * 0.96, hullDepth * 0.28, width * 0.96)
  const af = new THREE.Mesh(afGeo, antifoulingMat)
  af.position.set(-length * 0.1, -hullDepth * 0.5 + height * 0.28 - hullDepth * 0.64, 0)
  af.castShadow = true
  group.add(af)

  // White waterline stripe
  const wlGeo = new THREE.BoxGeometry(length * 0.97, 0.3, width * 0.97)
  const wlMat = new THREE.MeshPhongMaterial({ color: 0xffffff })
  const wl = new THREE.Mesh(wlGeo, wlMat)
  wl.position.set(-length * 0.1, -hullDepth * 0.5 + height * 0.28 - hullDepth * 0.36, 0)
  group.add(wl)
}

function addHatchCovers(
  group: THREE.Group,
  length: number,
  width: number,
  height: number,
  metalMat: THREE.MeshPhongMaterial
): void {
  const containerAreaLength = length * 0.62
  const hatchCount = Math.round(length / 14)
  const hatchLen = containerAreaLength / hatchCount - 0.8
  const hatchMat = new THREE.MeshPhongMaterial({
    color: 0x566470,
    specular: 0x223344,
    shininess: 25,
  })

  for (let i = 0; i < hatchCount; i++) {
    const hatchGeo = new THREE.BoxGeometry(hatchLen, 0.25, width * 0.72)
    const hatch = new THREE.Mesh(hatchGeo, hatchMat)
    const x = (i - (hatchCount - 1) / 2) * (hatchLen + 0.8)
    hatch.position.set(x + length * 0.02, height * 0.3 + 0.12, 0)
    hatch.receiveShadow = true
    hatch.castShadow = true
    group.add(hatch)

    // Hatch coaming
    const coamGeo = new THREE.BoxGeometry(hatchLen + 0.3, 0.35, width * 0.72 + 0.3)
    const coam = new THREE.Mesh(coamGeo, metalMat)
    coam.position.set(x + length * 0.02, height * 0.3 - 0.1, 0)
    group.add(coam)
  }
}

function addSuperstructure(
  group: THREE.Group,
  length: number,
  width: number,
  height: number,
  superstructureMat: THREE.MeshPhongMaterial,
  glassMat: THREE.MeshPhongMaterial,
  metalMat: THREE.MeshPhongMaterial
): void {
  const sternX = -length * 0.38
  const deckY = height * 0.28

  // Deckhouse — stack of 3 levels
  const floors = [
    { w: width * 0.48, l: length * 0.14, h: height * 1.1, yOff: 0 },
    { w: width * 0.44, l: length * 0.12, h: height * 0.9, yOff: height * 1.1 },
    { w: width * 0.40, l: length * 0.10, h: height * 0.75, yOff: height * 1.1 + height * 0.9 },
  ]

  let accH = deckY
  for (const f of floors) {
    const geo = new THREE.BoxGeometry(f.l, f.h, f.w)
    const mesh = new THREE.Mesh(geo, superstructureMat)
    mesh.position.set(sternX, accH + f.h / 2 + (floors.indexOf(f) === 0 ? 0 : 0), 0)
    mesh.castShadow = true
    group.add(mesh)
    accH += f.h

    // Window strip on each floor
    const winGeo = new THREE.BoxGeometry(f.l * 0.1, f.h * 0.32, f.w * 0.88)
    const win = new THREE.Mesh(winGeo, glassMat)
    win.position.set(sternX + f.l * 0.52, deckY + floors.slice(0, floors.indexOf(f) + 1).reduce((s, ff) => s + ff.h, 0) - f.h * 0.55, 0)
    group.add(win)
  }

  // Funnel / chimney stack
  const funnelGeo = new THREE.CylinderGeometry(0.9, 1.3, height * 2.0, 12)
  const funnelMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e, shininess: 40 })
  const funnel = new THREE.Mesh(funnelGeo, funnelMat)
  funnel.position.set(sternX, accH + height * 0.9, 0)
  funnel.castShadow = true
  group.add(funnel)

  // Funnel band (coloured livery stripe — yellow like a generic shipping line)
  const bandGeo = new THREE.CylinderGeometry(0.95, 1.35, 0.6, 12)
  const bandMat = new THREE.MeshPhongMaterial({ color: 0xddaa00, emissive: 0x664400, emissiveIntensity: 0.2 })
  const band = new THREE.Mesh(bandGeo, bandMat)
  band.position.set(sternX, accH + height * 1.0, 0)
  group.add(band)

  // Navigation mast
  const mastGeo = new THREE.CylinderGeometry(0.08, 0.12, height * 3.0, 8)
  const mast = new THREE.Mesh(mastGeo, metalMat)
  mast.position.set(sternX, accH + height * 2.5, 0)
  group.add(mast)

  // Radar dome on mast
  const radarGeo = new THREE.SphereGeometry(0.5, 10, 8)
  const radarMat = new THREE.MeshPhongMaterial({ color: 0xf5f5f5 })
  const radar = new THREE.Mesh(radarGeo, radarMat)
  radar.position.set(sternX, accH + height * 4.0, 0)
  group.add(radar)

  // Propeller shaft stern marker
  const propGeo = new THREE.CylinderGeometry(0.5, 0.8, 0.7, 12)
  const propMat = new THREE.MeshPhongMaterial({ color: 0xb8860b, shininess: 120 })
  const prop = new THREE.Mesh(propGeo, propMat)
  prop.rotation.z = Math.PI / 2
  prop.position.set(-length * 0.47, height * 0.28 - 1.5, 0)
  group.add(prop)
}

function addDeckFittings(
  group: THREE.Group,
  length: number,
  width: number,
  height: number,
  metalMat: THREE.MeshPhongMaterial
): void {
  const deckY = height * 0.28 + 0.17

  // Lashing bridge rails along the ship sides
  const railMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 50 })
  for (const sign of [-1, 1]) {
    const railGeo = new THREE.BoxGeometry(length * 0.65, 0.12, 0.12)
    const rail = new THREE.Mesh(railGeo, railMat)
    rail.position.set(length * 0.02, deckY + 1.0, sign * (width * 0.42))
    group.add(rail)

    // Stanchions (vertical supports)
    for (let i = -4; i <= 4; i++) {
      const stanchionGeo = new THREE.BoxGeometry(0.1, 1.0, 0.1)
      const stanchion = new THREE.Mesh(stanchionGeo, metalMat)
      stanchion.position.set(i * (length * 0.08), deckY + 0.5, sign * (width * 0.42))
      group.add(stanchion)
    }
  }

  // Bow anchor fairleads
  const fairleadGeo = new THREE.TorusGeometry(0.5, 0.15, 8, 12)
  const fairleadMat = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 60 })
  for (const sign of [-1, 1]) {
    const fairlead = new THREE.Mesh(fairleadGeo, fairleadMat)
    fairlead.rotation.y = Math.PI / 2
    fairlead.position.set(length * 0.44, deckY + 0.3, sign * width * 0.35)
    group.add(fairlead)
  }
}

export function updateShipTilt(shipGroup: THREE.Group | null, list: number, trim: number): void {
  if (!shipGroup) return
  // Smooth interpolated tilt for visual appeal
  const targetRotZ = (list * Math.PI) / 180
  const targetRotX = (trim * Math.PI) / 180
  shipGroup.rotation.z += (targetRotZ - shipGroup.rotation.z) * 0.08
  shipGroup.rotation.x += (targetRotX - shipGroup.rotation.x) * 0.08
}

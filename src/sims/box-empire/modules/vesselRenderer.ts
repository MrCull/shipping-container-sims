// ---------------------------------------------------------------------------
// Box Empire — Vessel mesh (inspired by stowage-master shipRenderer.ts)
// Procedural ship with tapered hull, antifouling band, hatch covers,
// accommodation block, funnel, and deck fittings.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { VesselVisit, Container } from '../types'
import { CONTAINER_LENGTH, CONTAINER_WIDTH, CONTAINER_HEIGHT, TUTORIAL_VESSEL } from './config'
import { createContainerMaterials, disposeContainerMaterials } from './containerMaterials'

// Deck-Y constant (must match getVesselSlotPosition in vesselManager)
const DECK_Y = 5.4
const CONTAINER_SPACING = CONTAINER_LENGTH + 0.5

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

function getMaterials() {
  if (!hullMat) {
    hullMat = new THREE.MeshPhongMaterial({ color: 0x1a2535, specular: 0x334455, shininess: 40, side: THREE.DoubleSide })
    antifoulMat = new THREE.MeshPhongMaterial({ color: 0x8b1a1a, specular: 0x441111, shininess: 20 })
    deckMat = new THREE.MeshPhongMaterial({ color: 0x4a3c28, specular: 0x221a10, shininess: 10 })
    superMat = new THREE.MeshPhongMaterial({ color: 0xf0f0e8, specular: 0x888880, shininess: 55 })
    glassMat = new THREE.MeshPhongMaterial({ color: 0x4488bb, emissive: 0x224466, emissiveIntensity: 0.5, specular: 0xaaccee, shininess: 180, transparent: true, opacity: 0.82 })
    metalMat = new THREE.MeshPhongMaterial({ color: 0x5a5a5a, specular: 0x888888, shininess: 80 })
  }
  return { hullMat: hullMat!, antifoulMat: antifoulMat!, deckMat: deckMat!, superMat: superMat!, glassMat: glassMat!, metalMat: metalMat! }
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
  const deckY = H * 0.3
  const midLen = L * 0.62
  const bowLen = L * 0.20
  const sternLen = L * 0.10

  // Main hull body
  const mid = new THREE.Mesh(new THREE.BoxGeometry(midLen, depth, W), hullMat)
  mid.position.set(-L * 0.09, -depth * 0.5 + deckY, 0)
  mid.castShadow = true; mid.receiveShadow = true
  group.add(mid)

  // Bow — tapered prism pointing in +X direction (bow faces +X on our rotated vessel)
  const bow = makeTaperedPrism(bowLen, depth, W, 0.6, 0, hullMat)
  bow.position.set(-L * 0.09 + midLen / 2 + bowLen / 2, -depth * 0.5 + deckY, 0)
  group.add(bow)

  // Stern
  const stern = makeTaperedPrism(sternLen, depth, W, W * 0.72, 0, hullMat)
  stern.position.set(-L * 0.09 - midLen / 2 - sternLen / 2, -depth * 0.5 + deckY, 0)
  group.add(stern)

  // Anti-fouling red band
  const af = new THREE.Mesh(new THREE.BoxGeometry(L * 0.95, depth * 0.30, W * 0.97), antifoulMat)
  af.position.set(-L * 0.09, -depth * 0.5 + deckY - depth * 0.62, 0)
  group.add(af)

  // White waterline stripe
  const wl = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.28, W * 0.97), new THREE.MeshPhongMaterial({ color: 0xffffff }))
  wl.position.set(-L * 0.09, -depth * 0.5 + deckY - depth * 0.35, 0)
  group.add(wl)
}

function buildDeck(group: THREE.Group, L: number, W: number, H: number, mats: ReturnType<typeof getMaterials>): void {
  const { deckMat, metalMat } = mats
  const deckY = H * 0.3

  const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.90, 0.32, W * 0.87), deckMat)
  deck.position.y = deckY
  deck.castShadow = true; deck.receiveShadow = true
  group.add(deck)

  // Hatch covers
  const numHatches = 5
  const hatchAreaL = L * 0.58
  const hatchLen = hatchAreaL / numHatches - 0.8
  const hatchMat = new THREE.MeshPhongMaterial({ color: 0x566470, specular: 0x223344, shininess: 22 })
  for (let i = 0; i < numHatches; i++) {
    const hx = (i - (numHatches - 1) / 2) * (hatchLen + 0.8)
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(hatchLen, 0.22, W * 0.70), hatchMat)
    hatch.position.set(hx + L * 0.02, deckY + 0.27, 0)
    hatch.castShadow = true
    group.add(hatch)
    const coam = new THREE.Mesh(new THREE.BoxGeometry(hatchLen + 0.25, 0.30, W * 0.70 + 0.25), metalMat)
    coam.position.set(hx + L * 0.02, deckY + 0.10, 0)
    group.add(coam)
  }
}

function buildSuperstructure(group: THREE.Group, L: number, W: number, H: number, mats: ReturnType<typeof getMaterials>): void {
  const { superMat, glassMat, metalMat } = mats
  const deckY = H * 0.3
  // Stern is at -X end
  const sternX = -L * 0.38

  const floors = [
    { w: W * 0.50, l: L * 0.13, h: H * 1.2 },
    { w: W * 0.44, l: L * 0.11, h: H * 0.95 },
    { w: W * 0.38, l: L * 0.09, h: H * 0.80 },
  ]
  let accY = deckY
  for (const f of floors) {
    const geo = new THREE.BoxGeometry(f.l, f.h, f.w)
    const m = new THREE.Mesh(geo, superMat)
    m.position.set(sternX, accY + f.h / 2, 0)
    m.castShadow = true
    group.add(m)
    // Window strip
    const win = new THREE.Mesh(new THREE.BoxGeometry(f.l * 0.09, f.h * 0.30, f.w * 0.88), glassMat)
    win.position.set(sternX + f.l * 0.54, accY + f.h * 0.62, 0)
    group.add(win)
    accY += f.h
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

  // Mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, H * 3.2, 8), metalMat)
  mast.position.set(sternX, accY + H * 2.6, 0)
  group.add(mast)

  // Radar
  const radar = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), new THREE.MeshPhongMaterial({ color: 0xf2f2f2 }))
  radar.position.set(sternX, accY + H * 4.2, 0)
  group.add(radar)

  // Propeller
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.75, 0.65, 12), new THREE.MeshPhongMaterial({ color: 0xb8860b, shininess: 120 }))
  prop.rotation.z = Math.PI / 2
  prop.position.set(-L * 0.47, deckY - 1.6, 0)
  group.add(prop)
}

function buildDeckFittings(group: THREE.Group, L: number, W: number, H: number, mats: ReturnType<typeof getMaterials>): void {
  const { metalMat } = mats
  const deckY = H * 0.3 + 0.17
  const railMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 48 })

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

  // Bow anchor fairleads
  const fairMat = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 60 })
  for (const sign of [-1, 1]) {
    const fair = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.14, 8, 12), fairMat)
    fair.rotation.y = Math.PI / 2
    fair.position.set(L * 0.43, deckY + 0.28, sign * W * 0.34)
    group.add(fair)
  }
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
    this.shakeState.set(vesselId, { intensity: 0.06, elapsed: 0 })
  }

  private createVesselMesh(vessel: VesselVisit): THREE.Group {
    const group = new THREE.Group()
    const L = vessel.loa
    const W = vessel.beam
    const H = 5  // deck height reference

    const mats = getMaterials()
    buildHull(group, L, W, H, mats)
    buildDeck(group, L, W, H, mats)
    buildSuperstructure(group, L, W, H, mats)
    buildDeckFittings(group, L, W, H, mats)

    // Rotate 180° so bow (+X) faces the direction of approach (-X travel)
    group.rotation.y = Math.PI
    return group
  }

  update(vessels: VesselVisit[], containers?: Container[], dt?: number): void {
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
      }

      // Update vessel position
      mesh.position.set(vessel.position.x, vessel.position.y, vessel.position.z)

      // Shake animation
      const shake = this.shakeState.get(vessel.id)
      if (shake) {
        shake.elapsed += dtVal
        const decay = Math.max(0, 1 - shake.elapsed / 1.5)
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
        this.updateDeckContainers(vessel, mesh, containers)
      }
    }
  }

  private updateDeckContainers(
    vessel: VesselVisit,
    vesselMesh: THREE.Group,
    containers: Container[],
  ): void {
    const deckMap = this.deckContainers.get(vessel.id)
    if (!deckMap) return

    // Find containers loaded on this vessel
    const loadedOnVessel = containers.filter(
      c => c.lifecycleState === 'loaded_on_vessel' && c.vesselSlot?.vesselId === vessel.id,
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
    const totalSpan = (TUTORIAL_VESSEL.bays - 1) * CONTAINER_SPACING
    for (const container of loadedOnVessel) {
      if (!deckMap.has(container.id)) {
        const cg = makeDeckContainer(container)
        // Position: bay determines X offset (vessel is rotated 180° so bay1 is at +X in vessel space)
        const bay = container.vesselSlot?.bay ?? 1
        const bayOffset = (bay - 1) * CONTAINER_SPACING - totalSpan / 2
        // In vessel local space (before rotation.y = PI): bay1 at +halfSpan, bay5 at -halfSpan
        cg.position.set(-bayOffset, DECK_Y + CONTAINER_HEIGHT / 2, 0)
        // Container length along vessel X axis
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

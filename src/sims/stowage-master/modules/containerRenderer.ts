import * as THREE from 'three'
import type { Container, Slot, ShipPreset } from '../types'
import { CONTAINER } from './config'

// Visual length of a 20ft container (x-axis = along ship/bay direction)
const VISUAL_Z = 5.9

// Shipping line liveries keyed by port
interface ShippingLine {
  bodyColor: number
  accentColor: number
  roofColor: number
}

const SHIPPING_LINES: Record<string, ShippingLine> = {
  Rotterdam: { bodyColor: 0x1c4fa0, accentColor: 0xffffff, roofColor: 0x163880 }, // Maersk blue
  Singapore: { bodyColor: 0x1a7a35, accentColor: 0xffffff, roofColor: 0x145a28 }, // Evergreen green
  Shanghai:  { bodyColor: 0xcc1c1c, accentColor: 0xffffff, roofColor: 0xaa1010 }, // COSCO red
  Hamburg:   { bodyColor: 0xdd7200, accentColor: 0x002266, roofColor: 0xbb5800 }, // Hapag-Lloyd orange
  Busan:     { bodyColor: 0x3f22aa, accentColor: 0xffffff, roofColor: 0x2e1880 }, // HMM purple
}

// Merge several BufferGeometries into one (position + normal only)
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0
  for (const g of geos) totalVerts += g.attributes.position.count
  const positions = new Float32Array(totalVerts * 3)
  const normals   = new Float32Array(totalVerts * 3)
  const indexArrays: number[][] = []
  let vOffset = 0
  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute
    const nor = g.attributes.normal as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      positions[(vOffset + i) * 3    ] = pos.getX(i)
      positions[(vOffset + i) * 3 + 1] = pos.getY(i)
      positions[(vOffset + i) * 3 + 2] = pos.getZ(i)
      if (nor) {
        normals[(vOffset + i) * 3    ] = nor.getX(i)
        normals[(vOffset + i) * 3 + 1] = nor.getY(i)
        normals[(vOffset + i) * 3 + 2] = nor.getZ(i)
      }
    }
    const localIdx: number[] = []
    if (g.index) {
      const idx = g.index.array
      for (let i = 0; i < idx.length; i++) localIdx.push(idx[i] + vOffset)
    } else {
      for (let i = 0; i < pos.count; i++) localIdx.push(vOffset + i)
    }
    indexArrays.push(localIdx)
    vOffset += pos.count
  }
  const totalIdx = indexArrays.reduce((s, a) => s + a.length, 0)
  const indices = new Uint32Array(totalIdx)
  let iOff = 0
  for (const arr of indexArrays) for (const v of arr) indices[iOff++] = v
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal',   new THREE.BufferAttribute(normals, 3))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  merged.computeVertexNormals()
  return merged
}

// Build the main corrugated container geometry (body + ribs + frame + corner castings + door end)
function buildContainerBody(L: number, H: number, W: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []

  // Main box
  geos.push(new THREE.BoxGeometry(L, H, W))

  // Corrugation ribs on long sides
  const ribCount = 11
  const ribW = 0.06
  for (let i = 0; i < ribCount; i++) {
    const xPos = -L / 2 + (L / (ribCount + 1)) * (i + 1)
    for (const side of [-1, 1]) {
      const rib = new THREE.BoxGeometry(ribW, H * 0.96, W + 0.01)
      const m = new THREE.Matrix4().makeTranslation(xPos, 0, side * (W / 2 + ribW / 2 - 0.01))
      rib.applyMatrix4(m)
      geos.push(rib)
    }
  }

  // Top & bottom corner rails along length
  const railH = 0.07
  const railD = 0.07
  for (const ySide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const rail = new THREE.BoxGeometry(L + 0.02, railH, railD)
      const m = new THREE.Matrix4().makeTranslation(0, ySide * (H / 2 + railH / 2), zSide * (W / 2 - railD / 2))
      rail.applyMatrix4(m)
      geos.push(rail)
    }
  }

  // Vertical corner posts
  const postS = 0.09
  for (const xSide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const post = new THREE.BoxGeometry(postS, H + 0.12, postS)
      const m = new THREE.Matrix4().makeTranslation(xSide * (L / 2 - postS / 2), 0, zSide * (W / 2 - postS / 2))
      post.applyMatrix4(m)
      geos.push(post)
    }
  }

  // Door-end panel (one short face, slightly raised)
  const doorH = H * 0.92
  const doorW = W * 0.88
  const doorGeo = new THREE.BoxGeometry(0.05, doorH, doorW)
  const doorM = new THREE.Matrix4().makeTranslation(-(L / 2 + 0.025), 0, 0)
  doorGeo.applyMatrix4(doorM)
  geos.push(doorGeo)

  const merged = mergeGeos(geos)
  for (const g of geos) g.dispose()
  return merged
}

export function createContainerMesh(container: Container): THREE.Group {
  const L = VISUAL_Z           // length along ship x-axis
  const H = CONTAINER.size.y   // height
  const W = CONTAINER.size.x   // width across beam z-axis

  const group = new THREE.Group()
  group.name = `container-${container.id}`

  const line = SHIPPING_LINES[container.port]
  const bodyHex = line ? line.bodyColor : container.portColor
  const roofHex = line ? line.roofColor : new THREE.Color(bodyHex).lerp(new THREE.Color(0x000000), 0.15).getHex()

  // --- Body (PBR MeshStandardMaterial like Box Empire) ---
  const bodyColor = new THREE.Color(bodyHex)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.58,
    metalness: 0.30,
  })

  const bodyGeo = buildContainerBody(L, H, W)
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
  bodyMesh.castShadow = true
  bodyMesh.receiveShadow = true
  group.add(bodyMesh)

  // --- Roof panel (slightly darker) ---
  const roofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(roofHex),
    roughness: 0.65,
    metalness: 0.20,
  })
  const roofGeo = new THREE.BoxGeometry(L * 0.98, 0.06, W * 0.96)
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.position.y = H / 2 + 0.03
  roof.castShadow = true
  group.add(roof)

  // --- Accent stripe (white or dark) on long sides ---
  if (line) {
    const stripeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(line.accentColor),
      roughness: 0.5,
      metalness: 0.1,
      emissive: new THREE.Color(line.accentColor),
      emissiveIntensity: 0.06,
    })
    for (const sign of [-1, 1]) {
      const stripeGeo = new THREE.BoxGeometry(L * 0.72, H * 0.09, 0.06)
      const stripe = new THREE.Mesh(stripeGeo, stripeMat)
      stripe.position.set(L * 0.03, H * 0.30, sign * (W / 2 + 0.04))
      group.add(stripe)
    }

    // Door-end accent band
    const endBandGeo = new THREE.BoxGeometry(0.06, H * 0.09, W * 0.7)
    const endBand = new THREE.Mesh(endBandGeo, stripeMat)
    endBand.position.set(-(L / 2 + 0.04), H * 0.30, 0)
    group.add(endBand)
  }

  // --- Corner castings (8 corners, grey metal) ---
  const castMat = new THREE.MeshStandardMaterial({ color: 0x606060, roughness: 0.4, metalness: 0.6 })
  const castGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24)
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(castGeo, castMat)
        c.position.set(sx * L / 2, sy * H / 2, sz * W / 2)
        group.add(c)
      }
    }
  }

  // --- Door hinges on short end ---
  const hingeMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 })
  const hingeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.28, 8)
  for (const hz of [-W * 0.44, W * 0.44]) {
    for (const hy of [-H * 0.35, 0, H * 0.35]) {
      const hinge = new THREE.Mesh(hingeGeo, hingeMat)
      hinge.rotation.z = Math.PI / 2
      hinge.position.set(-L / 2 - 0.02, hy, hz)
      group.add(hinge)
    }
  }

  // --- ID plate (white panel on one long side) ---
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6, metalness: 0.0 })
  const plateGeo = new THREE.BoxGeometry(L * 0.36, H * 0.14, 0.05)
  const plate = new THREE.Mesh(plateGeo, plateMat)
  plate.position.set(L * 0.14, H * 0.29, W / 2 + 0.04)
  group.add(plate)

  // Text-like bars on plate
  const textMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.0 })
  for (let i = 0; i < 3; i++) {
    const barGeo = new THREE.BoxGeometry(L * 0.26, H * 0.022, 0.055)
    const bar = new THREE.Mesh(barGeo, textMat)
    bar.position.set(L * 0.14, H * 0.31 - i * H * 0.042, W / 2 + 0.05)
    group.add(bar)
  }

  // --- Hazmat markings ONLY if hazardous ---
  if (container.isHazmat) {
    addHazmatMarkings(group, L, H, W)
  }

  group.userData['container'] = container
  group.userData['isContainer'] = true

  return group
}

function addHazmatMarkings(group: THREE.Group, L: number, H: number, W: number): void {
  // Orange hazmat band
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    roughness: 0.5,
    metalness: 0.1,
    emissive: new THREE.Color(0xff4400),
    emissiveIntensity: 0.3,
  })
  const bandGeo = new THREE.BoxGeometry(L + 0.04, H * 0.13, W + 0.04)
  const band = new THREE.Mesh(bandGeo, bandMat)
  band.position.y = H * 0.22
  group.add(band)

  // Diamond placard on each face (only visible sides)
  const diamondMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    roughness: 0.4,
    metalness: 0.1,
    emissive: new THREE.Color(0xff4400),
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  })
  const dSize = Math.min(L, W) * 0.30
  const diamondGeo = new THREE.PlaneGeometry(dSize, dSize)

  const faces: [THREE.Vector3, THREE.Euler][] = [
    [new THREE.Vector3(0,      H * 0.22, W / 2 + 0.05), new THREE.Euler(0, 0,            Math.PI / 4)],
    [new THREE.Vector3(0,      H * 0.22, -W / 2 - 0.05), new THREE.Euler(0, Math.PI,      Math.PI / 4)],
    [new THREE.Vector3(L / 2 + 0.05, H * 0.22, 0),      new THREE.Euler(0, Math.PI / 2,  Math.PI / 4)],
    [new THREE.Vector3(-L / 2 - 0.05, H * 0.22, 0),     new THREE.Euler(0, -Math.PI / 2, Math.PI / 4)],
  ]
  for (const [pos, rot] of faces) {
    const d = new THREE.Mesh(diamondGeo, diamondMat)
    d.position.copy(pos)
    d.rotation.copy(rot)
    group.add(d)
  }
}

// ── Slot indicators ──────────────────────────────────────────────────────────

export function createSlotIndicators(
  _scene: THREE.Scene,
  slots: Record<string, Slot>,
  availableIds: string[],
  shipConfig: ShipPreset,
  shipGroup: THREE.Group
): THREE.Group {
  const indicators = new THREE.Group()
  indicators.name = 'slot-indicators'

  const cw = CONTAINER.size.x
  const cl = VISUAL_Z
  const y  = CONTAINER.size.y

  const boxGeo  = new THREE.BoxGeometry(cl * 0.96, y * 0.96, cw * 0.96)
  const wireGeo = new THREE.EdgesGeometry(boxGeo)
  boxGeo.dispose()

  const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.85 })
  const fillGeo = new THREE.BoxGeometry(cl * 0.93, y * 0.93, cw * 0.93)
  const fillMat = new THREE.MeshPhongMaterial({
    color: 0x00ff88,
    emissive: 0x00cc66,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  })

  for (const slotId of availableIds) {
    const slot = slots[slotId]
    if (!slot) continue

    const pos = new THREE.Vector3(
      slot.xOffset,
      slot.yOffset + shipConfig.height * 0.3 + CONTAINER.size.y / 2,
      slot.zOffset
    )

    const wire = new THREE.LineSegments(wireGeo, wireMat.clone())
    wire.position.copy(pos)
    wire.userData['slotId'] = slotId
    wire.userData['isSlotIndicator'] = true
    wire.name = `slot-${slotId}`
    indicators.add(wire)

    const fill = new THREE.Mesh(fillGeo.clone(), fillMat.clone())
    fill.position.copy(pos)
    fill.userData['slotId'] = slotId
    fill.userData['isSlotIndicator'] = true
    fill.name = `slot-fill-${slotId}`
    indicators.add(fill)
  }

  shipGroup.add(indicators)
  return indicators
}

export function removeSlotIndicators(shipGroup: THREE.Group): void {
  const indicators = shipGroup.getObjectByName('slot-indicators')
  if (indicators) {
    indicators.traverse(child => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else mesh.material.dispose()
      }
    })
    shipGroup.remove(indicators)
  }
}

export function animateSlotIndicators(shipGroup: THREE.Group, time: number): void {
  const indicators = shipGroup.getObjectByName('slot-indicators')
  if (!indicators) return

  const pulse = 0.08 + Math.abs(Math.sin(time * 2.5)) * 0.08
  indicators.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.userData['isSlotIndicator'] && mesh.material) {
      const mat = mesh.material as THREE.MeshPhongMaterial
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = pulse
      if (mat.opacity !== undefined && mat.transparent) {
        mat.opacity = 0.08 + Math.abs(Math.sin(time * 2.5)) * 0.10
      }
    }
    const line = child as THREE.LineSegments
    if (line.material instanceof THREE.LineBasicMaterial) {
      line.material.opacity = 0.6 + Math.abs(Math.sin(time * 2.5)) * 0.35
    }
  })
}

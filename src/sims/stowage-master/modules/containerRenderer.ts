import * as THREE from 'three'
import type { Container, Slot, ShipPreset } from '../types'
import { CONTAINER } from './config'

// Container proportions: proper ISO 20ft proportions (roughly 2.4 wide × 2.6 tall × 6 long)
// VISUAL_Z is the visual length — slot offsets use CONTAINER.size.z from config
const VISUAL_Z = 5.9  // visual length (like a real 20ft container)

// Container colors for realistic shipping lines
const SHIPPING_LINE_COLORS: Record<string, number> = {
  // Override port colors with more realistic container liveries
  Rotterdam: 0x2255aa,  // Maersk-ish blue
  Singapore: 0x228833,  // Evergreen-ish green
  Shanghai:  0xdd2222,  // China Shipping red
  Hamburg:   0xff8800,  // Hapag-Lloyd orange
  Busan:     0x6633aa,  // purple/indigo
}

export function createContainerMesh(container: Container): THREE.Group {
  // x = length along ship (bay direction), z = width across beam (row direction)
  const x = VISUAL_Z
  const y = CONTAINER.size.y
  const z = CONTAINER.size.x

  const group = new THREE.Group()
  group.name = `container-${container.id}`

  const baseColor = SHIPPING_LINE_COLORS[container.port] ?? container.portColor

  const bodyColor = baseColor
  const bodyMat = new THREE.MeshPhongMaterial({
    color: bodyColor,
    specular: 0x334455,
    shininess: 55,
    flatShading: false,
  })

  const topColor = new THREE.Color(bodyColor).lerp(new THREE.Color(0xffffff), 0.12)
  const topMat = new THREE.MeshPhongMaterial({
    color: topColor,
    specular: 0x334455,
    shininess: 30,
  })

  const bodyGeo = new THREE.BoxGeometry(x, y, z)
  const body = new THREE.Mesh(bodyGeo, [
    bodyMat, // right (+X end)
    bodyMat, // left (-X end)
    topMat,  // top
    topMat,  // bottom
    bodyMat, // front (+Z side)
    bodyMat, // back (-Z side)
  ])
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  addSideRidges(group, x, y, z, bodyMat)

  addCornerCastings(group, x, y, z)

  // Door end detail (one end)
  addDoorEnd(group, x, y, z, bodyColor)

  // Hazmat markings
  if (container.isHazmat) {
    addHazmatMarkings(group, x, y, z)
  }

  // Container ID label (emissive white text-like rectangle)
  addContainerLabel(group, x, y, z)

  group.userData['container'] = container
  group.userData['isContainer'] = true

  return group
}

function addSideRidges(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  mat: THREE.MeshPhongMaterial
): void {
  const ridgeCount = 10
  const ridgeW = 0.05
  const ridgeH = y * 0.92
  const ridgeMat = new THREE.MeshPhongMaterial({
    color: (mat.color as THREE.Color).clone().lerp(new THREE.Color(0x000000), 0.15),
    shininess: 15,
  })
  const ridgeGeo = new THREE.BoxGeometry(ridgeW, ridgeH, 0.06)

  // Ridges on the long sides (+Z / -Z faces), distributed along X
  for (const sign of [-1, 1]) {
    for (let i = 0; i < ridgeCount; i++) {
      const ridge = new THREE.Mesh(ridgeGeo, ridgeMat)
      ridge.position.set(
        (i - (ridgeCount - 1) / 2) * (x / ridgeCount),
        0,
        sign * (z / 2 + 0.03)
      )
      group.add(ridge)
    }
  }
}

function addCornerCastings(group: THREE.Group, x: number, y: number, z: number): void {
  const castingGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22)
  const castingMat = new THREE.MeshPhongMaterial({
    color: 0x555555,
    specular: 0x999999,
    shininess: 90,
  })
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = new THREE.Mesh(castingGeo, castingMat)
        c.position.set(sx * x / 2, sy * y / 2, sz * z / 2)
        group.add(c)
      }
    }
  }
}

function addDoorEnd(group: THREE.Group, x: number, y: number, z: number, baseColor: number): void {
  // Door panels on one short end (-X face)
  const doorMat = new THREE.MeshPhongMaterial({
    color: new THREE.Color(baseColor).lerp(new THREE.Color(0x888888), 0.25),
    shininess: 30,
  })
  for (const side of [-0.25, 0.25]) {
    const doorGeo = new THREE.BoxGeometry(0.06, y * 0.96, z / 2 - 0.1)
    const door = new THREE.Mesh(doorGeo, doorMat)
    door.position.set(-x / 2 + 0.04, 0, side * z)
    group.add(door)
  }

  // Door hinges
  const hingeMat = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 80 })
  const hingeGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8)
  for (const hz of [-z * 0.46, z * 0.46]) {
    for (const hy of [-y * 0.38, 0, y * 0.38]) {
      const hinge = new THREE.Mesh(hingeGeo, hingeMat)
      hinge.position.set(-x / 2 + 0.07, hy, hz)
      hinge.rotation.z = Math.PI / 2
      group.add(hinge)
    }
  }
}

function addHazmatMarkings(group: THREE.Group, x: number, y: number, z: number): void {
  // Orange stripe
  const hazStripeMat = new THREE.MeshPhongMaterial({
    color: 0xff6600,
    emissive: 0xcc3300,
    emissiveIntensity: 0.4,
    shininess: 60,
  })
  const hazStripeGeo = new THREE.BoxGeometry(x + 0.03, y * 0.14, z + 0.03)
  const hazStripe = new THREE.Mesh(hazStripeGeo, hazStripeMat)
  hazStripe.position.y = y * 0.22
  group.add(hazStripe)

  // Diamond placards on each visible face
  addHazmatDiamond(group, x, y, z)
}

function addHazmatDiamond(group: THREE.Group, x: number, y: number, z: number): void {
  const diamondSize = Math.min(x, z) * 0.32
  const diamondGeo = new THREE.PlaneGeometry(diamondSize, diamondSize)
  const diamondMat = new THREE.MeshPhongMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.6,
    side: THREE.DoubleSide,
  })

  const faces: [THREE.Vector3, THREE.Euler][] = [
    [new THREE.Vector3(0, y * 0.22, z / 2 + 0.04), new THREE.Euler(0, 0, Math.PI / 4)],
    [new THREE.Vector3(0, y * 0.22, -z / 2 - 0.04), new THREE.Euler(0, Math.PI, Math.PI / 4)],
    [new THREE.Vector3(x / 2 + 0.04, y * 0.22, 0), new THREE.Euler(0, Math.PI / 2, Math.PI / 4)],
    [new THREE.Vector3(-x / 2 - 0.04, y * 0.22, 0), new THREE.Euler(0, -Math.PI / 2, Math.PI / 4)],
  ]

  for (const [pos, rot] of faces) {
    const d = new THREE.Mesh(diamondGeo, diamondMat)
    d.position.copy(pos)
    d.rotation.copy(rot)
    group.add(d)
  }
}

function addContainerLabel(group: THREE.Group, x: number, y: number, z: number): void {
  const labelGeo = new THREE.BoxGeometry(x * 0.38, y * 0.15, 0.04)
  const labelMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.12,
    shininess: 20,
  })
  const label = new THREE.Mesh(labelGeo, labelMat)
  label.position.set(0, y * 0.28, z / 2 + 0.03)
  group.add(label)
}

// Glowing slot indicators — wireframe outline instead of solid boxes
export function createSlotIndicators(
  _scene: THREE.Scene,
  slots: Record<string, Slot>,
  availableIds: string[],
  shipConfig: ShipPreset,
  shipGroup: THREE.Group
): THREE.Group {
  const indicators = new THREE.Group()
  indicators.name = 'slot-indicators'

  const cw = CONTAINER.size.x  // container width (across beam / Z)
  const cl = VISUAL_Z           // container length (along ship / X)
  const y = CONTAINER.size.y

  // Shared wireframe geometry — length along X, width along Z
  const boxGeo = new THREE.BoxGeometry(cl * 0.96, y * 0.96, cw * 0.96)
  const wireGeo = new THREE.EdgesGeometry(boxGeo)
  boxGeo.dispose()

  const wireMat = new THREE.LineBasicMaterial({
    color: 0x00ffaa,
    transparent: true,
    opacity: 0.85,
  })

  // Glowing fill
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

    // Wireframe outline
    const wire = new THREE.LineSegments(wireGeo, wireMat.clone())
    wire.position.copy(pos)
    wire.userData['slotId'] = slotId
    wire.userData['isSlotIndicator'] = true
    wire.name = `slot-${slotId}`
    indicators.add(wire)

    // Transparent fill for hit detection
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
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose())
        } else {
          mesh.material.dispose()
        }
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
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = pulse
      }
      if (mat.opacity !== undefined && mat.transparent) {
        mat.opacity = 0.08 + Math.abs(Math.sin(time * 2.5)) * 0.1
      }
    }
    const line = child as THREE.LineSegments
    if (line.material instanceof THREE.LineBasicMaterial) {
      line.material.opacity = 0.6 + Math.abs(Math.sin(time * 2.5)) * 0.35
    }
  })
}

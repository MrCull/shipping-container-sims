import * as THREE from 'three'
import type { Container, Slot, ShipPreset } from '../types'
import { CONTAINER } from './config'
import {
  SHIPPING_LINE_LIVERY,
  createContainerMaterials,
  disposeContainerMaterials,
} from './containerMaterials'

// Visual length of a 20ft container along the X (bay/length) axis
const VISUAL_Z = 5.9

const POST_SIZE = 0.11
const POST_COLOR = 0x2c313a

function addCornerPostsAndRails(group: THREE.Group, sx: number, sy: number, sz: number): void {
  const postMat = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.65, metalness: 0.55 })
  const postGeo = new THREE.BoxGeometry(POST_SIZE, sy * 0.97, POST_SIZE)
  const hx = sx / 2 - POST_SIZE / 2
  const hz = sz / 2 - POST_SIZE / 2
  for (const [px, pz] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]] as [number, number][]) {
    const p = new THREE.Mesh(postGeo, postMat)
    p.position.set(px, 0, pz)
    p.castShadow = true
    group.add(p)
  }

  // Top and bottom rails
  const railT = 0.06
  const railMat = new THREE.MeshStandardMaterial({ color: POST_COLOR, roughness: 0.65, metalness: 0.55 })
  const railX = new THREE.BoxGeometry(sx * 0.985, railT, POST_SIZE * 0.9)
  const railZ = new THREE.BoxGeometry(POST_SIZE * 0.9, railT, sz * 0.985)
  for (const y of [sy / 2 - railT / 2, -sy / 2 + railT / 2]) {
    for (const zSign of [-1, 1]) {
      const rx = new THREE.Mesh(railX, railMat)
      rx.position.set(0, y, zSign * (sz / 2 - POST_SIZE / 2))
      rx.castShadow = true
      group.add(rx)
    }
    for (const xSign of [-1, 1]) {
      const rz = new THREE.Mesh(railZ, railMat)
      rz.position.set(xSign * (sx / 2 - POST_SIZE / 2), y, 0)
      rz.castShadow = true
      group.add(rz)
    }
  }
}

export function createContainerMesh(container: Container): THREE.Group {
  const L = VISUAL_Z           // length along ship x-axis
  const H = CONTAINER.size.y   // height
  const W = CONTAINER.size.x   // width across beam z-axis

  const group = new THREE.Group()
  group.name = `container-${container.id}`

  const livery = SHIPPING_LINE_LIVERY[container.port]
  const colorHex = livery?.hex ?? `#${container.portColor.toString(16).padStart(6, '0')}`

  // Main body with canvas-textured faces
  const geo = new THREE.BoxGeometry(L, H, W)
  const materials = createContainerMaterials(colorHex, container.id, container.port)
  const mesh = new THREE.Mesh(geo, materials)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData['bodyMaterials'] = materials
  group.add(mesh)

  // Subtle edge lines for definition (like container-stack)
  const edges = new THREE.EdgesGeometry(geo)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x08080c, transparent: true, opacity: 0.45 })
  )
  group.add(line)

  // Corner posts + top/bottom rails
  addCornerPostsAndRails(group, L, H, W)

  // Hazmat markings ONLY if hazardous
  if (container.isHazmat) {
    addHazmatMarkings(group, L, H, W)
    group.userData['isHazmatContainer'] = true
  }

  group.userData['container'] = container
  group.userData['isContainer'] = true

  return group
}

function addHazmatMarkings(group: THREE.Group, L: number, H: number, W: number): void {
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
  band.userData['hazmatPulse'] = true
  group.add(band)

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
    [new THREE.Vector3(0,       H * 0.22,  W / 2 + 0.05), new THREE.Euler(0,  0,           Math.PI / 4)],
    [new THREE.Vector3(0,       H * 0.22, -W / 2 - 0.05), new THREE.Euler(0,  Math.PI,     Math.PI / 4)],
    [new THREE.Vector3( L / 2 + 0.05, H * 0.22, 0),       new THREE.Euler(0,  Math.PI / 2, Math.PI / 4)],
    [new THREE.Vector3(-L / 2 - 0.05, H * 0.22, 0),       new THREE.Euler(0, -Math.PI / 2, Math.PI / 4)],
  ]
  for (const [pos, rot] of faces) {
    const d = new THREE.Mesh(diamondGeo, diamondMat)
    d.position.copy(pos)
    d.rotation.copy(rot)
    d.userData['hazmatPulse'] = true
    group.add(d)
  }
}

// ── Slot indicators ──────────────────────────────────────────────────────────

export function createSlotIndicators(
  _scene: THREE.Scene,
  slots: Record<string, Slot>,
  availableIds: string[],
  shipConfig: ShipPreset,
  shipGroup: THREE.Group,
  dangerIds: string[] = []
): THREE.Group {
  const indicators = new THREE.Group()
  indicators.name = 'slot-indicators'

  const cw = CONTAINER.size.x
  const cl = VISUAL_Z
  const y  = CONTAINER.size.y

  const boxGeo  = new THREE.BoxGeometry(cl * 0.96, y * 0.96, cw * 0.96)
  const wireGeo = new THREE.EdgesGeometry(boxGeo)
  boxGeo.dispose()

  const fillGeo = new THREE.BoxGeometry(cl * 0.93, y * 0.93, cw * 0.93)

  for (const slotId of availableIds) {
    const slot = slots[slotId]
    if (!slot) continue
    const isDanger = dangerIds.includes(slotId)

    const deckY = shipConfig.deckOffsetY ?? shipConfig.height * 0.3
    const pos = new THREE.Vector3(
      slot.xOffset,
      slot.yOffset + deckY + CONTAINER.size.y / 2,
      slot.zOffset
    )

    const wire = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({
        color: isDanger ? 0xff5555 : 0x00ffaa,
        transparent: true,
        opacity: 0.85,
      })
    )
    wire.position.copy(pos)
    wire.userData['slotId'] = slotId
    wire.userData['isSlotIndicator'] = true
    wire.userData['isDangerSlot'] = isDanger
    wire.name = `slot-${slotId}`
    indicators.add(wire)

    const fill = new THREE.Mesh(
      fillGeo.clone(),
      new THREE.MeshPhongMaterial({
        color: isDanger ? 0xff4444 : 0x00ff88,
        emissive: isDanger ? 0xaa2222 : 0x00cc66,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      })
    )
    fill.position.copy(pos)
    fill.userData['slotId'] = slotId
    fill.userData['isSlotIndicator'] = true
    fill.userData['isDangerSlot'] = isDanger
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

/**
 * Place container meshes on the ship for all pre-loaded Import containers.
 * Called once during buildScene for levels with a discharge phase.
 */
/**
 * Place container meshes on the ship for all pre-loaded Import AND Transit containers.
 * Called once during buildScene for levels with a discharge phase.
 */
export function createImportContainerMeshes(
  grid: Record<string, Slot>,
  shipConfig: ShipPreset,
  shipGroup: THREE.Group
): void {
  const group = new THREE.Group()
  group.name = 'import-containers'

  for (const slot of Object.values(grid)) {
    if (!slot.container) continue
    // Render both import (local discharge) and transit (stays on board) containers
    if (!slot.container.isImport && !slot.container.isTransit) continue

    const deckY = shipConfig.deckOffsetY ?? shipConfig.height * 0.3
    const mesh = createContainerMesh(slot.container)
    mesh.position.set(
      slot.xOffset,
      slot.yOffset + deckY + CONTAINER.size.y / 2,
      slot.zOffset
    )
    mesh.name = `import-container-${slot.id}`
    group.add(mesh)
  }

  shipGroup.add(group)
}

export function removeImportContainerMeshes(shipGroup: THREE.Group): void {
  const group = shipGroup.getObjectByName('import-containers')
  if (group) {
    group.traverse(child => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose())
        else mesh.material.dispose()
      }
    })
    shipGroup.remove(group)
  }
}

/** Find and remove the mesh for a single Import container by slot ID. */
export function removeImportContainerMesh(shipGroup: THREE.Group, slotId: string): THREE.Group | null {
  const group = shipGroup.getObjectByName('import-containers')
  if (!group) return null
  const mesh = group.getObjectByName(`import-container-${slotId}`) as THREE.Group | undefined
  if (!mesh) return null
  group.remove(mesh)
  return mesh
}

/**
 * Clickable orange indicators on top of Import containers (discharge targets).
 * Uses `userData.isImportContainer = true` and `userData.slotId` for raycasting.
 */
export function createImportSlotIndicators(
  grid: Record<string, Slot>,
  dischargeableIds: string[],
  shipConfig: ShipPreset,
  shipGroup: THREE.Group
): THREE.Group {
  const indicators = new THREE.Group()
  indicators.name = 'import-slot-indicators'

  const cw = CONTAINER.size.x
  const cl = VISUAL_Z
  const y  = CONTAINER.size.y

  const boxGeo  = new THREE.BoxGeometry(cl * 0.96, y * 0.96, cw * 0.96)
  const wireGeo = new THREE.EdgesGeometry(boxGeo)
  boxGeo.dispose()

  const wireMat = new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.9 })
  const fillGeo = new THREE.BoxGeometry(cl * 0.93, y * 0.93, cw * 0.93)
  const fillMat = new THREE.MeshPhongMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  })

  for (const slotId of dischargeableIds) {
    const slot = grid[slotId]
    if (!slot) continue

    const deckY = shipConfig.deckOffsetY ?? shipConfig.height * 0.3
    const pos = new THREE.Vector3(
      slot.xOffset,
      slot.yOffset + deckY + CONTAINER.size.y / 2,
      slot.zOffset
    )

    const wire = new THREE.LineSegments(wireGeo, wireMat.clone())
    wire.position.copy(pos)
    wire.userData['slotId'] = slotId
    wire.userData['isImportContainer'] = true
    wire.name = `import-slot-${slotId}`
    indicators.add(wire)

    const fill = new THREE.Mesh(fillGeo.clone(), fillMat.clone())
    fill.position.copy(pos)
    fill.userData['slotId'] = slotId
    fill.userData['isImportContainer'] = true
    fill.name = `import-slot-fill-${slotId}`
    indicators.add(fill)
  }

  shipGroup.add(indicators)
  return indicators
}

export function removeImportSlotIndicators(shipGroup: THREE.Group): void {
  const indicators = shipGroup.getObjectByName('import-slot-indicators')
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

export function animateImportSlotIndicators(shipGroup: THREE.Group, time: number): void {
  const indicators = shipGroup.getObjectByName('import-slot-indicators')
  if (!indicators) return

  const pulse = 0.3 + Math.abs(Math.sin(time * 3.0)) * 0.3
  indicators.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.userData['isImportContainer'] && mesh.material) {
      const mat = mesh.material as THREE.MeshPhongMaterial
      const hoverBoost = mesh.userData['isHovered'] ? 0.4 : 0
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = pulse + hoverBoost
      if (mat.opacity !== undefined && mat.transparent) {
        mat.opacity = 0.10 + Math.abs(Math.sin(time * 3.0)) * 0.12 + (mesh.userData['isHovered'] ? 0.12 : 0)
      }
    }
    const line = child as THREE.LineSegments
    if (line.material instanceof THREE.LineBasicMaterial && line.userData['isImportContainer']) {
      line.material.opacity = 0.65 + Math.abs(Math.sin(time * 3.0)) * 0.35 + (line.userData['isHovered'] ? 0.2 : 0)
    }
  })
}

/**
 * Cyan indicators showing valid restow destinations for a transit container.
 */
export function createRestowSlotIndicators(
  grid: Record<string, Slot>,
  restowIds: string[],
  shipConfig: ShipPreset,
  shipGroup: THREE.Group,
  dangerIds: string[] = []
): THREE.Group {
  const indicators = new THREE.Group()
  indicators.name = 'restow-slot-indicators'

  const cw = CONTAINER.size.x
  const cl = VISUAL_Z
  const y  = CONTAINER.size.y

  const boxGeo  = new THREE.BoxGeometry(cl * 0.96, y * 0.96, cw * 0.96)
  const wireGeo = new THREE.EdgesGeometry(boxGeo)
  boxGeo.dispose()

  const fillGeo = new THREE.BoxGeometry(cl * 0.93, y * 0.93, cw * 0.93)

  for (const slotId of restowIds) {
    const slot = grid[slotId]
    if (!slot) continue
    const isDanger = dangerIds.includes(slotId)

    const deckY = shipConfig.deckOffsetY ?? shipConfig.height * 0.3
    const pos = new THREE.Vector3(
      slot.xOffset,
      slot.yOffset + deckY + CONTAINER.size.y / 2,
      slot.zOffset
    )

    const wire = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({
        color: isDanger ? 0xff5555 : 0x00ccff,
        transparent: true,
        opacity: 0.9,
      })
    )
    wire.position.copy(pos)
    wire.userData['slotId'] = slotId
    wire.userData['isRestowSlot'] = true
    wire.userData['isDangerSlot'] = isDanger
    wire.name = `restow-slot-${slotId}`
    indicators.add(wire)

    const fill = new THREE.Mesh(
      fillGeo.clone(),
      new THREE.MeshPhongMaterial({
        color: isDanger ? 0xff4444 : 0x0099ff,
        emissive: isDanger ? 0xaa2222 : 0x0066cc,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      })
    )
    fill.position.copy(pos)
    fill.userData['slotId'] = slotId
    fill.userData['isRestowSlot'] = true
    fill.userData['isDangerSlot'] = isDanger
    fill.name = `restow-slot-fill-${slotId}`
    indicators.add(fill)
  }

  shipGroup.add(indicators)
  return indicators
}

export function removeRestowSlotIndicators(shipGroup: THREE.Group): void {
  const indicators = shipGroup.getObjectByName('restow-slot-indicators')
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

export function animateRestowSlotIndicators(shipGroup: THREE.Group, time: number): void {
  const indicators = shipGroup.getObjectByName('restow-slot-indicators')
  if (!indicators) return

  indicators.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.userData['isRestowSlot'] && mesh.material) {
      const mat = mesh.material as THREE.MeshPhongMaterial
      const base = mesh.userData['isDangerSlot'] ? 0.45 : 0.3
      const range = mesh.userData['isDangerSlot'] ? 0.5 : 0.4
      const hoverBoost = mesh.userData['isHovered'] ? 0.35 : 0
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = base + Math.abs(Math.sin(time * 3.5)) * range + hoverBoost
      if (mat.opacity !== undefined && mat.transparent) {
        mat.opacity = 0.10 + Math.abs(Math.sin(time * 3.5)) * 0.12 + (mesh.userData['isHovered'] ? 0.12 : 0)
      }
    }
    const line = child as THREE.LineSegments
    if (line.material instanceof THREE.LineBasicMaterial && line.userData['isRestowSlot']) {
      line.material.opacity = 0.6 + Math.abs(Math.sin(time * 3.5)) * 0.4 + (line.userData['isHovered'] ? 0.2 : 0)
    }
  })
}

export function animateSlotIndicators(shipGroup: THREE.Group, time: number): void {
  const indicators = shipGroup.getObjectByName('slot-indicators')
  if (!indicators) return

  const pulse = 0.08 + Math.abs(Math.sin(time * 2.5)) * 0.08
  indicators.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.userData['isSlotIndicator'] && mesh.material) {
      const mat = mesh.material as THREE.MeshPhongMaterial
      const boost = mesh.userData['isDangerSlot'] ? 0.18 : 0
      const hoverBoost = mesh.userData['isHovered'] ? 0.28 : 0
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = pulse + boost + hoverBoost
      if (mat.opacity !== undefined && mat.transparent) {
        mat.opacity = 0.08 + Math.abs(Math.sin(time * 2.5)) * 0.10 + (mesh.userData['isHovered'] ? 0.12 : 0)
      }
    }
    const line = child as THREE.LineSegments
    if (line.material instanceof THREE.LineBasicMaterial) {
      line.material.opacity = 0.6 + Math.abs(Math.sin(time * 2.5)) * 0.35 + (line.userData['isHovered'] ? 0.2 : 0)
    }
  })
}

export function animateHazmatMeshes(root: THREE.Object3D | null, time: number): void {
  if (!root) return

  const pulse = 0.25 + Math.abs(Math.sin(time * 1.6)) * 0.35
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.userData['hazmatPulse'] || !mesh.material) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = pulse
  })
}

export function disposeContainerGroupMaterials(group: THREE.Group): void {
  group.traverse(obj => {
    const m = obj as THREE.Mesh | THREE.LineSegments
    if (!m.geometry) return
    const bodyMats = m.userData['bodyMaterials'] as THREE.MeshStandardMaterial[] | undefined
    if (bodyMats) {
      disposeContainerMaterials(bodyMats)
      m.userData['bodyMaterials'] = undefined
    } else if (m.material) {
      const mat = m.material
      if (Array.isArray(mat)) mat.forEach(x => x.dispose())
      else mat.dispose()
    }
    m.geometry.dispose()
  })
}

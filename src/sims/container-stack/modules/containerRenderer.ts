import * as THREE from 'three'
import type { JengaContainer, LayerOrientation } from '../types'
import { BLOCK } from './config'
import { getShippingContainerMaterials } from './containerMaterials'

export interface ContainerMeshUserData {
  containerId: string
  layerIndex: number
  slotIndex: number
  isJengaBlock: true
}

const POST = 0.11
const POST_METAL = 0x2c313a

function addCornerPosts(group: THREE.Group, sx: number, sy: number, sz: number): void {
  const postMat = new THREE.MeshStandardMaterial({
    color: POST_METAL,
    roughness: 0.65,
    metalness: 0.55,
  })
  const ph = sy * 0.96
  const geo = new THREE.BoxGeometry(POST, ph, POST)
  const hx = sx / 2 - POST / 2
  const hz = sz / 2 - POST / 2
  const corners: [number, number][] = [
    [hx, hz],
    [hx, -hz],
    [-hx, hz],
    [-hx, -hz],
  ]
  for (const [px, pz] of corners) {
    const p = new THREE.Mesh(geo, postMat)
    p.position.set(px, 0, pz)
    p.castShadow = true
    p.receiveShadow = true
    group.add(p)
  }

  const railT = 0.06
  const railMat = new THREE.MeshStandardMaterial({
    color: POST_METAL,
    roughness: 0.65,
    metalness: 0.55,
  })
  const topRailY = sy / 2 - railT / 2
  const botRailY = -sy / 2 + railT / 2
  const railX = new THREE.BoxGeometry(sx * 0.98, railT, POST * 0.9)
  const railZ = new THREE.BoxGeometry(POST * 0.9, railT, sz * 0.98)
  for (const y of [topRailY, botRailY]) {
    const rx = new THREE.Mesh(railX, railMat)
    rx.position.set(0, y, sz / 2 - POST / 2)
    rx.castShadow = true
    group.add(rx)
    const rx2 = rx.clone()
    rx2.position.set(0, y, -sz / 2 + POST / 2)
    group.add(rx2)
    const rz = new THREE.Mesh(railZ, railMat)
    rz.position.set(sx / 2 - POST / 2, y, 0)
    rz.castShadow = true
    group.add(rz)
    const rz2 = rz.clone()
    rz2.position.set(-sx / 2 + POST / 2, y, 0)
    group.add(rz2)
  }

}

export function createContainerMesh(
  container: JengaContainer,
  orientation: LayerOrientation
): THREE.Group {
  const group = new THREE.Group()
  const w = BLOCK.width
  const h = BLOCK.height
  const len = BLOCK.length

  const longAlongX = orientation === 'alongX'
  const sx = longAlongX ? w : len
  const sy = h
  const sz = longAlongX ? len : w

  const geo = new THREE.BoxGeometry(sx, sy, sz)
  const materials = getShippingContainerMaterials(container.color, longAlongX)
  const mesh = new THREE.Mesh(geo, materials)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const ud = {
    containerId: container.id,
    layerIndex: container.layerIndex,
    slotIndex: container.slotIndex,
    isJengaBlock: true,
  } satisfies ContainerMeshUserData
  mesh.userData = { ...ud, usesSharedBodyMaterials: true }

  addCornerPosts(group, sx, sy, sz)

  const edges = new THREE.EdgesGeometry(geo)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.5 })
  )

  group.add(mesh)
  group.add(line)
  group.userData = ud
  return group
}

function applyEmissiveToMesh(mesh: THREE.Mesh, on: boolean): void {
  const mats = mesh.material
  const list = Array.isArray(mats) ? mats : [mats]
  for (const m of list) {
    if (m instanceof THREE.MeshStandardMaterial) {
      if (on) {
        m.emissive.setHex(0x333344)
        m.emissiveIntensity = 0.35
      } else {
        m.emissive.setHex(0x000000)
        m.emissiveIntensity = 0
      }
    }
  }
}

export function setContainerHighlight(group: THREE.Group, on: boolean): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh && child.userData['isJengaBlock']) {
      applyEmissiveToMesh(child, on)
    }
  }
}

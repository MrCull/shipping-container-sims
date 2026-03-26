import * as THREE from 'three'
import type { ShipPreset } from '../types'

export function createShip(scene: THREE.Scene, shipConfig: ShipPreset): THREE.Group {
  const group = new THREE.Group()
  group.name = 'ship'

  const { length, width, height } = shipConfig
  const hullDepth = height * 1.5

  const hullShape = new THREE.Shape()
  const bowTaper = length * 0.2
  const sternTaper = length * 0.1

  hullShape.moveTo(-length / 2, -width / 2 + sternTaper)
  hullShape.lineTo(-length / 2, width / 2 - sternTaper)
  hullShape.quadraticCurveTo(-length / 2, width / 2, -length / 2 + sternTaper, width / 2)
  hullShape.lineTo(length / 2 - bowTaper, width / 2)
  hullShape.quadraticCurveTo(length / 2, width / 2 * 0.5, length / 2, 0)
  hullShape.quadraticCurveTo(length / 2, -width / 2 * 0.5, length / 2 - bowTaper, -width / 2)
  hullShape.lineTo(-length / 2 + sternTaper, -width / 2)
  hullShape.quadraticCurveTo(-length / 2, -width / 2, -length / 2, -width / 2 + sternTaper)

  const hullExtrudeSettings: THREE.ExtrudeGeometryOptions = { depth: hullDepth, bevelEnabled: false }
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, hullExtrudeSettings)
  const hullMat = new THREE.MeshPhongMaterial({ color: 0x2c2c2c, flatShading: false })
  const hull = new THREE.Mesh(hullGeo, hullMat)
  hull.rotation.x = -Math.PI / 2
  hull.position.y = -hullDepth + height * 0.3
  hull.castShadow = true
  hull.receiveShadow = true
  group.add(hull)

  const deckGeo = new THREE.BoxGeometry(length * 0.95, 0.3, width * 0.9)
  const deckMat = new THREE.MeshPhongMaterial({ color: 0x8b4513 })
  const deck = new THREE.Mesh(deckGeo, deckMat)
  deck.position.y = height * 0.3
  deck.receiveShadow = true
  group.add(deck)

  const waterlineGeo = new THREE.BoxGeometry(length * 0.96, 0.4, width * 0.92)
  const waterlineMat = new THREE.MeshPhongMaterial({ color: 0xcc0000 })
  const waterline = new THREE.Mesh(waterlineGeo, waterlineMat)
  waterline.position.y = -hullDepth * 0.3
  group.add(waterline)

  const bridgeWidth = width * 0.5
  const bridgeLength = length * 0.12
  const bridgeHeight = height * 2.5

  const bridgeGeo = new THREE.BoxGeometry(bridgeLength, bridgeHeight, bridgeWidth)
  const bridgeMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee })
  const bridge = new THREE.Mesh(bridgeGeo, bridgeMat)
  bridge.position.set(-length / 2 + bridgeLength, height * 0.3 + bridgeHeight / 2, 0)
  bridge.castShadow = true
  group.add(bridge)

  const windowGeo = new THREE.BoxGeometry(bridgeLength * 0.1, bridgeHeight * 0.2, bridgeWidth * 0.9)
  const windowMat = new THREE.MeshPhongMaterial({ color: 0x4488cc, emissive: 0x224466 })
  const windows = new THREE.Mesh(windowGeo, windowMat)
  windows.position.set(-length / 2 + bridgeLength * 1.55, height * 0.3 + bridgeHeight * 0.7, 0)
  group.add(windows)

  const funnelGeo = new THREE.CylinderGeometry(0.8, 1.2, height * 1.5, 8)
  const funnelMat = new THREE.MeshPhongMaterial({ color: 0x333333 })
  const funnel = new THREE.Mesh(funnelGeo, funnelMat)
  funnel.position.set(-length / 2 + bridgeLength * 0.5, height * 0.3 + bridgeHeight + height * 0.5, 0)
  funnel.castShadow = true
  group.add(funnel)

  const recessMat = new THREE.MeshPhongMaterial({ color: 0x4a3520 })
  const recessGeo = new THREE.BoxGeometry(length * 0.7, 0.15, width * 0.75)
  const recess = new THREE.Mesh(recessGeo, recessMat)
  recess.position.set(length * 0.1, height * 0.35, 0)
  group.add(recess)

  scene.add(group)
  return group
}

export function updateShipTilt(shipGroup: THREE.Group | null, list: number, trim: number): void {
  if (!shipGroup) return
  shipGroup.rotation.z = (list * Math.PI) / 180
  shipGroup.rotation.x = (trim * Math.PI) / 180
}

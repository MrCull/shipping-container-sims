import * as THREE from 'three'
import type { Container, Slot, ShipPreset } from '../types'
import { CONTAINER, WEIGHT_COLORS } from './config'

export function createContainerMesh(container: Container): THREE.Group {
  const { x, y, z } = CONTAINER.size
  const group = new THREE.Group()
  group.name = `container-${container.id}`

  const bodyGeo = new THREE.BoxGeometry(x, y, z)
  const bodyMat = new THREE.MeshPhongMaterial({
    color: container.portColor,
    flatShading: false,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const stripeHeight = y * 0.08
  const stripeGeo = new THREE.BoxGeometry(x + 0.01, stripeHeight, z + 0.01)
  const weightColor = WEIGHT_COLORS[container.weightCategory]
  const stripeMat = new THREE.MeshPhongMaterial({
    color: weightColor.three,
    emissive: weightColor.three,
    emissiveIntensity: 0.3,
  })
  const stripe = new THREE.Mesh(stripeGeo, stripeMat)
  stripe.position.y = -y / 2 + stripeHeight / 2 + 0.01
  group.add(stripe)

  if (container.isHazmat) {
    const hazStripeGeo = new THREE.BoxGeometry(x + 0.02, stripeHeight * 1.5, z + 0.02)
    const hazStripeMat = new THREE.MeshPhongMaterial({
      color: 0xff6600,
      emissive: 0xff6600,
      emissiveIntensity: 0.4,
    })
    const hazStripe = new THREE.Mesh(hazStripeGeo, hazStripeMat)
    hazStripe.position.y = 0
    group.add(hazStripe)

    addHazmatDiamond(group, x, y, z)
  }

  group.userData['container'] = container
  group.userData['isContainer'] = true

  return group
}

function addHazmatDiamond(group: THREE.Group, x: number, y: number, z: number): void {
  const diamondSize = Math.min(x, z) * 0.25
  const diamondGeo = new THREE.PlaneGeometry(diamondSize, diamondSize)
  const diamondMat = new THREE.MeshPhongMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  })

  const front = new THREE.Mesh(diamondGeo, diamondMat)
  front.position.set(0, y * 0.2, z / 2 + 0.01)
  front.rotation.z = Math.PI / 4
  group.add(front)

  const back = new THREE.Mesh(diamondGeo, diamondMat)
  back.position.set(0, y * 0.2, -z / 2 - 0.01)
  back.rotation.z = Math.PI / 4
  group.add(back)

  const left = new THREE.Mesh(diamondGeo, diamondMat)
  left.position.set(x / 2 + 0.01, y * 0.2, 0)
  left.rotation.z = Math.PI / 4
  left.rotation.y = Math.PI / 2
  group.add(left)

  const right = new THREE.Mesh(diamondGeo, diamondMat)
  right.position.set(-x / 2 - 0.01, y * 0.2, 0)
  right.rotation.z = Math.PI / 4
  right.rotation.y = Math.PI / 2
  group.add(right)
}

export function createSlotIndicators(
  _scene: THREE.Scene,
  slots: Record<string, Slot>,
  availableIds: string[],
  shipConfig: ShipPreset,
  shipGroup: THREE.Group
): THREE.Group {
  const indicators = new THREE.Group()
  indicators.name = 'slot-indicators'

  const { x, z } = CONTAINER.size
  const geo = new THREE.BoxGeometry(x * 0.95, 0.08, z * 0.95)

  for (const slotId of availableIds) {
    const slot = slots[slotId]
    if (!slot) continue

    const mat = new THREE.MeshPhongMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.35,
      emissive: 0x00ff88,
      emissiveIntensity: 0.2,
    })
    const indicator = new THREE.Mesh(geo.clone(), mat)
    indicator.position.set(
      slot.xOffset,
      slot.yOffset + shipConfig.height * 0.3 + CONTAINER.size.y / 2,
      slot.zOffset
    )
    indicator.userData['slotId'] = slotId
    indicator.userData['isSlotIndicator'] = true
    indicator.name = `slot-${slotId}`
    indicators.add(indicator)
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

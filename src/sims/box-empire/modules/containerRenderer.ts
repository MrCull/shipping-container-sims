// ---------------------------------------------------------------------------
// Box Empire — Container rendering with InstancedMesh
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Container } from '../types'
import {
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_HEIGHT,
} from './config'

const MAX_INSTANCES = 32

export class ContainerRenderer {
  private mesh: THREE.InstancedMesh
  private colorAttr: THREE.InstancedBufferAttribute
  private dummy = new THREE.Object3D()
  private containerIds: string[] = []

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(
      CONTAINER_LENGTH,
      CONTAINER_HEIGHT,
      CONTAINER_WIDTH,
    )
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      metalness: 0.3,
      vertexColors: true,
    })

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.count = 0
    this.mesh.frustumCulled = false

    const colors = new Float32Array(MAX_INSTANCES * 3)
    this.colorAttr = new THREE.InstancedBufferAttribute(colors, 3)
    this.mesh.instanceColor = this.colorAttr

    scene.add(this.mesh)
  }

  update(containers: Container[]): void {
    const visibleContainers = containers.filter(
      c => c.lifecycleState !== 'departed',
    )
    this.mesh.count = Math.min(visibleContainers.length, MAX_INSTANCES)
    this.containerIds = []

    const color = new THREE.Color()
    for (let i = 0; i < this.mesh.count; i++) {
      const c = visibleContainers[i]
      this.containerIds.push(c.id)

      this.dummy.position.set(
        c.currentLocation.position.x,
        c.currentLocation.position.y,
        c.currentLocation.position.z,
      )
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)

      color.set(c.ownerColor)
      this.colorAttr.setXYZ(i, color.r, color.g, color.b)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    this.colorAttr.needsUpdate = true
  }

  getContainerIdAtIndex(index: number): string | null {
    return this.containerIds[index] ?? null
  }

  getMesh(): THREE.InstancedMesh {
    return this.mesh
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach(m => m.dispose())
    } else {
      this.mesh.material.dispose()
    }
  }
}

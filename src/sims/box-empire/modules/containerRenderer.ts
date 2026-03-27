// ---------------------------------------------------------------------------
// Box Empire — Container rendering with improved geometry
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Container } from '../types'
import {
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_HEIGHT,
} from './config'

const MAX_INSTANCES = 32

// Container geometry: corrugated body + structural frame edges
function buildContainerGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = []

  const L = CONTAINER_LENGTH
  const W = CONTAINER_WIDTH
  const H = CONTAINER_HEIGHT
  const half = { L: L / 2, W: W / 2, H: H / 2 }

  // Main body box
  const body = new THREE.BoxGeometry(L, H, W)
  geometries.push(body)

  // Corrugation ribs on side panels (XZ face, running along Z axis, repeating)
  const ribW = 0.06
  const ribCount = 12
  for (let i = 0; i < ribCount; i++) {
    const xPos = -half.L + (L / (ribCount + 1)) * (i + 1)
    for (const side of [-1, 1]) {
      const rib = new THREE.BoxGeometry(ribW, H * 0.95, W + 0.01)
      const ribMat = new THREE.Matrix4()
      ribMat.makeTranslation(xPos, 0, side * (W / 2 + ribW / 2 - 0.01))
      rib.applyMatrix4(ribMat)
      geometries.push(rib)
    }
  }

  // Horizontal corner rails top/bottom
  const cornerRailH = 0.06
  const cornerRailW = 0.06

  // Top rails along length
  for (const wSide of [-1, 1]) {
    const rail = new THREE.BoxGeometry(L, cornerRailH, cornerRailW)
    const m = new THREE.Matrix4()
    m.makeTranslation(0, half.H + cornerRailH / 2, wSide * (half.W - cornerRailW / 2))
    rail.applyMatrix4(m)
    geometries.push(rail)
  }
  // Bottom rails along length
  for (const wSide of [-1, 1]) {
    const rail = new THREE.BoxGeometry(L, cornerRailH, cornerRailW)
    const m = new THREE.Matrix4()
    m.makeTranslation(0, -(half.H + cornerRailH / 2), wSide * (half.W - cornerRailW / 2))
    rail.applyMatrix4(m)
    geometries.push(rail)
  }

  // Vertical corner posts
  const postW = 0.08
  for (const xSide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const post = new THREE.BoxGeometry(postW, H + 0.1, postW)
      const m = new THREE.Matrix4()
      m.makeTranslation(
        xSide * (half.L - postW / 2),
        0,
        zSide * (half.W - postW / 2),
      )
      post.applyMatrix4(m)
      geometries.push(post)
    }
  }

  // Door end (front face) — slightly inset panel
  const doorW = W * 0.9
  const doorH = H * 0.92
  const doorPanel = new THREE.BoxGeometry(0.04, doorH, doorW)
  const doorM = new THREE.Matrix4()
  doorM.makeTranslation(half.L + 0.02, 0, 0)
  doorPanel.applyMatrix4(doorM)
  geometries.push(doorPanel)

  const merged = mergeGeometries(geometries)
  for (const g of geometries) g.dispose()
  return merged
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Simple manual merge of positions/normals/uvs
  let totalVerts = 0
  for (const g of geos) totalVerts += g.attributes.position.count

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)

  // Collect indices
  const indexArrays: number[][] = []
  let vertOffset = 0
  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute
    const nor = g.attributes.normal as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      positions[(vertOffset + i) * 3] = pos.getX(i)
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i)
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i)
      if (nor) {
        normals[(vertOffset + i) * 3] = nor.getX(i)
        normals[(vertOffset + i) * 3 + 1] = nor.getY(i)
        normals[(vertOffset + i) * 3 + 2] = nor.getZ(i)
      }
    }

    if (g.index) {
      const idx = g.index.array
      const localIdx: number[] = []
      for (let i = 0; i < idx.length; i++) {
        localIdx.push(idx[i] + vertOffset)
      }
      indexArrays.push(localIdx)
    } else {
      const localIdx: number[] = []
      for (let i = 0; i < pos.count; i++) localIdx.push(vertOffset + i)
      indexArrays.push(localIdx)
    }
    vertOffset += pos.count
  }

  const totalIndices = indexArrays.reduce((acc, arr) => acc + arr.length, 0)
  const indices = new Uint32Array(totalIndices)
  let idxOffset = 0
  for (const arr of indexArrays) {
    for (const v of arr) indices[idxOffset++] = v
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  merged.computeVertexNormals()
  return merged
}

export class ContainerRenderer {
  private mesh: THREE.InstancedMesh
  private colorAttr: THREE.InstancedBufferAttribute
  private dummy = new THREE.Object3D()
  private containerIds: string[] = []

  constructor(scene: THREE.Scene) {
    const geo = buildContainerGeometry()
    // vertexColors must be false here — per-instance color comes from instanceColor
    // attribute set below. With vertexColors:true the material reads per-vertex data
    // which doesn't exist in our merged geometry, giving black output.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.2,
      vertexColors: false,
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
      c => c.lifecycleState !== 'departed' && c.lifecycleState !== 'on_vessel',
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

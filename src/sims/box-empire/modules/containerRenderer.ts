// ---------------------------------------------------------------------------
// Box Empire — Container rendering
// ---------------------------------------------------------------------------
// Container geometry: a solid corrugated steel ISO container.
// The main body is a BoxGeometry. Corrugation ribs are thin flat rectangles
// sitting ON the long side faces (not penetrating). Corner posts and end door
// panel complete the silhouette.
// ---------------------------------------------------------------------------

import * as THREE from 'three'
import type { Container } from '../types'
import {
  CONTAINER_LENGTH,
  CONTAINER_WIDTH,
  CONTAINER_HEIGHT,
} from './config'

const MAX_INSTANCES = 64

function buildContainerGeometry(): THREE.BufferGeometry {
  const L = CONTAINER_LENGTH   // ~6.06 m
  const W = CONTAINER_WIDTH    // ~2.44 m
  const H = CONTAINER_HEIGHT   // ~2.59 m

  // We'll build everything as separate geometries and merge manually
  const parts: THREE.BufferGeometry[] = []

  // ---- Main body ----------------------------------------------------------
  parts.push(new THREE.BoxGeometry(L, H, W))

  // ---- Corrugation ribs on both long sides (XZ plane, Z face) ------------
  // Ribs are thin strips (depth 0.04 m) sitting flush on the +Z and -Z faces
  const ribDepth = 0.04
  const ribCount = 14
  const ribW_geo = L / (ribCount + 1)

  for (let i = 0; i < ribCount; i++) {
    const cx = -L / 2 + ribW_geo * (i + 1)
    for (const side of [-1, 1]) {
      const ribGeo = new THREE.BoxGeometry(ribW_geo * 0.55, H * 0.97, ribDepth)
      applyTranslation(ribGeo, cx, 0, side * (W / 2 + ribDepth / 2))
      parts.push(ribGeo)
    }
  }

  // ---- Corrugation ribs on end faces (front door end) --------------------
  const doorRibCount = 4
  const doorRibW = W / (doorRibCount + 1)
  for (let i = 0; i < doorRibCount; i++) {
    const cz = -W / 2 + doorRibW * (i + 1)
    const ribGeo = new THREE.BoxGeometry(ribDepth, H * 0.97, doorRibW * 0.55)
    applyTranslation(ribGeo, L / 2 + ribDepth / 2, 0, cz)
    parts.push(ribGeo)
  }

  // ---- Corner posts (darker colour will come from a tint later, same geo) -
  const postW = 0.12
  const postH = H + 0.04
  for (const xs of [-1, 1]) {
    for (const zs of [-1, 1]) {
      const post = new THREE.BoxGeometry(postW, postH, postW)
      applyTranslation(post, xs * (L / 2 - postW / 2), 0, zs * (W / 2 - postW / 2))
      parts.push(post)
    }
  }

  // ---- Top and bottom rails along length ----------------------------------
  const railH = 0.07
  const railW = 0.07
  for (const ys of [-1, 1]) {
    for (const zs of [-1, 1]) {
      const rail = new THREE.BoxGeometry(L, railH, railW)
      applyTranslation(rail, 0, ys * (H / 2 + railH / 2), zs * (W / 2 - railW / 2))
      parts.push(rail)
    }
  }

  const merged = mergeBufferGeometries(parts)
  for (const g of parts) g.dispose()
  return merged
}

function applyTranslation(geo: THREE.BufferGeometry, x: number, y: number, z: number): void {
  geo.translate(x, y, z)
}

function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0
  let totalIdx = 0
  for (const g of geos) {
    totalVerts += g.attributes.position.count
    totalIdx += g.index ? g.index.count : g.attributes.position.count
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const indices = new Uint32Array(totalIdx)

  let vOffset = 0
  let iOffset = 0

  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute
    const nor = g.attributes.normal as THREE.BufferAttribute

    for (let i = 0; i < pos.count; i++) {
      positions[(vOffset + i) * 3 + 0] = pos.getX(i)
      positions[(vOffset + i) * 3 + 1] = pos.getY(i)
      positions[(vOffset + i) * 3 + 2] = pos.getZ(i)
      if (nor) {
        normals[(vOffset + i) * 3 + 0] = nor.getX(i)
        normals[(vOffset + i) * 3 + 1] = nor.getY(i)
        normals[(vOffset + i) * 3 + 2] = nor.getZ(i)
      }
    }

    if (g.index) {
      const src = g.index.array
      for (let i = 0; i < src.length; i++) {
        indices[iOffset++] = src[i] + vOffset
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset++] = vOffset + i
      }
    }

    vOffset += pos.count
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  out.setIndex(new THREE.BufferAttribute(indices, 1))
  out.computeVertexNormals()
  return out
}

export class ContainerRenderer {
  private mesh: THREE.InstancedMesh
  private colorAttr: THREE.InstancedBufferAttribute
  private dummy = new THREE.Object3D()
  private containerIds: string[] = []

  constructor(scene: THREE.Scene) {
    const geo = buildContainerGeometry()

    // White base — instanceColor provides per-container shipping-line colour.
    // vertexColors: false is critical (merged geometry has no vertex colour data).
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0.15,
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
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.scale.set(1, 1, 1)
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

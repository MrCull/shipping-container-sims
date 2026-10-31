/**
 * ROB boxes in the 3D hull (spec #106, #110): the display-only remain-on-board boxes of a vessel's ROB bays as one
 * InstancedMesh of plain boxes, a child of the vessel's root so it moves with the hull. They are slot data, not
 * containers: no picking, no custody, no pose over time. Colour follows the POD so a later port's boxes read as a group.
 * Nothing here is reactive (never put these objects in Vue state).
 */
import * as THREE from 'three'
import type { RobBox } from '../scenario/robBays'
import { slotCentre, type VesselClassSpec } from '../scenario/vesselClasses'
import { colourOf, type ColourBy, type ColourContext } from './colourBy'
import { CONTAINER_DIMS } from './sceneModel'

/** Muted palette (hex) by POD, so ROB boxes stay quieter than the boxes being worked. */
const POD_COLOURS = ['#7d8fa3', '#a39a7d', '#7da38f', '#a3857d', '#8f7da3', '#7d9ea3', '#a37d93', '#93a37d']

export interface RobMesh {
  mesh: THREE.InstancedMesh
  /** Boxes drawn. */
  count: number
  /** Colour by (#130): `default` keeps the muted POD colours, every other mode uses the shared colour of that mode. */
  setColour(mode: ColourBy, ctx: ColourContext): void
  dispose(): void
}

/** One InstancedMesh holding every ROB box of a vessel, in the vessel's local frame (stern x = 0, quay at z = 0). Null when it has none. */
export function buildRobMesh(spec: VesselClassSpec, boxes: readonly RobBox[]): RobMesh | null {
  if (boxes.length === 0) return null
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.1 })
  const mesh = new THREE.InstancedMesh(geometry, material, boxes.length)
  mesh.name = 'rob_boxes'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const pods = [...new Set(boxes.map((b) => b.pod))].sort()
  const m = new THREE.Matrix4()
  const colour = new THREE.Color()
  const paint = (mode: ColourBy, ctx: ColourContext): void => {
    boxes.forEach((b, i) => {
      if (mode === 'default') colour.set(POD_COLOURS[pods.indexOf(b.pod) % POD_COLOURS.length])
      else colour.set(colourOf(mode, { line: b.line, full: b.full, isoType: b.isoType, pod: b.pod, weightClass: b.weightClass, direction: 'TRANSSHIPMENT', onCall: false, rob: true }, 0, ctx).hex)
      mesh.setColorAt(i, colour)
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  boxes.forEach((b, i) => {
    const d = CONTAINER_DIMS[b.size]
    const c = slotCentre(spec, 0, b, b.size)
    // a hair smaller than the cell, so neighbouring boxes show a seam
    m.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion(), new THREE.Vector3(d.length - 0.1, d.height - 0.05, d.width - 0.05))
    mesh.setMatrixAt(i, m)
  })
  paint('default', { ports: [] })
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return {
    mesh,
    count: boxes.length,
    setColour: paint,
    dispose() {
      geometry.dispose()
      material.dispose()
      mesh.dispose()
    },
  }
}

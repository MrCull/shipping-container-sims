/**
 * ROB boxes in the 3D hull (spec #106, #110): the display-only remain-on-board boxes of a vessel's ROB bays as one
 * InstancedMesh of plain boxes, a child of the vessel's root so it moves with the hull. They are slot data, not
 * containers: no picking, no custody, no pose over time. Every ROB box is the shared ROB grey (`ROB_HEX`, `--tt-data-rob`,
 * #159) in every colour mode, the colour the bay viewer gives ROB cells: quiet next to the boxes being worked.
 * Nothing here is reactive (never put these objects in Vue state).
 */
import * as THREE from 'three'
import type { RobBox } from '../scenario/robBays'
import { slotCentre, type VesselClassSpec } from '../scenario/vesselClasses'
import { colourOf, type ColourBy, type ColourContext } from './colourBy'
import { CONTAINER_DIMS } from './sceneModel'


export interface RobMesh {
  mesh: THREE.InstancedMesh
  /** Boxes drawn. */
  count: number
  /** Colour by (#130): the ROB grey in every mode (#159; kept so the renderer's call stays mode-agnostic). */
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
  const m = new THREE.Matrix4()
  const colour = new THREE.Color()
  const paint = (mode: ColourBy, ctx: ColourContext): void => {
    boxes.forEach((b, i) => {
      colour.set(colourOf(mode, { line: b.line, full: b.full, isoType: b.isoType, pod: b.pod, weightClass: b.weightClass, direction: 'TRANSSHIPMENT', onCall: false, rob: true }, 0, ctx).hex)
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

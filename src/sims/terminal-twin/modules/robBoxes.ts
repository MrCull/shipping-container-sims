/**
 * ROB boxes in the 3D hull (spec #106, #110): the display-only remain-on-board boxes of a vessel's ROB bays as one
 * InstancedMesh of plain boxes, a child of the vessel's root so it moves with the hull. They are slot data, not
 * containers: no picking, no custody, no pose over time. The ROB display (#168) sets their colour: `grey` is the shared
 * ROB grey (`ROB_HEX`, #159), `show` the colour the mode gives any box, and `hide` leaves the mesh hidden (the vessel
 * renderer toggles its visibility). Nothing here is reactive (never put these objects in Vue state).
 */
import * as THREE from 'three'
import type { RobBox } from '../scenario/robBays'
import { slotCentre, type VesselClassSpec } from '../scenario/vesselClasses'
import { DEFAULT_ROB_DISPLAY, robColourOf, type ColourBy, type ColourContext, type RobDisplay } from './colourBy'
import { CONTAINER_DIMS } from './sceneModel'


export interface RobMesh {
  mesh: THREE.InstancedMesh
  /** Boxes drawn. */
  count: number
  /** Colour by (#130) and ROB display (#168): the boxes' colours for this mode and display. */
  setColour(mode: ColourBy, robDisplay: RobDisplay, ctx: ColourContext): void
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
  const paint = (mode: ColourBy, robDisplay: RobDisplay, ctx: ColourContext): void => {
    boxes.forEach((b, i) => {
      colour.set(robColourOf(robDisplay, mode, { line: b.line, full: b.full, isoType: b.isoType, pod: b.pod, weightClass: b.weightClass, direction: 'TRANSSHIPMENT', onCall: false }, 0, ctx).hex)
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
  paint('default', DEFAULT_ROB_DISPLAY, { ports: [] })
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

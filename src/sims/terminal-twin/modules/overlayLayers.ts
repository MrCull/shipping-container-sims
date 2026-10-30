/**
 * Live-state 3D overlays (TT-18): occupancy plates for WTP pads and STS ground
 * positions, and state labels above equipment and vessels. Both read the
 * SceneModel at the displayed time, so they always show what the engine state
 * says at that instant. (The lane graph and reservation overlays live in
 * SceneRenderer.) Three.js objects stay out of Vue reactivity.
 */
import * as THREE from 'three'
import { EQUIPMENT_KINDS, type EquipmentKind } from './equipmentKinds'
import { entityBounds } from './picking'
import type { OverlayState } from './overlays'
import { declutterLabels, type LabelBox } from './labelDeclutter'
import { CONTAINER_DIMS, type SceneModel } from './sceneModel'

export interface OverlayLayerStats {
  padsOccupied: number
  padsFree: number
  groundPositionsOccupied: number
  /** Transfer stalls with a truck standing in them / free (zeros without a landside or while occupancy is off). */
  stallsOccupied: number
  stallsFree: number
  /** Labels currently visible (after decluttering). */
  labels: number
  /** Labels hidden because they would overlap a higher-priority one on screen. */
  labelsHidden: number
  /** Screen boxes (px) of the visible labels, when the camera is known (dev API / tests). */
  labelBoxes: LabelBox[]
}

/** The camera and viewport the labels are laid out against (screen-space decluttering). */
export interface LabelScreen {
  camera: THREE.PerspectiveCamera
  width: number
  height: number
}

const LABEL_W_PX = 320
const LABEL_H_PX = 72
const LABEL_W_M = 36
const LABEL_H_M = (LABEL_W_M * LABEL_H_PX) / LABEL_W_PX
const LABEL_CAP = 24

export class OverlayLayers {
  readonly group = new THREE.Group()
  private model: SceneModel
  private padPlates = new Map<string, THREE.Mesh>()
  private stallPlates = new Map<string, THREE.Mesh>()
  private gpPlates: THREE.Mesh[] = []
  private labels = new Map<string, THREE.Sprite>()
  private labelKind = new Map<string, EquipmentKind>()
  private labelTextures = new Map<string, THREE.CanvasTexture>()
  private free: THREE.MeshBasicMaterial
  private busy: THREE.MeshBasicMaterial
  private gpMat: THREE.MeshBasicMaterial
  private plane = new THREE.PlaneGeometry(1, 1)
  private current: OverlayLayerStats = { padsOccupied: 0, padsFree: 0, groundPositionsOccupied: 0, stallsOccupied: 0, stallsFree: 0, labels: 0, labelsHidden: 0, labelBoxes: [] }

  constructor(model: SceneModel) {
    this.model = model
    const plate = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false })
    this.free = plate('#10b981')
    this.busy = plate('#ef4444')
    this.gpMat = plate('#f59e0b')
    for (const pad of model.graph.pads) {
      const m = new THREE.Mesh(this.plane, this.free)
      m.rotation.x = -Math.PI / 2
      m.position.set(pad.x, 0.28, pad.z)
      m.scale.set(3.6, 13.6, 1)
      m.renderOrder = 4
      m.visible = false
      this.padPlates.set(pad.id, m)
      this.group.add(m)
    }
    for (const stall of model.landside?.stalls ?? []) {
      const m = new THREE.Mesh(this.plane, this.free)
      m.rotation.x = -Math.PI / 2
      m.position.set(stall.x, 0.28, stall.z)
      m.scale.set(3.6, 13.6, 1)
      m.renderOrder = 4
      m.visible = false
      this.stallPlates.set(stall.id, m)
      this.group.add(m)
    }
    const labelled = EQUIPMENT_KINDS.filter((def) => def.labelled).flatMap((def) => def.ids(model).map((id) => ({ id, kind: def.kind })))
    for (const { id, kind } of labelled.slice(0, LABEL_CAP)) {
      this.labelKind.set(id, kind)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }))
      sprite.scale.set(LABEL_W_M, LABEL_H_M, 1)
      sprite.renderOrder = 10
      sprite.visible = false
      sprite.name = id
      this.labels.set(id, sprite)
      this.group.add(sprite)
    }
    this.group.visible = false
  }

  private labelTexture(text: string): THREE.CanvasTexture {
    let tex = this.labelTextures.get(text)
    if (tex) return tex
    const canvas = document.createElement('canvas')
    canvas.width = LABEL_W_PX
    canvas.height = LABEL_H_PX
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'rgba(17, 24, 39, 0.86)'
      ctx.fillRect(0, 0, LABEL_W_PX, LABEL_H_PX)
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 3
      ctx.strokeRect(1.5, 1.5, LABEL_W_PX - 3, LABEL_H_PX - 3)
      ctx.fillStyle = '#e5e7eb'
      ctx.font = '600 30px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, LABEL_W_PX / 2, LABEL_H_PX / 2, LABEL_W_PX - 16)
    }
    tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    this.labelTextures.set(text, tex)
    return tex
  }

  /** The label's screen rectangle in px (top-left origin), or null when it is behind the camera or off screen. */
  private screenBox(id: string, position: THREE.Vector3, { camera, width, height }: LabelScreen): LabelBox | null {
    const v = position.clone().applyMatrix4(camera.matrixWorldInverse)
    const depth = -v.z
    if (depth <= camera.near) return null
    const pxPerM = height / (2 * depth * Math.tan((camera.fov * Math.PI) / 360))
    const w = LABEL_W_M * pxPerM
    const h = LABEL_H_M * pxPerM
    const p = position.clone().project(camera)
    const cx = ((p.x + 1) / 2) * width
    const cy = ((1 - p.y) / 2) * height
    if (cx + w / 2 < 0 || cx - w / 2 > width || cy + h / 2 < 0 || cy - h / 2 > height) return null
    return { id, x: cx - w / 2, y: cy - h / 2, w, h }
  }

  private gpPlate(i: number): THREE.Mesh {
    let m = this.gpPlates[i]
    if (!m) {
      m = new THREE.Mesh(this.plane, this.gpMat)
      m.rotation.x = -Math.PI / 2
      m.renderOrder = 4
      this.gpPlates[i] = m
      this.group.add(m)
    }
    return m
  }

  update(t: number, overlays: OverlayState, screen?: LabelScreen, selectedId: string | null = null): void {
    const model = this.model
    this.group.visible = overlays.occupancy || overlays.labels
    const stats: OverlayLayerStats = { padsOccupied: 0, padsFree: 0, groundPositionsOccupied: 0, stallsOccupied: 0, stallsFree: 0, labels: 0, labelsHidden: 0, labelBoxes: [] }

    const occupiedPads = new Set<string>()
    let gps = 0
    if (overlays.occupancy) {
      for (const id of model.containerIds) {
        const owner = model.custodyAt(id, t)
        if (!owner) continue
        if (owner.kind === 'wtpPad') occupiedPads.add(owner.id)
        else if (owner.kind === 'groundPosition') {
          const pose = model.containerPose(id, t)
          if (!pose) continue
          const d = CONTAINER_DIMS[model.containerSize[id]]
          const plate = this.gpPlate(gps++)
          plate.visible = true
          plate.position.set(pose.x, 0.28, pose.z)
          plate.scale.set(d.length + 1, d.width + 1, 1)
        }
      }
    }
    for (let i = gps; i < this.gpPlates.length; i++) this.gpPlates[i].visible = false
    stats.groundPositionsOccupied = gps
    for (const [id, plate] of this.padPlates) {
      plate.visible = overlays.occupancy
      if (!overlays.occupancy) continue
      const occupied = occupiedPads.has(id)
      plate.material = occupied ? this.busy : this.free
      if (occupied) stats.padsOccupied++
      else stats.padsFree++
    }

    if (this.stallPlates.size > 0) {
      const taken = new Set<string>()
      if (overlays.occupancy)
        for (const truckId of model.truckIds) {
          const p = model.truckPose(truckId, t)
          if (!p.visible) continue
          for (const stall of model.landside?.stalls ?? []) if (Math.abs(p.x - stall.x) < 1.5 && Math.abs(p.z - stall.z) < 1.5) taken.add(stall.id)
        }
      for (const [id, plate] of this.stallPlates) {
        plate.visible = overlays.occupancy
        if (!overlays.occupancy) continue
        plate.material = taken.has(id) ? this.busy : this.free
        if (taken.has(id)) stats.stallsOccupied++
        else stats.stallsFree++
      }
    }

    // Labels: lay out in priority order (selection first, then registry order), then hide any that would overlap a kept one.
    const shown: { id: string; sprite: THREE.Sprite; box: LabelBox | null }[] = []
    const order = [...this.labels.keys()]
    if (selectedId && this.labels.has(selectedId)) order.unshift(selectedId)
    for (const id of new Set(order)) {
      const sprite = this.labels.get(id)!
      const kind = this.labelKind.get(id) ?? 'vessel'
      const b = overlays.labels ? entityBounds(model, id, t) : null
      sprite.visible = false
      if (!b) continue
      const text = `${id} · ${model.statusAt(kind, id, t).replace(/-/g, ' ')}`
      const tex = this.labelTexture(text)
      const mat = sprite.material
      if (mat.map !== tex) {
        mat.map = tex
        mat.needsUpdate = true
      }
      sprite.position.set(b.x, b.y + b.sy / 2 + LABEL_H_M, b.z)
      shown.push({ id, sprite, box: screen ? this.screenBox(id, sprite.position, screen) : null })
    }
    const boxes = shown.flatMap((s) => (s.box ? [s.box] : []))
    const keep = screen ? declutterLabels(boxes) : null
    for (const s of shown) {
      // Without a camera nothing can be judged: show it. A label behind the camera or off screen is not drawn anyway.
      const visible = keep ? (s.box ? keep.has(s.id) : false) : true
      s.sprite.visible = visible
      if (visible) stats.labels++
      else if (s.box) stats.labelsHidden++
      if (visible && s.box) stats.labelBoxes.push(s.box)
    }
    this.current = stats
  }

  stats(): OverlayLayerStats {
    return { ...this.current }
  }

  dispose(): void {
    for (const s of this.labels.values()) s.material.dispose()
    for (const tex of this.labelTextures.values()) tex.dispose()
    this.free.dispose()
    this.busy.dispose()
    this.gpMat.dispose()
    this.plane.dispose()
  }
}

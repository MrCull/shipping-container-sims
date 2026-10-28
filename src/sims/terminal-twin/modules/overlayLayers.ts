/**
 * Live-state 3D overlays (TT-18): occupancy plates for WTP pads and STS ground
 * positions, and state labels above equipment and vessels. Both read the
 * SceneModel at the displayed time, so they always show what the engine state
 * says at that instant. (The lane graph and reservation overlays live in
 * SceneRenderer.) Three.js objects stay out of Vue reactivity.
 */
import * as THREE from 'three'
import { entityBounds } from './picking'
import type { OverlayState } from './overlays'
import { CONTAINER_DIMS, type SceneModel } from './sceneModel'

export interface OverlayLayerStats {
  padsOccupied: number
  padsFree: number
  groundPositionsOccupied: number
  /** Transfer stalls with a truck standing in them / free (zeros without a landside or while occupancy is off). */
  stallsOccupied: number
  stallsFree: number
  /** Labels currently visible. */
  labels: number
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
  private labelTextures = new Map<string, THREE.CanvasTexture>()
  private free: THREE.MeshBasicMaterial
  private busy: THREE.MeshBasicMaterial
  private gpMat: THREE.MeshBasicMaterial
  private plane = new THREE.PlaneGeometry(1, 1)
  private current: OverlayLayerStats = { padsOccupied: 0, padsFree: 0, groundPositionsOccupied: 0, stallsOccupied: 0, stallsFree: 0, labels: 0 }

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
    const labelled = [...model.stsIds, ...model.shcIds, ...model.ascIds, ...model.vesselIds]
    for (const id of labelled.slice(0, LABEL_CAP)) {
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

  update(t: number, overlays: OverlayState): void {
    const model = this.model
    this.group.visible = overlays.occupancy || overlays.labels
    const stats = { padsOccupied: 0, padsFree: 0, groundPositionsOccupied: 0, stallsOccupied: 0, stallsFree: 0, labels: 0 }

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

    for (const [id, sprite] of this.labels) {
      const kind = model.truckIds.includes(id) ? 'truck' : model.stsIds.includes(id) ? 'sts' : model.shcIds.includes(id) ? 'shc' : model.ascIds.includes(id) ? 'asc' : 'vessel'
      const b = overlays.labels ? entityBounds(model, id, t) : null
      sprite.visible = b !== null
      if (!b) continue
      const text = `${id} · ${model.statusAt(kind, id, t).replace(/-/g, ' ')}`
      const tex = this.labelTexture(text)
      const mat = sprite.material
      if (mat.map !== tex) {
        mat.map = tex
        mat.needsUpdate = true
      }
      sprite.position.set(b.x, b.y + b.sy / 2 + LABEL_H_M, b.z)
      stats.labels++
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

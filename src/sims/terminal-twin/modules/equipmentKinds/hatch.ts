/**
 * Hatch panel (TT-R10): bounds, inspector view, dev-API state and its scene renderer. Panels are not containers: they
 * are drawn from the engine's hatch state (on their hatch, hanging from the STS spreader, stacked in the laydown) by
 * one instanced box mesh, and the hull drawn under them has no baked covers over their bays.
 */
import * as THREE from 'three'
import type { HatchPanelState } from '../../engine'
import type { EntityView } from '../entityInspector'
import type { SceneModel } from '../sceneModel'
import type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

/** Panel colour: painted steel, a little lighter than the deck so a stack in the laydown reads against the quay. */
const PANEL_COLOUR = '#7a8794'

/** Margin added to the selection box (m). */
const SELECT_MARGIN_M = 0.4

/** What the renderer drew for a panel at the last update (dev API `sceneState().hatchRigs`). */
export interface HatchRigState {
  status: string
  /** Centre drawn (m, world). */
  x: number
  y: number
  z: number
  lengthM: number
  widthM: number
  thicknessM: number
}

class HatchRenderer implements KindRenderer {
  private readonly mesh: THREE.InstancedMesh | null = null
  private readonly ids: string[]
  private readonly drawn = new Map<string, HatchRigState>()
  private readonly matrix = new THREE.Matrix4()
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(private host: KindRendererHost) {
    this.ids = host.model.hatchPanelIds
    if (this.ids.length === 0) return
    const geometry = host.track(new THREE.BoxGeometry(1, 1, 1))
    const material = host.track(new THREE.MeshStandardMaterial({ color: PANEL_COLOUR, roughness: 0.75, metalness: 0.1 }))
    const mesh = new THREE.InstancedMesh(geometry, material, this.ids.length)
    mesh.name = 'hatch_panels'
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false // instances span the quay and the vessels; the mesh has no useful bounding sphere
    for (let i = 0; i < this.ids.length; i++) mesh.setMatrixAt(i, this.hidden)
    host.scene.add(mesh)
    this.mesh = mesh
  }

  update(frame: KindFrame): void {
    const mesh = this.mesh
    if (!mesh) return
    this.drawn.clear()
    const { model } = this.host
    for (let i = 0; i < this.ids.length; i++) {
      const id = this.ids[i]
      const pose = model.hatchPanelPose(id, frame.t)
      if (!pose) {
        mesh.setMatrixAt(i, this.hidden)
        continue
      }
      this.matrix.makeScale(pose.lengthM, pose.thicknessM, pose.widthM).setPosition(pose.x, pose.y, pose.z)
      mesh.setMatrixAt(i, this.matrix)
      this.drawn.set(id, { status: pose.status, x: pose.x, y: pose.y, z: pose.z, lengthM: pose.lengthM, widthM: pose.widthM, thicknessM: pose.thicknessM })
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  rigState(): Record<string, unknown> {
    return Object.fromEntries(this.drawn)
  }

  stats() {
    return { hatchPanels: this.drawn.size }
  }

  dispose(): void {
    if (this.mesh) this.host.scene.remove(this.mesh)
    this.mesh?.dispose()
  }
}

function hatchView(p: Readonly<HatchPanelState>): EntityView {
  return {
    kind: 'hatch',
    id: p.id,
    facts: [
      { label: 'inspector.fact.status', value: p.status },
      { label: 'inspector.fact.vessel', value: p.vesselId, link: true },
      { label: 'inspector.fact.bay', value: p.bay },
      { label: 'inspector.fact.panelIndex', value: p.index },
      { label: 'inspector.fact.panelWeight', value: p.weightT },
      { label: 'inspector.fact.laydownBay', value: p.siteId },
      { label: 'inspector.fact.stackLevel', value: p.level },
      { label: 'inspector.fact.liftedBy', value: p.stsId, link: p.stsId !== null },
    ],
    job: null,
    custody: [],
  }
}

export const hatchKind: EquipmentKindDef<'hatch'> = {
  kind: 'hatch',
  sceneKey: 'hatchPanels',
  rigKey: 'hatchRigs',
  labelled: false,
  ids: (model: SceneModel) => model.hatchPanelIds,
  bounds(model, id, time) {
    const p = model.hatchPanelPose(id, time)
    if (!p) return null
    return { x: p.x, y: p.y, z: p.z, sx: p.lengthM + SELECT_MARGIN_M, sy: p.thicknessM + SELECT_MARGIN_M, sz: p.widthM + SELECT_MARGIN_M, yaw: 0 }
  },
  sceneState: (model, id, t) => {
    const p = model.hatchPanelPose(id, t)
    return { status: model.statusAt('hatch', id, t), x: p?.x ?? null, y: p?.y ?? null, z: p?.z ?? null, lengthM: p?.lengthM ?? null, widthM: p?.widthM ?? null, stsId: p?.stsId ?? null }
  },
  describe: (state) => hatchView(state as HatchPanelState),
  createRenderer: (host) => new HatchRenderer(host),
}

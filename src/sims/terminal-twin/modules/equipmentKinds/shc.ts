/** Shuttle carrier (SHC): bounds, inspector view, dev-API state and its scene renderer (procedural placeholder, then the rigged GLB). */
import * as THREE from 'three'
import { shcOperationalState, type ShcJob, type ShcState } from '../../engine'
import type { EntityView } from '../entityInspector'
import { SHC } from '../equipmentDims'
import { CONTAINER_DIMS } from '../sceneModel'
import { loadShcModel, ShcRig, SHC_RIG } from '../shcAssets'
import type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

/** [A] How fast an empty spreader rises and lowers when the engine gives it no lift motion (m/s of display time). */
const EMPTY_HOIST_MPS = 1.5
/** Height of the spreader's twist-lock plane when an empty SHC is not driving: the top of a standard box on the ground. */
const EMPTY_SPREADER_DOWN_Y = CONTAINER_DIMS['40'].height

class ShcRenderer implements KindRenderer {
  private shcs = new Map<string, { group: THREE.Group; spreader: THREE.Mesh; rig?: ShcRig }>()
  private hoistEase = new Map<string, { t: number; y: number }>()

  constructor(private host: KindRendererHost) {
    for (const id of host.model.shcIds) this.addShc(id)
    if (host.model.shcIds.length > 0) {
      loadShcModel().then(
        (shcModel) => {
          if (host.isDisposed()) return
          for (const [id, entry] of this.shcs) {
            entry.rig = new ShcRig(shcModel, id)
            entry.group.visible = false
            host.scene.add(entry.rig.root)
          }
        },
        (err: unknown) => console.warn('Terminal Twin: SHC GLB failed to load; keeping placeholders', err),
      )
    }
  }

  /** Procedural low-poly shuttle carrier: four legs, side and cross beams, cab, spreader. Length along local X. */
  private addShc(id: string): void {
    const track = this.host.track.bind(this.host)
    const group = new THREE.Group()
    group.name = id
    const frame = track(new THREE.MeshStandardMaterial({ color: '#e8ebef', roughness: 0.55, metalness: 0.25 }))
    const accent = track(new THREE.MeshStandardMaterial({ color: '#d35400', roughness: 0.6 }))
    const dark = track(new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.8 }))
    const glass = track(new THREE.MeshStandardMaterial({ color: '#7fb3d5', roughness: 0.2, metalness: 0.4 }))
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      group.add(m)
      return m
    }
    const hl = SHC.length / 2 - SHC.leg / 2
    const hw = SHC.width / 2 - SHC.leg / 2
    const top = SHC.height - SHC.beam / 2
    for (const x of [-hl, hl]) {
      for (const z of [-hw, hw]) {
        box(SHC.leg, SHC.height - 0.9, SHC.leg, frame, x, (SHC.height - 0.9) / 2 + 0.9, z)
        box(1.2, 1.2, 0.5, dark, x, 0.6, z) // wheel
      }
      box(SHC.leg, SHC.beam, SHC.width, accent, x, top, 0) // cross beam
    }
    for (const z of [-hw, hw]) {
      box(SHC.length, SHC.beam, SHC.leg, frame, 0, top, z) // side beam
      box(SHC.length * 0.8, 0.5, SHC.leg, accent, 0, 1.3, z) // lower skirt
    }
    box(2.2, 1.8, 2, frame, hl - 0.6, SHC.height + 0.9, 0) // cab
    box(0.1, 1.1, 1.7, glass, hl + 0.52, SHC.height + 1.05, 0)
    const spreader = box(6.4, 0.35, 2.6, track(new THREE.MeshStandardMaterial({ color: '#f2b705' })), 0, 0, 0)
    this.host.scene.add(group)
    this.shcs.set(id, { group, spreader })
  }

  update(frame: KindFrame): void {
    const { model } = this.host
    const { t, cameraPosition } = frame
    for (const [id, parts] of this.shcs) {
      const pose = model.shcPose(id, t)
      if (frame.live && model.isReversing(id, t)) frame.sounds.push({ id, machine: 'shc', x: pose.x, y: 3, z: pose.z, motion: 'reversing' })
      if (parts.rig) {
        const boxHeight = frame.carried.get(id)
        parts.rig.chooseLod(Math.hypot(cameraPosition.x - pose.x, cameraPosition.y - 4, cameraPosition.z - pose.z) / frame.lodScale)
        parts.rig.pose({
          x: pose.x,
          z: pose.z,
          yaw: pose.yaw,
          steerRad: pose.steerRad,
          odometerM: pose.odometerM,
          attachY: this.spreaderPlane(id, t, pose.lift, pose.travelling || model.statusAt('shc', id, t) === 'parked', boxHeight),
          carrying: boxHeight !== undefined,
        })
        continue
      }
      parts.group.position.set(pose.x, 0, pose.z)
      parts.group.rotation.y = pose.heading === 'z' ? Math.PI / 2 : 0
      // the spreader sits on top of the (possible) box: box bottom = lift
      parts.spreader.position.y = pose.lift + CONTAINER_DIMS['40'].height + 0.2
    }
  }

  /**
   * Height of the spreader's twist-lock plane. Carrying: exactly the box top (it follows the engine's lift
   * motion). Empty: raised while driving or parked, lowered onto where a box would stand otherwise, eased so it never snaps.
   */
  private spreaderPlane(id: string, t: number, lift: number, raised: boolean, boxHeight: number | undefined): number {
    if (boxHeight !== undefined) {
      this.hoistEase.delete(id)
      return lift + boxHeight
    }
    const target = raised ? SHC_RIG.attachRestY : lift + EMPTY_SPREADER_DOWN_Y
    const ease = this.hoistEase.get(id)
    let y = target
    if (ease && Math.abs(t - ease.t) < 30) {
      const step = EMPTY_HOIST_MPS * Math.abs(t - ease.t)
      y = ease.y + Math.max(-step, Math.min(step, target - ease.y))
    }
    this.hoistEase.set(id, { t, y })
    return y
  }

  rigState(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [id, { rig }] of this.shcs) if (rig) out[id] = { ...rig.rigState }
    return out
  }

  stats() {
    const shcLods = { lod0: 0, lod1: 0, lod2: 0 }
    let rigged = 0
    for (const { rig } of this.shcs.values()) {
      if (!rig) continue
      rigged++
      shcLods[`lod${rig.rigState.lod}` as keyof typeof shcLods]++
    }
    return { shcs: this.shcs.size, shcLods, shcAssets: rigged > 0 ? ('loaded' as const) : ('placeholder' as const) }
  }

  dispose(): void {
    // shared geometry and materials are disposed through the host's track(); each rig frees its own plate material
    for (const { rig } of this.shcs.values()) rig?.dispose()
  }
}

function shcView(shc: Readonly<ShcState>, job?: Readonly<ShcJob>, now?: number): EntityView {
  const facts: EntityView['facts'] = [
    { label: 'inspector.fact.operationalState', value: shcOperationalState(shc, now ?? -Infinity), token: 'shcState' },
    { label: 'inspector.fact.status', value: shc.status },
    { label: 'inspector.fact.node', value: shc.nodeId },
    { label: 'inspector.fact.carrying', value: shc.carrying, link: shc.carrying !== null },
  ]
  const working = shc.jobId !== null
  return {
    kind: 'shc',
    id: shc.id,
    facts,
    job: working
      ? [
          { label: 'inspector.fact.job', value: shc.jobId },
          { label: 'inspector.fact.container', value: job?.containerId ?? shc.carrying, link: true },
          { label: 'inspector.fact.fromPosition', value: job?.groundPositionId ?? null },
          { label: 'inspector.fact.toPad', value: job?.wtpPadId ?? null },
        ]
      : null,
    custody: [],
  }
}

export const shcKind: EquipmentKindDef<'shc'> = {
  kind: 'shc',
  sceneKey: 'shcs',
  rigKey: 'shcRigs',
  labelled: true,
  ids: (model) => model.shcIds,
  bounds(model, id, time) {
    const p = model.shcPose(id, time)
    const height = SHC.height + 3
    return { x: p.x, y: height / 2, z: p.z, sx: SHC.length + 1, sy: height, sz: SHC.width + 1, yaw: p.heading === 'z' ? Math.PI / 2 : 0 }
  },
  sceneState: (model, id, t) => ({ status: model.statusAt('shc', id, t), ...model.shcPose(id, t) }),
  describe: (state, extras) => shcView(state as ShcState, extras.job, extras.now),
  async loadExtras(state, query) {
    const jobId = (state as { jobId: string | null }).jobId
    return { job: (await query<{ id: string }[]>('shcJobs')).find((j) => j.id === jobId) as ShcJob | undefined }
  },
  createRenderer: (host) => new ShcRenderer(host),
}

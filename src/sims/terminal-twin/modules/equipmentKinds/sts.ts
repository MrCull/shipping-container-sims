/** STS quay crane: bounds, inspector view, dev-API state and its scene renderer (procedural placeholder, then the rigged GLB). */
import * as THREE from 'three'
import type { StsState } from '../../engine'
import type { EntityView } from '../entityInspector'
import { STS } from '../equipmentDims'
import { stsBeaconOffsets } from '../gantryBeacons'
import { spreaderModeFor } from '../spreaderMode'
import { loadStsTemplate, StsModel, type SpreaderMode } from '../stsAssets'
import type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

/** Z of the landside crane rail. */
const STS_LAND_RAIL_Z = STS.waterRailZ + STS.gauge

interface StsParts {
  group: THREE.Group
  trolley: THREE.Mesh
  ropes: THREE.Mesh
  spreader: THREE.Mesh
}

class StsRenderer implements KindRenderer {
  readonly wantsContainerOwners = true
  private sts = new Map<string, StsParts>()
  private stsModels = new Map<string, StsModel>()
  private lastSpreader = new Map<string, SpreaderMode>()

  constructor(private host: KindRendererHost) {
    const { config } = host.model
    for (const s of config.sts) {
      this.addSts(s.id)
      // Amber beacons at the model's `beaconMounts` (legs and portal beam ends).
      host.beacons.add(s.id, stsBeaconOffsets())
    }
    loadStsTemplate().then(
      (template) => {
        if (host.isDisposed()) return
        config.sts.forEach((s, i) => {
          const m = new StsModel(template, i)
          m.root.name = `${s.id}-model`
          host.scene.add(m.root)
          this.stsModels.set(s.id, m)
          const placeholder = this.sts.get(s.id)
          if (placeholder) placeholder.group.visible = false
        })
      },
      (err: unknown) => console.warn('Terminal Twin: STS GLB failed to load; keeping procedural cranes', err),
    )
  }

  private addSts(id: string): void {
    const track = this.host.track.bind(this.host)
    const group = new THREE.Group()
    group.name = id
    const steel = track(new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.6, metalness: 0.3 }))
    const accent = track(new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.6 }))
    const dark = track(new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.7 }))
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      group.add(m)
      return m
    }
    const zW = STS.waterRailZ
    const zL = STS_LAND_RAIL_Z
    const hx = STS.legSpacingX / 2
    for (const x of [-hx, hx]) {
      for (const z of [zW, zL]) box(STS.legSize, STS.portalY, STS.legSize, steel, x, STS.portalY / 2, z)
      box(STS.legSize, STS.legSize, zL - zW, steel, x, STS.portalY, (zW + zL) / 2) // portal side beams
      box(STS.legSize * 0.8, STS.legSize * 0.8, zL - zW, steel, x, 12, (zW + zL) / 2) // sill beams
      box(STS.legSize * 0.7, STS.apexY - STS.portalY, STS.legSize * 0.7, steel, x, (STS.apexY + STS.portalY) / 2, zL - 4) // A-frame
    }
    for (const z of [zW, zL]) box(STS.legSpacingX, STS.legSize, STS.legSize, steel, 0, STS.portalY, z)
    // Boom (girders on both sides of the trolley path) and the machinery house.
    const boomLen = STS.boomBackreachZ + zL - STS.boomOutreachZ
    const boomZ = (STS.boomOutreachZ + zL + STS.boomBackreachZ) / 2
    for (const x of [-3, 3]) box(1.2, 2.4, boomLen, steel, x, STS.portalY + 4, boomZ)
    box(7.2, 0.6, 2, accent, 0, STS.portalY + 4, STS.boomOutreachZ + 1) // boom tip
    box(10, 6, 14, steel, 0, STS.portalY + 9, zL + STS.boomBackreachZ - 8) // machinery house
    box(STS.legSpacingX + 2, 1.2, 2, accent, 0, STS.portalY + 1.2, zW) // waterside portal accent
    // Moving parts.
    const trolley = box(6.4, 2.4, 5, dark, 0, STS.portalY + 1.6, 0)
    const ropes = box(0.25, 1, 0.25, dark, 0, 0, 0)
    const spreader = box(12.2, 0.7, 2.5, track(new THREE.MeshStandardMaterial({ color: '#f2b705' })), 0, 0, 0)
    this.host.scene.add(group)
    this.sts.set(id, { group, trolley, ropes, spreader })
  }

  update(frame: KindFrame): void {
    const { model } = this.host
    const { t, cameraPosition } = frame
    for (const { id } of model.config.sts) {
      const gantrying = frame.live && model.isGantrying(id, t)
      const x = model.stsPose(id, t).gantryX
      this.host.beacons.update(id, { x, y: 0, z: 0 }, gantrying, frame.flashOn)
      frame.sounds.push({ id, machine: 'sts', x, y: 12, z: STS.waterRailZ + STS.gauge / 2, motion: gantrying ? 'gantrying' : 'idle' })
      if (frame.live && model.isWorking(id, t)) {
        // trolley and hoist whine, from the trolley
        const pose = model.stsPose(id, t)
        frame.sounds.push({ id, machine: 'sts', x, y: STS.portalY + 4, z: pose.trolleyZ, motion: 'working' })
      }
    }
    for (const [id, m] of this.stsModels) {
      const pose = model.stsPose(id, t)
      const l = frame.loads.get(`sts:${id}`)
      const mode: SpreaderMode = spreaderModeFor(l, { canTwin: true, previous: this.lastSpreader.get(id) })
      this.lastSpreader.set(id, mode)
      m.carrying = l?.count ?? 0
      m.setPose({ gantryX: pose.gantryX, trolleyZ: pose.trolleyZ, hoistY: pose.hoistY, spreader: mode, locked: !!l })
      m.updateLod(cameraPosition, frame.lodScale)
    }
    for (const [id, parts] of this.sts) {
      if (this.stsModels.has(id)) continue
      const pose = model.stsPose(id, t)
      parts.group.position.x = pose.gantryX
      parts.trolley.position.z = pose.trolleyZ
      parts.spreader.position.set(0, pose.hoistY + 0.35, pose.trolleyZ)
      const ropeTop = STS.portalY + 0.4
      const ropeLen = Math.max(0.1, ropeTop - (pose.hoistY + 0.7))
      parts.ropes.scale.y = ropeLen
      parts.ropes.position.set(0, ropeTop - ropeLen / 2, pose.trolleyZ)
    }
  }

  rigState(): Record<string, unknown> {
    return Object.fromEntries([...this.stsModels].map(([id, m]) => [id, m.renderState()]))
  }

  stats() {
    const models = [...this.stsModels.values()]
    return {
      sts: this.sts.size,
      stsAssets: models.length ? ('loaded' as const) : ('placeholder' as const),
      stsLods: { lod0: models.filter((m) => m.lod === 0).length, lod1: models.filter((m) => m.lod === 1).length, lod2: models.filter((m) => m.lod === 2).length },
    }
  }

  dispose(): void {
    for (const m of this.stsModels.values()) m.dispose()
  }
}

function stsView(sts: Readonly<StsState>): EntityView {
  const working = sts.carrying.length > 0 || sts.workQueue.length > 0
  return {
    kind: 'sts',
    id: sts.id,
    facts: [
      { label: 'inspector.fact.status', value: sts.status },
      { label: 'inspector.fact.vessel', value: sts.vesselId, link: sts.vesselId !== null },
      { label: 'inspector.fact.gantry', value: sts.gantryX, unit: 'length' },
      { label: 'inspector.fact.bays', value: sts.bays.join(', ') || null },
    ],
    job: working
      ? [
          { label: 'inspector.fact.carryingBoxes', value: sts.carrying.join(', ') || null },
          { label: 'inspector.fact.nextBox', value: sts.workQueue[0] ?? null, link: sts.workQueue.length > 0 },
          { label: 'inspector.fact.queued', value: sts.workQueue.length },
        ]
      : null,
    custody: [],
  }
}

export const stsKind: EquipmentKindDef<'sts'> = {
  kind: 'sts',
  sceneKey: 'sts',
  rigKey: 'stsRendered',
  labelled: true,
  ids: (model) => model.stsIds,
  bounds(model, id, time) {
    const p = model.stsPose(id, time)
    const height = STS.apexY + 1.3
    return { x: p.gantryX, y: height / 2, z: STS.waterRailZ + STS.gauge / 2, sx: STS.legSpacingX + 4, sy: height, sz: STS.gauge + 6, yaw: 0 }
  },
  sceneState: (model, id, t) => ({ status: model.statusAt('sts', id, t), ...model.stsPose(id, t), gantrying: model.isGantrying(id, t) }),
  describe: (state) => stsView(state as StsState),
  createRenderer: (host) => new StsRenderer(host),
}

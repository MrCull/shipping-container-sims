/** Automated stacking crane (ASC): bounds, inspector view, dev-API state and its scene renderer (procedural placeholder, then the rigged GLB). */
import * as THREE from 'three'
import type { AscState } from '../../engine'
import { AscRig, loadAscModel } from '../ascAssets'
import { ASC_MODEL, ascScaleY, HC_HEIGHT_M } from '../ascRig'
import type { EntityView } from '../entityInspector'
import { ASC, ascHeightM } from '../equipmentDims'
import { CONTAINER_DIMS } from '../sceneModel'
import type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

interface AscParts {
  group: THREE.Group
  trolley: THREE.Mesh
  spreader: THREE.Mesh
  ropes: THREE.Mesh
  blockX: number
  height: number
  tiers: number
  rig?: AscRig
}

class AscRenderer implements KindRenderer {
  private ascs = new Map<string, AscParts>()

  constructor(private host: KindRendererHost) {
    for (const id of host.model.ascIds) {
      this.addAsc(id)
      // Amber beacons at the four leg bases, on the rails.
      host.beacons.add(id, [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ x: (sx * ASC.span) / 2, y: 2.5, z: (sz * ASC.legLength) / 2 }))))
    }
    if (host.model.ascIds.length > 0) {
      loadAscModel().then(
        (ascModel) => {
          if (host.isDisposed()) return
          for (const [id, entry] of this.ascs) {
            entry.rig = new AscRig(ascModel, id)
            entry.group.visible = false
            host.scene.add(entry.rig.root)
          }
        },
        (err: unknown) => console.warn('Terminal Twin: ASC GLB failed to load; keeping placeholders', err),
      )
    }
  }

  /**
   * Procedural ASC: a portal on two rails that spans the rows (legs at the
   * rails, a girder across), a trolley on the girder and a hoisted spreader.
   * The group sits at the gantry Z; the trolley and spreader move in local X.
   */
  private addAsc(id: string): void {
    const track = this.host.track.bind(this.host)
    const block = this.host.model.blockOfAsc(id)
    const height = ascHeightM(block)
    const group = new THREE.Group()
    group.name = id
    const frame = track(new THREE.MeshStandardMaterial({ color: '#2f6fb3', roughness: 0.55, metalness: 0.25 }))
    const accent = track(new THREE.MeshStandardMaterial({ color: '#f2b705', roughness: 0.6 }))
    const dark = track(new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.8 }))
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      group.add(m)
      return m
    }
    for (const side of [-1, 1]) {
      const x = (side * ASC.span) / 2
      box(ASC.legWidth, height, ASC.legWidth, frame, x, height / 2, -ASC.legLength / 2 + 0.5)
      box(ASC.legWidth, height, ASC.legWidth, frame, x, height / 2, ASC.legLength / 2 - 0.5)
      box(ASC.legWidth * 1.4, 0.6, ASC.legLength + 1, dark, x, 0.4, 0) // bogie
      box(ASC.legWidth, 0.8, ASC.legLength, accent, x, height * 0.55, 0) // leg tie
    }
    box(ASC.span + 6, ASC.girderHeight, ASC.girderDepth, frame, 0, height + ASC.girderHeight / 2, 0)
    const trolley = box(3.2, 1.2, ASC.girderDepth - 0.4, accent, 0, height + ASC.girderHeight + 0.6, 0)
    const ropes = box(0.12, 1, 0.12, dark, 0, 0, 0)
    const spreader = box(6.4, 0.35, 2.6, accent, 0, 0, 0)
    this.host.scene.add(group)
    this.ascs.set(id, { group, trolley, spreader, ropes, blockX: block.x, height: height + ASC.girderHeight, tiers: block.tiers })
  }

  update(frame: KindFrame): void {
    const { model } = this.host
    const { t, cameraPosition } = frame
    for (const [id, parts] of this.ascs) {
      const pose = model.ascPose(id, t)
      const gantrying = frame.live && model.isGantrying(id, t)
      this.host.beacons.update(id, { x: parts.blockX, y: 0, z: pose.z }, gantrying, frame.flashOn)
      frame.sounds.push({ id, machine: 'asc', x: parts.blockX, y: 8, z: pose.z, motion: gantrying ? 'gantrying' : 'idle' })
      if (frame.live && model.isWorking(id, t)) frame.sounds.push({ id, machine: 'asc', x: pose.x, y: parts.height, z: pose.z, motion: 'working' })
      const lx = pose.x - parts.blockX
      const boxHeight = frame.carried.get(id)
      if (parts.rig) {
        parts.rig.chooseLod(Math.hypot(cameraPosition.x - pose.x, cameraPosition.y - 12, cameraPosition.z - pose.z) / frame.lodScale)
        // Twist-lock plane: the top of the carried box; empty, where the top of a high-cube box would be.
        parts.rig.pose({
          blockX: parts.blockX,
          trolleyX: lx,
          gantryZ: pose.z,
          attachY: pose.hoistY + (boxHeight ?? HC_HEIGHT_M),
          carrying: boxHeight !== undefined,
          tiers: parts.tiers,
        })
        continue
      }
      parts.group.position.set(parts.blockX, 0, pose.z)
      parts.trolley.position.x = lx
      const spreaderY = pose.hoistY + CONTAINER_DIMS['40HC'].height + 0.2
      parts.spreader.position.set(lx, spreaderY, 0)
      const ropeLen = Math.max(0.1, parts.height - spreaderY)
      parts.ropes.scale.y = ropeLen
      parts.ropes.position.set(lx, parts.height - ropeLen / 2, 0)
    }
  }

  rigState(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [id, { rig }] of this.ascs) if (rig) out[id] = { ...rig.rigState }
    return out
  }

  stats() {
    const ascLods = { lod0: 0, lod1: 0, lod2: 0 }
    let ascRigged = 0
    for (const { rig } of this.ascs.values()) {
      if (!rig) continue
      ascRigged++
      ascLods[`lod${rig.rigState.lod}` as keyof typeof ascLods]++
    }
    return { ascs: this.ascs.size, ascLods, ascAssets: ascRigged > 0 ? ('loaded' as const) : ('placeholder' as const) }
  }

  dispose(): void {
    // shared geometry and materials are disposed through the host's track()
  }
}

function ascView(asc: Readonly<AscState>): EntityView {
  return {
    kind: 'asc',
    id: asc.id,
    facts: [
      { label: 'inspector.fact.status', value: asc.status },
      { label: 'inspector.fact.block', value: asc.blockId },
      { label: 'inspector.fact.stacked', value: asc.stacked },
      { label: 'inspector.fact.carrying', value: asc.carrying, link: asc.carrying !== null },
    ],
    job:
      asc.jobId !== null
        ? [
            { label: 'inspector.fact.job', value: asc.jobId },
            { label: 'inspector.fact.container', value: asc.carrying, link: asc.carrying !== null },
          ]
        : null,
    custody: [],
  }
}

export const ascKind: EquipmentKindDef<'asc'> = {
  kind: 'asc',
  sceneKey: 'ascs',
  rigKey: 'ascRigs',
  labelled: true,
  ids: (model) => model.ascIds,
  bounds(model, id, time) {
    // The ASC GLB's overall box (rails to e-house roof), stretched for blocks taller than the model's design stack.
    const block = model.blockOfAsc(id)
    const height = ASC_MODEL.heightM * ascScaleY(block.tiers)
    return { x: block.x, y: height / 2, z: model.ascPose(id, time).z, sx: ASC_MODEL.widthM, sy: height, sz: ASC_MODEL.lengthM, yaw: 0 }
  },
  sceneState: (model, id, t) => ({ status: model.statusAt('asc', id, t), ...model.ascPose(id, t), gantrying: model.isGantrying(id, t) }),
  describe: (state) => ascView(state as AscState),
  createRenderer: (host) => new AscRenderer(host),
}

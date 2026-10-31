/** Vessel: bounds, inspector view, dev-API state and its scene renderer (placeholder hull, then the class GLB LODs in the line's livery). */
import type { VesselState } from '../../engine'
import { FENDER_GAP_M } from '../../scenario/vesselClasses'
import type { EntityView } from '../entityInspector'
import { VesselCountdownLabels } from '../vesselCountdownLabels'
import { VesselHulls } from '../vesselRenderer'
import type { VesselStatusInput } from '../vesselStatus'
import type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

class VesselRenderer implements KindRenderer {
  private vessels: VesselHulls
  private countdowns: VesselCountdownLabels

  constructor(host: KindRendererHost) {
    this.vessels = new VesselHulls(host.model)
    host.scene.add(this.vessels.group)
    this.countdowns = new VesselCountdownLabels(host.model)
    host.scene.add(this.countdowns.group)
  }

  update(frame: KindFrame): void {
    this.vessels.update(frame.t, frame.cameraPosition)
    this.countdowns.update(frame.t)
  }

  rigState(): Record<string, unknown> {
    return this.vessels.states()
  }

  stats() {
    const v = this.vessels.stats()
    return { vessels: v.visible, vesselAssets: v.assets, vesselLods: v.lods, vesselLabels: this.countdowns.states() }
  }

  dispose(): void {
    this.countdowns.dispose()
    this.vessels.dispose()
  }
}

function vesselView(v: Readonly<VesselState>, status?: VesselStatusInput): EntityView {
  return {
    vesselStatus: status,
    kind: 'vessel',
    id: v.id,
    facts: [
      { label: 'inspector.fact.status', value: v.status },
      { label: 'inspector.fact.class', value: v.sizeClass },
      { label: 'inspector.fact.berthX', value: v.berthX, unit: 'length' },
      { label: 'inspector.fact.stsAssigned', value: v.stsIds.join(', ') || null },
      { label: 'inspector.fact.remaining', value: v.remainingDischarge },
      { label: 'inspector.fact.anchorageWait', value: v.anchorageWaitS, unit: 'time' },
    ],
    job: null,
    custody: [],
  }
}

export const vesselKind: EquipmentKindDef<'vessel'> = {
  kind: 'vessel',
  sceneKey: 'vessels',
  rigKey: 'vesselHulls',
  labelled: true,
  ids: (model) => model.vesselIds,
  bounds(model, id, time) {
    const centre = model.entityCentre(id, time)
    if (!centre) return null
    const spec = model.vesselSpec(id)
    return { x: centre.x, y: spec.deckHeightM / 2, z: centre.z - FENDER_GAP_M, sx: spec.loaM + 2, sy: spec.deckHeightM + 14, sz: spec.beamM + 2, yaw: 0 }
  },
  sceneState: (model, id, t) => ({ status: model.statusAt('vessel', id, t) }),
  describe: (state, extras) => vesselView(state as VesselState, extras.vesselStatus as VesselStatusInput | undefined),
  async loadExtras(state, query) {
    return { vesselStatus: await query<VesselStatusInput>('vesselStatus', (state as VesselState).id) }
  },
  createRenderer: (host) => new VesselRenderer(host),
}

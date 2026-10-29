/** Landside truck: bounds, inspector view, dev-API state and its scene renderer (the landside scene: roads, gate, stalls and the trucks). */
import type { TruckState } from '../../engine'
import type { EntityView } from '../entityInspector'
import { TRUCK } from '../equipmentDims'
import { LandsideScene } from '../landsideRenderer'
import { loadTruckModels } from '../truckAssets'
import type { EquipmentKindDef, KindFrame, KindRenderer, KindRendererHost } from './types'

class TruckRenderer implements KindRenderer {
  private landside: LandsideScene

  constructor(host: KindRendererHost) {
    this.landside = new LandsideScene(host.model)
    host.scene.add(this.landside.group)
    if (host.model.config.landside) {
      loadTruckModels().then(
        (models) => {
          if (!host.isDisposed()) this.landside.setTruckModels(models)
        },
        (err: unknown) => console.warn('Terminal Twin: truck GLBs failed to load; keeping procedural trucks', err),
      )
    }
  }

  update(frame: KindFrame): void {
    this.landside.update(frame.t, frame.cameraPosition)
  }

  onInfrastructureLoaded(): void {
    this.landside.useGateModels()
  }

  rigState(): Record<string, unknown> {
    return this.landside.rigStates()
  }

  stats() {
    return { landside: this.landside.stats() }
  }

  dispose(): void {
    this.landside.dispose()
  }
}

function truckView(truck: Readonly<TruckState>): EntityView {
  const open = truck.legs.filter((l) => !l.done)
  return {
    kind: 'truck',
    id: truck.id,
    facts: [
      { label: 'inspector.fact.status', value: truck.status },
      { label: 'inspector.fact.transaction', value: truck.transaction },
      { label: 'inspector.fact.stall', value: truck.stallId },
      { label: 'inspector.fact.carrying', value: truck.carrying, link: truck.carrying !== null },
    ],
    job:
      open.length > 0
        ? open.map((l) => ({ label: 'inspector.fact.container' as const, value: l.containerId, link: true }))
        : null,
    custody: [],
  }
}

export const truckKind: EquipmentKindDef<'truck'> = {
  kind: 'truck',
  sceneKey: 'trucks',
  rigKey: 'truckRigs',
  labelled: false,
  ids: (model) => model.truckIds,
  bounds(model, id, time) {
    const p = model.truckPose(id, time)
    if (!p.visible) return null
    // the box on the chassis stands at the origin; the cab is ahead along the body's heading
    const cx = p.x + Math.cos(p.yaw) * ((TRUCK.rearX + TRUCK.frontX) / 2)
    const cz = p.z - Math.sin(p.yaw) * ((TRUCK.rearX + TRUCK.frontX) / 2)
    return { x: cx, y: TRUCK.height / 2, z: cz, sx: TRUCK.frontX - TRUCK.rearX + 0.6, sy: TRUCK.height, sz: TRUCK.width + 0.6, yaw: p.yaw }
  },
  sceneState: (model, id, t) => ({ status: model.statusAt('truck', id, t), ...model.truckPose(id, t) }),
  describe: (state) => truckView(state as TruckState),
  createRenderer: (host) => new TruckRenderer(host),
}

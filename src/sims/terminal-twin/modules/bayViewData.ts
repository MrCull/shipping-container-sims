/**
 * Bay viewer data (spec #106, #115): what the viewer needs about one vessel, gathered from the engine's query
 * interface (worker side, one round trip) as plain data for `buildBayView`. Properties are read tolerantly: a box
 * restored from a snapshot from before spec #106 has none.
 */
import type { ContainerState, SimQuery, TransitWorld } from '../engine'
import { resolveContainerProps } from '../scenario/containerProps'
import type { ScenarioConfig } from '../scenario/types'
import type { BayBox, BayViewData } from './bayView'
import { subjectOfBox } from './colourBy'

function boxOf(c: Readonly<ContainerState>, world: TransitWorld, now: number, vessels: ReadonlySet<string>): BayBox {
  const p = c.props
  const s = subjectOfBox(c, world, now, { vessels })
  return {
    id: c.id,
    size: c.size,
    line: c.line,
    full: c.full,
    custody: c.custody.kind,
    ...(p ? { isoType: p.isoType, pol: p.pol, pod: p.pod, weightClass: p.weightClass, grossKg: p.tareKg + p.cargoKg, direction: p.direction, plannedDepartureS: p.plannedDepartureS } : {}),
    transit: s.transit,
    arrivedS: s.arrivedS,
    leftS: s.leftS,
    onCall: s.onCall,
  }
}

export function collectBayViewData(
  q: Pick<SimQuery, 'now' | 'vessel' | 'vessels' | 'vesselSlots' | 'workPackages' | 'container' | 'containers' | 'truck'>,
  vesselId: string,
  config?: Pick<ScenarioConfig, 'containerProps'>,
): BayViewData {
  const v = q.vessel(vesselId)
  const now = q.now()
  const vessels = new Set(q.vessels().map((x) => x.id))
  const world: TransitWorld = {
    vesselStatus: (id) => q.vessel(id).status,
    truckStatus: (id) => {
      try {
        return q.truck(id).status
      } catch {
        return undefined // a truck that has left and been forgotten
      }
    },
  }
  const boxOf_ = (c: Readonly<ContainerState>): BayBox => boxOf(c, world, now, vessels)
  const slots = [...q.vesselSlots(vesselId)]
  const boxes: BayViewData['boxes'] = {}
  const lost = new Set<string>()
  for (const s of slots) {
    const id = s.containerId ?? s.plannedContainerId
    if (id) boxes[s.id] = boxOf_(q.container(id))
    else if (s.purpose === 'discharge') lost.add(s.id)
  }
  // a discharged slot no longer names its box: it is the first owner in the box's custody history
  if (lost.size > 0) {
    for (const c of q.containers()) {
      if (c.vesselId !== vesselId) continue
      const first = c.custodyHistory[0]?.owner
      if (first && first.kind === 'vesselSlot' && lost.has(first.id)) boxes[first.id] = boxOf_(c)
    }
  }
  return {
    vesselId,
    sizeClass: v.sizeClass,
    status: v.status,
    slots,
    boxes,
    packages: q.workPackages().filter((p) => p.vesselId === vesselId),
    robBoxes: [...(v.robBoxes ?? [])],
    now,
    ...(config ? { ports: [...resolveContainerProps(config).portRotation.ports] } : {}),
  }
}

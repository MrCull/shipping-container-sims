import type { Container, TruckVisit } from '../types'

export interface RenderEntityIndexes {
  containerById: Map<string, Container>
  containersByVesselId: Map<string, Container[]>
  truckById: Map<string, TruckVisit>
  truckByContainerId: Map<string, TruckVisit>
}

export function buildRenderEntityIndexes(
  containers: Container[],
  trucks: TruckVisit[],
): RenderEntityIndexes {
  const containerById = new Map<string, Container>()
  const containersByVesselId = new Map<string, Container[]>()
  const truckById = new Map<string, TruckVisit>()
  const truckByContainerId = new Map<string, TruckVisit>()

  for (const container of containers) {
    containerById.set(container.id, container)
    const vesselId = container.vesselSlot?.vesselId
    if (vesselId) {
      const list = containersByVesselId.get(vesselId) ?? []
      list.push(container)
      containersByVesselId.set(vesselId, list)
    }
  }

  for (const truck of trucks) {
    truckById.set(truck.id, truck)
    if (truck.containerId) truckByContainerId.set(truck.containerId, truck)
  }

  return { containerById, containersByVesselId, truckById, truckByContainerId }
}

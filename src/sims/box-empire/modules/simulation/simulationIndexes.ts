import type { BoxEmpireState, Container, Equipment, Job, TruckVisit, VesselVisit } from '../../types'

export interface SimulationIndexes {
  containerById: Map<string, Container>
  equipmentById: Map<string, Equipment>
  jobById: Map<string, Job>
  activeJobByContainerId: Map<string, Job>
  truckById: Map<string, TruckVisit>
  vesselById: Map<string, VesselVisit>
}

export function buildSimulationIndexes(state: BoxEmpireState): SimulationIndexes {
  const containerById = new Map<string, Container>()
  const equipmentById = new Map<string, Equipment>()
  const jobById = new Map<string, Job>()
  const activeJobByContainerId = new Map<string, Job>()
  const truckById = new Map<string, TruckVisit>()
  const vesselById = new Map<string, VesselVisit>()

  for (const container of state.containers) {
    containerById.set(container.id, container)
  }
  for (const eq of state.equipment) {
    equipmentById.set(eq.id, eq)
  }
  for (const job of state.jobs) {
    jobById.set(job.id, job)
    if (
      job.status === 'pending' ||
      job.status === 'assigned' ||
      job.status === 'in_progress' ||
      job.status === 'blocked'
    ) {
      if (!activeJobByContainerId.has(job.containerId)) {
        activeJobByContainerId.set(job.containerId, job)
      }
    }
  }
  for (const truck of state.truckVisits) {
    truckById.set(truck.id, truck)
  }
  for (const vessel of state.vesselVisits) {
    vesselById.set(vessel.id, vessel)
  }

  return { containerById, equipmentById, jobById, activeJobByContainerId, truckById, vesselById }
}

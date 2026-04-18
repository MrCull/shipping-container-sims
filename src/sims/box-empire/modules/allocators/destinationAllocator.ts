import type { Container, Job, Position3D, TruckVisit, VesselVisit, YardBlock, YardSlotRef } from '../../types'
import { makeVesselSlotId, makeYardSlotId } from '../../types'
import { QUAY_BUFFER_DISCHARGE_POSITION, QUAY_BUFFER_LOAD_POSITION } from '../config'
import { createJob } from '../jobScheduler'
import { getTruckContainerPositionForVisitType } from '../truckManager'
import { getVesselSlotPosition } from '../vesselManager'
import { getSlotWorldPosition } from '../yardManager'

export function getDischargeExchangePositionForCraneX(craneX: number): Position3D {
  return { ...QUAY_BUFFER_DISCHARGE_POSITION, x: craneX + QUAY_BUFFER_DISCHARGE_POSITION.x }
}

export function getLoadExchangePositionForCraneX(craneX: number): Position3D {
  return { ...QUAY_BUFFER_LOAD_POSITION, x: craneX + QUAY_BUFFER_LOAD_POSITION.x }
}

export function createExportTruckToYardJob(
  truck: TruckVisit,
  yard: YardBlock,
  slot: YardSlotRef,
  simTime: number,
): Job | null {
  if (!truck.containerId) return null
  const slotId = makeYardSlotId(slot.blockId, slot.bay, slot.row, slot.tier)
  return createJob(
    truck.containerId,
    { type: 'truck', id: truck.id, position: getTruckContainerPositionForVisitType(truck.visitType) },
    { type: 'yard_slot', id: slotId, position: getSlotWorldPosition(yard, slot) },
    'reach_stacker',
    10,
    simTime,
  )
}

export function createImportYardToTruckJob(
  container: Container,
  truck: TruckVisit,
  simTime: number,
): Job | null {
  if (!container.yardSlot) return null
  const slotId = makeYardSlotId(
    container.yardSlot.blockId,
    container.yardSlot.bay,
    container.yardSlot.row,
    container.yardSlot.tier,
  )
  return createJob(
    container.id,
    { type: 'yard_slot', id: slotId, position: { ...container.currentLocation.position } },
    { type: 'truck', id: truck.id, position: getTruckContainerPositionForVisitType(truck.visitType) },
    'reach_stacker',
    8,
    simTime,
  )
}

export function createVesselDischargeJob(
  vessel: VesselVisit,
  containerId: string,
  bay: number,
  row: number,
  tier: number,
  simTime: number,
): Job {
  const vesselPos = getVesselSlotPosition(vessel, bay, row, tier)
  const slotId = makeVesselSlotId(vessel.id, bay, row, tier)
  return createJob(
    containerId,
    { type: 'vessel_slot', id: slotId, position: vesselPos },
    { type: 'quay_buffer', id: 'quay-discharge', position: getDischargeExchangePositionForCraneX(vesselPos.x) },
    'mobile_harbor_crane',
    12,
    simTime,
  )
}

export function createImportQuayToYardJob(
  containerId: string,
  yard: YardBlock,
  slot: YardSlotRef,
  pickupPosition: Position3D,
  simTime: number,
): Job {
  const slotId = makeYardSlotId(slot.blockId, slot.bay, slot.row, slot.tier)
  return createJob(
    containerId,
    { type: 'quay_buffer', id: 'quay-discharge', position: pickupPosition },
    { type: 'yard_slot', id: slotId, position: getSlotWorldPosition(yard, slot) },
    'reach_stacker',
    10.5,
    simTime,
  )
}

export function createExportYardToQuayJob(
  container: Container,
  yard: YardBlock,
  simTime: number,
  loadExchangePosition: Position3D = { ...QUAY_BUFFER_LOAD_POSITION },
): Job | null {
  if (!container.yardSlot) return null
  const slotId = makeYardSlotId(
    container.yardSlot.blockId,
    container.yardSlot.bay,
    container.yardSlot.row,
    container.yardSlot.tier,
  )
  return createJob(
    container.id,
    { type: 'yard_slot', id: slotId, position: getSlotWorldPosition(yard, container.yardSlot) },
    { type: 'quay_buffer', id: 'quay-load', position: loadExchangePosition },
    'reach_stacker',
    10.25,
    simTime,
  )
}

export function createExportQuayToVesselJob(
  containerId: string,
  vessel: VesselVisit,
  bay: number,
  row: number,
  tier: number,
  simTime: number,
  priority = 10,
  pickupPosition: Position3D = { ...QUAY_BUFFER_LOAD_POSITION },
): Job {
  const vesselPos = getVesselSlotPosition(vessel, bay, row, tier)
  const slotId = makeVesselSlotId(vessel.id, bay, row, tier)
  return createJob(
    containerId,
    { type: 'quay_buffer', id: 'quay-load', position: pickupPosition },
    { type: 'vessel_slot', id: slotId, position: vesselPos },
    'mobile_harbor_crane',
    priority,
    simTime,
  )
}

export function createYardShuffleJob(
  containerId: string,
  yard: YardBlock,
  from: YardSlotRef,
  to: YardSlotRef,
  simTime: number,
): Job {
  return createJob(
    containerId,
    {
      type: 'yard_slot',
      id: makeYardSlotId(from.blockId, from.bay, from.row, from.tier),
      position: getSlotWorldPosition(yard, from),
    },
    {
      type: 'yard_slot',
      id: makeYardSlotId(to.blockId, to.bay, to.row, to.tier),
      position: getSlotWorldPosition(yard, to),
    },
    'reach_stacker',
    15,
    simTime,
  )
}

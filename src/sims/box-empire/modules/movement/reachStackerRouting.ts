import type { Job, Location, Position3D } from '../../types'
import {
  RS_QUAY_PARK_OFFSET,
  RS_TRUCK_PARK_OFFSET,
  RS_YARD_PARK_OFFSET,
} from '../config'
import type { OccupancyWorld } from './occupancyWorld'
import {
  getYardServiceLanes,
  REACH_STACKER_FOOTPRINT,
  type YardServiceLanes,
} from './terminalGeometry'

type YardServiceSide = 'landside' | 'waterside'
type JobEndpoint = 'pickup' | 'dropoff'

function distanceTo(a: Position3D, b: Position3D): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function pushWaypoint(points: Position3D[], point: Position3D): void {
  const previous = points[points.length - 1]
  if (previous && Math.abs(previous.x - point.x) < 0.1 && Math.abs(previous.z - point.z) < 0.1) return
  points.push(point)
}

function sideForZ(z: number, lanes: YardServiceLanes = getYardServiceLanes()): YardServiceSide {
  const landsideDistance = Math.abs(z - lanes.landsideZ)
  const watersideDistance = Math.abs(z - lanes.watersideZ)
  if (z >= lanes.roadEdgeZ) return 'landside'
  if (z <= lanes.seaEdgeZ) return 'waterside'
  return landsideDistance <= watersideDistance ? 'landside' : 'waterside'
}

function laneZ(side: YardServiceSide, lanes: YardServiceLanes = getYardServiceLanes()): number {
  return side === 'landside' ? lanes.landsideZ : lanes.watersideZ
}

function serviceSideForYardEndpoint(current: Position3D, job: Job, endpoint: JobEndpoint): YardServiceSide {
  const yardLocation = endpoint === 'pickup' ? job.pickupLocation : job.dropoffLocation
  const otherLocation = endpoint === 'pickup' ? job.dropoffLocation : job.pickupLocation

  if (yardLocation.type !== 'yard_slot') return sideForZ(yardLocation.position.z)
  if (otherLocation.type === 'truck') return 'landside'
  if (otherLocation.type === 'quay_buffer' || otherLocation.type === 'vessel_slot') return 'waterside'
  // yard→yard shuffle: stay on whichever side the RS is already on
  return sideForZ(current.z)
}

function parkingSideForEndpoint(current: Position3D, job: Job, endpoint: JobEndpoint, location: Location): YardServiceSide {
  if (location.type === 'yard_slot') return serviceSideForYardEndpoint(current, job, endpoint)
  if (location.type === 'quay_buffer' || location.type === 'vessel_slot') return 'waterside'
  return 'landside'
}

function chooseBestPosition(
  current: Position3D,
  candidates: Position3D[],
  occupancy?: OccupancyWorld,
  movingEntityId = '__reach-stacker-route-probe__',
): Position3D {
  const available = occupancy
    ? candidates.filter(candidate => occupancy.canOccupy(movingEntityId, candidate, REACH_STACKER_FOOTPRINT).allowed)
    : candidates
  const pool = available.length > 0 ? available : candidates
  return pool.reduce((best, candidate) =>
    distanceTo(current, candidate) <= distanceTo(current, best) ? candidate : best,
  )
}

function yardParkingPosition(current: Position3D, job: Job, endpoint: JobEndpoint, target: Position3D): Position3D {
  const side = serviceSideForYardEndpoint(current, job, endpoint)
  return {
    x: target.x,
    y: 0,
    z: side === 'landside'
      ? target.z + RS_YARD_PARK_OFFSET
      : target.z - RS_YARD_PARK_OFFSET,
  }
}

function truckParkingPosition(
  current: Position3D,
  target: Position3D,
  occupancy?: OccupancyWorld,
  movingEntityId?: string,
): Position3D {
  return chooseBestPosition(current, [
    { x: target.x + RS_TRUCK_PARK_OFFSET, y: 0, z: target.z },
    { x: target.x - RS_TRUCK_PARK_OFFSET, y: 0, z: target.z },
  ], occupancy, movingEntityId)
}

function quayParkingPosition(target: Position3D): Position3D {
  return {
    x: target.x,
    y: 0,
    z: target.z + RS_QUAY_PARK_OFFSET,
  }
}

export function reachStackerParkingPosition(
  current: Position3D,
  job: Job,
  endpoint: JobEndpoint,
  occupancy?: OccupancyWorld,
  movingEntityId?: string,
): Position3D {
  const location = endpoint === 'pickup' ? job.pickupLocation : job.dropoffLocation
  if (location.type === 'truck') return truckParkingPosition(current, location.position, occupancy, movingEntityId)
  if (location.type === 'yard_slot') return yardParkingPosition(current, job, endpoint, location.position)
  if (location.type === 'quay_buffer') return quayParkingPosition(location.position)
  return { x: location.position.x, y: 0, z: location.position.z }
}

export function buildReachStackerRoute(
  from: Position3D,
  to: Position3D,
  job: Job,
  endpoint: JobEndpoint,
): Position3D[] {
  const points: Position3D[] = []
  const lanes = getYardServiceLanes()
  const destination = endpoint === 'pickup' ? job.pickupLocation : job.dropoffLocation
  const targetSide = parkingSideForEndpoint(from, job, endpoint, destination)
  const fromSide = sideForZ(from.z, lanes)
  const fromLaneZ = laneZ(fromSide, lanes)
  const targetLaneZ = laneZ(targetSide, lanes)
  const crossesYard = fromSide !== targetSide

  if (Math.abs(from.z - fromLaneZ) > 0.5) {
    pushWaypoint(points, { x: from.x, y: 0, z: fromLaneZ })
  }

  if (crossesYard) {
    const bypassX = Math.min(from.x, to.x, lanes.bypassX)
    pushWaypoint(points, { x: bypassX, y: 0, z: fromLaneZ })
    pushWaypoint(points, { x: bypassX, y: 0, z: targetLaneZ })
  }

  if (Math.abs(to.x - (points[points.length - 1]?.x ?? from.x)) > 0.5) {
    pushWaypoint(points, { x: to.x, y: 0, z: targetLaneZ })
  }
  pushWaypoint(points, { x: to.x, y: 0, z: to.z })

  return points
}

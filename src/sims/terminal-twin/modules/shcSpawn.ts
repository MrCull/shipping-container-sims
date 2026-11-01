/**
 * Where a shuttle carrier faces when it appears (#142). It spawns looking down its first leg, so the first move
 * needs no turn on the spot. Before any leg is known it faces along its parking bay towards the work: the
 * parking area lies west of the apron and its bays run along X (`laneGraph.ts`, #160), so that is east (+X, yaw 0).
 */

/** Yaw (rad about +Y, three.js sense) of a drive along an axis towards `to`: 0 = +X, -pi/2 = +Z, pi/2 = -Z, pi = -X. */
export function driveYaw(axis: 'x' | 'z', from: number, to: number): number {
  const d = to - from
  return axis === 'x' ? (d > 0 ? 0 : Math.PI) : d > 0 ? -Math.PI / 2 : Math.PI / 2
}

/** Yaw before the first leg is known: along the parking row, towards the work (east). */
export const SHC_PARKING_YAW = 0

/** Spawn yaw for a shuttle carrier whose first leg is `first` (null: none known yet). */
export function shcSpawnYaw(first: { axis: 'x' | 'z'; from: number; to: number } | null): number {
  return first ? driveYaw(first.axis, first.from, first.to) : SHC_PARKING_YAW
}

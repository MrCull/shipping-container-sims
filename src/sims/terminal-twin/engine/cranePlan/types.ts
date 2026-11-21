/**
 * Crane plan (#288): per vessel, which cranes work which bays and each crane's ordered packages, with predicted times.
 * The plan is authoritative for order and advisory for time: the engine works packages in plan order and never waits
 * for a predicted start. Everything here is plain data; the pure functions live in the sibling files.
 */
import type { WorkPackageKind } from '../state'

/** The name of a plan strategy. `as-today` and `balanced-moves` are the same plan (balanced split, today's order). */
export type CranePlanStrategy = string

/** One package as the plan functions see it (an engine `WorkPackage` boiled down). */
export interface PlanPackage {
  id: string
  kind: WorkPackageKind
  section: 'deck' | 'hold'
  /** Internal bay index. */
  bay: number
  /** Gantry X of the bay (m). */
  bayX: number
  moves: number
  status: 'planned' | 'released' | 'active' | 'complete'
  /** The (row, tier) cells the package works, in work order (discharge and load packages). */
  cells: { row: number; tier: number }[]
}

/** One crane's part of a plan. */
export interface PlanCrane {
  stsId: string
  railIndex: number
  bays: number[]
  packageIds: string[]
}

/** The plan record kept in `SimState.cranePlans`, by vessel id. */
export interface CranePlanRecord {
  vesselId: string
  strategy: CranePlanStrategy
  /** 1 for the plan made at the crane split; a later re-plan raises it. */
  revision: number
  madeAtS: number
  cranes: PlanCrane[]
  /** Predicted conflict seconds computed when the plan was made (kept for the accuracy report). */
  predictedConflictS: number
  /** Per crane: its `kpis.perSts[id].railWaitS` when it was assigned, and when it finished (null while working). */
  railWaitStartS: Record<string, number>
  railWaitEndS: Record<string, number | null>
}

/** A predicted time interval of one package. */
export interface PackageTime {
  startS: number
  endS: number
}

/** A time window in which two neighbouring cranes are planned closer than the minimum spacing. */
export interface ConflictWindow {
  /** The crane lower on the rail, then the one above it. */
  stsA: string
  stsB: string
  /** True when one of the two works another vessel and is treated as fixed. */
  obstacle: boolean
  fromS: number
  toS: number
  /** Gantry X of the two cranes at the start of the window (m). */
  xA: number
  xB: number
}

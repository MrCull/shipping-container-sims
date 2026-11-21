/**
 * Crane plan view model (#288): pure TS, no Vue. Turns the engine's `CranePlanView` into what the Crane plan view
 * draws: bays across (in quay order), time down, one band per crane, a bar per package (the actual times once
 * worked), the planned ghost of a late package, predicted conflict marks, neighbouring cranes as obstacles and a
 * now line. The component only draws it.
 */
import type { CranePlanView, PlanPackageView } from '../engine'
import { VESSEL_CLASSES } from '../scenario/vesselClasses'
import type { VesselSizeClass } from '../scenario/types'
import { vesselBayNumber } from './locationNotation'

export interface PlanColumn {
  bay: number
  /** Bay number in maritime notation. */
  number: number
  x: number
}

export interface PlanBar {
  id: string
  stsId: string
  bay: number
  /** Column index. */
  col: number
  kind: PlanPackageView['kind']
  section: 'deck' | 'hold'
  status: PlanPackageView['status']
  moves: number
  /** Seconds from the start of the time axis. */
  fromS: number
  toS: number
  /** True when the bar shows actual times (started), false when predicted. */
  actual: boolean
  /** The originally planned interval when it differs from the bar by more than a second, else null. */
  ghost: { fromS: number; toS: number } | null
  details: PlanPackageView
}

export interface PlanBand {
  stsId: string
  /** 0-based colour index in rail order. */
  colour: number
  colFrom: number
  colTo: number
}

export interface PlanConflictMark {
  stsA: string
  stsB: string
  obstacle: boolean
  fromS: number
  toS: number
  /** Fractional column positions of the two cranes at the start of the window. */
  colA: number
  colB: number
}

export interface PlanObstacleMark {
  stsId: string
  vesselId: string
  /** Fractional column position (outside 0..n-1 when beyond the vessel's work). */
  col: number
}

export interface CranePlanModel {
  vesselId: string
  strategy: string
  revision: number
  columns: PlanColumn[]
  bands: PlanBand[]
  bars: PlanBar[]
  conflicts: PlanConflictMark[]
  obstacles: PlanObstacleMark[]
  /** Time axis, seconds. */
  t0: number
  t1: number
  nowS: number
  conflictS: number
}

/** Obstacles further than this many minimum spacings from the vessel's work span are left out. */
const OBSTACLE_REACH = 2

export function buildCranePlanModel(view: CranePlanView, sizeClass: VesselSizeClass): CranePlanModel {
  const spec = VESSEL_CLASSES[sizeClass]
  const bays = [...new Set(view.cranes.flatMap((c) => c.bays))].sort((a, b) => (view.bayX[a] ?? 0) - (view.bayX[b] ?? 0))
  const columns: PlanColumn[] = bays.map((bay) => ({ bay, number: vesselBayNumber(bay, spec.bays, null), x: view.bayX[bay] ?? 0 }))
  const colOf = new Map(columns.map((c, i) => [c.bay, i]))
  const pitch = columns.length > 1 ? (columns[columns.length - 1].x - columns[0].x) / (columns.length - 1) : view.minSpacingM || 1
  const colAt = (x: number): number => (columns.length ? (x - columns[0].x) / pitch : 0)

  const bands: PlanBand[] = []
  const bars: PlanBar[] = []
  view.cranes.forEach((c, i) => {
    const cols = c.bays.map((b) => colOf.get(b) as number)
    bands.push({ stsId: c.stsId, colour: i, colFrom: Math.min(...cols), colTo: Math.max(...cols) })
    for (const p of c.packages) {
      const started = p.actualStartS !== null
      const fromS = started ? (p.actualStartS as number) : p.predictedStartS
      const toS = p.actualEndS ?? Math.max(p.predictedEndS, fromS)
      const differs = Math.abs(p.plannedStartS - fromS) > 1 || Math.abs(p.plannedEndS - toS) > 1
      bars.push({
        id: p.id,
        stsId: c.stsId,
        bay: p.bay,
        col: colOf.get(p.bay) as number,
        kind: p.kind,
        section: p.section,
        status: p.status,
        moves: p.moves,
        fromS,
        toS,
        actual: started,
        ghost: differs ? { fromS: p.plannedStartS, toS: p.plannedEndS } : null,
        details: p,
      })
    }
  })

  const conflicts = view.conflicts.map((w) => ({
    stsA: w.stsA,
    stsB: w.stsB,
    obstacle: w.obstacle,
    fromS: w.fromS,
    toS: w.toS,
    colA: colAt(w.xA),
    colB: colAt(w.xB),
  }))
  const lo = columns[0]?.x ?? 0
  const hi = columns[columns.length - 1]?.x ?? 0
  const reach = OBSTACLE_REACH * view.minSpacingM
  const obstacles = view.obstacles
    .filter((o) => o.x >= lo - reach && o.x <= hi + reach)
    .map((o) => ({ stsId: o.stsId, vesselId: o.vesselId, col: colAt(o.x) }))

  const times = bars.flatMap((b) => [b.fromS, b.toS, ...(b.ghost ? [b.ghost.fromS, b.ghost.toS] : [])])
  const t0 = Math.min(view.now, ...times)
  const t1 = Math.max(view.now, ...times, t0 + 1)
  return {
    vesselId: view.vesselId,
    strategy: view.strategy,
    revision: view.revision,
    columns,
    bands,
    bars,
    conflicts,
    obstacles,
    t0,
    t1,
    nowS: view.now,
    conflictS: conflicts.reduce((n, w) => n + (w.toS - w.fromS), 0),
  }
}

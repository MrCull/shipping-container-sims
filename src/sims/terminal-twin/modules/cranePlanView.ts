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
  /** The crane that works this bay. */
  stsId: string
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
  /** Stable colour slot 0 to 7 of the crane (`craneColour`). */
  colour: number
  /** Bay numbers of the crane, in quay order. */
  bayNumbers: number[]
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
  /** Time ticks (s), every hour when the span allows it. */
  ticks: number[]
  conflicts: PlanConflictMark[]
  obstacles: PlanObstacleMark[]
  /** Time axis, seconds. */
  t0: number
  t1: number
  nowS: number
  conflictS: number
}

export const CRANE_COLOURS = 8

/** A crane keeps its colour slot on every vessel: the number in its id (STS103 gives 103), else a hash of the id. */
export function craneColour(stsId: string): number {
  const n = Number(/(\d+)$/.exec(stsId)?.[1])
  if (Number.isFinite(n)) return n % CRANE_COLOURS
  let h = 0
  for (const ch of stsId) h = (h * 31 + ch.charCodeAt(0)) % 997
  return h % CRANE_COLOURS
}

/** Hour ticks when at most 14 fit, else the next coarser step. */
export function timeTicks(t0: number, t1: number): number[] {
  const span = t1 - t0
  const step = [60, 300, 600, 1800, 3600, 7200, 14400, 21600, 43200].find((s) => span / s <= 14 && (s >= 3600 || span < 3600 * 2)) ?? 86400
  const out: number[] = []
  for (let s = Math.ceil(t0 / step) * step; s <= t1; s += step) out.push(s)
  return out
}

/** Obstacles further than this many minimum spacings from the vessel's work span are left out. */
const OBSTACLE_REACH = 2

/**
 * `displayS`: the sim time the 3D scene draws (the engine runs ahead of it). The now line sits there and what the engine
 * has done since is not shown as done: a package that started after it reads as predicted, and an open one is drawn at least up to it.
 */
export function buildCranePlanModel(view: CranePlanView, sizeClass: VesselSizeClass, displayS: number = view.now): CranePlanModel {
  const spec = VESSEL_CLASSES[sizeClass]
  const bays = [...new Set(view.cranes.flatMap((c) => c.bays))].sort((a, b) => (view.bayX[a] ?? 0) - (view.bayX[b] ?? 0))
  const owner = new Map(view.cranes.flatMap((c) => c.bays.map((b) => [b, c.stsId] as const)))
  const columns: PlanColumn[] = bays.map((bay) => ({ stsId: owner.get(bay) as string, bay, number: vesselBayNumber(bay, spec.bays, null), x: view.bayX[bay] ?? 0 }))
  const colOf = new Map(columns.map((c, i) => [c.bay, i]))
  const pitch = columns.length > 1 ? (columns[columns.length - 1].x - columns[0].x) / (columns.length - 1) : view.minSpacingM || 1
  const colAt = (x: number): number => (columns.length ? (x - columns[0].x) / pitch : 0)

  const bands: PlanBand[] = []
  const bars: PlanBar[] = []
  view.cranes.forEach((c) => {
    const cols = c.bays.map((b) => colOf.get(b) as number)
    bands.push({
      stsId: c.stsId,
      colour: craneColour(c.stsId),
      bayNumbers: cols.map((i) => columns[i].number),
      colFrom: Math.min(...cols),
      colTo: Math.max(...cols),
    })
    for (const p of c.packages) {
      const started = p.actualStartS !== null && p.actualStartS <= displayS
      const fromS = started ? (p.actualStartS as number) : p.predictedStartS
      const finished = started && p.actualEndS !== null && p.actualEndS <= displayS
      const toS = finished ? (p.actualEndS as number) : Math.max(p.predictedEndS, fromS, started ? displayS : fromS)
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
  const t0 = Math.min(displayS, ...times)
  const t1 = Math.max(displayS, ...times, t0 + 1)
  return {
    vesselId: view.vesselId,
    strategy: view.strategy,
    revision: view.revision,
    columns,
    bands,
    bars,
    ticks: timeTicks(t0, t1),
    conflicts,
    obstacles,
    t0,
    t1,
    nowS: displayS,
    conflictS: conflicts.reduce((n, w) => n + (w.toS - w.fromS), 0),
  }
}

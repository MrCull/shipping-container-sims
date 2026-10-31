/**
 * Vessel status (spec #116, #126): what the vessel popup and the floating label say about one vessel.
 * `buildVesselStatus(input, now)` is pure: it turns the view fields (ETA, berth allocation and berth times, mooring
 * time, move counts) and the sim time into a phase, an estimated operations start with its countdown, and moves done
 * and remaining overall and per STS. The input is plain data, built either from the engine's query (`collectVesselStatusInput`,
 * served by the worker query kind `vesselStatus`) or from the scene model's status timeline (`vesselStatusInputFromModel`, for
 * the labels, which run every frame). Both are read-only: the event log and the goldens do not change.
 */
import type { SimQuery, VesselStatus } from '../engine'
import type { ScenarioConfig } from '../scenario/types'
import type { SceneModel } from './sceneModel'

export type VesselPhase = 'approaching' | 'waiting' | 'mooring' | 'working' | 'unmooring' | 'departed'

export interface VesselStatusInput {
  status: VesselStatus
  /** Scheduled arrival (s), null when unknown. */
  etaS: number | null
  /** When the berth was allocated (mooring began), once known. */
  berthAllocatedS: number | null
  /** When mooring ended and operations could start, once known. */
  berthedS: number | null
  departedS: number | null
  /** The mooring time (s): berth allocation plus this is the estimated operations start. */
  mooringS: number
  /** Boxes to move for this vessel and how many are done. */
  moves: { total: number; done: number }
  perSts: { id: string; total: number; done: number }[]
}

export interface MovesCount {
  total: number
  done: number
  remaining: number
}

/** The label over a vessel that is not yet working: its phase and the countdown (null = no estimate). */
export interface VesselLabel {
  phase: VesselPhase
  countdownS: number | null
}

export interface VesselStatusView {
  phase: VesselPhase
  etaS: number | null
  /** Seconds to the ETA while the vessel is still approaching (never below 0), else null. */
  etaCountdownS: number | null
  /** Operations start: the actual berth time once berthed, an estimate while mooring, else null (unknown). */
  opsStartS: number | null
  opsStartEstimated: boolean
  /** Seconds to the estimated operations start (never below 0), null when unknown or already working. */
  countdownS: number | null
  moves: MovesCount
  perSts: (MovesCount & { id: string })[]
  /** Null once the vessel works (or has worked): no label. */
  label: VesselLabel | null
}

const PHASE: Record<VesselStatus, VesselPhase> = {
  scheduled: 'approaching',
  'at-anchorage': 'waiting',
  mooring: 'mooring',
  berthed: 'working',
  unmooring: 'unmooring',
  departed: 'departed',
}

const counts = (c: { total: number; done: number }): MovesCount => {
  const done = Math.max(0, Math.min(c.done, c.total))
  return { total: c.total, done, remaining: c.total - done }
}

export function buildVesselStatus(input: VesselStatusInput, now: number): VesselStatusView {
  const phase = PHASE[input.status]
  const beforeWork = phase === 'approaching' || phase === 'waiting' || phase === 'mooring'
  let opsStartS: number | null = null
  let opsStartEstimated = false
  if (input.berthedS !== null) opsStartS = input.berthedS
  else if (input.berthAllocatedS !== null) {
    opsStartS = input.berthAllocatedS + input.mooringS
    opsStartEstimated = true
  }
  const countdownS = beforeWork && opsStartS !== null ? Math.max(0, opsStartS - now) : null
  const etaCountdownS = phase === 'approaching' && input.etaS !== null ? Math.max(0, input.etaS - now) : null
  return {
    phase,
    etaS: input.etaS,
    etaCountdownS,
    opsStartS,
    opsStartEstimated,
    countdownS,
    moves: counts(input.moves),
    perSts: input.perSts.map((s) => ({ id: s.id, ...counts(s) })),
    label: beforeWork ? { phase, countdownS: phase === 'approaching' ? etaCountdownS : countdownS } : null,
  }
}

/** The engine's view of one vessel: its times, and the boxes of its work packages (done = complete packages + progress of the one being worked). */
export function collectVesselStatusInput(
  q: Pick<SimQuery, 'vessel' | 'workPackages' | 'sts'>,
  config: Pick<ScenarioConfig, 'vessels' | 'quay'>,
  vesselId: string,
): VesselStatusInput {
  const v = q.vessel(vesselId)
  const cfg = config.vessels.find((c) => c.id === vesselId)
  const perSts = new Map<string, { total: number; done: number }>()
  for (const p of q.workPackages()) {
    if (p.vesselId !== vesselId || p.kind === 'hatch-remove' || p.kind === 'hatch-replace') continue
    const total = p.containerIds.length || p.emptyReq?.count || 0
    let done = 0
    if (p.status === 'complete') done = total
    else if (p.status === 'active') {
      const sts = q.sts(p.stsId)
      if (sts.activePackageId === p.id) done = Math.max(0, p.containerIds.length - sts.workQueue.length)
    }
    const entry = perSts.get(p.stsId) ?? { total: 0, done: 0 }
    entry.total += total
    entry.done += done
    perSts.set(p.stsId, entry)
  }
  const list = [...perSts].map(([id, c]) => ({ id, ...c })).sort((a, b) => a.id.localeCompare(b.id))
  // before the crane split there are no packages yet: the plan's size from the scenario, nothing done
  const planned = cfg ? cfg.discharge + cfg.load + cfg.transshipment : 0
  const total = list.length > 0 ? list.reduce((n, s) => n + s.total, 0) : planned
  const done = list.reduce((n, s) => n + s.done, 0)
  return {
    status: v.status,
    etaS: cfg?.arrivalS ?? null,
    berthAllocatedS: v.berthAllocatedAt,
    berthedS: v.berthedAt,
    departedS: v.departedAt,
    mooringS: config.quay.mooringS,
    moves: { total, done },
    perSts: list,
  }
}

/** A countdown as `mm:ss` (`h:mm:ss` from an hour), fixed width so a ticking label does not jump. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The same times from the scene model's status timeline at `t` (labels only need the status and times, not the moves). */
export function vesselStatusInputFromModel(model: SceneModel, id: string, t: number): VesselStatusInput {
  const times = model.vesselStatusTimes(id, t)
  return {
    status: times.status as VesselStatus,
    etaS: model.vesselConfig(id)?.arrivalS ?? null,
    berthAllocatedS: times.mooringS,
    berthedS: times.berthedS,
    departedS: times.departedS,
    mooringS: model.config.quay.mooringS,
    moves: { total: 0, done: 0 },
    perSts: [],
  }
}

/**
 * Vessel and STS timeline (the dashboard's Gantt chart): a pure fold over the
 * committed event log. Windows still open at `now` are closed at `now`.
 *
 * Per vessel: anchorage (arrival until berth allocation), mooring, work
 * (berthed until work complete) and unmooring; berth window = allocation until
 * departure. Per crane: one work package per crane-split assignment (bays
 * assigned until `StsWorkComplete`).
 */
import type { EngineEvent } from '../events'

export interface TimelineWindow {
  startS: number
  endS: number
}

export interface TimelinePackage extends TimelineWindow {
  stsId: string
  /** Bays assigned to the crane by the crane split. */
  bays: number[]
  /** True while the package has not finished at `now`. */
  open: boolean
}

/** One work package (TT-10): released by the TOS, worked by one STS. `startS` = start of work (now while only released). */
export interface TimelineWorkPackage extends TimelineWindow {
  packageId: string
  stsId: string
  kind: 'discharge' | 'load'
  section: 'deck' | 'hold'
  bay: number
  moves: number
  releasedAt: number
  /** Work not started yet (released, waiting behind other packages). */
  waiting: boolean
  open: boolean
}

export interface VesselTimelineRow {
  vesselId: string
  arrivedAt: number | null
  berthAllocatedAt: number | null
  berthedAt: number | null
  workCompletedAt: number | null
  departedAt: number | null
  berthX: number | null
  /** Arrival until berth allocation (zero length when a berth was free). */
  anchorage: TimelineWindow
  /** Berth allocation until berthed. */
  mooring: TimelineWindow
  /** Berthed until work complete. */
  work: TimelineWindow
  /** Work complete until departure. */
  unmooring: TimelineWindow
  /** Berth allocation until departure: the quay stretch is taken. */
  berth: TimelineWindow
  packages: TimelinePackage[]
  /** Work packages in release order; the window runs from the start of work to completion. */
  workPackages: TimelineWorkPackage[]
}

export interface TimelineReport {
  nowS: number
  vessels: VesselTimelineRow[]
}

export function buildTimeline(events: readonly EngineEvent[], now: number): TimelineReport {
  const rows = new Map<string, VesselTimelineRow>()
  const row = (id: string): VesselTimelineRow => {
    let r = rows.get(id)
    if (!r) {
      r = {
        vesselId: id,
        arrivedAt: null,
        berthAllocatedAt: null,
        berthedAt: null,
        workCompletedAt: null,
        departedAt: null,
        berthX: null,
        anchorage: { startS: 0, endS: 0 },
        mooring: { startS: 0, endS: 0 },
        work: { startS: 0, endS: 0 },
        unmooring: { startS: 0, endS: 0 },
        berth: { startS: 0, endS: 0 },
        packages: [],
        workPackages: [],
      }
      rows.set(id, r)
    }
    return r
  }

  for (const e of events) {
    switch (e.type) {
      case 'VesselArrived':
        row(e.payload.vesselId).arrivedAt = e.t
        break
      case 'BerthAllocated': {
        const r = row(e.payload.vesselId)
        r.berthAllocatedAt = e.t
        r.berthX = e.payload.berthX
        break
      }
      case 'VesselBerthed':
        row(e.payload.vesselId).berthedAt = e.t
        break
      case 'VesselWorkComplete':
        row(e.payload.vesselId).workCompletedAt = e.t
        break
      case 'VesselDeparted':
        row(e.payload.vesselId).departedAt = e.t
        break
      case 'DecisionResolved':
        if (e.payload.decisionPoint === 'craneSplit') {
          const { request, reply } = e.payload
          for (const a of reply.assignments) {
            row(request.vesselId).packages.push({
              stsId: a.stsId,
              bays: [...a.bays],
              startS: e.t,
              endS: now,
              open: true,
            })
          }
        }
        break
      case 'WorkPackageReleased':
        row(e.payload.vesselId).workPackages.push({
          packageId: e.payload.packageId,
          stsId: e.payload.stsId,
          kind: e.payload.kind,
          section: e.payload.section,
          bay: e.payload.bay,
          moves: e.payload.moves,
          releasedAt: e.t,
          startS: now,
          endS: now,
          waiting: true,
          open: true,
        })
        break
      case 'WorkPackageStarted': {
        const wp = row(e.payload.vesselId).workPackages.find((p) => p.packageId === e.payload.packageId)
        if (wp) {
          wp.startS = e.t
          wp.waiting = false
        }
        break
      }
      case 'WorkPackageCompleted': {
        const wp = row(e.payload.vesselId).workPackages.find((p) => p.packageId === e.payload.packageId)
        if (wp) {
          wp.endS = e.t
          wp.open = false
        }
        break
      }
      case 'StsWorkComplete': {
        const open = row(e.payload.vesselId).packages.find((p) => p.open && p.stsId === e.payload.stsId)
        if (open) {
          open.endS = e.t
          open.open = false
        }
        break
      }
      default:
        break
    }
  }

  for (const r of rows.values()) {
    const arrived = r.arrivedAt ?? now
    const allocated = r.berthAllocatedAt ?? now
    const berthed = r.berthedAt ?? now
    const completed = r.workCompletedAt ?? now
    const departed = r.departedAt ?? now
    r.anchorage = { startS: arrived, endS: allocated }
    r.mooring = { startS: allocated, endS: berthed }
    r.work = { startS: berthed, endS: completed }
    r.unmooring = { startS: completed, endS: departed }
    r.berth = { startS: allocated, endS: departed }
  }
  return { nowS: now, vessels: [...rows.values()].sort((a, b) => (a.arrivedAt ?? Infinity) - (b.arrivedAt ?? Infinity)) }
}

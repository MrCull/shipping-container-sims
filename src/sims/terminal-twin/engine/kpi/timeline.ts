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

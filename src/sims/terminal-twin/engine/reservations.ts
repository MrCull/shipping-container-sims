/**
 * Conflict-zone reservations (TT-05): time windows on lane-graph zones
 * (intersections, STS lanes / ground positions, WTP pads). A plan reserves
 * every zone it passes before it starts; if any window would overlap an
 * existing one, the whole plan starts later. Windows are half-open
 * [from, to), so zero-length windows (instant mode) never conflict.
 *
 * State is plain JSON in `SimState.reservations`; reservations that ended
 * before `now` are pruned whenever new ones are made.
 */
import type { SimState } from './state'

export interface Reservation {
  id: number
  zone: string
  /** Equipment id holding the zone. */
  holder: string
  from: number
  to: number
}

/** A window relative to a plan's start (s). */
export interface WindowSpec {
  zone: string
  from: number
  to: number
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - 1e-9 && b0 < a1 - 1e-9

/** Earliest start ≥ `now` at which none of the plan's windows overlap an existing reservation. */
export function earliestStart(state: SimState, windows: WindowSpec[], now: number): number {
  return earliestStartAmong(state.reservations, windows, now)
}

/** `earliestStart` against an explicit reservation list (e.g. without the planner's own holds). */
export function earliestStartAmong(list: readonly Reservation[], windows: WindowSpec[], now: number): number {
  const byZone = new Map<string, { from: number; to: number }[]>()
  for (const r of list) {
    if (r.to <= now) continue
    const list = byZone.get(r.zone) ?? []
    list.push(r)
    byZone.set(r.zone, list)
  }
  let start = now
  for (let guard = 0; guard < 100000; guard++) {
    let moved = false
    for (const w of windows) {
      for (const r of byZone.get(w.zone) ?? []) {
        if (overlaps(start + w.from, start + w.to, r.from, r.to)) {
          start = r.to - w.from
          moved = true
        }
      }
    }
    if (!moved) return start
  }
  throw new Error('earliestStart: no conflict-free start found')
}

/** Reserve the windows for a plan starting at `start`; prunes reservations that ended before `now`. */
export function reserve(state: SimState, holder: string, windows: WindowSpec[], start: number): Reservation[] {
  const now = state.now
  state.reservations = state.reservations.filter((r) => r.to > now)
  const made: Reservation[] = []
  for (const w of windows) {
    if (w.to - w.from <= 0) continue
    const r: Reservation = { id: state.nextReservationId++, zone: w.zone, holder, from: start + w.from, to: start + w.to }
    state.reservations.push(r)
    made.push(r)
  }
  return made
}

/** Merge same-zone windows that overlap or touch (a plan never conflicts with itself). */
export function mergeWindows(windows: WindowSpec[]): WindowSpec[] {
  const byZone = new Map<string, WindowSpec[]>()
  for (const w of windows) byZone.set(w.zone, [...(byZone.get(w.zone) ?? []), { ...w }])
  const merged: WindowSpec[] = []
  for (const list of byZone.values()) {
    list.sort((a, b) => a.from - b.from)
    let cur = list[0]
    for (const w of list.slice(1)) {
      if (w.from <= cur.to + 1e-9) cur.to = Math.max(cur.to, w.to)
      else {
        merged.push(cur)
        cur = w
      }
    }
    merged.push(cur)
  }
  return merged
}

/** Pairs of overlapping reservations in the same zone (for the invariant). */
export function overlappingReservations(list: Reservation[]): [Reservation, Reservation][] {
  const byZone = new Map<string, Reservation[]>()
  for (const r of list) byZone.set(r.zone, [...(byZone.get(r.zone) ?? []), r])
  const pairs: [Reservation, Reservation][] = []
  for (const rs of byZone.values()) {
    const sorted = [...rs].sort((a, b) => a.from - b.from || a.id - b.id)
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length && sorted[j].from < sorted[i].to; j++)
        if (overlaps(sorted[i].from, sorted[i].to, sorted[j].from, sorted[j].to)) pairs.push([sorted[i], sorted[j]])
  }
  return pairs
}

/** Overlapping pairs that involve a reservation with `id >= fromId` (those made since the last check). */
export function overlappingNewReservations(list: Reservation[], fromId: number): [Reservation, Reservation][] {
  const pairs: [Reservation, Reservation][] = []
  for (const r of list) {
    if (r.id < fromId) continue
    for (const o of list) {
      if (o === r || o.zone !== r.zone || !overlaps(r.from, r.to, o.from, o.to)) continue
      if (o.id >= fromId && o.id < r.id) continue // a pair of two new ones is reported once
      pairs.push(r.from < o.from || (r.from === o.from && r.id < o.id) ? [r, o] : [o, r])
    }
  }
  return pairs
}

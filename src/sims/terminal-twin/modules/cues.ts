/**
 * Cues (TT-21): moments worth a sound or a banner, taken from engine events and
 * released when the DISPLAY clock reaches them (the engine runs ahead of the
 * display while playing). Pure TS: the store feeds it, the sound player and the
 * departure banner consume it.
 */
import type { EventSummary } from '../worker/protocol'

export type CueKind = 'landed' | 'horn' | 'complete'
export interface Cue {
  t: number
  kind: CueKind
  /** horn: a big ship (deeper horn). */
  large?: boolean
  vesselId?: string
  /** A banner goes with this cue. */
  banner?: 'departure' | 'complete'
}

/** Vessel size lookup for the horn pitch. */
export type VesselIsLarge = (vesselId: string) => boolean

/** The cue an event makes, or null. */
export function cueFor(e: EventSummary, isLarge: VesselIsLarge): Cue | null {
  const vesselId = e.subjects.vessels?.[0]
  switch (e.type) {
    case 'StsGrounded':
    case 'StsLoaded':
      return { t: e.t, kind: 'landed' }
    case 'VesselArrived':
      return { t: e.t, kind: 'horn', vesselId, large: vesselId ? isLarge(vesselId) : false }
    case 'VesselDeparted':
      return { t: e.t, kind: 'horn', vesselId, large: vesselId ? isLarge(vesselId) : false, banner: 'departure' }
    case 'ScenarioEnded':
      return { t: e.t, kind: 'complete', banner: 'complete' }
    default:
      return null
  }
}

const MAX_PENDING = 2000

export class CuePlanner {
  private pending: Cue[] = []
  private seen = new Set<number>()

  constructor(private isLarge: VesselIsLarge = () => false) {}

  setVesselSize(isLarge: VesselIsLarge): void {
    this.isLarge = isLarge
  }

  ingest(events: readonly EventSummary[]): void {
    for (const e of events) {
      if (this.seen.has(e.id)) continue
      const cue = cueFor(e, this.isLarge)
      if (!cue) continue
      this.seen.add(e.id)
      this.pending.push(cue)
    }
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING)
    if (this.seen.size > 4 * MAX_PENDING) this.seen = new Set(this.seen)
  }

  /**
   * Cues now due at `displayTime`. A cue that is long past (the display jumped,
   * e.g. Run to…) is dropped, except the scenario-complete one.
   */
  drain(displayTime: number, speed: number): Cue[] {
    const staleBefore = displayTime - Math.max(5, speed * 0.5)
    const due: Cue[] = []
    const keep: Cue[] = []
    for (const c of this.pending) {
      if (c.t > displayTime) keep.push(c)
      else if (c.t >= staleBefore || c.kind === 'complete') due.push(c)
    }
    this.pending = keep
    due.sort((a, b) => a.t - b.t)
    return due
  }

  reset(): void {
    this.pending = []
    this.seen.clear()
  }
}

/** Minimum real-time gap (ms) between two sounds of one kind at a playback speed. */
export function minGapMs(kind: CueKind, speed: number): number {
  if (kind === 'complete') return 0
  if (kind === 'horn') return speed <= 60 ? 3000 : 12000
  return speed <= 10 ? 150 : speed <= 60 ? 600 : 2500
}

/** Real-time throttle for sound effects: one instance per player. */
export class SoundThrottle {
  private last = new Map<CueKind, number>()

  allow(kind: CueKind, speed: number, nowMs: number): boolean {
    const prev = this.last.get(kind)
    if (prev !== undefined && nowMs - prev < minGapMs(kind, speed)) return false
    this.last.set(kind, nowMs)
    return true
  }

  reset(): void {
    this.last.clear()
  }
}

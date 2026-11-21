/**
 * STS productivity from the event log (spec #116, #117). Pure: takes the events of a run and splits each crane's time
 * between the moment its first work package starts and `endS` into what it was doing, so "the cranes look idle" can be
 * answered with numbers and re-measured after any change (`pnpm run tt:run --preset ... --events f.jsonl`, then
 * `pnpm run tt:sts f.jsonl`).
 *
 * A crane is in exactly one bucket at a time; the bucket changes on the events below and lasts until the next one:
 *
 * | bucket        | starts on                                           | meaning                                                  |
 * |---------------|-----------------------------------------------------|----------------------------------------------------------|
 * | `cycle`       | StsMoveStarted / StsLoadStarted, and the end of any | hoisting, trolleying, locking, landing a box (also the   |
 * |               | wait                                                | gaps between packages while a next one is not yet open)  |
 * | `hatch`       | StsHatchStarted                                     | hatch cover work (lift, laydown, replace)                |
 * | `lashing`     | StsWaitingForHatch                                  | the cover is still lashed / the hatch is not yet secured |
 * | `ground`      | StsWaitingForGroundPosition                         | discharge: no free ground position                       |
 * | `box`         | StsWaitingForBox                                    | load: the export box is not on its ground position yet   |
 * | `rail`        | StsWaitingForRail                                   | a neighbouring crane is closer than `stsMinSpacingM`     |
 * | `reposition`  | StsRepositionStarted                                | stepping aside for another crane                         |
 * | `boom`        | StsBoomStarted (until StsBoomCompleted, then back   | boom mode real (#301): parking the spreader and turning  |
 * |               | to `done` after the last move, else `cycle`)        | the boom; also the boom turns planned inside a cycle to  |
 * |               |                                                     | pass a vessel's bridge (#302), moved out of `cycle`      |
 * | `done`        | StsWorkComplete                                     | the crane has no more work on its vessel                 |
 */
import type { EngineEvent } from './events'
import type { MotionSegment } from './kinematics'

export const STS_TIME_BUCKETS = ['cycle', 'hatch', 'lashing', 'ground', 'box', 'rail', 'reposition', 'boom', 'done'] as const
export type StsTimeBucket = (typeof STS_TIME_BUCKETS)[number]

export interface StsTimeRow {
  stsId: string
  /** When the crane's first work package started (the start of its measured window). */
  startS: number
  /** `endS - startS`. */
  windowS: number
  /** Seconds per bucket; they add up to `windowS`. */
  buckets: Record<StsTimeBucket, number>
  /** Boxes grounded (discharge) or loaded (load) inside the window. */
  moves: number
  /** `moves` per hour of the window. */
  grossMovesPerHour: number
}

export interface StsProductivityReport {
  endS: number
  rows: StsTimeRow[]
  /** Sum over the rows. */
  total: { windowS: number; buckets: Record<StsTimeBucket, number>; moves: number; grossMovesPerHour: number }
  /** Seconds per bucket as a share (0..1) of `total.windowS`. */
  share: Record<StsTimeBucket, number>
}

const zero = (): Record<StsTimeBucket, number> => Object.fromEntries(STS_TIME_BUCKETS.map((b) => [b, 0])) as Record<StsTimeBucket, number>

const ENTER: Partial<Record<EngineEvent['type'], StsTimeBucket>> = {
  StsMoveStarted: 'cycle',
  StsLoadStarted: 'cycle',
  StsGroundPositionWaitEnded: 'cycle',
  StsBoxWaitEnded: 'cycle',
  StsHatchStarted: 'hatch',
  StsWaitingForHatch: 'lashing',
  StsWaitingForGroundPosition: 'ground',
  StsWaitingForBox: 'box',
  StsWaitingForRail: 'rail',
  StsRepositionStarted: 'reposition',
  StsBoomStarted: 'boom',
  StsWorkComplete: 'done',
}

/** One crane's running tally while `stsProductivity` walks the events. */
interface CraneTally {
  /** First WorkPackageStarted (s). */
  startS: number
  /** The bucket the crane is in now, and since when (s). */
  bucket: StsTimeBucket
  since: number
  buckets: Record<StsTimeBucket, number>
  moves: number
  /** The bucket before the current boom transition (#298), restored at StsBoomCompleted. */
  beforeBoom: StsTimeBucket
  /** Boom time inside planned cycles (#302 bridge passages), moved from cycle to boom (s). */
  boomInCycle: number
}

/** The crane time breakdown of `events` (sim-time order) up to `endS`. */
export function stsProductivity(events: readonly EngineEvent[], endS: number): StsProductivityReport {
  const cranes = new Map<string, CraneTally>()
  for (const e of events) {
    if (e.t > endS) break
    const stsId = (e.payload as { stsId?: string }).stsId
    if (!stsId) continue
    let c = cranes.get(stsId)
    if (!c) {
      if (e.type !== 'WorkPackageStarted') continue
      c = { startS: e.t, bucket: 'cycle', since: e.t, buckets: zero(), moves: 0, beforeBoom: 'cycle', boomInCycle: 0 }
      cranes.set(stsId, c)
    }
    if (e.type === 'StsGrounded' || e.type === 'StsLoaded') c.moves++
    if (e.type === 'StsMoveStarted' || e.type === 'StsLoadStarted') {
      // a bridge passage turns the boom inside the planned cycle (#302): that time is boom, not cycle
      for (const s of (e.payload as { segments?: MotionSegment[] }).segments ?? []) if (s.axis === 'boom') c.boomInCycle += Math.max(0, Math.min(s.t1, endS) - s.t0)
    }
    if (e.type === 'StsBoomStarted') c.beforeBoom = c.bucket
    const next = e.type === 'StsBoomCompleted' ? (c.beforeBoom === 'done' ? 'done' : 'cycle') : ENTER[e.type]
    if (!next) continue
    c.buckets[c.bucket] += e.t - c.since
    c.bucket = next
    c.since = e.t
  }
  const rows: StsTimeRow[] = [...cranes.entries()]
    .map(([stsId, c]) => {
      c.buckets[c.bucket] += endS - c.since
      const turned = Math.min(c.boomInCycle, c.buckets.cycle)
      c.buckets.cycle -= turned
      c.buckets.boom += turned
      const windowS = endS - c.startS
      return { stsId, startS: c.startS, windowS, buckets: c.buckets, moves: c.moves, grossMovesPerHour: windowS > 0 ? (c.moves * 3600) / windowS : 0 }
    })
    .sort((a, b) => a.stsId.localeCompare(b.stsId))
  const buckets = zero()
  let windowS = 0
  let moves = 0
  for (const r of rows) {
    windowS += r.windowS
    moves += r.moves
    for (const b of STS_TIME_BUCKETS) buckets[b] += r.buckets[b]
  }
  const share = zero()
  for (const b of STS_TIME_BUCKETS) share[b] = windowS > 0 ? buckets[b] / windowS : 0
  return { endS, rows, total: { windowS, buckets, moves, grossMovesPerHour: windowS > 0 ? (moves * 3600) / windowS : 0 }, share }
}

/** Plain-text table of a report (the `tt:sts` output). */
export function formatStsProductivity(r: StsProductivityReport): string {
  const pad = (s: string, n: number) => s.padStart(n)
  const head = ['STS', 'from s', 'moves', 'moves/h', ...STS_TIME_BUCKETS]
  const lines = [head.map((h, i) => (i === 0 ? h.padEnd(7) : pad(h, 11))).join('')]
  const line = (name: string, startS: string, moves: number, mph: number, b: Record<StsTimeBucket, number>, windowS: number) =>
    [name.padEnd(7), pad(startS, 11), pad(String(moves), 11), pad(mph.toFixed(1), 11), ...STS_TIME_BUCKETS.map((k) => pad(`${((100 * b[k]) / (windowS || 1)).toFixed(0)}%`, 11))].join('')
  for (const row of r.rows) lines.push(line(row.stsId, String(Math.round(row.startS)), row.moves, row.grossMovesPerHour, row.buckets, row.windowS))
  lines.push(line('ALL', '', r.total.moves, r.total.grossMovesPerHour, r.total.buckets, r.total.windowS))
  return lines.join('\n')
}

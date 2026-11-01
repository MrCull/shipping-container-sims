/**
 * Per-box waits from the event log (spec #166, `pnpm run tt:profile`). Pure: it folds the events of a run up to `endS`
 * into the time each box spent waiting for the next piece of equipment, split by the stage it waited in:
 *
 * - a box is READY when the equipment that handed it over has put it down (or, for an export retrieval, when the ASC
 *   job for it was assigned); a box is TAKEN when the next equipment picks it up. The wait is the time between them.
 * - a wait is attributed to the equipment that was to take the box: `yard` (the ASC), `horizontal` (the SHC) or `sts`
 *   (the crane). Trips while the box is carried are not waits and are not counted.
 * - a wait still open at `endS` is cut there and marked `open`.
 *
 * | path      | stage        | ready                                   | taken                                  |
 * |-----------|--------------|-----------------------------------------|----------------------------------------|
 * | discharge | `sts`        | StsWaitingForGroundPosition             | StsGroundPositionWaitEnded             |
 * | discharge | `horizontal` | StsGrounded (on the ground position)    | ShcPicked                              |
 * | discharge | `yard`       | ShcDroppedAtWtp (on the WTP pad)        | AscPicked                              |
 * | load      | `yard`       | AscJobAssigned (export retrieval)       | AscRetrieved (lifted out of the stack) |
 * | load      | `horizontal` | AscDroppedAtWtp (on the WTP pad)        | ShcPickedAtWtp                         |
 * | load      | `sts`        | ShcDroppedAtGround (on the ground pos.) | StsLoadPicked                          |
 *
 * An export retrieval is an ASC job whose first move is `AscRoutingToStack`; rehandle jobs and truck jobs are not. A
 * box counts on a path when it enters it: a discharge box when the STS picks it from the vessel, a load box when the
 * STS starts its load.
 */
import type { EngineEvent } from './events'

export const BOX_WAIT_PATHS = ['discharge', 'load'] as const
export const BOX_WAIT_STAGES = ['yard', 'horizontal', 'sts'] as const
export type BoxWaitPath = (typeof BOX_WAIT_PATHS)[number]
export type BoxWaitStage = (typeof BOX_WAIT_STAGES)[number]

export interface BoxWait {
  containerId: string
  path: BoxWaitPath
  stage: BoxWaitStage
  /** When the box became ready (for an export retrieval: when its ASC job was assigned). */
  startS: number
  /** When it was taken, or `endS` for a wait still open. */
  endS: number
  seconds: number
  /** Still waiting at `endS`. */
  open: boolean
}

export interface BoxWaitPathRow {
  /** Boxes that entered the path by `endS`. */
  boxes: number
  /** Seconds waited per stage, summed over the path's boxes. */
  totalS: Record<BoxWaitStage, number>
  /** `totalS` per box (0 with no boxes). */
  meanS: Record<BoxWaitStage, number>
}

export interface BoxWaitReport {
  endS: number
  paths: Record<BoxWaitPath, BoxWaitPathRow>
  /** The longest waits, longest first. */
  top: BoxWait[]
}

export interface BoxWaitOptions {
  /** How many of the longest waits to list (default 10). */
  top?: number
}

const zeroStages = (): Record<BoxWaitStage, number> => Object.fromEntries(BOX_WAIT_STAGES.map((s) => [s, 0])) as Record<BoxWaitStage, number>
const r3 = (n: number) => Math.round(n * 1000) / 1000

interface Pending {
  containerId: string
  path: BoxWaitPath
  stage: BoxWaitStage
  startS: number
}

/** The waits of a run up to `endS`, from its event log (sim-time order). */
export function boxWaits(events: readonly EngineEvent[], endS: number, options: BoxWaitOptions = {}): BoxWaitReport {
  const pending = new Map<string, Pending>()
  const waits: BoxWait[] = []
  const boxes: Record<BoxWaitPath, Set<string>> = { discharge: new Set(), load: new Set() }
  /** Assignment time of each export retrieval job (AscJobAssigned), until its first move shows it is one. */
  const assignedAt = new Map<string, number>()

  const ready = (path: BoxWaitPath, stage: BoxWaitStage, containerId: string, startS: number) => {
    const key = `${path}|${stage}|${containerId}`
    if (!pending.has(key)) pending.set(key, { containerId, path, stage, startS })
  }
  const taken = (path: BoxWaitPath, stage: BoxWaitStage, containerId: string, t: number) => {
    const key = `${path}|${stage}|${containerId}`
    const p = pending.get(key)
    if (!p) return
    pending.delete(key)
    waits.push({ containerId, path, stage, startS: p.startS, endS: t, seconds: r3(t - p.startS), open: false })
  }

  for (const e of events) {
    if (e.t > endS) break
    switch (e.type) {
      case 'StsPicked':
        boxes.discharge.add(e.payload.containerId)
        if (e.payload.twin) boxes.discharge.add(e.payload.twin.containerId)
        break
      case 'StsWaitingForGroundPosition':
        ready('discharge', 'sts', e.payload.containerId, e.t)
        break
      case 'StsGroundPositionWaitEnded':
        taken('discharge', 'sts', e.payload.containerId, e.t)
        break
      case 'StsGrounded':
        ready('discharge', 'horizontal', e.payload.containerId, e.t)
        break
      case 'ShcPicked':
        taken('discharge', 'horizontal', e.payload.containerId, e.t)
        break
      case 'ShcDroppedAtWtp':
        ready('discharge', 'yard', e.payload.containerId, e.t)
        break
      case 'AscPicked':
        taken('discharge', 'yard', e.payload.containerId, e.t)
        break
      case 'StsLoadStarted':
        boxes.load.add(e.payload.containerId)
        break
      case 'AscJobAssigned':
        if (!e.payload.rehandle && !e.payload.stallId) assignedAt.set(e.payload.jobId, e.t)
        break
      case 'AscRoutingToStack': {
        const since = assignedAt.get(e.payload.jobId)
        if (since !== undefined) ready('load', 'yard', e.payload.containerId, since)
        break
      }
      case 'AscRetrieved':
        if (!e.payload.rehandle) taken('load', 'yard', e.payload.containerId, e.t)
        break
      case 'AscDroppedAtWtp':
        ready('load', 'horizontal', e.payload.containerId, e.t)
        break
      case 'ShcPickedAtWtp':
        taken('load', 'horizontal', e.payload.containerId, e.t)
        break
      case 'ShcDroppedAtGround':
        ready('load', 'sts', e.payload.containerId, e.t)
        break
      case 'StsLoadPicked':
        taken('load', 'sts', e.payload.containerId, e.t)
        break
      default:
        break
    }
  }

  for (const p of pending.values())
    waits.push({ containerId: p.containerId, path: p.path, stage: p.stage, startS: p.startS, endS, seconds: r3(endS - p.startS), open: true })

  const paths = Object.fromEntries(
    BOX_WAIT_PATHS.map((path) => {
      const totalS = zeroStages()
      for (const w of waits) if (w.path === path) totalS[w.stage] += w.seconds
      const count = boxes[path].size
      const meanS = zeroStages()
      for (const s of BOX_WAIT_STAGES) meanS[s] = count > 0 ? r3(totalS[s] / count) : 0
      for (const s of BOX_WAIT_STAGES) totalS[s] = r3(totalS[s])
      return [path, { boxes: count, totalS, meanS }]
    }),
  ) as Record<BoxWaitPath, BoxWaitPathRow>

  waits.sort((a, b) => b.seconds - a.seconds || a.startS - b.startS || a.containerId.localeCompare(b.containerId))
  return { endS, paths, top: waits.slice(0, options.top ?? 10) }
}

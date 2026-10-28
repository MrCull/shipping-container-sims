/**
 * Built-in ascDispatch strategies (TT-08). Pure: request in, reply out.
 */
import type { AscDispatchCandidate, AscDispatchReply, AscDispatchRequest } from './types'

const pick = (c: AscDispatchCandidate | undefined): AscDispatchReply => ({ ascId: c?.ascId ?? null })

/**
 * Prefer the waterside ASC for WTP work and the landside ASC for transfer-stall
 * work. The other crane takes the box when the preferred one is busy or cannot
 * serve it, but only if no step-aside is needed ("when separation permits").
 */
export function watersideFirstDispatch(req: AscDispatchRequest): AscDispatchReply {
  const preferred = req.job.kind === 'transfer' ? 'landside' : 'waterside'
  const ok = req.candidates.filter((c) => c.canServe)
  const first = ok.find((c) => c.side === preferred)
  if (first) return pick(first)
  return pick(ok.find((c) => !c.needsYield))
}

/**
 * Even out the work: the serviceable idle ASC with the fewest jobs (ties: the
 * one nearest the pad, then waterside). Used to compare against the
 * side-preference default.
 */
export function balancedAscDispatch(req: AscDispatchRequest): AscDispatchReply {
  const ok = req.candidates.filter((c) => c.canServe)
  const sorted = [...ok].sort(
    (a, b) =>
      a.jobs - b.jobs ||
      Math.abs(a.gantryZ - req.job.padZ) - Math.abs(b.gantryZ - req.job.padZ) ||
      (a.side === 'waterside' ? -1 : 1),
  )
  return pick(sorted[0])
}

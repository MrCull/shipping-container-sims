/**
 * Built-in strategies for the quay decision points: berth allocation and
 * crane split. Synchronous and pure (request → reply).
 */
import type {
  BerthAllocationReply,
  BerthAllocationRequest,
  CraneSplitReply,
  CraneSplitRequest,
} from './types'

// ── berth allocation ───────────────────────────────────────────────────────

interface BerthCandidate {
  x: number
  /** Free quay length of the gap the vessel would berth in. */
  gapLength: number
}

/** Every stern position that fits: at the quay start or just past a berthed vessel (plus the gap). */
export function berthCandidates(req: BerthAllocationRequest): BerthCandidate[] {
  const occ = [...req.occupied].sort((a, b) => a.fromX - b.fromX)
  const out: BerthCandidate[] = []
  let gapStart = 0
  for (let i = 0; i <= occ.length; i++) {
    const next = occ[i]
    const lo = i === 0 ? 0 : gapStart + req.berthGapM
    const hi = next ? next.fromX - req.berthGapM : req.quayLengthM
    if (hi - lo >= req.loaM - 1e-9) out.push({ x: lo, gapLength: (next ? next.fromX : req.quayLengthM) - gapStart })
    if (next) gapStart = next.toX
  }
  return out
}

export function firstFitBerth(req: BerthAllocationRequest): BerthAllocationReply {
  return { berthX: berthCandidates(req)[0]?.x ?? null }
}

export function bestFitBerth(req: BerthAllocationRequest): BerthAllocationReply {
  const best = berthCandidates(req).sort((a, b) => a.gapLength - b.gapLength || a.x - b.x)[0]
  return { berthX: best?.x ?? null }
}

// ── crane split ────────────────────────────────────────────────────────────

/**
 * The free cranes a vessel may use: a contiguous run in rail order that has
 * every crane of a vessel further along the quay on the correct side.
 */
export function eligibleCranes(req: CraneSplitRequest): CraneSplitRequest['cranes'] {
  return req.cranes.filter((c) => {
    if (c.vesselId !== null) return false
    return req.cranes.every((o) => {
      if (o.vesselId === null || o.vesselId === req.vesselId || o.vesselBerthX === null) return true
      return o.railIndex < c.railIndex ? o.vesselBerthX < req.berthX : o.vesselBerthX > req.berthX
    })
  })
}

/** Choose `n` consecutive eligible cranes whose centre is nearest the vessel's work. */
function chooseCranes(req: CraneSplitRequest, n: number): string[] {
  const free = eligibleCranes(req)
  if (n <= 0 || free.length === 0) return []
  n = Math.min(n, free.length)
  const workCentre = req.bays.reduce((s, b) => s + b.x, 0) / req.bays.length
  let best = 0
  let bestCost = Infinity
  for (let i = 0; i + n <= free.length; i++) {
    const mean = free.slice(i, i + n).reduce((s, c) => s + c.gantryX, 0) / n
    const cost = Math.abs(mean - workCentre)
    if (cost < bestCost - 1e-9) {
      bestCost = cost
      best = i
    }
  }
  return free.slice(best, best + n).map((c) => c.stsId)
}

/** Split the work bays into `n` contiguous groups whose weights are as equal as possible. */
function partition(bays: CraneSplitRequest['bays'], n: number, weight: (b: CraneSplitRequest['bays'][number]) => number): number[][] {
  // Linear partition: minimise the heaviest group, then the sum of squares (dynamic programming).
  const m = bays.length
  const prefix = [0]
  for (const b of bays) prefix.push(prefix[prefix.length - 1] + weight(b))
  const sum = (i: number, j: number) => prefix[j] - prefix[i]
  type Cost = { max: number; sq: number; cut: number }
  // best[g][j]: first j bays in g groups
  const best: Cost[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => ({ max: Infinity, sq: Infinity, cut: -1 })))
  best[0][0] = { max: 0, sq: 0, cut: -1 }
  for (let g = 1; g <= n; g++)
    for (let j = g; j <= m; j++)
      for (let i = g - 1; i < j; i++) {
        const prev = best[g - 1][i]
        if (prev.max === Infinity) continue
        const s = sum(i, j)
        const cand = { max: Math.max(prev.max, s), sq: prev.sq + s * s, cut: i }
        const cur = best[g][j]
        if (cand.max < cur.max - 1e-9 || (Math.abs(cand.max - cur.max) <= 1e-9 && cand.sq < cur.sq - 1e-9)) best[g][j] = cand
      }
  const groups: number[][] = []
  let j = m
  for (let g = n; g >= 1; g--) {
    const i = best[g][j].cut
    groups.unshift(bays.slice(i, j).map((b) => b.bay))
    j = i
  }
  return groups
}

function split(req: CraneSplitRequest, weight: (b: CraneSplitRequest['bays'][number]) => number): CraneSplitReply {
  const cranes = chooseCranes(req, Math.min(req.maxSts, req.bays.length))
  if (cranes.length === 0) return { assignments: [] }
  const groups = partition(req.bays, cranes.length, weight)
  return { assignments: cranes.map((stsId, k) => ({ stsId, bays: groups[k] })) }
}

/** As many cranes as allowed; contiguous bay ranges with near-equal numbers of moves. */
export function balancedMovesSplit(req: CraneSplitRequest): CraneSplitReply {
  return split(req, (b) => b.moves)
}

/** As many cranes as allowed; contiguous bay ranges with near-equal numbers of bays. */
export function equalBaysSplit(req: CraneSplitRequest): CraneSplitReply {
  return split(req, () => 1)
}

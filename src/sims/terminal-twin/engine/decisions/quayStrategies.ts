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

/** Every stern position that fits: at the quay start or just past a berthed vessel (plus the gap), within the crane reach window (#365). */
export function berthCandidates(req: BerthAllocationRequest): BerthCandidate[] {
  const occ = [...req.occupied].sort((a, b) => a.fromX - b.fromX)
  const out: BerthCandidate[] = []
  let gapStart = 0
  for (let i = 0; i <= occ.length; i++) {
    const next = occ[i]
    const lo = Math.max(i === 0 ? 0 : gapStart + req.berthGapM, req.minBerthX ?? 0)
    const hi = next ? next.fromX - req.berthGapM : req.quayLengthM
    if (hi - lo >= req.loaM - 1e-9 && lo <= (req.maxBerthX ?? Infinity) + 1e-9) out.push({ x: lo, gapLength: (next ? next.fromX : req.quayLengthM) - gapStart })
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
 * every crane of a vessel further along the quay on the correct side, and
 * not out of reach of the vessel (#303).
 */
export function eligibleCranes(req: CraneSplitRequest): CraneSplitRequest['cranes'] {
  return req.cranes.filter((c) => {
    if (c.vesselId !== null || c.outOfReach) return false
    return req.cranes.every((o) => {
      if (o.vesselId === null || o.vesselId === req.vesselId || o.vesselBerthX === null) return true
      return o.railIndex < c.railIndex ? o.vesselBerthX < req.berthX : o.vesselBerthX > req.berthX
    })
  })
}

/**
 * Every run of `n` consecutive eligible cranes, nearest the vessel's work first (the mean gantry X of the run against
 * the work centre; a tie keeps the lower run).
 */
function craneRuns(req: CraneSplitRequest, n: number): CraneSplitRequest['cranes'][] {
  const free = eligibleCranes(req)
  const workCentre = req.bays.reduce((s, b) => s + b.x, 0) / req.bays.length
  // #303: a free crane that is out of reach stays idle; never choose cranes on both sides of it.
  const idle = req.cranes.filter((c) => c.vesselId === null && c.outOfReach).map((c) => c.railIndex)
  const spansIdle = (i: number) => idle.some((r) => r > free[i].railIndex && r < free[i + n - 1].railIndex)
  const runs: { cranes: CraneSplitRequest['cranes']; cost: number }[] = []
  for (let i = 0; i + n <= free.length; i++) {
    if (spansIdle(i)) continue
    const cranes = free.slice(i, i + n)
    runs.push({ cranes, cost: Math.abs(cranes.reduce((s, c) => s + c.gantryX, 0) / n - workCentre) })
  }
  // stable sort: a cost within 1e-9 of another counts as a tie, as the single best pick always did
  return runs.sort((a, b) => (Math.abs(a.cost - b.cost) <= 1e-9 ? 0 : a.cost - b.cost)).map((r) => r.cranes)
}

/** Split the work bays into `n` contiguous groups whose weights are as equal as possible. */
function partition(
  bays: CraneSplitRequest['bays'],
  n: number,
  weight: (b: CraneSplitRequest['bays'][number]) => number,
  canWork: (group: number, bay: number) => boolean = () => true,
): number[][] | null {
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
        // #369: group g-1 takes bays i..j-1, so its crane must reach every one of them
        if (!bays.slice(i, j).every((b) => canWork(g - 1, b.bay))) continue
        const s = sum(i, j)
        const cand = { max: Math.max(prev.max, s), sq: prev.sq + s * s, cut: i }
        const cur = best[g][j]
        if (cand.max < cur.max - 1e-9 || (Math.abs(cand.max - cur.max) <= 1e-9 && cand.sq < cur.sq - 1e-9)) best[g][j] = cand
      }
  if (best[n][m].max === Infinity) return null
  const groups: number[][] = []
  let j = m
  for (let g = n; g >= 1; g--) {
    const i = best[g][j].cut
    groups.unshift(bays.slice(i, j).map((b) => b.bay))
    j = i
  }
  return groups
}

/**
 * The run of cranes nearest the work whose bays split so that each crane reaches its own (#369: a crane's
 * `unreachableBays`, outside its rail reach, never go to it); fewer cranes when no run of `n` can. When no run can
 * (a vessel berthed outside the reach window, #365), the nearest run as before, so `sts.rail-reachable` fails the run
 * loudly instead of the vessel waiting for cranes for ever.
 */
function split(req: CraneSplitRequest, weight: (b: CraneSplitRequest['bays'][number]) => number): CraneSplitReply {
  let nearest: CraneSplitRequest['cranes'] | undefined
  for (let n = Math.min(req.maxSts, req.bays.length); n > 0; n--) {
    for (const cranes of craneRuns(req, n)) {
      nearest ??= cranes
      const groups = partition(req.bays, n, weight, (k, bay) => !cranes[k].unreachableBays?.includes(bay))
      if (groups) return { assignments: cranes.map((c, k) => ({ stsId: c.stsId, bays: groups[k] })) }
    }
  }
  if (!nearest) return { assignments: [] }
  const groups = partition(req.bays, nearest.length, weight) as number[][]
  return { assignments: nearest.map((c, k) => ({ stsId: c.stsId, bays: groups[k] })) }
}

/** As many cranes as allowed; contiguous bay ranges with near-equal numbers of moves. */
export function balancedMovesSplit(req: CraneSplitRequest): CraneSplitReply {
  return split(req, (b) => b.moves)
}

/** As many cranes as allowed; contiguous bay ranges with near-equal numbers of bays. */
export function equalBaysSplit(req: CraneSplitRequest): CraneSplitReply {
  return split(req, () => 1)
}

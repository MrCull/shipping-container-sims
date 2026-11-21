/**
 * Conflict prediction (#288), pure. A conflict window is a time interval in which two cranes' planned gantry
 * positions are closer than the minimum STS spacing. It does not simulate the yield rules: it marks where a wait is
 * likely, not who gives way.
 */
import { travelTime, type AxisProfile } from '../kinematics'
import type { ConflictWindow, PackageTime, PlanPackage } from './types'

interface PathPoint {
  s: number
  x: number
}

export interface CranePath {
  stsId: string
  railIndex: number
  /** Position at the start of the plan and the packages with their predicted times, in order. */
  from: { x: number; s: number }
  packages: readonly (Pick<PlanPackage, 'bayX'> & PackageTime)[]
  /** True: not part of this vessel's plan, stands still where it is (a crane of a neighbouring vessel). */
  fixed?: boolean
}

/** The piecewise linear path of a crane: travel to the bay (at the start of the package), stand, travel on. */
export function pathOf(c: CranePath, gantry: AxisProfile): PathPoint[] {
  const pts: PathPoint[] = [{ s: c.from.s, x: c.from.x }]
  let x = c.from.x
  for (const p of c.packages) {
    if (Math.abs(p.bayX - x) > 1e-9) {
      // the gantry travel is the first part of the package
      pts.push({ s: p.startS, x })
      pts.push({ s: Math.min(p.endS, p.startS + travelTime(p.bayX - x, gantry)), x: p.bayX })
    }
    pts.push({ s: p.endS, x: p.bayX })
    x = p.bayX
  }
  return pts
}

function xAt(pts: PathPoint[], s: number, fixed: boolean): number {
  if (fixed || pts.length === 1 || s <= pts[0].s) return pts[0].x
  const last = pts[pts.length - 1]
  if (s >= last.s) return last.x
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i].s) {
      const a = pts[i - 1]
      const b = pts[i]
      return b.s === a.s ? b.x : a.x + ((b.x - a.x) * (s - a.s)) / (b.s - a.s)
    }
  }
  return last.x
}

/**
 * Windows where neighbouring cranes (adjacent in rail order) are closer than `spacingM`, from the start of the plan
 * to the end of the last package. Cranes of other vessels pass `fixed`.
 */
export function predictConflicts(cranes: readonly CranePath[], spacingM: number, gantry: AxisProfile): ConflictWindow[] {
  const sorted = [...cranes].sort((a, b) => a.railIndex - b.railIndex)
  const own = sorted.filter((c) => !c.fixed)
  if (own.length === 0) return []
  const planEnd = Math.max(...own.map((c) => (c.packages.length ? c.packages[c.packages.length - 1].endS : c.from.s)))
  const out: ConflictWindow[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (a.fixed && b.fixed) continue
    const pa = pathOf(a, gantry)
    const pb = pathOf(b, gantry)
    const t0 = Math.min(pa[0].s, pb[0].s)
    const cuts = [...new Set([t0, planEnd, ...pa.map((p) => p.s), ...pb.map((p) => p.s)])]
      .filter((s) => s >= t0 && s <= planEnd)
      .sort((p, q) => p - q)
    let open: { from: number; xA: number; xB: number } | null = null
    const close = (to: number) => {
      if (open && to - open.from > 1e-6)
        out.push({ stsA: a.stsId, stsB: b.stsId, obstacle: !!(a.fixed || b.fixed), fromS: open.from, toS: to, xA: open.xA, xB: open.xB })
      open = null
    }
    for (let k = 0; k + 1 < cuts.length; k++) {
      const s0 = cuts[k]
      const s1 = cuts[k + 1]
      const d0 = xAt(pb, s0, !!b.fixed) - xAt(pa, s0, !!a.fixed)
      const d1 = xAt(pb, s1, !!b.fixed) - xAt(pa, s1, !!a.fixed)
      if (d0 >= spacingM && d1 >= spacingM) {
        close(s0)
        continue
      }
      let from = s0
      let to = s1
      if (d0 >= spacingM !== d1 >= spacingM) {
        const cross = s0 + ((spacingM - d0) / (d1 - d0)) * (s1 - s0)
        if (d0 >= spacingM) from = cross
        else to = cross
      }
      if (open && from > s0 + 1e-9) close(s0)
      if (!open) open = { from, xA: xAt(pa, from, !!a.fixed), xB: xAt(pb, from, !!b.fixed) }
      if (to < s1 - 1e-9) close(to)
    }
    close(cuts[cuts.length - 1])
  }
  return out
}

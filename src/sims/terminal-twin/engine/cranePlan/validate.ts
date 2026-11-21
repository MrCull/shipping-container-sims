/**
 * Crane plan validator (#288), pure. A failing plan is an error, not a fallback: it returns the first broken rule
 * as a message (or null).
 */
import type { PlanCrane, PlanPackage } from './types'

export interface PlanCheckInput {
  /** Work bays of the vessel, ascending. */
  workBays: number[]
  cranes: PlanCrane[]
  packages: Record<string, PlanPackage>
  /** The previous order per crane (a re-plan): a package that is no longer `planned` keeps its place. */
  previous?: Record<string, string[]>
}

const isHatch = (p: PlanPackage) => p.kind === 'hatch-remove' || p.kind === 'hatch-replace'

/** The first broken rule of the plan, or null when it holds. */
export function validatePlan(input: PlanCheckInput): string | null {
  const { workBays, packages } = input
  const byRail = [...input.cranes].sort((a, b) => a.railIndex - b.railIndex)

  // every work bay once, rail order = bay order
  const covered: number[] = []
  for (const c of byRail) covered.push(...c.bays)
  if (covered.length !== workBays.length || covered.some((b, i) => b !== workBays[i]))
    return `bays covered [${covered.join(',')}] must equal the work bays [${workBays.join(',')}] in rail order`

  const seen = new Set<string>()
  for (const c of byRail) {
    const own = new Set(c.bays)
    for (const id of c.packageIds) {
      const p = packages[id]
      if (!p) return `${c.stsId} lists unknown package ${id}`
      if (seen.has(id)) return `package ${id} is on two cranes or twice in one list`
      seen.add(id)
      if (!own.has(p.bay)) return `${c.stsId} has package ${id} in bay ${p.bay}, which is not one of its bays`
    }
  }
  for (const p of Object.values(packages)) if (workBays.includes(p.bay) && !seen.has(p.id)) return `package ${p.id} (bay ${p.bay}) is on no crane`

  for (const c of byRail) {
    const list = c.packageIds.map((id) => packages[id])
    const at = (p: PlanPackage) => list.indexOf(p)
    for (const bay of c.bays) {
      const inBay = list.filter((p) => p.bay === bay)
      const removes = inBay.filter((p) => p.kind === 'hatch-remove')
      const replaces = inBay.filter((p) => p.kind === 'hatch-replace')
      const hold = inBay.filter((p) => !isHatch(p) && p.section === 'hold')
      if (removes.length > 0 || replaces.length > 0) {
        const lastRemove = Math.max(-1, ...removes.map(at))
        for (const h of hold) if (at(h) < lastRemove) return `${c.stsId} bay ${bay}: hold package ${h.id} comes before the hatch cover is off`
        const lastHoldLoad = Math.max(-1, ...hold.filter((p) => p.kind === 'load').map(at))
        for (const r of replaces) if (at(r) < lastHoldLoad) return `${c.stsId} bay ${bay}: hatch replace ${r.id} comes before the hold is loaded`
        for (const r of replaces) if (removes.some((m) => at(m) > at(r))) return `${c.stsId} bay ${bay}: hatch replace ${r.id} comes before a remove`
      }
      // a shared cell's discharge comes before its load
      for (const d of inBay.filter((p) => p.kind === 'discharge'))
        for (const l of inBay.filter((p) => p.kind === 'load'))
          if (at(l) < at(d) && d.cells.some((a) => l.cells.some((b) => a.row === b.row && a.tier === b.tier)))
            return `${c.stsId} bay ${bay}: load ${l.id} comes before the discharge ${d.id} of the same cell`
      // each stack loads bottom up
      const lastTier = new Map<string, number>()
      for (const l of inBay.filter((p) => p.kind === 'load'))
        for (const cell of l.cells) {
          const key = `${l.section}:${cell.row}`
          const prev = lastTier.get(key)
          if (prev !== undefined && cell.tier < prev) return `${c.stsId} bay ${bay}: row ${cell.row} loads tier ${cell.tier} after tier ${prev}`
          lastTier.set(key, cell.tier)
        }
    }
    // a package that is no longer planned keeps its position
    const prev = input.previous?.[c.stsId]
    if (prev) {
      const locked = prev.filter((id) => packages[id] && packages[id].status !== 'planned')
      for (let i = 0; i < locked.length; i++)
        if (c.packageIds[i] !== locked[i]) return `${c.stsId}: package ${locked[i]} is already ${packages[locked[i]].status} and must keep position ${i}`
    }
  }
  return null
}

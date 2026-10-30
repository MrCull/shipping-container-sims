/**
 * Yard grouping rules of the `grouped` yardAllocation strategy (spec #106, #111). Pure: shared by the strategy
 * (which prices a slot) and the engine (which counts the preferences a placement broke).
 *
 * Groups: imports by line (earlier planned departure higher); exports by outbound vessel and POD (heavy at the
 * bottom); transshipment boxes by onward vessel and POD; storage empties by line, size and ISO type. Reefers keep
 * to powered rows through `candidateSlots`, as for every strategy. All of it is a preference: a mismatch costs
 * score, it never removes a slot.
 */
import type { ScenarioConfig } from '../../scenario/types'
import type { ContainerState } from '../state'
import { strategies } from './strategies'
import type { YardBoxView } from './types'

const WEIGHT_RANK = { LIGHT: 0, MEDIUM: 1, HEAVY: 2 } as const

/** The group a box belongs to: boxes with the same key belong together. */
export function yardGroupKey(b: YardBoxView): string {
  switch (b.direction) {
    case 'IMPORT':
      return `IMP|${b.line}`
    case 'EXPORT':
      return `EXP|${b.outboundVesselId ?? '-'}|${b.pod}`
    case 'TRANSSHIPMENT':
      return `TRX|${b.outboundVesselId ?? '-'}|${b.pod}`
    case 'STORAGE':
      return `STO|${b.line}|${b.size}|${b.isoType}`
  }
}

/**
 * How `box` standing directly on `below` breaks a grouping preference: `mixed` = another group, `order` = the same
 * group in the wrong order (an import that leaves later above one that leaves earlier; a heavier export above a
 * lighter one), `none` otherwise.
 */
export type YardGroupBreak = 'none' | 'order' | 'mixed'

export function yardGroupBreak(box: YardBoxView, below: YardBoxView): YardGroupBreak {
  if (yardGroupKey(box) !== yardGroupKey(below)) return 'mixed'
  if (box.direction === 'IMPORT' && box.plannedDepartureS > below.plannedDepartureS) return 'order'
  if (box.direction === 'EXPORT' && WEIGHT_RANK[box.weightClass] > WEIGHT_RANK[below.weightClass]) return 'order'
  return 'none'
}

/** The view of a container the grouped strategy works from. */
export function yardBoxView(box: ContainerState): YardBoxView {
  const p = box.props
  return {
    direction: p.direction,
    line: box.line,
    size: box.size,
    isoType: p.isoType,
    ...(p.outbound.kind === 'vessel' && p.outbound.id !== undefined ? { outboundVesselId: p.outbound.id } : {}),
    pod: p.pod,
    weightClass: p.weightClass,
    plannedDepartureS: p.plannedDepartureS,
  }
}

/** Whether the scenario asks for grouped decking: the request then carries the grouping data and the KPI report counts the broken preferences. */
export function yardGroupingOn(config: ScenarioConfig): boolean {
  return (config.decisions?.points?.yardAllocation?.strategy ?? strategies.yardAllocation.default) === 'grouped'
}

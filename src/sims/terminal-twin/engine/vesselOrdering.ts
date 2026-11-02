/**
 * Vessel Planning ordering (spec #106, `config.vesselPlanning.ordering = 'pod-weight'`): the work order of the
 * boxes inside one package. Pure functions of plain data; `workPackages.ts` calls them when it builds a package.
 *
 * Stacking is the only hard rule and is never traded away: a stack is always worked top-down on discharge and
 * bottom-up on load. POD and weight are soft preferences: they only choose between orders the stacking allows,
 * and the broken ones are counted (`kpis.ordering`), never refused. Packages stay one per bay section.
 */
import type { ContainerProps } from '../scenario/containerProps'
import { grossKgOf, WEIGHT_RANK } from '../scenario/containerProps'
import type { ScenarioConfig, StowSequence, VesselOrdering } from '../scenario/types'

/** The default work order (spec #106, #114): `as-today` stays selectable through `vesselPlanning.ordering` / `--ordering`. */
export const DEFAULT_VESSEL_ORDERING: VesselOrdering = 'pod-weight'

/** The work order a scenario runs with. */
export const vesselOrderingOf = (config: ScenarioConfig): VesselOrdering => config.vesselPlanning?.ordering ?? DEFAULT_VESSEL_ORDERING

/**
 * The stow sequence policy (spec #166, #174, `StowSequence` in scenario/types): the order a bay section's moves take
 * inside its package. `tier` is the only value: discharge takes the highest tier first across all stacks of the
 * section, load the lowest tier first (see `orderLoad`). Package order and bay order do not depend on it.
 */
export const DEFAULT_STOW_SEQUENCE: StowSequence = 'tier'

/** The stow sequence a scenario runs with (`vesselPlanning.stowSequence`, default `tier`). */
export const stowSequenceOf = (config: ScenarioConfig): StowSequence => config.vesselPlanning?.stowSequence ?? DEFAULT_STOW_SEQUENCE

/** A vessel cell as the ordering sees it. */
export interface OrderCell {
  bay: number
  row: number
  tier: number
  deck: boolean
  /** Aft/fore 20 ft half, or null for a whole 40 ft cell. */
  half: 'aft' | 'fore' | null
}

/** What the ordering reads of a box: its stored properties, line and size. */
export interface OrderBox {
  line: string
  size: string
  props?: ContainerProps
}

export interface OrderEntry<S extends OrderCell> {
  slot: S
  /** Absent for an empties requirement (no box allocated yet): it keeps its place after the boxes of its section. */
  box: OrderBox | undefined
}


/** Position of a POD in the port rotation (later port = larger). A POD outside the rotation ranks as the terminal. */
export function podRank(ports: readonly string[], pod: string | undefined): number {
  return Math.max(0, pod ? ports.indexOf(pod) : 0)
}

const grossOf = (b: OrderBox | undefined): number => (b?.props ? grossKgOf(b.props) : 0)
const aftFirst = (h: OrderCell['half']): number => (h === 'fore' ? 1 : 0)

/**
 * Yard-group key of a discharged box, mirroring how the yard groups boxes: imports by line, transshipments by
 * onward vessel and POD, storage empties by line, size and type. Equal keys = the same yard area.
 */
export function yardGroupOrderKey(box: OrderBox | undefined, ports: readonly string[]): string {
  const p = box?.props
  if (!box || !p) return '~'
  const pod = String(podRank(ports, p.pod)).padStart(2, '0')
  if (p.direction === 'TRANSSHIPMENT') return `1|${p.outbound.id ?? ''}|${pod}`
  if (p.direction === 'IMPORT') return `0|${box.line}`
  if (p.direction === 'STORAGE') return `2|${box.line}|${box.size}|${p.isoType}`
  return `3|${p.outbound.id ?? ''}|${pod}`
}

/** Split a list into runs of the same bay section, keeping the order of the sections. */
function bySection<T extends { slot: OrderCell }>(list: T[]): T[][] {
  const runs: T[][] = []
  const index = new Map<string, T[]>()
  for (const e of list) {
    const key = `${e.slot.bay}:${e.slot.deck ? 1 : 0}`
    let run = index.get(key)
    if (!run) {
      run = []
      index.set(key, run)
      runs.push(run)
    }
    run.push(e)
  }
  return runs
}

/**
 * Discharge order `tier` (#174): highest tier first across all stacks of the section, so no stack is emptied to its
 * floor while another still stands high. Inside one tier the yard groups come together (the group key, imports by
 * line, then by planned departure, then row, aft half before fore half), so a tier still runs group by group.
 */
function dischargeByTier<S extends OrderCell>(run: OrderEntry<S>[], ports: readonly string[]): OrderEntry<S>[] {
  const keyed = run.map((e) => ({ e, group: yardGroupOrderKey(e.box, ports), dep: e.box?.props?.plannedDepartureS ?? 0 }))
  keyed.sort(
    (a, b) =>
      b.e.slot.tier - a.e.slot.tier ||
      (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) ||
      a.dep - b.dep ||
      a.e.slot.row - b.e.slot.row ||
      aftFirst(a.e.slot.half) - aftFirst(b.e.slot.half),
  )
  return keyed.map((k) => k.e)
}

const STOW_SEQUENCE_ORDER: Record<StowSequence, <S extends OrderCell>(run: OrderEntry<S>[], ports: readonly string[]) => OrderEntry<S>[]> = {
  tier: dischargeByTier,
}

/**
 * Discharge order within each bay section (a bay section = one bay of hold or deck), in the stow sequence of the
 * scenario. Sections keep their input order.
 */
export function orderDischarge<S extends OrderCell>(entries: OrderEntry<S>[], ports: readonly string[], sequence: StowSequence = DEFAULT_STOW_SEQUENCE): OrderEntry<S>[] {
  const order = STOW_SEQUENCE_ORDER[sequence]
  return bySection(entries).flatMap((run) => order(run, ports))
}

/**
 * Load order, bottom-up: lower tiers first (so a stack is never loaded out of order); inside a tier the later POD
 * first (it belongs underneath), then the heavier box, then row and half. Entries without a box (empties
 * requirements) keep their place after the boxes of their section.
 */
export function orderLoad<S extends OrderCell>(entries: OrderEntry<S>[], ports: readonly string[]): OrderEntry<S>[] {
  const out: OrderEntry<S>[] = []
  for (const run of bySection(entries)) {
    const boxes = run.filter((e) => e.box)
    const rest = run.filter((e) => !e.box)
    boxes.sort(
      (a, b) =>
        a.slot.tier - b.slot.tier ||
        podRank(ports, b.box?.props?.pod) - podRank(ports, a.box?.props?.pod) ||
        grossOf(b.box) - grossOf(a.box) ||
        a.slot.row - b.slot.row ||
        aftFirst(a.slot.half) - aftFirst(b.slot.half),
    )
    out.push(...boxes, ...rest)
  }
  return out
}

/** Broken-preference counts of one package's load plan (boxes sitting on the boxes below them in the same row). */
export interface LoadBreaks {
  /** Boxes with a later POD than a box directly below them (the one below is dug out first). */
  podOnEarlier: number
  /** Boxes in a heavier weight class than a box directly below them. */
  heavyOnLight: number
}

export function countLoadBreaks<S extends OrderCell>(entries: OrderEntry<S>[], ports: readonly string[]): LoadBreaks {
  const breaks: LoadBreaks = { podOnEarlier: 0, heavyOnLight: 0 }
  const rows = new Map<string, OrderEntry<S>[]>()
  for (const e of entries) {
    if (!e.box?.props) continue
    const key = `${e.slot.bay}:${e.slot.deck ? 1 : 0}:${e.slot.row}`
    rows.set(key, [...(rows.get(key) ?? []), e])
  }
  for (const stack of rows.values()) {
    for (const upper of stack) {
      const below = stack.filter((l) => l.slot.tier < upper.slot.tier)
      if (below.length === 0) continue
      const top = Math.max(...below.map((l) => l.slot.tier))
      const under = below.filter((l) => l.slot.tier === top)
      const u = upper.box?.props as ContainerProps
      if (under.some((l) => podRank(ports, u.pod) > podRank(ports, l.box?.props?.pod))) breaks.podOnEarlier++
      if (under.some((l) => l.box?.props && WEIGHT_RANK[u.weightClass] > WEIGHT_RANK[l.box.props.weightClass])) breaks.heavyOnLight++
    }
  }
  return breaks
}

/** Yard-group changes in a discharge sequence beyond the minimum (one per extra group), per bay section: 0 = every group came off in one run. */
export function countDischargeSplits<S extends OrderCell>(sequence: OrderEntry<S>[], ports: readonly string[]): number {
  let splits = 0
  for (const run of bySection(sequence)) {
    const keys = run.map((e) => yardGroupOrderKey(e.box, ports))
    let changes = 0
    for (let i = 1; i < keys.length; i++) if (keys[i] !== keys[i - 1]) changes++
    splits += Math.max(0, changes - Math.max(0, new Set(keys).size - 1))
  }
  return splits
}

/** A booked export box and its cell, as the plan-time stowage sees it. */
export interface StowItem {
  boxId: string
  slotId: string
  cell: OrderCell
  size: string
  reefer: boolean
  props?: ContainerProps
}

/**
 * Plan-time stowage (the "where the slots allow" of the load preference): later PODs and heavier boxes take the
 * lower tiers of their bay section. Only boxes of the same size and reefer-ness trade cells, so every cell still
 * fits its box. Returns the new slot id of each box that moves.
 */
export function stowByPodWeight(items: StowItem[], ports: readonly string[]): Map<string, string> {
  const moved = new Map<string, string>()
  const groups = new Map<string, StowItem[]>()
  for (const it of items) {
    if (!it.props) continue
    const key = `${it.cell.bay}:${it.cell.deck ? 1 : 0}:${it.size}:${it.reefer ? 1 : 0}`
    groups.set(key, [...(groups.get(key) ?? []), it])
  }
  for (const group of groups.values()) {
    const cells = [...group].sort(
      (a, b) =>
        a.cell.tier - b.cell.tier ||
        a.cell.row - b.cell.row ||
        aftFirst(a.cell.half) - aftFirst(b.cell.half) ||
        (a.slotId < b.slotId ? -1 : 1),
    )
    const boxes = [...group].sort(
      (a, b) =>
        podRank(ports, b.props?.pod) - podRank(ports, a.props?.pod) ||
        (b.props ? grossKgOf(b.props) : 0) - (a.props ? grossKgOf(a.props) : 0) ||
        (a.boxId < b.boxId ? -1 : 1),
    )
    boxes.forEach((b, i) => {
      if (cells[i].slotId !== b.slotId) moved.set(b.boxId, cells[i].slotId)
    })
  }
  return moved
}

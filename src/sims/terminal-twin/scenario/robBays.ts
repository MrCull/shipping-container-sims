/**
 * ROB (remain on board) bays (spec #106, ticket #110): a share of each vessel's bays is set aside, never worked at
 * this terminal, and filled with display-only boxes bound for later ports.
 *
 * ROB boxes are NOT containers: they are plain slot data (`RobBox`) kept per vessel, so invariants, KPIs, yard,
 * landside, work packages and cranes never see them. Only the 3D hull (and later the bay viewer) reads them.
 *
 * Randomness: every draw comes from a stream keyed by (seed, vessel id), the same family as the container
 * property streams (`containerProps.ts`), so with `robBayFraction` 0 (the default) nothing is drawn and no existing
 * box, move or golden changes. Pure: no engine state is read.
 *
 * Rules [A]:
 * - Bays: `round(robBayFraction x bays)` of the vessel's bays, at least one bay always left to work.
 * - Fill: `robFill` (default 70%) of the hold cells and of the deck cells of the ROB bays, spread unevenly over the rows.
 * - Stacking (TT-R07): bottom up, twin-20 cells first, then 40 ft cells, never a 20 on a 40. Heavier boxes lower within
 *   a kind of cell.
 * - POD: a port the service calls after this terminal (the rotation after `terminal`; the others when it is last).
 */
import type { ContainerSize, PortRotation, ScenarioConfig, VesselConfig } from './types'
import { drawContainerProps, grossKgOf, propsStream, resolveContainerProps, type WeightClass } from './containerProps'
import { cellCapacity, cellsPerBay, stackBaseTier, vesselClass, vesselSlotId, type CellHalf } from './vesselClasses'

/** [A] Default fill level of the ROB bays. */
export const DEFAULT_ROB_FILL = 0.7

/** [A] Target arrival fill of a normally stowed vessel (discharge plus ROB boxes, share of all cells): the middle of a normal 60 to 80 %. */
export const NORMAL_ARRIVAL_FILL = 0.7

/** One display-only ROB box: its slot, ISO type, POD, line and weight class (plus what the renderers need). */
export interface RobBox {
  slotId: string
  vesselId: string
  bay: number
  row: number
  tier: number
  /** On deck (true) or in the hold. */
  deck: boolean
  half: CellHalf
  size: ContainerSize
  isoType: string
  /** UN/LOCODE of a later port of the rotation. */
  pod: string
  line: string
  weightClass: WeightClass
  grossKg: number
  full: boolean
}

export const robBayFractionOf = (config: Pick<ScenarioConfig, 'robBayFraction'>): number => config.robBayFraction ?? 0
export const arrivalFillOf = (config: Pick<ScenarioConfig, 'arrivalFill'>): number => config.arrivalFill ?? 0
export const robFillOf = (config: Pick<ScenarioConfig, 'robFill'>): number => config.robFill ?? DEFAULT_ROB_FILL

/** The ports the service calls after this terminal, in call order; the other ports when the terminal is last. */
export function laterPorts(rotation: PortRotation): string[] {
  const i = rotation.ports.indexOf(rotation.terminal)
  const after = rotation.ports.slice(i + 1).filter((p) => p !== rotation.terminal)
  return after.length > 0 ? after : rotation.ports.filter((p) => p !== rotation.terminal)
}

/** Validation messages (empty = valid). */
export function validateRob(config: Pick<ScenarioConfig, 'robBayFraction' | 'robFill' | 'arrivalFill'>): string[] {
  const out: string[] = []
  const f = config.robBayFraction
  if (f !== undefined && !(f >= 0 && f < 1)) out.push('robBayFraction must be from 0 up to (not including) 1')
  const fill = config.robFill
  if (fill !== undefined && !(fill > 0 && fill <= 1)) out.push('robFill must be above 0 and at most 1')
  const af = config.arrivalFill
  if (af !== undefined && !(af > 0 && af < 1)) out.push('arrivalFill must be above 0 and below 1')
  return out
}

/** Cells a box takes on average: a 20 ft box half a cell (twin-20), a 40 or 40HC a whole one. */
export function cellsOfBoxes(count: number, sizeMix: Partial<Record<ContainerSize, number>>): number {
  const w20 = sizeMix['20'] ?? 0
  const wBig = (sizeMix['40'] ?? 0) + (sizeMix['40HC'] ?? 0)
  const p20 = w20 + wBig > 0 ? w20 / (w20 + wBig) : 0
  return count * (p20 * 0.5 + (1 - p20))
}

/**
 * Extra ROB bays that bring a vessel to the scenario's arrival fill (#148). The working bays must keep room for the
 * call's discharge cells plus its load, transshipment and empties cells (10 % spare); within that, the count whose fill
 * (discharge cells plus the filled ROB cells, over every cell of the hull) is nearest `arrivalFill`; ties take fewer bays.
 * 0 when `arrivalFill` is absent or the call alone already reaches it. `reservedBoxes` is the load side of the call.
 */
export function arrivalRobBayCount(
  config: Pick<ScenarioConfig, 'arrivalFill' | 'robFill' | 'cargo'>,
  v: Pick<VesselConfig, 'sizeClass' | 'discharge' | 'sizeMix'>,
  reservedBoxes: number,
): number {
  const target = arrivalFillOf(config)
  if (target <= 0) return 0
  const spec = vesselClass(v.sizeClass)
  const mix = v.sizeMix ?? config.cargo.sizeMix
  const dischargeCells = cellsOfBoxes(v.discharge, mix)
  const needed = (dischargeCells + cellsOfBoxes(reservedBoxes, mix)) * 1.1
  const perBay = cellsPerBay(spec)
  const total = cellCapacity(spec)
  const maxBays = Math.min(spec.bays - 1, Math.max(0, Math.floor((total - needed) / perBay)))
  const robPerBay = robFillOf(config) * perBay
  let best = 0
  for (let n = 1; n <= maxBays; n++)
    if (Math.abs((dischargeCells + n * robPerBay) / total - target) < Math.abs((dischargeCells + best * robPerBay) / total - target)) best = n
  return best
}

/**
 * The ROB bays of one vessel (sorted bay indices): `round(robBayFraction x bays)`, or `minBays` (the arrival-fill count)
 * when that is more; empty with the default fraction 0 and no arrival fill.
 */
export function pickRobBays(config: Pick<ScenarioConfig, 'robBayFraction'>, seed: number, v: Pick<VesselConfig, 'id' | 'sizeClass'>, minBays = 0): number[] {
  const bays = vesselClass(v.sizeClass).bays
  const n = Math.min(bays - 1, Math.max(0, minBays, Math.round(robBayFractionOf(config) * bays)))
  if (n === 0) return []
  const rng = propsStream(seed, `rob-bays:${v.id}`)
  const pool = Array.from({ length: bays }, (_, i) => i)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n).sort((a, b) => a - b)
}

/** Cells the vessel can work once its ROB bays are set aside. */
export const workableCells = (v: Pick<VesselConfig, 'sizeClass'>, robBays: readonly unknown[]): number => {
  const spec = vesselClass(v.sizeClass)
  return cellCapacity(spec) - robBays.length * cellsPerBay(spec)
}

function weighted<K extends string>(weights: Partial<Record<K, number>>, draw: number): K | null {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0)
  if (entries.length === 0) return null
  let r = draw * entries.reduce((n, [, w]) => n + w, 0)
  for (const [k, w] of entries) {
    r -= w
    if (r < 0) return k
  }
  return entries[entries.length - 1][0]
}

/** Split `total` cells over stacks of at most `caps[i]` (the hull profile shortens the outer hold stacks): an even share, then random moves of one cell between stacks. */
function stackHeights(total: number, caps: readonly number[], rng: () => number): number[] {
  const n = caps.length
  const h = Array.from({ length: n }, (_, i) => Math.min(caps[i], Math.floor(total / n) + (i < total % n ? 1 : 0)))
  let left = total - h.reduce((a, b) => a + b, 0)
  for (let i = 0; left > 0 && i < n * 64; i++) {
    const r = i % n
    if (h[r] < caps[r]) {
      h[r]++
      left--
    }
  }
  for (let k = 0; k < n * 2; k++) {
    const a = Math.floor(rng() * n)
    const b = Math.floor(rng() * n)
    if (a !== b && h[a] > 0 && h[b] < caps[b]) {
      h[a]--
      h[b]++
    }
  }
  return h
}

/** Fill the ROB bays of one vessel (see the module comment). Boxes come out bottom-up per stack. */
export function fillRobBays(config: ScenarioConfig, seed: number, v: VesselConfig, robBays: readonly number[]): RobBox[] {
  if (robBays.length === 0) return []
  const spec = vesselClass(v.sizeClass)
  const fill = robFillOf(config)
  const ports = laterPorts(resolveContainerProps(config).portRotation)
  const rng = propsStream(seed, `rob-fill:${v.id}`)
  const sizeMix = v.sizeMix ?? config.cargo.sizeMix
  const w20 = sizeMix['20'] ?? 0
  const wBig = (sizeMix['40'] ?? 0) + (sizeMix['40HC'] ?? 0)
  const p20 = w20 + wBig > 0 ? w20 / (w20 + wBig) : 0
  const bigMix: Partial<Record<ContainerSize, number>> = wBig > 0 ? { '40': sizeMix['40'] ?? 0, '40HC': sizeMix['40HC'] ?? 0 } : { '40': 1 }
  const out: RobBox[] = []
  let serial = 0

  const makeBox = (bay: number, row: number, tier: number, deck: boolean, half: CellHalf, size: ContainerSize): RobBox => {
    const slotId = vesselSlotId(v.id, bay, row, tier, half)
    const full = rng() >= config.cargo.emptyShare
    const line = weighted(config.cargo.lines, rng()) ?? Object.keys(config.cargo.lines)[0]
    const p = drawContainerProps(config, seed, { id: `ROB:${v.id}:${serial++}`, size, full, line, reefer: false, direction: 'TRANSSHIPMENT', inbound: { kind: 'vessel', id: v.id }, arrivalS: 0 })
    const pod = ports[Math.min(ports.length - 1, Math.floor(rng() * ports.length))]
    return { slotId, vesselId: v.id, bay, row, tier, deck, half, size, isoType: p.isoType, pod, line, weightClass: p.weightClass, grossKg: grossKgOf(p), full }
  }

  for (const bay of robBays) {
    for (const deck of [false, true]) {
      const caps = Array.from({ length: spec.rows }, (_, row) => (deck ? spec.holdTiers + spec.deckTiers : spec.holdTiers) - stackBaseTier(spec, row, deck))
      const heights = stackHeights(Math.round(fill * caps.reduce((a, b) => a + b, 0)), caps, rng)
      for (let row = 0; row < spec.rows; row++) {
        const from = stackBaseTier(spec, row, deck)
        // cells bottom-up: some twin-20 cells, then 40 ft cells; each group drawn heaviest first
        const h = heights[row]
        let pairs = 0
        for (let i = 0; i < h; i++) if (rng() < p20) pairs++
        const cells: RobBox[][] = []
        const draw = (n: number, make: () => RobBox[]) => {
          const group = Array.from({ length: n }, make)
          group.sort((a, b) => b.reduce((s, x) => s + x.grossKg, 0) - a.reduce((s, x) => s + x.grossKg, 0))
          cells.push(...group)
        }
        // tiers are assigned after the sort, so draw with a placeholder tier and fix it below
        draw(pairs, () => [makeBox(bay, row, from, deck, 'aft', '20'), makeBox(bay, row, from, deck, 'fore', '20')])
        draw(h - pairs, () => [makeBox(bay, row, from, deck, null, (weighted(bigMix, rng()) ?? '40') as ContainerSize)])
        cells.forEach((cell, i) => {
          for (const b of cell) {
            b.tier = from + i
            b.slotId = vesselSlotId(v.id, bay, row, b.tier, b.half)
            out.push(b)
          }
        })
      }
    }
  }
  return out
}

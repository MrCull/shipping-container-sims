/**
 * Bay-plan generator: turns the vessel table plus the seed into vessel
 * slots and discharge containers. Pure and deterministic; it uses its own
 * RNG stream, so the engine's main RNG (move variation) is unaffected.
 *
 * The engine builds its initial state from it, and the browser scene model
 * calls it too (same config + seed = same boxes), so bay plans never travel
 * over the worker protocol.
 *
 * Rules [A]:
 * - Discharge boxes are spread unevenly over the bays (seeded weights). Within a bay
 *   they are split between hold and deck in proportion to their tiers and
 *   stacked from the bottom (hold floor / hatch cover) up, so nothing floats.
 * - 20 ft boxes are paired fore/aft in one cell (a twin-20 candidate); an odd
 *   one out takes the aft half of a cell alone. 40 ft and HC fill a cell.
 * - Load and transshipment slots are reserved (empty, purpose set) in free
 *   cells, spread round-robin over the bays, hold first.
 */
import { nextRandom } from '../engine/rng'
import { makeIso6346Id } from './iso6346'
import { LINE_OWNER_PREFIX } from './lines'
import type { ContainerSize, ScenarioConfig, VesselConfig, Weights } from './types'
import { cellCapacity, vesselClass, vesselSlotId, type CellHalf } from './vesselClasses'

export type SlotPurpose = 'discharge' | 'load' | 'transshipment'

export interface PlannedSlot {
  id: string
  vesselId: string
  bay: number
  row: number
  tier: number
  /** On deck (true) or in the hold. */
  deck: boolean
  half: CellHalf
  purpose: SlotPurpose
}

export interface PlannedContainer {
  id: string
  size: ContainerSize
  full: boolean
  line: string
  vesselId: string
  /** The discharge box's slot on board, or the load box's booked (empty) load slot. */
  slotId: string
  /** discharge: starts on the vessel; load: an export box starting in the yard (TT-10). */
  flow: 'discharge' | 'load'
}

/** True when export boxes exist: the load flow needs yard blocks and SHCs to carry them. */
export function loadFlowEnabled(config: ScenarioConfig): boolean {
  return (config.yard?.blocks.length ?? 0) > 0 && (config.shcs?.length ?? 0) > 0
}

export interface CargoPlan {
  slots: PlannedSlot[]
  containers: PlannedContainer[]
}

/** Seed offset of the scenario-generation RNG stream. */
const STREAM = 0x9e3779b9

type Rng = () => number

function makeRng(seed: number): Rng {
  let state = (seed ^ STREAM) >>> 0
  return () => {
    const [value, next] = nextRandom(state)
    state = next
    return value
  }
}

/** Draw a key with probability proportional to its weight. */
export function pickWeighted<K extends string>(weights: Weights<K>, rng: Rng): K {
  const entries = (Object.entries(weights) as [K, number][]).filter(([, w]) => w > 0)
  if (entries.length === 0) throw new Error('Weights must have at least one positive entry')
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let r = rng() * total
  for (const [k, w] of entries) {
    r -= w
    if (r < 0) return k
  }
  return entries[entries.length - 1][0]
}

interface Unit {
  boxes: { size: ContainerSize; full: boolean; line: string }[]
}

/** Split `total` over buckets in proportion to `weights`, capped per bucket (largest remainder). */
function apportion(total: number, weights: number[], caps: number[]): number[] {
  const out = weights.map(() => 0)
  let left = total
  let open = weights.map((_, i) => i).filter((i) => caps[i] > 0)
  while (left > 0 && open.length > 0) {
    const sum = open.reduce((s, i) => s + weights[i], 0)
    const share = open.map((i) => ({ i, exact: (left * weights[i]) / sum }))
    let given = 0
    for (const { i, exact } of share) {
      const n = Math.min(Math.floor(exact), caps[i] - out[i])
      out[i] += n
      given += n
    }
    // hand out the remainder one by one, largest fraction first
    share.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.i - b.i)
    for (const { i } of share) {
      if (given >= left) break
      if (out[i] < caps[i]) {
        out[i]++
        given++
      }
    }
    left -= given
    open = open.filter((i) => out[i] < caps[i])
    if (given === 0) break
  }
  return out
}

function planVessel(
  config: ScenarioConfig,
  v: VesselConfig,
  rng: Rng,
  serials: Map<string, number>,
  plan: CargoPlan,
  loadRng: Rng,
): void {
  const spec = vesselClass(v.sizeClass)
  const tiers = spec.holdTiers + spec.deckTiers
  const { cargo } = config

  // 1. Boxes and their cells (units).
  const twenties: Unit['boxes'] = []
  const units: Unit[] = []
  for (let i = 0; i < v.discharge; i++) {
    const box = {
      size: pickWeighted(v.sizeMix ?? cargo.sizeMix, rng),
      full: rng() >= cargo.emptyShare,
      line: pickWeighted(cargo.lines, rng),
    }
    if (box.size === '20') twenties.push(box)
    else units.push({ boxes: [box] })
  }
  for (let i = 0; i < twenties.length; i += 2) units.push({ boxes: twenties.slice(i, i + 2) })
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[units[i], units[j]] = [units[j], units[i]]
  }
  const withLoad = loadFlowEnabled(config)
  const reserved = (withLoad ? 0 : v.load) + v.transshipment
  const capacity = cellCapacity(spec)
  if (units.length + reserved > capacity)
    throw new Error(
      `Vessel ${v.id} (${spec.label}): ${units.length} discharge cells + ${reserved} load/transshipment slots do not fit (capacity ${capacity} cells)`,
    )

  // 2. Discharge cells: spread over bays with jitter, hold/deck in proportion, bottom-up.
  const occupied = new Set<string>()
  const cells: { bay: number; row: number; tier: number }[] = []
  const perBay = apportion(
    units.length,
    // uneven: some bays carry much more discharge than others
    Array.from({ length: spec.bays }, () => 0.1 + 1.9 * rng() ** 2),
    Array.from({ length: spec.bays }, () => spec.rows * tiers),
  )
  const fill = (bay: number, fromTier: number, toTier: number, n: number) => {
    for (let tier = fromTier; tier < toTier && n > 0; tier++)
      for (let row = 0; row < spec.rows && n > 0; row++) {
        cells.push({ bay, row, tier })
        occupied.add(`${bay}:${row}:${tier}`)
        n--
      }
  }
  perBay.forEach((q, bay) => {
    const holdCap = spec.rows * spec.holdTiers
    const deckCap = spec.rows * spec.deckTiers
    let deck = Math.min(deckCap, Math.round((q * spec.deckTiers) / tiers))
    let hold = q - deck
    if (hold > holdCap) {
      deck += hold - holdCap
      hold = holdCap
    }
    fill(bay, spec.holdTiers, tiers, deck)
    fill(bay, 0, spec.holdTiers, hold)
  })

  const addSlot = (bay: number, row: number, tier: number, half: CellHalf, purpose: SlotPurpose): string => {
    const id = vesselSlotId(v.id, bay, row, tier, half)
    plan.slots.push({ id, vesselId: v.id, bay, row, tier, deck: tier >= spec.holdTiers, half, purpose })
    return id
  }
  units.forEach((unit, i) => {
    const { bay, row, tier } = cells[i]
    unit.boxes.forEach((box, k) => {
      const half: CellHalf = box.size === '20' ? (k === 0 ? 'aft' : 'fore') : null
      const slotId = addSlot(bay, row, tier, half, 'discharge')
      const prefix = LINE_OWNER_PREFIX[box.line]
      if (!prefix) throw new Error(`Unknown shipping line ${box.line} (no owner prefix)`)
      const serial = (serials.get(prefix) ?? 100000 + Math.floor(rng() * 400000)) + 1 + Math.floor(rng() * 5)
      if (serial > 999999) throw new Error(`Owner prefix ${prefix} ran out of serial numbers`)
      serials.set(prefix, serial)
      plan.containers.push({ id: makeIso6346Id(prefix, serial), ...box, vesselId: v.id, slotId, flow: 'discharge' })
    })
  })

  // 2b. Export boxes (load flow): each goes to a slot whose stack held no discharge box, filled bottom-up,
  // so the slot below is always loaded first and nothing is left floating once the discharge is out.
  if (withLoad && v.load > 0) {
    const stackHasDischarge = (bay: number, row: number, deck: boolean): boolean => {
      for (let tier = deck ? spec.holdTiers : 0; tier < (deck ? tiers : spec.holdTiers); tier++)
        if (occupied.has(`${bay}:${row}:${tier}`)) return true
      return false
    }
    const loadTwenties: Unit['boxes'] = []
    const loadUnits: Unit[] = []
    for (let i = 0; i < v.load; i++) {
      const box = { size: pickWeighted(v.sizeMix ?? cargo.sizeMix, loadRng), full: true, line: pickWeighted(cargo.lines, loadRng) }
      if (box.size === '20') loadTwenties.push(box)
      else loadUnits.push({ boxes: [box] })
    }
    for (let i = 0; i < loadTwenties.length; i += 2) loadUnits.push({ boxes: loadTwenties.slice(i, i + 2) })
    for (let i = loadUnits.length - 1; i > 0; i--) {
      const j = Math.floor(loadRng() * (i + 1))
      ;[loadUnits[i], loadUnits[j]] = [loadUnits[j], loadUnits[i]]
    }
    const clean: { row: number; tier: number }[][] = []
    for (let bay = 0; bay < spec.bays; bay++) {
      const list: { row: number; tier: number }[] = []
      for (const deck of [false, true])
        for (let tier = deck ? spec.holdTiers : 0; tier < (deck ? tiers : spec.holdTiers); tier++)
          for (let row = 0; row < spec.rows; row++) if (!stackHasDischarge(bay, row, deck)) list.push({ row, tier })
      clean.push(list)
    }
    const room = clean.reduce((n, l) => n + l.length, 0)
    if (loadUnits.length > room)
      throw new Error(`Vessel ${v.id} (${spec.label}): ${loadUnits.length} export cells do not fit beside the discharge boxes (room for ${room})`)
    let b = 0
    for (const unit of loadUnits) {
      while (clean[b].length === 0) b = (b + 1) % spec.bays
      const cell = clean[b].shift() as { row: number; tier: number }
      occupied.add(`${b}:${cell.row}:${cell.tier}`)
      unit.boxes.forEach((box, k) => {
        const half: CellHalf = box.size === '20' ? (k === 0 ? 'aft' : 'fore') : null
        const slotId = addSlot(b, cell.row, cell.tier, half, 'load')
        const prefix = LINE_OWNER_PREFIX[box.line]
        if (!prefix) throw new Error(`Unknown shipping line ${box.line} (no owner prefix)`)
        const serial = (serials.get(prefix) ?? 100000 + Math.floor(loadRng() * 400000)) + 1 + Math.floor(loadRng() * 5)
        if (serial > 999999) throw new Error(`Owner prefix ${prefix} ran out of serial numbers`)
        serials.set(prefix, serial)
        plan.containers.push({ id: makeIso6346Id(prefix, serial), ...box, vesselId: v.id, slotId, flow: 'load' })
      })
      b = (b + 1) % spec.bays
    }
  }

  // 3. Reserved load / transshipment slots: free cells, round-robin over bays, hold first.
  const freeByBay: { row: number; tier: number }[][] = []
  for (let bay = 0; bay < spec.bays; bay++) {
    const free: { row: number; tier: number }[] = []
    for (let tier = 0; tier < tiers; tier++)
      for (let row = 0; row < spec.rows; row++) if (!occupied.has(`${bay}:${row}:${tier}`)) free.push({ row, tier })
    freeByBay.push(free)
  }
  const purposes: SlotPurpose[] = [
    ...Array.from({ length: withLoad ? 0 : v.load }, () => 'load' as const),
    ...Array.from({ length: v.transshipment }, () => 'transshipment' as const),
  ]
  let bay = 0
  for (const purpose of purposes) {
    while (freeByBay[bay].length === 0) bay = (bay + 1) % spec.bays
    const cell = freeByBay[bay].shift() as { row: number; tier: number }
    addSlot(bay, cell.row, cell.tier, null, purpose)
    bay = (bay + 1) % spec.bays
  }
}

/** Generate every vessel's bay plan and discharge boxes (vessel table order). */
export function planCargo(config: ScenarioConfig, seed: number): CargoPlan {
  const rng = makeRng(seed)
  const loadRng = makeRng(seed ^ 0x51ed270b)
  const serials = new Map<string, number>()
  const plan: CargoPlan = { slots: [], containers: [] }
  for (const v of config.vessels) planVessel(config, v, rng, serials, plan, loadRng)
  return plan
}

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
 *   they are split between hold and deck in proportion to their tiers (all on deck with `deckOnly`) and
 *   stacked from the bottom (hold floor / hatch cover) up, so nothing floats.
 * - 20 ft boxes are paired fore/aft in one cell (a twin-20 candidate); an odd
 *   one out takes the aft half of a cell alone. 40 ft and HC fill a cell.
 * - Stowage (TT-R07): a 20 ft box never sits on a 40 ft box, and a 40 ft box rests only on a 40 or on two filled
 *   20 ft halves. A stack (one bay x row x hold/deck section) therefore reads, bottom up, twin-20 cells, then either
 *   40 ft cells or lone 20 ft halves ({@link stackAccepts}).
 * - Load and transshipment slots are reserved (empty, purpose set) in free
 *   cells, spread round-robin over the bays, hold first.
 */
import { nextRandom } from '../engine/rng'
import { makeIso6346Id } from './iso6346'
import { LINE_OWNER_PREFIX } from './lines'
import { isReefer } from './reefer'
import { sampleDwell, transshipmentConfig } from './dwell'
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
  /** Empty-container slot (TT-11): which requirement (index in `VesselConfig.empties`) it is booked for. */
  emptyReq?: { index: number; size: ContainerSize; line: string }
  /** Transshipment slot linked to a box that arrives on an earlier vessel (TT-11). */
  plannedContainerId?: string
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
  flow: 'discharge' | 'load' | 'pool'
  /**
   * Discharge boxes linked to an onward vessel (TT-11): the vessel and slot that will load it, and how long it
   * dwells in the yard first (s).
   */
  transshipment?: { onwardVesselId: string; onwardSlotId: string; dwellS: number }
  /** Empty-pool boxes (TT-11): how long the box has stood in the yard at t = 0 (s). Internal scratch for transshipment dwell. */
  ageS?: number
  /** Reefer (R19): needs a powered yard row, at most `REEFER_MAX_TIERS` high. Absent = not a reefer. */
  reefer?: true
}

/** True when export boxes exist: the load flow needs yard blocks and SHCs to carry them. */
export function loadFlowEnabled(config: ScenarioConfig): boolean {
  return (config.yard?.blocks.length ?? 0) > 0 && (config.shcs?.length ?? 0) > 0
}

export interface CargoPlan {
  slots: PlannedSlot[]
  containers: PlannedContainer[]
}

/** `ContainerState.vesselId` of empty-pool boxes (they belong to no vessel). */
export const POOL_VESSEL_ID = 'POOL'

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

/** What a cell of a stack holds: two 20 ft halves, a 40 ft box (or HC), or a single 20 ft half. */
export type CellKind = 'pair' | 'full' | 'lone'
/** Stowage state of a stack, bottom up: twin-20 cells only (`open`), then 40 ft cells (`full`) or lone halves (`lone`). */
export type StackState = 'open' | 'full' | 'lone'

/** The state after `kind` goes on top of a stack in `state`, or null when that would put a 20 on a 40 or a 40 on a lone half. */
export function stackAccepts(state: StackState, kind: CellKind): StackState | null {
  if (state === 'open') return kind === 'pair' ? 'open' : kind
  return state === kind ? state : null
}

function cellKindOf(boxes: readonly { size: ContainerSize }[]): CellKind {
  return boxes[0].size !== '20' ? 'full' : boxes.length === 2 ? 'pair' : 'lone'
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

/**
 * Reorders the discharge cells of every stack so nothing breaks the stowage rule (TT-R07): twin-20 cells at the
 * bottom, then the 40 ft cells or the lone 20 ft half, never both. `units[i]` sits in `cells[i]`; units only
 * move within a stack, except the odd lone half, which swaps into a stack that has no 40 ft box when its own has one.
 */
function stowDischarge(units: Unit[], cells: { bay: number; row: number; tier: number }[], holdTiers: number): void {
  const stackOf = (i: number) => `${cells[i].bay}:${cells[i].row}:${cells[i].tier >= holdTiers}`
  const members = new Map<string, number[]>()
  cells.forEach((_, i) => members.set(stackOf(i), [...(members.get(stackOf(i)) ?? []), i]))
  const kinds = (idx: number[]) => idx.map((i) => cellKindOf(units[i].boxes))
  const lone = units.findIndex((u) => cellKindOf(u.boxes) === 'lone')
  if (lone >= 0 && kinds(members.get(stackOf(lone)) as number[]).includes('full')) {
    const swap = (a: number, b: number) => ([units[a], units[b]] = [units[b], units[a]])
    const groups = [...members.values()]
    const clean = groups.find((g) => !kinds(g).includes('full') && !kinds(g).includes('lone'))
    if (clean) swap(lone, clean[0])
    else {
      // every stack holds a 40 ft box: trade places with the only 40 ft box of a stack
      const single = groups.find((g) => kinds(g).filter((k) => k === 'full').length === 1 && !kinds(g).includes('lone'))
      if (!single) throw new Error('No legal cell for the odd 20 ft box: every stack holds 40 ft boxes (a 20 never sits on a 40)')
      swap(lone, single[kinds(single).indexOf('full')] as number)
    }
  }
  const rank = { pair: 0, full: 1, lone: 1 }
  for (const idx of members.values()) {
    const sorted = [...idx].sort((a, b) => cells[a].tier - cells[b].tier)
    const ordered = sorted.map((i) => units[i]).sort((a, b) => rank[cellKindOf(a.boxes)] - rank[cellKindOf(b.boxes)])
    sorted.forEach((i, k) => (units[i] = ordered[k]))
  }
}

function planVessel(
  config: ScenarioConfig,
  v: VesselConfig,
  rng: Rng,
  serials: Map<string, number>,
  plan: CargoPlan,
  loadRng: Rng,
  dwellRng: Rng,
  tsSources: PlannedContainer[],
): void {
  const spec = vesselClass(v.sizeClass)
  const tiers = spec.holdTiers + spec.deckTiers
  const { cargo } = config

  // 1. Boxes and their cells (units).
  const twenties: Unit['boxes'] = []
  const units: Unit[] = []
  const tsBoxes = new Set<object>()
  const tsCount = Math.min(v.discharge, v.dischargeTransshipment ?? 0)
  for (let i = 0; i < v.discharge; i++) {
    const box = {
      size: pickWeighted(v.sizeMix ?? cargo.sizeMix, rng),
      full: rng() >= cargo.emptyShare,
      line: pickWeighted(cargo.lines, rng),
    }
    if (i < tsCount) tsBoxes.add(box)
    if (box.size === '20') twenties.push(box)
    else units.push({ boxes: [box] })
  }
  for (let i = 0; i < twenties.length; i += 2) units.push({ boxes: twenties.slice(i, i + 2) })
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[units[i], units[j]] = [units[j], units[i]]
  }
  const withLoad = loadFlowEnabled(config)
  const reserved = withLoad ? 0 : v.load + v.transshipment
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
    let deck = Math.min(deckCap, v.deckOnly ? q : Math.round((q * spec.deckTiers) / tiers))
    let hold = q - deck
    if (hold > holdCap) {
      deck += hold - holdCap
      hold = holdCap
    }
    fill(bay, spec.holdTiers, tiers, deck)
    fill(bay, 0, spec.holdTiers, hold)
  })

  stowDischarge(units, cells, spec.holdTiers)
  /** Stacks that end in a lone 20 ft half: nothing but another half may go on top. */
  const loneStacks = new Set(
    units.flatMap((u, i) => (cellKindOf(u.boxes) === 'lone' ? [`${cells[i].bay}:${cells[i].row}:${cells[i].tier >= spec.holdTiers}`] : [])),
  )

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
      const planned: PlannedContainer = { id: makeIso6346Id(prefix, serial), ...box, vesselId: v.id, slotId, flow: 'discharge' }
      if (isReefer(cargo, planned.id, planned.full)) planned.reefer = true
      plan.containers.push(planned)
      if (tsBoxes.has(box)) tsSources.push(planned)
    })
  })

  // 2b. Load boxes (load flow): exports, transshipment boxes and empties each go to a slot whose stack held no
  // discharge box, filled bottom-up, so the slot below is always loaded first and nothing is left floating once the
  // discharge is out. Empties are placed after everything else, so they never lie below a box loaded with them.
  const emptiesTotal = (v.empties ?? []).reduce((n, e) => n + e.count, 0)
  if (withLoad && v.load + v.transshipment + emptiesTotal > 0) {
    const stackHasDischarge = (bay: number, row: number, deck: boolean): boolean => {
      for (let tier = deck ? spec.holdTiers : 0; tier < (deck ? tiers : spec.holdTiers); tier++)
        if (occupied.has(`${bay}:${row}:${tier}`)) return true
      return false
    }
    interface LoadBox {
      size: ContainerSize
      full: boolean
      line: string
      kind: 'export' | 'ts' | 'empty'
      req?: number
    }
    interface LoadUnit {
      boxes: LoadBox[]
    }
    const loadUnits: LoadUnit[] = []
    /** 20 ft boxes of one group share cells in pairs; the rest take a cell each. */
    const addGroup = (boxes: LoadBox[], into: LoadUnit[]) => {
      const twenties = boxes.filter((x) => x.size === '20')
      for (const x of boxes) if (x.size !== '20') into.push({ boxes: [x] })
      for (let i = 0; i < twenties.length; i += 2) into.push({ boxes: twenties.slice(i, i + 2) })
    }
    const draw = (count: number, kind: 'export' | 'ts'): LoadBox[] =>
      Array.from({ length: count }, () => ({
        size: pickWeighted(v.sizeMix ?? cargo.sizeMix, loadRng),
        full: true,
        line: pickWeighted(cargo.lines, loadRng),
        kind,
      }))
    addGroup(draw(v.load, 'export'), loadUnits)
    addGroup(draw(v.transshipment, 'ts'), loadUnits)
    for (let i = loadUnits.length - 1; i > 0; i--) {
      const j = Math.floor(loadRng() * (i + 1))
      ;[loadUnits[i], loadUnits[j]] = [loadUnits[j], loadUnits[i]]
    }
    ;(v.empties ?? []).forEach((e, index) => {
      if (!(e.line in LINE_OWNER_PREFIX)) throw new Error(`Unknown shipping line ${e.line} (no owner prefix)`)
      const boxes: LoadBox[] = Array.from({ length: e.count }, () => ({ size: e.size, full: false, line: e.line, kind: 'empty' as const, req: index }))
      addGroup(boxes, loadUnits)
    })
    interface Stack {
      next: number
      state: StackState
    }
    const stacks = new Map<string, Stack>()
    const clean: { row: number; tier: number; deck: boolean }[][] = []
    for (let bay = 0; bay < spec.bays; bay++) {
      const list: { row: number; tier: number; deck: boolean }[] = []
      for (const deck of [false, true]) {
        const from = deck ? spec.holdTiers : 0
        for (let tier = from; tier < (deck ? tiers : spec.holdTiers); tier++)
          for (let row = 0; row < spec.rows; row++)
            if (!stackHasDischarge(bay, row, deck)) {
              list.push({ row, tier, deck })
              stacks.set(`${bay}:${row}:${deck}`, { next: from, state: 'open' })
            }
      }
      clean.push(list)
    }
    const room = clean.reduce((n, l) => n + l.length, 0)
    if (loadUnits.length > room)
      throw new Error(`Vessel ${v.id} (${spec.label}): ${loadUnits.length} export cells do not fit beside the discharge boxes (room for ${room})`)
    /** First cell of a bay (lowest tier first) whose stack takes this kind of cell on top (TT-R07: no 20 on a 40). */
    const findCell = (bay: number, kind: CellKind): number => {
      for (let i = 0; i < clean[bay].length; i++) {
        const c = clean[bay][i]
        const st = stacks.get(`${bay}:${c.row}:${c.deck}`) as Stack
        if (st.next === c.tier && stackAccepts(st.state, kind)) return i
      }
      return -1
    }
    let b = 0
    for (const unit of loadUnits) {
      const kind = cellKindOf(unit.boxes)
      let tries = 0
      while (tries < spec.bays && findCell(b, kind) < 0) {
        b = (b + 1) % spec.bays
        tries++
      }
      const at = findCell(b, kind)
      if (at < 0) throw new Error(`Vessel ${v.id} (${spec.label}): no legal cell left for a ${kind === 'full' ? '40 ft' : '20 ft'} export box (a 20 never sits on a 40)`)
      const cell = clean[b].splice(at, 1)[0]
      const st = stacks.get(`${b}:${cell.row}:${cell.deck}`) as Stack
      st.next++
      st.state = stackAccepts(st.state, kind) as StackState
      occupied.add(`${b}:${cell.row}:${cell.tier}`)
      unit.boxes.forEach((box, k) => {
        const half: CellHalf = box.size === '20' ? (k === 0 ? 'aft' : 'fore') : null
        const slotId = addSlot(b, cell.row, cell.tier, half, box.kind === 'ts' ? 'transshipment' : 'load')
        if (box.kind === 'empty') {
          plan.slots[plan.slots.length - 1].emptyReq = { index: box.req as number, size: box.size, line: box.line }
          return
        }
        const prefix = LINE_OWNER_PREFIX[box.line]
        if (!prefix) throw new Error(`Unknown shipping line ${box.line} (no owner prefix)`)
        const serial = (serials.get(prefix) ?? 100000 + Math.floor(loadRng() * 400000)) + 1 + Math.floor(loadRng() * 5)
        if (serial > 999999) throw new Error(`Owner prefix ${prefix} ran out of serial numbers`)
        serials.set(prefix, serial)
        const loadBox: PlannedContainer = { id: makeIso6346Id(prefix, serial), size: box.size, full: box.full, line: box.line, vesselId: v.id, slotId, flow: 'load' }
        if (isReefer(config.cargo, loadBox.id, loadBox.full)) loadBox.reefer = true
        plan.containers.push(loadBox)
      })
      if (unit.boxes[0].kind !== 'empty') b = (b + 1) % spec.bays // empties of a requirement share a bay: one package
    }
  }
  // dwell of each transshipment box discharged here (own stream: no effect on the other draws)
  const dwell = transshipmentConfig(config).dwell
  for (const c of tsSources) if (c.vesselId === v.id) c.ageS = sampleDwell(dwell, dwellRng)

  // 3. Reserved load / transshipment slots: free cells, round-robin over bays, hold first.
  const freeByBay: { row: number; tier: number }[][] = []
  for (let bay = 0; bay < spec.bays; bay++) {
    const free: { row: number; tier: number }[] = []
    for (let tier = 0; tier < tiers; tier++)
      for (let row = 0; row < spec.rows; row++)
        if (!occupied.has(`${bay}:${row}:${tier}`) && !loneStacks.has(`${bay}:${row}:${tier >= spec.holdTiers}`)) free.push({ row, tier })
    freeByBay.push(free)
  }
  const purposes: SlotPurpose[] = [
    ...Array.from({ length: withLoad ? 0 : v.load }, () => 'load' as const),
    ...Array.from({ length: withLoad ? 0 : v.transshipment }, () => 'transshipment' as const),
  ]
  let bay = 0
  for (const purpose of purposes) {
    while (freeByBay[bay].length === 0) bay = (bay + 1) % spec.bays
    const cell = freeByBay[bay].shift() as { row: number; tier: number }
    addSlot(bay, cell.row, cell.tier, null, purpose)
    bay = (bay + 1) % spec.bays
  }
}

/** A cell of a vessel's bay plan for a box booked after the plan was made (V11-14). */
export interface ExtraLoadCell {
  bay: number
  row: number
  tier: number
  deck: boolean
  half: CellHalf
}

/**
 * The cell for one more export box booked to a vessel after planning (a box a truck delivers with any yard start).
 * Same rule as the planner: a stack that holds no discharge box and no empties slot, filled bottom-up, so the load
 * order (bay, hold before deck, tier) never leaves a box floating. A 20 ft box first completes a lone aft half.
 * Spreads over the bays (fewest slots first). Null when the vessel has no such cell left.
 */
export function extraLoadCell(
  sizeClass: VesselConfig['sizeClass'],
  slots: readonly Pick<PlannedSlot, 'bay' | 'row' | 'tier' | 'deck' | 'half' | 'purpose' | 'emptyReq'>[],
  size: ContainerSize,
): ExtraLoadCell | null {
  const spec = vesselClass(sizeClass)
  const tiers = spec.holdTiers + spec.deckTiers
  if (size === '20') {
    const lone = slots
      .filter((s) => s.half === 'aft' && s.purpose === 'load' && !s.emptyReq)
      .sort((a, b) => a.bay - b.bay || Number(a.deck) - Number(b.deck) || a.tier - b.tier || a.row - b.row)
      .find((s) => !slots.some((o) => o !== s && o.bay === s.bay && o.row === s.row && o.deck === s.deck && o.tier >= s.tier))
    if (lone) return { bay: lone.bay, row: lone.row, tier: lone.tier, deck: lone.deck, half: 'fore' }
  }
  const perBay = new Array<number>(spec.bays).fill(0)
  for (const s of slots) perBay[s.bay]++
  const bays = [...perBay.keys()].sort((a, b) => perBay[a] - perBay[b] || a - b)
  const kind: CellKind = size === '20' ? 'lone' : 'full'
  for (const bay of bays)
    for (const deck of [false, true]) {
      const from = deck ? spec.holdTiers : 0
      const to = deck ? tiers : spec.holdTiers
      let best: ExtraLoadCell | null = null
      for (let row = 0; row < spec.rows; row++) {
        const stack = slots.filter((s) => s.bay === bay && s.row === row && s.deck === deck)
        if (stack.some((s) => s.purpose === 'discharge' || s.emptyReq)) continue
        const tier = stack.reduce((m, s) => Math.max(m, s.tier + 1), from)
        if (tier >= to) continue
        // TT-R07: a 40 never goes on a lone half, a 20 never on a 40
        let state: StackState | null = 'open'
        for (let t = from; t < tier && state; t++) {
          const halves = stack.filter((s) => s.tier === t)
          state = stackAccepts(state, cellKindOf(halves[0]?.half === null ? [{ size: '40' }] : halves.length === 2 ? [{ size: '20' }, { size: '20' }] : [{ size: '20' }]))
        }
        if (!state || !stackAccepts(state, kind)) continue
        if (!best || tier < best.tier) best = { bay, row, tier, deck, half: size === '20' ? 'aft' : null }
      }
      if (best) return best
    }
  return null
}

/**
 * Generate every vessel's bay plan and boxes (vessel table order), then link transshipment boxes to their onward
 * vessels and add the empty pool.
 *
 * Transshipment link [A]: each box a vessel discharges as transshipment (`dischargeTransshipment`) may be loaded
 * by a LATER vessel's transshipment slot of the same size, first come first served, if its dwell fits before that
 * vessel arrives (discharge vessel arrival + dwell <= onward arrival). Transshipment slots with no such box
 * hold a box that is already in the yard at t = 0 (it came on an earlier vessel); discharged boxes with no
 * onward slot stay in the yard like imports.
 */
export function planCargo(config: ScenarioConfig, seed: number): CargoPlan {
  const rng = makeRng(seed)
  const loadRng = makeRng(seed ^ 0x51ed270b)
  const dwellRng = makeRng(seed ^ 0x7a3b9c11)
  const serials = new Map<string, number>()
  const plan: CargoPlan = { slots: [], containers: [] }
  const tsSources: PlannedContainer[] = []
  for (const v of config.vessels) planVessel(config, v, rng, serials, plan, loadRng, dwellRng, tsSources)
  if (loadFlowEnabled(config)) {
    linkTransshipment(config, plan, tsSources)
    addEmptyPool(config, seed, plan, serials)
  } else for (const c of tsSources) delete c.ageS
  return plan
}

function linkTransshipment(config: ScenarioConfig, plan: CargoPlan, sources: PlannedContainer[]): void {
  if (sources.length === 0) return
  const arrival = new Map(config.vessels.map((v) => [v.id, v.arrivalS]))
  const slots = new Map(plan.slots.map((s) => [s.id, s]))
  const free = sources
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (arrival.get(a.c.vesselId) as number) - (arrival.get(b.c.vesselId) as number) || a.i - b.i)
    .map((x) => x.c)
  const used = new Set<string>()
  const replaced = new Set<string>()
  const targets = plan.containers
    .filter((c) => c.flow === 'load' && slots.get(c.slotId)?.purpose === 'transshipment')
    .sort((a, b) => (arrival.get(a.vesselId) as number) - (arrival.get(b.vesselId) as number))
  for (const target of targets) {
    const limit = arrival.get(target.vesselId) as number
    const source = free.find(
      (c) => !used.has(c.id) && c.size === target.size && c.vesselId !== target.vesselId && (arrival.get(c.vesselId) as number) + (c.ageS as number) <= limit,
    )
    if (!source) continue
    used.add(source.id)
    replaced.add(target.id)
    ;(slots.get(target.slotId) as PlannedSlot).plannedContainerId = source.id
    source.transshipment = { onwardVesselId: target.vesselId, onwardSlotId: target.slotId, dwellS: source.ageS as number }
  }
  for (const c of sources) delete c.ageS
  if (replaced.size > 0) plan.containers = plan.containers.filter((c) => !replaced.has(c.id))
}

/** The empty pool (TT-11): boxes in the yard at t = 0, each with an age. Own RNG stream. */
function addEmptyPool(config: ScenarioConfig, seed: number, plan: CargoPlan, serials: Map<string, number>): void {
  const pool = config.emptyPool
  if (!pool || pool.count <= 0) return
  const rng = makeRng(seed ^ 0x3c6ef372)
  for (let i = 0; i < pool.count; i++) {
    const size = pickWeighted(pool.sizeMix ?? config.cargo.sizeMix, rng)
    const line = pickWeighted(pool.lines ?? config.cargo.lines, rng)
    const prefix = LINE_OWNER_PREFIX[line]
    if (!prefix) throw new Error(`Unknown shipping line ${line} (no owner prefix)`)
    const serial = (serials.get(prefix) ?? 100000 + Math.floor(rng() * 400000)) + 1 + Math.floor(rng() * 5)
    if (serial > 999999) throw new Error(`Owner prefix ${prefix} ran out of serial numbers`)
    serials.set(prefix, serial)
    plan.containers.push({
      id: makeIso6346Id(prefix, serial),
      size,
      full: false,
      line,
      vesselId: POOL_VESSEL_ID,
      slotId: '',
      flow: 'pool',
      ageS: Math.round(rng() * (pool.maxAgeS ?? 7 * 86400)),
    })
  }
}

/**
 * Yard pre-fill (TT-14): the starting population of a `prefilled` yard, placed box by box through the selected
 * yardAllocation strategy, so the starting stacks reflect the strategy under test. The engine asks the handler
 * through the decision runtime in its pre-run phase (V11-13, `subsystems/prefill.ts`) using `prefillSteps`;
 * `planPrefill` is the same computation answered synchronously, for the scene model. Pure and seeded (own RNG
 * stream): the same config, seed and strategy give an identical yard. The engine's initial state and the browser
 * scene model both call `planPrefill`.
 *
 * Population, in placement order:
 * 1. export and transshipment-load boxes booked to the scenario's vessels (reverse load sequence);
 * 2. the empty pool (oldest first);
 * 3. filler boxes until the target % of the yard's cells is reached: imports awaiting truck pickup and (with
 *    `yardStart.mix`, #149) exports and transshipment boxes waiting for a vessel outside the scenario, in the mix's shares.
 *    An import has a dwell that has already partly elapsed: `pickupReadyAt` = its dwell minus its age (> 0 unless the
 *    dwell is 0).
 * The booked boxes are always placed, even when they exceed the target.
 * A box goes to the block with the lowest fill (ties: first block) that has a legal slot. Under the `grouped` strategy
 * (#149) the pre-fill stacks like a terminal: every box carries its grouping properties, a box prefers the blocks that
 * already hold its group (while they are under 90% full), never stands on another group, and the booked exports are
 * placed group by group, heavy first.
 */
import type { DecisionHandler, DecisionRequestMessage, YardAllocationRequest, YardBoxView } from './decisions/types'
import { getStrategy, strategies } from './decisions/strategies'
import { yardGroupingOn, yardGroupKey, yardViewOfProps } from './decisions/yardGrouping'
import { createQuery, type SimQuery } from './query'
import { nextRandom, seedState } from './rng'
import type { SimState } from './state'
import { blockSpecs, boxSpan, parseYardSlotId, reeferFields } from './yardLayout'
import { pickWeighted, POOL_VESSEL_ID, type CargoPlan } from '../scenario/bayPlan'
import { drawContainerProps, WEIGHT_RANK, type ContainerProps } from '../scenario/containerProps'
import { sampleDwell } from '../scenario/dwell'
import { DEFAULT_LANDSIDE } from '../scenario/builder'
import { compareKeys, loadSequenceKey, type ExportPlacement } from '../scenario/exportYard'
import { makeIso6346Id } from '../scenario/iso6346'
import { LINE_OWNER_PREFIX } from '../scenario/lines'
import { isReefer } from '../scenario/reefer'
import { DEFAULT_YARD_TARGET_PCT, type ContainerSize, type ScenarioConfig } from '../scenario/types'

/** Asks the yardAllocation handler for a slot (synchronously). */
export type YardPlacer = (message: DecisionRequestMessage<'yardAllocation'>, query: SimQuery) => string | null

/** A filler box created by the pre-fill: an import (the default) or a transshipment box (no vessel: it was discharged before the scenario starts). */
export interface PrefillImport {
  id: string
  size: ContainerSize
  line: string
  /** Seconds the box has stood in the yard at t = 0. */
  ageS: number
  /** Sim time from which a truck may collect it (a transshipment box waits for its vessel instead). */
  pickupReadyAt?: number
  /** Reefer (R19): placed in a powered row. */
  reefer?: true
  /** Absent = IMPORT. */
  direction?: 'IMPORT' | 'EXPORT' | 'TRANSSHIPMENT'
  /** Stored properties, drawn by the pre-fill (same stream as the engine's container state). */
  props: ContainerProps
}

export interface PrefillPlan {
  /** Placements of the booked export boxes, the empty pool and the imports. */
  placements: ExportPlacement[]
  imports: PrefillImport[]
}

/** First serial of pre-filled import boxes (landside trucks use 500000+, the cargo plan stays below). */
const IMPORT_SERIAL0 = 700000
const PREFILL_SALT = 0x2f6e2b1
/** A grouped box keeps to the blocks that hold its group until they are this full, then it spills to the emptiest block. */
const GROUP_BLOCK_MAX_FILL = 0.9

/** The placer for a config: a custom synchronous handler, else the configured (or default) strategy. */
export function yardPlacerOf(config: ScenarioConfig, custom?: DecisionHandler<'yardAllocation'>): YardPlacer {
  const name = config.decisions?.points?.yardAllocation?.strategy ?? strategies.yardAllocation.default
  const handler = custom ?? getStrategy('yardAllocation', name)
  return (message, query) => {
    const reply = handler(message, query)
    if (reply && typeof (reply as { then?: unknown }).then === 'function')
      throw new Error('The synchronous pre-fill plan (planPrefill, used by the scene model) needs a synchronous yardAllocation handler; the engine itself asks the handler through the decision runtime in its pre-run phase')
    return (reply as { slotId: string | null }).slotId
  }
}

/** Cells (20 ft each) of the whole yard. */
export const yardCapacityCells = (config: ScenarioConfig): number => blockSpecs(config).reduce((n, b) => n + b.bays * b.rows * b.tiers, 0)

/**
 * The pre-fill as a resumable computation: yields one `yardAllocation` request at a time and receives the reply's
 * slot id (or null), then continues; `out` fills up as boxes are placed. Pure and seeded: the same replies in the
 * same order rebuild the same state, which is how a snapshot taken mid pre-run is resumed.
 */
export function* prefillSteps(
  config: ScenarioConfig,
  plan: CargoPlan,
  seed: number,
  out: PrefillPlan = { placements: [], imports: [] },
): Generator<YardAllocationRequest, PrefillPlan, string | null> {
  const blocks = blockSpecs(config).map((spec) => ({
    spec,
    capacity: spec.bays * spec.rows * spec.tiers,
    used: 0,
    heights: new Array<number>(spec.bays * spec.rows).fill(0),
    tops: new Array<string | null>(spec.bays * spec.rows).fill(null),
    spans: new Array<number>(spec.bays * spec.rows).fill(0),
    views: new Array<YardBoxView | null>(spec.bays * spec.rows).fill(null),
    groups: new Map<string, number>(),
  }))
  const grouped = yardGroupingOn(config)
  if (blocks.length === 0) return out
  let rngState = seedState((seed ^ PREFILL_SALT) >>> 0)
  const rng = () => {
    const [v, next] = nextRandom(rngState)
    rngState = next
    return v
  }
  function* tryPlace(
    box: { id: string; size: ContainerSize; full: boolean; line: string; vesselId: string; reefer?: true; props?: ContainerProps },
    strict = true,
  ): Generator<YardAllocationRequest, ExportPlacement | null, string | null> {
    const view = grouped && box.props ? yardViewOfProps(box.line, box.size, box.props) : null
    const key = view ? yardGroupKey(view) : ''
    // lowest fill first (a grouped box: the blocks that hold its group first); a block without a legal slot passes the box on
    const fill = (b: (typeof blocks)[number]) => b.used / b.capacity
    const own = (b: (typeof blocks)[number]) => (view && (b.groups.get(key) ?? 0) > 0 && fill(b) < GROUP_BLOCK_MAX_FILL ? 0 : 1)
    const order = blocks.map((b, i) => ({ b, i })).sort((x, y) => own(x.b) - own(y.b) || fill(x.b) - fill(y.b) || x.i - y.i)
    for (const { b } of order) {
      const request: YardAllocationRequest = {
        containerId: box.id,
        size: box.size,
        full: box.full,
        line: box.line,
        vesselId: box.vesselId,
        wtpPadId: '',
        blockId: b.spec.id,
        bays: b.spec.bays,
        rows: b.spec.rows,
        tiers: b.spec.tiers,
        blockX: b.spec.x,
        firstBayZ: b.spec.firstBayZ,
        wtpX: b.spec.x,
        wtpZ: b.spec.wtpZ,
        heights: b.heights.slice(),
        topVessels: b.tops.slice(),
        stackSpans: b.spans.slice(),
        ...(view ? { box: view, stackTops: b.views.slice(), ...(strict ? { sameGroupOnly: true as const } : {}) } : {}),
        ...reeferFields(b.spec, box.reefer),
        random: rng(),
      }
      const slotId = yield request
      if (slotId === null) continue
      const cell = parseYardSlotId(slotId)
      const span = boxSpan(box.size)
      if (cell.blockId !== b.spec.id || cell.bay < 1 || cell.bay + span - 1 > b.spec.bays || cell.row < 1 || cell.row > b.spec.rows || cell.tier < 1)
        throw new Error(`yardAllocation handler returned slot ${slotId}, which is outside block ${b.spec.id} for a ${span * 20} ft box (pre-fill)`)
      for (let k = 0; k < span; k++) {
        const i = (cell.bay + k - 1) * b.spec.rows + (cell.row - 1)
        if (b.heights[i] !== cell.tier - 1) throw new Error(`yardAllocation handler returned slot ${slotId}, which does not sit on its stack (pre-fill)`)
        b.heights[i] = cell.tier
        b.tops[i] = box.vesselId
        b.spans[i] = span
        b.views[i] = view
      }
      if (view) b.groups.set(key, (b.groups.get(key) ?? 0) + span)
      b.used += span
      const placement: ExportPlacement = { containerId: box.id, vesselId: box.vesselId, size: box.size, blockId: b.spec.id, slotId, bay: cell.bay, row: cell.row, tier: cell.tier, span }
      out.placements.push(placement)
      return placement
    }
    return null
  }

  // 1 + 2: booked export boxes, then the empty pool
  const slots = new Map(plan.slots.map((s) => [s.id, s]))
  const vesselIndex = new Map(config.vessels.map((v, i) => [v.id, i]))
  const exports = plan.containers
    .filter((c) => c.flow === 'load')
    .map((c) => ({ c, key: [vesselIndex.get(c.vesselId) ?? 0, ...loadSequenceKey(slots.get(c.slotId) as NonNullable<ReturnType<typeof slots.get>>)] }))
    .sort((a, b) => compareKeys(b.key, a.key))
    .map((x) => x.c)
  if (grouped) {
    // group by group (vessel and POD), heavy first so the heavy boxes stand at the bottom; ties keep the reverse load sequence
    const groupOf = (c: (typeof exports)[number]) => (c.props ? yardGroupKey(yardViewOfProps(c.line, c.size, c.props)) : '')
    const rank = (c: (typeof exports)[number]) => (c.props ? WEIGHT_RANK[c.props.weightClass] : 0)
    const index = new Map(exports.map((c, i) => [c.id, i]))
    exports.sort((a, b) => (groupOf(a) < groupOf(b) ? -1 : groupOf(a) > groupOf(b) ? 1 : rank(b) - rank(a) || (index.get(a.id) as number) - (index.get(b.id) as number)))
  }
  const pool = plan.containers.filter((c) => c.flow === 'pool').sort((a, b) => (b.ageS ?? 0) - (a.ageS ?? 0) || (a.id < b.id ? -1 : 1))
  for (const c of [...exports, ...pool]) {
    let p = yield* tryPlace(c)
    if (!p && grouped) p = yield* tryPlace(c, false) // a booked box is always placed, even on another group
    if (!p) throw new Error(`The yard has no room for ${c.flow === 'load' ? 'export box' : 'empty'} ${c.id} (add yard blocks, bays or tiers)`)
  }

  // 3: imports up to the target
  const target = Math.round((yardCapacityCells(config) * (config.yardStart?.targetPct ?? DEFAULT_YARD_TARGET_PCT)) / 100)
  const dwell = config.landside?.importDwell ?? DEFAULT_LANDSIDE.importDwell
  const ids = new Set(plan.containers.map((c) => c.id))
  let placed = blocks.reduce((s, b) => s + b.used, 0)
  const mix = config.yardStart?.mix
  for (let serial = IMPORT_SERIAL0; placed < target; serial++) {
    const direction = (mix ? pickWeighted<string>({ IMPORT: mix.import, EXPORT: mix.export, TRANSSHIPMENT: mix.transshipment }, rng) : 'IMPORT') as NonNullable<PrefillImport['direction']>
    let size = pickWeighted<ContainerSize>(config.cargo.sizeMix, rng)
    const line = pickWeighted<string>(config.cargo.lines, rng)
    if (boxSpan(size) > target - placed) size = '20'
    const d = sampleDwell(dwell, rng)
    const ageS = Math.round(rng() * d)
    let id = makeIso6346Id(LINE_OWNER_PREFIX[line], serial)
    while (ids.has(id)) id = makeIso6346Id(LINE_OWNER_PREFIX[line], ++serial)
    ids.add(id)
    const reefer = isReefer(config.cargo, id, true)
    const propsOf = (sz: ContainerSize) =>
      drawContainerProps(config, seed, { id, size: sz, full: true, line, reefer, direction, inbound: direction === 'EXPORT' ? { kind: 'truck' } : { kind: 'vessel' }, arrivalS: -ageS }) // an import or transshipment box was discharged before the scenario starts, from a vessel outside it; an export came by truck
    // recorded before its placement is announced, so a consumer sees the box together with its slot
    const imp: PrefillImport = { id, size, line, ageS, props: propsOf(size), ...(direction === 'IMPORT' ? { pickupReadyAt: d - ageS } : { direction }) }
    if (reefer) imp.reefer = true
    out.imports.push(imp)
    let p = yield* tryPlace({ id, size, full: true, line, vesselId: POOL_VESSEL_ID, reefer: imp.reefer, props: imp.props })
    if (!p && boxSpan(size) === 2) {
      imp.size = '20' // no pair of equal stacks for a 40 ft box: a 20 ft box may still fit
      imp.props = propsOf('20')
      p = yield* tryPlace({ id, size: '20', full: true, line, vesselId: POOL_VESSEL_ID, reefer: imp.reefer, props: imp.props })
    }
    if (!p) {
      out.imports.pop()
      break // the yard is full
    }
    placed += p.span
  }
  return out
}

/** The whole pre-fill at once, asking `place` synchronously (the browser scene model, which mirrors the engine's default start). */
export function planPrefill(config: ScenarioConfig, plan: CargoPlan, seed: number, place: YardPlacer, query: SimQuery): PrefillPlan {
  const steps = prefillSteps(config, plan, seed)
  let n = 0
  let step = steps.next()
  while (!step.done) {
    const message: DecisionRequestMessage<'yardAllocation'> = {
      correlationId: `yardAllocation-prefill-${n++}`,
      decisionPoint: 'yardAllocation',
      version: 1,
      t: 0,
      payload: step.value,
    }
    step = steps.next(place(message, query))
  }
  return step.value
}

/** The pre-fill of a configured start: only for `yardStart.mode === 'prefilled'` with yard blocks. */
export function prefillOf(config: ScenarioConfig, plan: CargoPlan, seed: number, custom?: DecisionHandler<'yardAllocation'>, state?: SimState): PrefillPlan | null {
  if (config.yardStart?.mode !== 'prefilled' || blockSpecs(config).length === 0) return null
  const query = createQuery(() => state as SimState)
  return planPrefill(config, plan, seed, yardPlacerOf(config, custom), query)
}

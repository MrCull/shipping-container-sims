/**
 * Invariant checker. When enabled, the engine checks invariants after every
 * processed event; a violation is logged as an `InvariantViolated` event
 * caused by the offending event and, in fail-fast mode, stops the run.
 *
 * Incremental checking (V11-18): each invariant declares the entity kinds it
 * `reads`. After an event, `InvariantTracker.check` runs only the invariants
 * whose kinds overlap the event's subjects, and those marked `scoped` run
 * against the touched containers / yard columns only. A full sweep
 * (`InvariantTracker.sweep`, every `sweepEvery` events and at the end of a run)
 * runs every invariant's full `check`, so a violation an incremental check
 * misses still surfaces.
 *
 * Add an invariant: append to INVARIANTS with a stable dotted id and its
 * `reads`. When a ticket adds a new custody owner kind, extend `custodyHolders`
 * and `heldAt`.
 */
import { laneGraphOf } from './laneGraph'
import { hasLandside, landsideGraphOf } from './landsideGraph'
import { overlappingNewReservations, overlappingReservations } from './reservations'
import type { EngineEvent } from './events'
import { columnKey, yardIndexOf } from './yardIndex'
import { ascIndexOf, type AscState, type CustodyRef, type SimState, type YardSlotState } from './state'
import { ascPoseAt } from './subsystems/asc'
import { gantryPositionAt, railOrder } from './subsystems/rail'
import { shcPositionAt } from './subsystems/shc'
import { truckPositionAt } from './subsystems/landside'
import { ASC_MIN_SEPARATION_M, blockSpecs, travelHoistM } from './yardLayout'
import type { ScenarioConfig } from '../scenario/types'
import { vesselClass } from '../scenario/vesselClasses'

export interface InvariantViolation {
  invariant: string
  message: string
  /** Offending event (set by the engine). */
  eventId?: number
  t?: number
}

/**
 * What an invariant reads. An event touches `container` (and so `yardSlot`) when it lists containers in its subjects,
 * `vessel` for vessels, `equipment` for equipment or jobs (reservations and planned motions only change in equipment
 * events). `reservation` and `time` (positions at `state.now`, which move with the clock) are touched by every event.
 */
export type InvariantKind = 'container' | 'yardSlot' | 'vessel' | 'equipment' | 'reservation' | 'time'

/** What the last event touched, for invariants that can check less than the whole state. */
export interface InvariantScope {
  /** Containers named by the event's subjects. */
  containers: readonly string[]
  /** Yard columns (`yardIndex.columnKey`) the touched boxes stood in before and stand in now. */
  yardColumns: ReadonlySet<string>
  /** Custody owners (`kind:id`) the touched boxes left or entered, with the boxes recorded as held there. */
  custody: ReadonlyMap<string, ReadonlySet<string>>
  /** Equipment (and job) ids named by the event's subjects. */
  equipment: ReadonlySet<string>
  /** Vessels named by the event's subjects or holding a touched box (now or before). */
  vessels: ReadonlySet<string>
  /** Reservations with an id from here up were made since the last check. */
  newReservationsFrom: number
}

export interface Invariant {
  id: string
  description: string
  /** Entity kinds this invariant reads; it is skipped after an event that touches none of them. */
  reads: readonly InvariantKind[]
  /**
   * Returns one message per violation (empty = holds). Without a scope it checks the whole state. An invariant that sets
   * `scoped` also takes the scope of the last event and checks only what it touched, reporting what a full check would
   * report for those entities.
   */
  check(state: SimState, config: ScenarioConfig, scope?: InvariantScope): string[]
  scoped?: true
}

const refKey = (r: CustodyRef) => `${r.kind}:${r.id}`

/** Every place that physically holds a container, with what it holds. */
function custodyHolders(state: SimState): { owner: CustodyRef; containerId: string }[] {
  const holders: { owner: CustodyRef; containerId: string }[] = []
  for (const s of Object.values(state.vesselSlots))
    if (s.containerId) holders.push({ owner: { kind: 'vesselSlot', id: s.id }, containerId: s.containerId })
  for (const s of Object.values(state.sts))
    for (const c of s.carrying) holders.push({ owner: { kind: 'sts', id: s.id }, containerId: c })
  for (const g of Object.values(state.groundPositions))
    if (g.containerId) holders.push({ owner: { kind: 'groundPosition', id: g.id }, containerId: g.containerId })
  for (const s of Object.values(state.shcs))
    if (s.carrying) holders.push({ owner: { kind: 'shc', id: s.id }, containerId: s.carrying })
  for (const p of Object.values(state.wtpPads))
    if (p.containerId) holders.push({ owner: { kind: 'wtpPad', id: p.id }, containerId: p.containerId })
  for (const a of Object.values(state.ascs))
    if (a.carrying) holders.push({ owner: { kind: 'asc', id: a.id }, containerId: a.carrying })
  for (const y of Object.values(state.yardSlots))
    if (y.containerId) holders.push({ owner: { kind: 'yardSlot', id: y.id }, containerId: y.containerId })
  for (const t of Object.values(state.trucks))
    if (t.carrying) holders.push({ owner: { kind: 'truck', id: t.id }, containerId: t.carrying })
  // boxes that left the terminal on a truck are held by "outside"
  for (const c of Object.values(state.containers))
    if (c.custody.kind === 'external') holders.push({ owner: { ...c.custody }, containerId: c.id })
  return holders
}

/** The box a ground position or WTP pad currently holds. */
function placeHolder(state: SimState, ref: CustodyRef): string | null {
  if (ref.kind === 'groundPosition') return state.groundPositions[ref.id]?.containerId ?? null
  if (ref.kind === 'wtpPad') return state.wtpPads[ref.id]?.containerId ?? null
  return null
}


/** The containers a custody owner physically holds (the per-owner form of `custodyHolders`). */
function heldAt(state: SimState, owner: CustodyRef): string[] {
  const one = (id: string | null | undefined): string[] => (id ? [id] : [])
  switch (owner.kind) {
    case 'vesselSlot': return one(state.vesselSlots[owner.id]?.containerId)
    case 'sts': return [...(state.sts[owner.id]?.carrying ?? [])]
    case 'groundPosition': return one(state.groundPositions[owner.id]?.containerId)
    case 'shc': return one(state.shcs[owner.id]?.carrying)
    case 'wtpPad': return one(state.wtpPads[owner.id]?.containerId)
    case 'asc': return one(state.ascs[owner.id]?.carrying)
    case 'yardSlot': return one(state.yardSlots[owner.id]?.containerId)
    case 'truck': return one(state.trucks[owner.id]?.carrying)
    case 'external': return []
  }
}

const parseRefKey = (key: string): CustodyRef => {
  const i = key.indexOf(':')
  return { kind: key.slice(0, i) as CustodyRef['kind'], id: key.slice(i + 1) }
}

/** Occupied slots covering one bay-row-tier cell of a block. */
function cellOccupants(state: SimState, blockId: string, bay: number, row: number, tier: number): YardSlotState[] {
  return (yardIndexOf(state).byColumn.get(columnKey(blockId, bay, row)) ?? []).filter((s) => s.tier === tier && s.containerId)
}

/** The slots to check: those in the given columns (deduplicated), or every slot. */
function slotsToCheck(state: SimState, columns?: ReadonlySet<string>): YardSlotState[] {
  if (!columns) return Object.values(state.yardSlots)
  const index = yardIndexOf(state)
  const slots = new Set<YardSlotState>()
  for (const key of columns) for (const s of index.byColumn.get(key) ?? []) slots.add(s)
  return [...slots]
}

function slotBounds(state: SimState, columns?: ReadonlySet<string>): string[] {
  const messages: string[] = []
  for (const s of slotsToCheck(state, columns)) {
    const block = state.yardBlocks[s.blockId]
    if (!block) messages.push(`slot ${s.id} is in unknown block ${s.blockId}`)
    else if (s.bay < 1 || s.bay + s.span - 1 > block.bays || s.row < 1 || s.row > block.rows || s.tier < 1)
      messages.push(`slot ${s.id} lies outside block ${block.id} (${block.bays} bays × ${block.rows} rows)`)
  }
  return messages
}

function stackHeight(state: SimState, columns?: ReadonlySet<string>): string[] {
  const messages: string[] = []
  for (const s of slotsToCheck(state, columns)) {
    const block = state.yardBlocks[s.blockId]
    if (block && s.tier > block.tiers) messages.push(`slot ${s.id} is on tier ${s.tier}, above the tier limit ${block.tiers}`)
  }
  return messages
}

function noFloating(state: SimState, columns?: ReadonlySet<string>): string[] {
  const messages: string[] = []
  for (const s of slotsToCheck(state, columns)) {
    if (!s.containerId || s.tier <= 1) continue
    for (let b = 0; b < s.span; b++)
      if (cellOccupants(state, s.blockId, s.bay + b, s.row, s.tier - 1).length === 0)
        messages.push(`box ${s.containerId} in slot ${s.id} is floating: nothing below bay ${s.bay + b} on tier ${s.tier - 1}`)
  }
  return messages
}

/** Cells holding two or more boxes; `report` words the violation, or returns null when the invariant does not cover it. */
function sharedCells(
  state: SimState,
  columns: ReadonlySet<string> | undefined,
  report: (cell: string, slots: YardSlotState[], mixed: boolean) => string | null,
): string[] {
  const messages: string[] = []
  const seen = new Set<string>()
  for (const s of slotsToCheck(state, columns)) {
    if (!s.containerId) continue
    for (let b = 0; b < s.span; b++) {
      const cell = `${s.blockId}:${s.bay + b}-${s.row}-${s.tier}`
      if (seen.has(cell)) continue
      seen.add(cell)
      const occupants = cellOccupants(state, s.blockId, s.bay + b, s.row, s.tier)
      if (occupants.length < 2) continue
      const message = report(cell, occupants, new Set(occupants.map((o) => o.span)).size > 1)
      if (message) messages.push(message)
    }
  }
  return messages
}

const doubleOccupied = (state: SimState, columns?: ReadonlySet<string>): string[] =>
  sharedCells(state, columns, (cell, slots, mixed) => (mixed ? null : `cell ${cell} is double-occupied by ${slots.map((x) => x.id).join(', ')}`))

const mixedLengthOverlap = (state: SimState, columns?: ReadonlySet<string>): string[] =>
  sharedCells(state, columns, (cell, slots, mixed) => (mixed ? `cell ${cell}: a 40 ft box overlaps a 20 ft box (${slots.map((x) => x.id).join(', ')})` : null))

/**
 * A stack takes the length of its bottom box: every box in a stack (one row x one 20 ft bay position) has the span of
 * the box at tier 1. A 40 ft box counts in both stacks it covers.
 */
function mixedLengthStack(state: SimState, columns?: ReadonlySet<string>): string[] {
  const messages: string[] = []
  const index = yardIndexOf(state)
  const seen = new Set<string>()
  for (const s of slotsToCheck(state, columns))
    for (let b = 0; b < s.span; b++) {
      const key = columnKey(s.blockId, s.bay + b, s.row)
      if (seen.has(key) || (columns && !columns.has(key))) continue
      seen.add(key)
      const boxes = (index.byColumn.get(key) ?? []).filter((x) => x.containerId).sort((x, y) => x.tier - y.tier)
      const bottom = boxes[0]
      const other = bottom && boxes.find((x) => x.span !== bottom.span)
      if (bottom && other)
        messages.push(`stack ${key.replace('|', ' bay-row ')}: ${bottom.span * 20} ft box ${bottom.containerId} at the bottom, ${other.span * 20} ft box ${other.containerId} above it (${other.id})`)
    }
  return messages
}

/** The custody check for the owners a set of touched boxes left or entered: each owner holds exactly the boxes recorded there. */
function custodyScoped(state: SimState, scope: InvariantScope): string[] {
  const messages: string[] = []
  for (const [key, recorded] of scope.custody) {
    const owner = parseRefKey(key)
    const held = heldAt(state, owner)
    for (const id of held) {
      const box = state.containers[id]
      if (!box) messages.push(`${key} holds unknown container ${id}`)
      else if (refKey(box.custody) !== key) messages.push(`container ${id} records custody ${refKey(box.custody)} but is held by ${key}`)
    }
    for (const id of recorded) {
      if (held.includes(id)) continue
      const other = placeHolder(state, owner)
      const why = other && other !== id ? ` (${key} is double-occupied: ${other} was set down on it)` : ''
      messages.push(`container ${id} records custody ${key} but is held by nobody${why}`)
    }
  }
  return messages
}

const blockSpecCache = new WeakMap<ScenarioConfig, Record<string, ReturnType<typeof blockSpecs>[number]>>()
/** Block specs by id, built once per scenario config (the config is immutable during a run). */
function blockSpecsById(config: ScenarioConfig) {
  let by = blockSpecCache.get(config)
  if (!by) blockSpecCache.set(config, (by = Object.fromEntries(blockSpecs(config).map((b) => [b.id, b]))))
  return by
}

/** Half-extent (m) of a WTP pad's lifting envelope across X and along Z. */
const PAD_HALF_X_M = 1.6
const PAD_HALF_Z_M = 6.5

export const INVARIANTS: Invariant[] = [
  {
    id: 'custody.single-owner',
    reads: ['container'],
    description:
      'Every container is held by exactly one custody owner, and that owner is the one the container records. ' +
      'This also catches a double-occupied ground position or WTP pad: a place holds one box, so the box set down second displaces the first.',
    scoped: true,
    check(state, _config, scope) {
      if (scope) return custodyScoped(state, scope)
      const messages: string[] = []
      const heldBy = new Map<string, string[]>()
      for (const h of custodyHolders(state)) {
        if (!state.containers[h.containerId]) {
          messages.push(`${refKey(h.owner)} holds unknown container ${h.containerId}`)
          continue
        }
        const list = heldBy.get(h.containerId) ?? []
        list.push(refKey(h.owner))
        heldBy.set(h.containerId, list)
      }
      for (const box of Object.values(state.containers)) {
        const owners = heldBy.get(box.id) ?? []
        const recorded = refKey(box.custody)
        if (owners.length !== 1 || owners[0] !== recorded) {
          const held = owners.length ? owners.join(', ') : 'nobody'
          const other = placeHolder(state, box.custody)
          const why = other && other !== box.id ? ` (${recorded} is double-occupied: ${other} was set down on it)` : ''
          messages.push(`container ${box.id} records custody ${recorded} but is held by ${held}${why}`)
        }
      }
      return messages
    },

  },
  {
    id: 'reservation.no-overlap',
    reads: ['reservation'],
    description: 'No two conflict-zone reservations overlap in time.',
    scoped: true,
    check(state, _config, scope) {
      // reservations only grow by `reserve` (ids ascend) and otherwise shrink or expire, so a new overlap involves a new one
      const pairs = scope ? overlappingNewReservations(state.reservations, scope.newReservationsFrom) : overlappingReservations(state.reservations)
      return pairs.map(
        ([a, b]) =>
          `zone ${a.zone}: ${a.holder} [${a.from.toFixed(3)}, ${a.to.toFixed(3)}) overlaps ${b.holder} [${b.from.toFixed(3)}, ${b.to.toFixed(3)})`,
      )
    },
  },
  {
    id: 'claim.single-holder',
    reads: ['equipment'],
    description: 'No container is claimed by two SHCs at once, and every claimed job names its SHC.',
    check(state) {
      const messages: string[] = []
      const claims = new Map<string, string[]>()
      for (const shc of Object.values(state.shcs)) {
        if (!shc.jobId) continue
        const job = state.shcJobs[shc.jobId]
        if (!job) {
          messages.push(`${shc.id} claims unknown job ${shc.jobId}`)
          continue
        }
        if (job.shcId !== shc.id) messages.push(`${shc.id} claims job ${job.id}, which names ${job.shcId ?? 'no SHC'}`)
        claims.set(job.containerId, [...(claims.get(job.containerId) ?? []), shc.id])
      }
      for (const [containerId, holders] of claims)
        if (holders.length > 1) messages.push(`container ${containerId} is claimed by ${holders.join(', ')}`)
      return messages
    },
  },
  {
    id: 'yard.slot-bounds',
    reads: ['yardSlot'],
    description: 'Every stacked box lies inside its block: bays, rows and tiers within the block, a 40 ft box on two bays.',
    scoped: true,
    check: (state, _config, scope) => slotBounds(state, scope?.yardColumns),
  },
  {
    id: 'yard.stack-height',
    reads: ['yardSlot'],
    description: "No stack is higher than its block's tier limit.",
    scoped: true,
    check: (state, _config, scope) => stackHeight(state, scope?.yardColumns),
  },
  {
    id: 'yard.no-floating',
    reads: ['yardSlot'],
    description: 'Every box above tier 1 rests on boxes: each bay it covers has a box directly below.',
    scoped: true,
    check: (state, _config, scope) => noFloating(state, scope?.yardColumns),
  },
  {
    id: 'yard.no-double-occupied',
    reads: ['yardSlot'],
    description: 'No stack cell holds two boxes of the same length.',
    scoped: true,
    check: (state, _config, scope) => doubleOccupied(state, scope?.yardColumns),
  },
  {
    id: 'yard.no-mixed-length-overlap',
    reads: ['yardSlot'],
    description: 'A 40 ft box never overlaps a 20 ft box in the same cell.',
    scoped: true,
    check: (state, _config, scope) => mixedLengthOverlap(state, scope?.yardColumns),
  },
  {
    id: 'yard.no-mixed-length-stack',
    reads: ['yardSlot'],
    description: 'A yard stack (one row x one 20 ft bay position) holds boxes of one length only: the length of its bottom box.',
    scoped: true,
    check: (state, _config, scope) => mixedLengthStack(state, scope?.yardColumns),
  },
  {
    id: 'asc.wtp-handover',
    reads: ['time'],
    description:
      "An ASC never enters a WTP pad's lifting envelope (spreader below travel height over the pad) while an SHC is on the pad.",
    check(state, config) {
      const messages: string[] = []
      if (Object.keys(state.ascs).length === 0 || Object.keys(state.shcs).length === 0) return messages
      const graph = laneGraphOf(config)
      const blocks = blockSpecsById(config)
      for (const asc of Object.values(state.ascs)) {
        const pose = ascPoseAt(asc, state.now)
        const travel = travelHoistM(blocks[asc.blockId])
        if (pose.hoistY >= travel - 1e-6) continue
        for (const pad of graph.pads) {
          if (Math.abs(pose.x - pad.x) >= PAD_HALF_X_M || Math.abs(pose.z - pad.z) >= PAD_HALF_Z_M) continue
          for (const shc of Object.values(state.shcs)) {
            const at = shcPositionAt(graph, shc, state.now)
            if (Math.abs(at.x - pad.x) < PAD_HALF_X_M && Math.abs(at.z - pad.z) < PAD_HALF_Z_M)
              messages.push(`${asc.id} is in the lifting envelope of ${pad.id} (hoist ${pose.hoistY.toFixed(2)} m) while ${shc.id} is there`)
          }
        }
      }
      return messages
    },
  },
  {
    id: 'asc.no-passing',
    reads: ['equipment'],
    description:
      'The two ASCs of a block never pass or collide: the waterside ASC stays waterside of the landside ASC and their centres ' +
      'stay at least ASC_MIN_SEPARATION_M apart, now and at every breakpoint of their planned motion.',
    scoped: true,
    check(state, _config, scope) {
      const messages: string[] = []
      if (state.subsystems.asc !== 'real') return messages // instant ASCs jump: no rail to share
      const byBlock = new Map<string, AscState[]>()
      for (const a of Object.values(state.ascs)) byBlock.set(a.blockId, [...(byBlock.get(a.blockId) ?? []), a])
      // only the blocks whose ASCs the event involved (a pair's motion plans change only in its own events)
      const touchedBlocks = scope ? new Set(Object.values(state.ascs).filter((a) => scope.equipment.has(a.id)).map((a) => a.blockId)) : null
      for (const [blockId, list] of byBlock) {
        if (list.length < 2 || (touchedBlocks && !touchedBlocks.has(blockId))) continue
        const [w, l] = [...list].sort((a, b) => ascIndexOf(a.id) - ascIndexOf(b.id))
        const times = new Set<number>([state.now])
        for (const s of [...w.motion, ...l.motion]) {
          for (const t of [s.t0, (s.t0 + s.t1) / 2, s.t1]) if (t >= state.now) times.add(t)
        }
        for (const t of [...times].sort((a, b) => a - b)) {
          const gap = ascPoseAt(l, t).z - ascPoseAt(w, t).z
          if (gap < ASC_MIN_SEPARATION_M - 1e-6) {
            messages.push(
              `${w.id} and ${l.id} of ${blockId} are ${gap.toFixed(2)} m apart at t=${t.toFixed(2)} s (minimum ${ASC_MIN_SEPARATION_M} m, waterside ASC must stay waterside)`,
            )
            break
          }
        }
      }
      return messages
    },
  },
  {
    id: 'sts.rail-order',
    reads: ['time'],
    description:
      'STS cranes keep their rail order and never pass or overlap: neighbouring rail reservations stay stsMinSpacingM apart, ' +
      'each crane is inside its reservation, and reservations stay on the quay.',
    check(state, config) {
      const messages: string[] = []
      const eps = 1e-6
      const order = railOrder(state)
      order.forEach((s, i) => {
        const x = gantryPositionAt(s, state.now)
        if (x < s.railLo - eps || x > s.railHi + eps)
          messages.push(`${s.id} at ${x.toFixed(2)} m is outside its rail reservation ${s.railLo.toFixed(2)}–${s.railHi.toFixed(2)} m`)
        if (s.railLo < -eps || s.railHi > config.quay.lengthM + eps)
          messages.push(`${s.id} rail reservation ${s.railLo.toFixed(2)}–${s.railHi.toFixed(2)} m leaves the quay`)
        const next = order[i + 1]
        if (next && s.railHi + config.quay.stsMinSpacingM > next.railLo + eps)
          messages.push(
            `${s.id} (${s.railLo.toFixed(2)}–${s.railHi.toFixed(2)} m) and ${next.id} (${next.railLo.toFixed(2)}–${next.railHi.toFixed(2)} m) are closer than ${config.quay.stsMinSpacingM} m or out of rail order`,
          )
      })
      return messages
    },
  },
  {
    id: 'stowage.order',
    reads: ['vessel', 'container'],
    description:
      'Stowage order: a box on board never lies above an empty cell. Every filled load slot above the bottom tier of its ' +
      'section (hold floor or hatch cover) has a box directly below it, so lower tiers are loaded before upper tiers.',
    scoped: true,
    check(state, _config, scope) {
      const messages: string[] = []
      const filled = new Map<string, ('aft' | 'fore' | null)[]>()
      const loads = []
      for (const s of Object.values(state.vesselSlots)) {
        if (!s.containerId) continue
        if (scope && !scope.vessels.has(s.vesselId)) continue
        const key = `${s.vesselId}:${s.bay}:${s.row}:${s.tier}`
        filled.set(key, [...(filled.get(key) ?? []), s.half])
        if (s.purpose === 'load' || s.purpose === 'transshipment') loads.push(s)
      }
      for (const s of loads) {
        const holdTiers = vesselClass(state.vessels[s.vesselId].sizeClass).holdTiers
        if (s.tier === 0 || s.tier === holdTiers) continue
        const below = filled.get(`${s.vesselId}:${s.bay}:${s.row}:${s.tier - 1}`) ?? []
        if (!below.some((h) => h === null || s.half === null || h === s.half))
          messages.push(`box ${s.containerId} in ${s.id} lies above an empty cell (bay ${s.bay} row ${s.row} tier ${s.tier - 1})`)
      }
      return messages
    },
  },
  {
    id: 'landside.segregation',
    reads: ['equipment'],
    description:
      'Safety segregation: external trucks only ever stand on landside road nodes and never come within the waterside network ' +
      '(landside of every block stack at all times, now and at every breakpoint of their planned motion), and SHCs only stand on ' +
      'waterside lane-graph nodes, so they never use the public gate or the landside roads.',
    scoped: true,
    check(state, config, scope) {
      const messages: string[] = []
      const trucks = Object.values(state.trucks).filter((t) => !scope || scope.equipment.has(t.id))
      const lanes = laneGraphOf(config)
      if (trucks.length > 0 && hasLandside(config)) {
        const graph = landsideGraphOf(config)
        const landsideZ = Math.min(...graph.stalls.map((s) => s.z)) - 1e-6
        for (const t of trucks) {
          if (!graph.nodes[t.nodeId]) {
            if (lanes.nodes[t.nodeId]) messages.push(`${t.id} is on the waterside lane graph (node ${t.nodeId})`)
            messages.push(`${t.id} is at ${t.nodeId}, which is not a landside road node`)
            continue
          }
          const times = new Set<number>([state.now])
          for (const s of t.motion) for (const at of [s.t0, s.t1]) if (at >= state.now) times.add(at)
          for (const at of [...times].sort((a, b) => a - b)) {
            const p = truckPositionAt(graph, t, at)
            if (p.z < landsideZ) {
              messages.push(`${t.id} reaches Z ${p.z.toFixed(1)} m at t=${at.toFixed(1)} s, inside the waterside area (landside starts at Z ${landsideZ.toFixed(1)} m)`)
              break
            }
          }
        }
      }
      const gateZ = hasLandside(config) ? Math.min(...landsideGraphOf(config).stalls.map((s) => s.z)) - 1e-6 : Infinity
      for (const shc of Object.values(state.shcs)) {
        if (shc.nodeId.startsWith('ls:') || !lanes.nodes[shc.nodeId]) messages.push(`${shc.id} is at ${shc.nodeId}, which is not a waterside lane node (SHCs never use the public gate)`)
        else if (lanes.nodes[shc.nodeId].z >= gateZ) messages.push(`${shc.id} is at ${shc.nodeId}, in the landside area`)
      }
      return messages
    },
  },
  {
    id: 'berth.no-overlap',
    reads: ['vessel'],
    description: 'Vessels on the quay (mooring, berthed, unmooring) lie within the quay and keep berthGapM apart.',
    check(state, config) {
      const messages: string[] = []
      const eps = 1e-6
      const onQuay = Object.values(state.vessels)
        .filter((v) => v.berthX !== null && (v.status === 'mooring' || v.status === 'berthed' || v.status === 'unmooring'))
        .map((v) => ({ id: v.id, from: v.berthX as number, to: (v.berthX as number) + vesselClass(v.sizeClass).loaM }))
        .sort((a, b) => a.from - b.from)
      onQuay.forEach((v, i) => {
        if (v.from < -eps || v.to > config.quay.lengthM + eps) messages.push(`${v.id} (${v.from}–${v.to} m) is off the quay`)
        const next = onQuay[i + 1]
        if (next && v.to + config.quay.berthGapM > next.from + eps)
          messages.push(`${v.id} (${v.from}–${v.to} m) and ${next.id} (${next.from}–${next.to} m) are closer than ${config.quay.berthGapM} m`)
      })
      return messages
    },
  },
]

export function checkInvariants(state: SimState, config: ScenarioConfig): InvariantViolation[] {
  const violations: InvariantViolation[] = []
  for (const inv of INVARIANTS)
    for (const message of inv.check(state, config)) violations.push({ invariant: inv.id, message })
  return violations
}

/** Events between full sweeps unless the host says otherwise; the last event of a run is always swept. */
export const DEFAULT_SWEEP_EVERY = 1000

const yardColumnsOf = (state: SimState, custody: CustodyRef | undefined): string[] => {
  if (custody?.kind !== 'yardSlot') return []
  const s = state.yardSlots[custody.id]
  if (!s) return []
  const keys: string[] = []
  for (let b = 0; b < s.span; b++) keys.push(columnKey(s.blockId, s.bay + b, s.row))
  return keys
}

/**
 * Incremental invariant checking for one simulation. It remembers, per container, the custody owner and yard columns it
 * was last seen in, so a box that left a place still marks that place (and the box above it) for checking. The memory is
 * derived and self-correcting; the first check after construction or `reset()` is a full sweep.
 */
export class InvariantTracker {
  private primed = false
  private keyOf = new Map<string, string>()
  private recordedAt = new Map<string, Set<string>>()
  private columnsOf = new Map<string, string[]>()
  /** Checks run so far: full sweeps (the priming check counts as one) and incremental checks. */
  private nextReservationId = 0
  readonly stats = { sweeps: 0, incremental: 0 }

  /** Forget everything (the state was replaced); the next check is a full sweep. */
  reset(): void {
    this.primed = false
    this.keyOf.clear()
    this.recordedAt.clear()
    this.columnsOf.clear()
  }

  private record(id: string, key: string | undefined): void {
    const old = this.keyOf.get(id)
    if (old !== undefined) this.recordedAt.get(old)?.delete(id)
    if (key === undefined) {
      this.keyOf.delete(id)
      return
    }
    this.keyOf.set(id, key)
    let set = this.recordedAt.get(key)
    if (!set) this.recordedAt.set(key, (set = new Set()))
    set.add(id)
  }

  /** Every invariant over the whole state; also rebuilds what the incremental checks remember. */
  sweep(state: SimState, config: ScenarioConfig): InvariantViolation[] {
    this.reset()
    for (const box of Object.values(state.containers)) {
      this.record(box.id, refKey(box.custody))
      const cols = yardColumnsOf(state, box.custody)
      if (cols.length) this.columnsOf.set(box.id, cols)
    }
    this.primed = true
    this.nextReservationId = state.nextReservationId
    this.stats.sweeps++
    return checkInvariants(state, config)
  }

  /** The invariants the event can affect, against what it touched. */
  check(state: SimState, config: ScenarioConfig, ev: Pick<EngineEvent, 'subjects'>): InvariantViolation[] {
    if (!this.primed) return this.sweep(state, config)
    this.stats.incremental++
    const touched = new Set<InvariantKind>(['reservation', 'time'])
    const containers = ev.subjects.containers ?? []
    if (containers.length) {
      touched.add('container')
      touched.add('yardSlot')
    }
    if (ev.subjects.vessels?.length) touched.add('vessel')
    if (ev.subjects.equipment?.length || ev.subjects.jobs?.length) touched.add('equipment')

    const yardColumns = new Set<string>()
    const custody = new Map<string, Set<string>>()
    const markKey = (key: string | undefined): void => {
      if (key !== undefined && !key.startsWith('external:')) custody.set(key, new Set())
    }
    for (const id of containers) {
      markKey(this.keyOf.get(id))
      for (const c of this.columnsOf.get(id) ?? []) yardColumns.add(c)
      const box = state.containers[id]
      const key = box ? refKey(box.custody) : undefined
      this.record(id, key)
      markKey(key)
      const cols = box ? yardColumnsOf(state, box.custody) : []
      for (const c of cols) yardColumns.add(c)
      if (cols.length) this.columnsOf.set(id, cols)
      else this.columnsOf.delete(id)
    }
    // the boxes recorded at each touched owner; an entry that no longer records that owner is stale and moves to its real one
    for (const [key, recorded] of custody) {
      for (const id of [...(this.recordedAt.get(key) ?? [])]) {
        const box = state.containers[id]
        const actual = box ? refKey(box.custody) : undefined
        if (actual === key) recorded.add(id)
        else this.record(id, actual)
      }
    }

    const equipment = new Set([...(ev.subjects.equipment ?? []), ...(ev.subjects.jobs ?? [])])
    const vessels = new Set(ev.subjects.vessels ?? [])
    for (const key of custody.keys()) {
      const owner = parseRefKey(key)
      if (owner.kind === 'vesselSlot') {
        const slot = state.vesselSlots[owner.id]
        if (slot) vessels.add(slot.vesselId)
      }
    }
    const scope: InvariantScope = { containers, yardColumns, custody, equipment, vessels, newReservationsFrom: this.nextReservationId }
    this.nextReservationId = state.nextReservationId
    const violations: InvariantViolation[] = []
    for (const inv of INVARIANTS) {
      if (!inv.reads.some((k) => touched.has(k))) continue
      const messages = inv.check(state, config, inv.scoped ? scope : undefined)
      for (const message of messages) violations.push({ invariant: inv.id, message })
    }
    return violations
  }
}

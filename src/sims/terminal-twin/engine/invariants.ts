/**
 * Invariant checker. When enabled, the engine runs every invariant after
 * every processed event; a violation is logged as an `InvariantViolated`
 * event caused by the offending event and, in fail-fast mode, stops the run.
 *
 * Add an invariant: append to INVARIANTS with a stable dotted id. When a
 * ticket adds a new custody owner kind, extend `custodyHolders`.
 */
import { laneGraphOf } from './laneGraph'
import { overlappingReservations } from './reservations'
import { ascIndexOf, type AscState, type CustodyRef, type SimState } from './state'
import { ascPoseAt } from './subsystems/asc'
import { gantryPositionAt, railOrder } from './subsystems/rail'
import { shcPositionAt } from './subsystems/shc'
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

export interface Invariant {
  id: string
  description: string
  /** Returns one message per violation (empty = holds). */
  check(state: SimState, config: ScenarioConfig): string[]
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
  return holders
}

/** The box a ground position or WTP pad currently holds. */
function placeHolder(state: SimState, ref: CustodyRef): string | null {
  if (ref.kind === 'groundPosition') return state.groundPositions[ref.id]?.containerId ?? null
  if (ref.kind === 'wtpPad') return state.wtpPads[ref.id]?.containerId ?? null
  return null
}


/** Cells (block:bay-row-tier) each stacked box covers, with the slots covering each. */
function yardCells(state: SimState): Map<string, string[]> {
  const cells = new Map<string, string[]>()
  for (const s of Object.values(state.yardSlots)) {
    if (!s.containerId) continue
    for (let b = 0; b < s.span; b++) {
      const key = `${s.blockId}:${s.bay + b}-${s.row}-${s.tier}`
      cells.set(key, [...(cells.get(key) ?? []), s.id])
    }
  }
  return cells
}

/** Half-extent (m) of a WTP pad's lifting envelope across X and along Z. */
const PAD_HALF_X_M = 1.6
const PAD_HALF_Z_M = 6.5

export const INVARIANTS: Invariant[] = [
  {
    id: 'custody.single-owner',
    description:
      'Every container is held by exactly one custody owner, and that owner is the one the container records. ' +
      'This also catches a double-occupied ground position or WTP pad: a place holds one box, so the box set down second displaces the first.',
    check(state) {
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
    description: 'No two conflict-zone reservations overlap in time.',
    check(state) {
      return overlappingReservations(state.reservations).map(
        ([a, b]) =>
          `zone ${a.zone}: ${a.holder} [${a.from.toFixed(3)}, ${a.to.toFixed(3)}) overlaps ${b.holder} [${b.from.toFixed(3)}, ${b.to.toFixed(3)})`,
      )
    },
  },
  {
    id: 'claim.single-holder',
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
    description: 'Every stacked box lies inside its block: bays, rows and tiers within the block, a 40 ft box on two bays.',
    check(state) {
      const messages: string[] = []
      for (const s of Object.values(state.yardSlots)) {
        const block = state.yardBlocks[s.blockId]
        if (!block) messages.push(`slot ${s.id} is in unknown block ${s.blockId}`)
        else if (s.bay < 1 || s.bay + s.span - 1 > block.bays || s.row < 1 || s.row > block.rows || s.tier < 1)
          messages.push(`slot ${s.id} lies outside block ${block.id} (${block.bays} bays × ${block.rows} rows)`)
      }
      return messages
    },
  },
  {
    id: 'yard.stack-height',
    description: "No stack is higher than its block's tier limit.",
    check(state) {
      const messages: string[] = []
      for (const s of Object.values(state.yardSlots)) {
        const block = state.yardBlocks[s.blockId]
        if (block && s.tier > block.tiers) messages.push(`slot ${s.id} is on tier ${s.tier}, above the tier limit ${block.tiers}`)
      }
      return messages
    },
  },
  {
    id: 'yard.no-floating',
    description: 'Every box above tier 1 rests on boxes: each bay it covers has a box directly below.',
    check(state) {
      const cells = yardCells(state)
      const messages: string[] = []
      for (const s of Object.values(state.yardSlots)) {
        if (!s.containerId || s.tier <= 1) continue
        for (let b = 0; b < s.span; b++)
          if (!cells.has(`${s.blockId}:${s.bay + b}-${s.row}-${s.tier - 1}`))
            messages.push(`box ${s.containerId} in slot ${s.id} is floating: nothing below bay ${s.bay + b} on tier ${s.tier - 1}`)
      }
      return messages
    },
  },
  {
    id: 'yard.no-double-occupied',
    description: 'No stack cell holds two boxes of the same length.',
    check(state) {
      const messages: string[] = []
      for (const [cell, slots] of yardCells(state)) {
        if (slots.length < 2) continue
        const spans = new Set(slots.map((id) => state.yardSlots[id].span))
        if (spans.size === 1) messages.push(`cell ${cell} is double-occupied by ${slots.join(', ')}`)
      }
      return messages
    },
  },
  {
    id: 'yard.no-mixed-length-overlap',
    description: 'A 40 ft box never overlaps a 20 ft box in the same cell.',
    check(state) {
      const messages: string[] = []
      for (const [cell, slots] of yardCells(state)) {
        if (slots.length < 2) continue
        const spans = new Set(slots.map((id) => state.yardSlots[id].span))
        if (spans.size > 1) messages.push(`cell ${cell}: a 40 ft box overlaps a 20 ft box (${slots.join(', ')})`)
      }
      return messages
    },
  },
  {
    id: 'asc.wtp-handover',
    description:
      "An ASC never enters a WTP pad's lifting envelope (spreader below travel height over the pad) while an SHC is on the pad.",
    check(state, config) {
      const messages: string[] = []
      if (Object.keys(state.ascs).length === 0 || Object.keys(state.shcs).length === 0) return messages
      const graph = laneGraphOf(config)
      const blocks = Object.fromEntries(blockSpecs(config).map((b) => [b.id, b]))
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
    description:
      'The two ASCs of a block never pass or collide: the waterside ASC stays waterside of the landside ASC and their centres ' +
      'stay at least ASC_MIN_SEPARATION_M apart, now and at every breakpoint of their planned motion.',
    check(state) {
      const messages: string[] = []
      if (state.subsystems.asc !== 'real') return messages // instant ASCs jump: no rail to share
      const byBlock = new Map<string, AscState[]>()
      for (const a of Object.values(state.ascs)) byBlock.set(a.blockId, [...(byBlock.get(a.blockId) ?? []), a])
      for (const [blockId, list] of byBlock) {
        if (list.length < 2) continue
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
    description:
      'Stowage order: a box on board never lies above an empty cell. Every filled load slot above the bottom tier of its ' +
      'section (hold floor or hatch cover) has a box directly below it, so lower tiers are loaded before upper tiers.',
    check(state) {
      const messages: string[] = []
      const filled = new Map<string, ('aft' | 'fore' | null)[]>()
      const loads = []
      for (const s of Object.values(state.vesselSlots)) {
        if (!s.containerId) continue
        const key = `${s.vesselId}:${s.bay}:${s.row}:${s.tier}`
        filled.set(key, [...(filled.get(key) ?? []), s.half])
        if (s.purpose === 'load') loads.push(s)
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
    id: 'berth.no-overlap',
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

/**
 * Export pre-fill (TT-10): where the export boxes booked to the vessels
 * stand in the yard when the scenario starts. Pure and deterministic; the
 * engine builds its initial state from it and the browser scene model calls
 * it too (same config + seed = same yard).
 *
 * Rules [A] (full strategy-driven pre-fill comes in TT-14):
 * - Boxes are placed in reverse load sequence, always on the lowest legal
 *   tier (low tiers first, then the bay farthest from the WTP pads, then row), in the first
 *   block with room, so import stacking near the pads does not bury them.
 *   So tier 1 fills before anything is stacked, and where boxes are stacked the
 *   one loaded first is on top: no rehandle is needed in load order.
 */
import { blockSpecs, boxSpan, candidateSlots, parseYardSlotId, type YardStacks } from '../engine/yardLayout'
import type { CargoPlan } from './bayPlan'
import type { ContainerSize, ScenarioConfig } from './types'

export interface ExportPlacement {
  containerId: string
  vesselId: string
  size: ContainerSize
  blockId: string
  /** Anchor cell `<block>:<bay>-<row>-<tier>`. */
  slotId: string
  bay: number
  row: number
  tier: number
  span: 1 | 2
}

/** Load sequence key of a booked slot: bay, hold before deck, tier, row, aft before fore. */
export function loadSequenceKey(slot: {
  bay: number
  deck: boolean
  tier: number
  row: number
  half: 'aft' | 'fore' | null
  emptyReq?: { index: number }
}): number[] {
  // empties (TT-11) follow the other boxes of their bay section: they are stowed last, so they never lie below them
  return [slot.bay, Number(slot.deck), slot.emptyReq ? 1 + slot.emptyReq.index : 0, slot.tier, slot.row, slot.half === 'fore' ? 1 : 0]
}

export function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function planExportYard(config: ScenarioConfig, plan: CargoPlan): ExportPlacement[] {
  const slots = new Map(plan.slots.map((s) => [s.id, s]))
  const vesselIndex = new Map(config.vessels.map((v, i) => [v.id, i]))
  const boxes = plan.containers
    .filter((c) => c.flow === 'load')
    .map((c) => {
      const slot = slots.get(c.slotId)
      if (!slot) throw new Error(`Export box ${c.id} has no load slot`)
      return { c, key: [vesselIndex.get(c.vesselId) ?? 0, ...loadSequenceKey(slot)] }
    })
    .sort((a, b) => compareKeys(b.key, a.key)) // reverse load sequence
  // the empty pool follows the export boxes (oldest first), so it never buries them
  const pool = plan.containers.filter((c) => c.flow === 'pool').sort((a, b) => (b.ageS ?? 0) - (a.ageS ?? 0) || (a.id < b.id ? -1 : 1))
  if (boxes.length + pool.length === 0) return []
  const blocks = blockSpecs(config).map((b) => ({
    spec: b,
    heights: new Array<number>(b.bays * b.rows).fill(0),
    tops: new Array<string | null>(b.bays * b.rows).fill(null),
  }))
  const out: ExportPlacement[] = []
  for (const { c } of [...boxes, ...pool.map((c) => ({ c }))]) {
    let placed = false
    for (const blk of blocks) {
      const stacks: YardStacks = {
        blockId: blk.spec.id,
        bays: blk.spec.bays,
        rows: blk.spec.rows,
        tiers: blk.spec.tiers,
        size: c.size,
        blockX: blk.spec.x,
        firstBayZ: blk.spec.firstBayZ,
        wtpX: blk.spec.x,
        wtpZ: blk.spec.wtpZ,
        heights: blk.heights,
        topVessels: blk.tops,
      }
      const best = candidateSlots(stacks).sort((a, b) => a.tier - b.tier || b.bay - a.bay || a.row - b.row)[0]
      if (!best) continue
      const cell = parseYardSlotId(best.slotId)
      for (let k = 0; k < boxSpan(c.size); k++) {
        const i = (cell.bay + k - 1) * blk.spec.rows + (cell.row - 1)
        blk.heights[i] = cell.tier
        blk.tops[i] = c.vesselId
      }
      out.push({
        containerId: c.id,
        vesselId: c.vesselId,
        size: c.size,
        blockId: blk.spec.id,
        slotId: best.slotId,
        bay: cell.bay,
        row: cell.row,
        tier: cell.tier,
        span: boxSpan(c.size),
      })
      placed = true
      break
    }
    if (!placed) throw new Error(`The yard has no room for export box ${c.id} (add yard blocks, bays or tiers)`)
  }
  return out
}

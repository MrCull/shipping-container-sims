// Builds the single "move" Choice question for the current phase. Options are restricted to
// the same rule-legal slot IDs the UI already exposes (`legalSlotIds` on the snapshot); this
// module never computes or filters by predicted outcomes (raw-mode boundary, plan 02 §2 rule 2).
//
// See .ai/plans/stowage-master/02-jev-state-and-questions.md §2.4.

import type { ShipPreset, Slot } from '../../types'
import type { JevChoiceQuestion } from '../../types/jev'
import { getStackWeight, isOutermostRow, isTopThird, slotId } from '../shipGrid'
import { round1, type JevGameSnapshot } from './jevStateBuilder'
import { JEV_CONFIG } from './jevConfig'

/** Bump whenever the instruction wording changes (skill: version questions and criteria). */
export const JEV_QUESTION_VERSION = JEV_CONFIG.questionVersion

const LOAD_INSTRUCTIONS =
  'Choose the slot for the container in `move.container`. Use `rules`, `vessel`, `stability`, ' +
  '`bay_plan`, `port_rotation` and `upcoming_load_list`. The best slot keeps the ship well clear ' +
  'of capsize, founder, stack-collapse and hazmat-explosion conditions after this container is ' +
  'added, keeps list and trim near zero, avoids the scoring penalties in `rules.scoring_load`, ' +
  'does not block containers for earlier ports, and leaves good positions for the containers in ' +
  "`upcoming_load_list`. Each option is a legal slot described by its position; consider the " +
  "effect of adding `move.container`'s weight at that position."

const DISCHARGE_INSTRUCTIONS =
  'Choose which top-of-stack container to lift next. Prefer discharging imports in an order ' +
  'that keeps list and trim near zero and earns the bonuses in `rules.scoring_discharge`. Lift ' +
  'a transit container only when it blocks imports that must be discharged, since restowing ' +
  'costs points. Never let removal push list or trim past the disaster thresholds in ' +
  '`stability.thresholds`.'

const RESTOW_INSTRUCTIONS =
  'Choose where to re-stow the transit container in `move.container`, which was lifted from ' +
  '`move.lifted_from`. Keep it low (outside the top third) where possible, keep list and trim ' +
  'near zero, respect stack-weight and hazmat separation rules, and avoid positions that would ' +
  'block imports still to be discharged.'

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

function describeBayPosition(slot: Slot, preset: ShipPreset): string {
  const activeBays = preset.bays - preset.sternBlockedBays
  const half = slot.bayIndex < activeBays / 2 ? 'aft half' : 'forward half'
  return `Bay ${String(slot.bay).padStart(2, '0')} (${half}, x ${formatSigned(round1(slot.xOffset))} m)`
}

function describeRowPosition(slot: Slot, preset: ShipPreset): string {
  const outer = isOutermostRow(slot.rowIndex, preset.rows)
  const side = slot.zOffset < 0 ? 'port side' : slot.zOffset > 0 ? 'starboard side' : 'centreline'
  const position = outer ? 'outermost' : 'inner'
  return `row ${String(slot.row).padStart(2, '0')} (${position}, ${side}, z ${formatSigned(round1(slot.zOffset))} m)`
}

function describeTierPosition(slot: Slot, preset: ShipPreset): string {
  const level = slot.tierIndex + 1
  const topThird = isTopThird(slot.tierIndex, preset.tiers)
  return `tier ${String(slot.tier).padStart(2, '0')} = level ${level} of ${preset.tiers} (${topThird ? 'top third' : 'not top third'})`
}

function describeColumnSupport(grid: Record<string, Slot>, slot: Slot, preset: ShipPreset): string {
  const columnWeight = round1(getStackWeight(grid, preset, slot.bay, slot.row))
  if (slot.tierIndex === 0) {
    return `Deck level. Column weight now ${columnWeight} t of ${preset.maxStackWeight} t max.`
  }
  const belowId = slotId(slot.bay, slot.row, slot.tier - 2)
  const below = grid[belowId]
  if (!below?.container) {
    return `Empty column. Column weight now ${columnWeight} t of ${preset.maxStackWeight} t max.`
  }
  const c = below.container
  return `On top of: 1 container, ${c.port} (port order ${c.portOrder}), ${round1(c.weight)} t. Column weight now ${columnWeight} t of ${preset.maxStackWeight} t max.`
}

/** Builds a positional description used for both `load` and `restow` options. */
function buildPositionalOption(grid: Record<string, Slot>, slot: Slot, preset: ShipPreset): string {
  return `${describeBayPosition(slot, preset)}, ${describeRowPosition(slot, preset)}, ${describeTierPosition(slot, preset)}. ${describeColumnSupport(grid, slot, preset)}`
}

/** Counts how many imports sit below `slot` in the same bay/row column (contiguous stack). */
function countImportsBelowInStack(grid: Record<string, Slot>, slot: Slot): number {
  let count = 0
  for (let tierIndex = slot.tierIndex - 1; tierIndex >= 0; tierIndex--) {
    const tierNum = (tierIndex + 1) * 2
    const below = grid[slotId(slot.bay, slot.row, tierNum)]
    if (!below?.container) break
    if (below.container.isImport) count++
  }
  return count
}

function buildDischargeOption(grid: Record<string, Slot>, slot: Slot, preset: ShipPreset): string {
  const container = slot.container
  if (!container) return 'Empty slot.'

  const bay = describeBayPosition(slot, preset)
  const row = describeRowPosition(slot, preset)
  const tier = describeTierPosition(slot, preset)

  if (container.isImport) {
    return `IMPORT ${container.id} ${round1(container.weight)} t ${container.weightCategory}, top of stack at ${tier}, ${row}, ${bay}. Removing it discharges an import.`
  }

  const importsBelow = countImportsBelowInStack(grid, slot)
  const plural = importsBelow === 1 ? '' : 's'
  if (importsBelow > 0) {
    return `TRANSIT ${container.id} ${round1(container.weight)} t to ${container.port} (port order ${container.portOrder}), top of stack at ${tier}, above ${importsBelow} import${plural} in this column. Lifting it starts a restow (-15 base) to reach the import${plural} below.`
  }
  return `TRANSIT ${container.id} ${round1(container.weight)} t to ${container.port} (port order ${container.portOrder}), top of stack at ${tier}, above 0 imports. Lifting it wastes a move and costs points.`
}

/**
 * Builds the one `move` Choice question for the snapshot's phase. Options (criteria) are keyed
 * by slot ID exactly as they appear in `snapshot.legalSlotIds`, sorted, with no "other/none"
 * option — the game always requires a move and every option offered is legal.
 */
export function buildMoveQuestion(snapshot: JevGameSnapshot): Record<string, JevChoiceQuestion> {
  const sortedSlotIds = [...snapshot.legalSlotIds].sort()
  const criteria: Record<string, string> = {}

  for (const id of sortedSlotIds) {
    const slot = snapshot.grid[id]
    if (!slot) continue
    criteria[id] =
      snapshot.kind === 'discharge'
        ? buildDischargeOption(snapshot.grid, slot, snapshot.preset)
        : buildPositionalOption(snapshot.grid, slot, snapshot.preset)
  }

  const instructions =
    snapshot.kind === 'load' ? LOAD_INSTRUCTIONS : snapshot.kind === 'discharge' ? DISCHARGE_INSTRUCTIONS : RESTOW_INSTRUCTIONS

  return {
    move: {
      type: 'choice',
      instructions,
      criteria,
    },
  }
}

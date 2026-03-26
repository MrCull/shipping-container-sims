import type { Container, Slot, ShipPreset, PlacementResult, StarRatingResult } from '../types'
import { SCORING, PHYSICS } from './config'
import { isOutermostRow, isTopThird } from './shipGrid'

export function calculatePlacementScore(
  container: Container,
  slot: Slot,
  grid: Record<string, Slot>,
  shipConfig: ShipPreset,
  list: number,
  trim: number
): PlacementResult {
  let score = 100
  const reasons: PlacementResult['reasons'] = []

  if (container.weight > SCORING.heavyHighWeightThreshold && isTopThird(slot.tierIndex, shipConfig.tiers)) {
    score += SCORING.heavyHighDeduction
    reasons.push({ text: 'Heavy container placed too high', points: SCORING.heavyHighDeduction })
  }

  if (container.weight > SCORING.outboardWeightThreshold && isOutermostRow(slot.rowIndex, shipConfig.rows)) {
    score += SCORING.outboardDeduction
    reasons.push({ text: 'Heavy container at outboard position', points: SCORING.outboardDeduction })
  }

  if (Math.abs(list) >= PHYSICS.listWarning || Math.abs(trim) >= PHYSICS.trimWarning) {
    score += SCORING.imbalanceDeduction
    reasons.push({ text: 'Ship already in warning zone', points: SCORING.imbalanceDeduction })
  }

  if (container.isHazmat) {
    for (const other of Object.values(grid)) {
      if (other.container && other.container.isHazmat && other.id !== slot.id) {
        const bayDiff = Math.abs(other.bay - slot.bay) / 2
        const rowDiff = Math.abs(other.row - slot.row)
        const tierDiff = Math.abs(other.tier - slot.tier) / 2
        if (bayDiff < 2 && rowDiff < 1.5 && tierDiff < 2) {
          score += SCORING.hazmatDeduction
          reasons.push({ text: 'Hazmat too close to another hazmat', points: SCORING.hazmatDeduction })
          break
        }
      }
    }
  }

  const podPenalty = checkPodOrder(container, slot, grid)
  if (podPenalty < 0) {
    score += podPenalty
    reasons.push({ text: 'Poor discharge order', points: podPenalty })
  }

  if (container.weight > 20 && slot.tierIndex < Math.floor(shipConfig.tiers / 3)) {
    reasons.push({ text: 'Heavy container low - great stability!', points: 0, good: true })
  }
  if (container.weight > 20 && slot.rowIndex === Math.floor(shipConfig.rows / 2)) {
    reasons.push({ text: 'Heavy on centreline - perfect balance!', points: 0, good: true })
  }
  if (container.isHazmat && !reasons.some(r => r.text.includes('Hazmat'))) {
    reasons.push({ text: 'Hazmat safely separated', points: 0, good: true })
  }

  score = Math.max(0, score)
  return { score, reasons }
}

function checkPodOrder(container: Container, slot: Slot, grid: Record<string, Slot>): number {
  let penalty = 0
  for (const other of Object.values(grid)) {
    if (!other.container) continue
    if (other.bay !== slot.bay || other.row !== slot.row) continue
    if (other.tierIndex <= slot.tierIndex) continue
    if (other.container.portOrder < container.portOrder) {
      penalty += SCORING.podWrongOrderDeduction
    }
  }
  return penalty
}

export function getStarRating(score: number, targetScore: number): StarRatingResult {
  const percent = score / targetScore
  if (percent >= 0.95) return { stars: 5, title: 'Perfect Planner' }
  if (percent >= 0.80) return { stars: 4, title: 'Harbor Master' }
  if (percent >= 0.60) return { stars: 3, title: 'Solid Stevedore' }
  if (percent >= 0.40) return { stars: 2, title: 'Deck Hand' }
  if (percent >= 0.20) return { stars: 1, title: 'Landlubber' }
  return { stars: 0, title: 'Absolute Maritime Disaster' }
}

export function checkPerfectBalance(list: number, trim: number): number {
  if (
    Math.abs(list) < SCORING.perfectBalanceThreshold &&
    Math.abs(trim) < SCORING.perfectBalanceThreshold
  ) {
    return SCORING.perfectBalanceBonus
  }
  return 0
}

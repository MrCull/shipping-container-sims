import type { ScoringResult } from '../types'
import { SCORING } from './config'

export function computeMoveScore(params: {
  moveDurationSec: number
  jitterIntegral: number
  comboStreak: number
  layerCountAfterPlace: number
  startLayerCount: number
}): ScoringResult {
  const { moveDurationSec, jitterIntegral, comboStreak, layerCountAfterPlace, startLayerCount } =
    params

  const speedT = Math.min(1, Math.max(0, 1 - moveDurationSec / SCORING.fastMoveSeconds))
  const speedMultiplier = SCORING.speedMinMult + speedT * (SCORING.speedMaxMult - SCORING.speedMinMult)

  const jitterNorm = jitterIntegral / Math.max(SCORING.jitterRefForSteadiness, 1)
  const steadinessT = Math.min(1, Math.max(0, 1 - jitterNorm))
  const steadinessMultiplier =
    SCORING.steadinessMinMult +
    steadinessT * (SCORING.steadinessMaxMult - SCORING.steadinessMinMult)

  const tier = Math.min(comboStreak, SCORING.comboTiers.length - 1)
  const comboMultiplier = SCORING.comboTiers[tier]!

  const heightExtra = Math.max(0, layerCountAfterPlace - startLayerCount)
  const heightBonus = heightExtra * SCORING.heightBonusPerLayer

  const basePoints = SCORING.basePerMove
  const mult = speedMultiplier * steadinessMultiplier * comboMultiplier
  const points = Math.round(basePoints * mult + heightBonus)

  return {
    points,
    basePoints,
    speedMultiplier,
    steadinessMultiplier,
    comboMultiplier,
    heightBonus,
    streakAfter: comboStreak,
  }
}

export function nextComboStreak(current: number, wobbleSpike: boolean): number {
  if (wobbleSpike) {
    return Math.max(0, current - 1)
  }
  return current + 1
}

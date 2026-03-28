import type { LevelConfig } from '../types'
import { SHIP_PRESETS, SCORING, CONTAINER } from './config'

export const LEVELS: LevelConfig[] = [
  {
    id: 0,
    name: 'Level 1 - Feeder Vessel',
    description: 'A small feeder ship. Learn the basics of container loading.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 20,
    timerSeconds: 90,   // 90 s — tutorial level
  },
  {
    id: 1,
    name: 'Level 2 - Feeder Vessel',
    description: 'Same feeder vessel. First unload 10 Import containers, then load the vessel.',
    preset: SHIP_PRESETS.small,
    hazmatRate: CONTAINER.hazmatRate,
    containerCount: 20,
    dischargeContainerCount: 10,
    timerSeconds: 210,  // 3.5 min (extra time for discharge + load)
  },
  {
    id: 2,
    name: 'Level 3 - Mega Carrier',
    description: 'A massive container ship. Master the art of loading.',
    preset: SHIP_PRESETS.large,
    hazmatRate: CONTAINER.hazmatRate * 1.5,
    timerSeconds: 180,  // 3 min
  },
]

export function getLevelConfig(levelId: number): LevelConfig {
  return LEVELS[levelId] ?? LEVELS[0]
}

export function getTotalSlots(preset: LevelConfig['preset']): number {
  return preset.bays * preset.rows * preset.tiers
}

export function getTargetScore(preset: LevelConfig['preset'], containerCount?: number): number {
  const count = containerCount ?? getTotalSlots(preset)
  return count * 100 * SCORING.targetScoreMultiplier
}

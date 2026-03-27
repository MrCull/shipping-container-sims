/** Moves required to complete a level and advance. */
export const MOVES_PER_LEVEL = 5

const LEVEL_TIME_BASE_SEC = 110
const LEVEL_TIME_DEC_PER_LEVEL = 10
const LEVEL_TIME_MIN_SEC = 42

const MOVE_TIME_BASE_SEC = 38
const MOVE_TIME_DEC_PER_LEVEL = 2.5
const MOVE_TIME_MIN_SEC = 14

export function getLevelTimeLimitSec(level: number): number {
  const t = LEVEL_TIME_BASE_SEC - (level - 1) * LEVEL_TIME_DEC_PER_LEVEL
  return Math.max(LEVEL_TIME_MIN_SEC, t)
}

export function getMoveTimeLimitSec(level: number): number {
  const t = MOVE_TIME_BASE_SEC - (level - 1) * MOVE_TIME_DEC_PER_LEVEL
  return Math.max(MOVE_TIME_MIN_SEC, t)
}

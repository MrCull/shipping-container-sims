/** Moves required to complete a level and advance. Level 1 = 1, level 2 = 2, etc. */
export function getMovesRequiredForLevel(level: number): number {
  return Math.max(1, Math.floor(level))
}

// Phase 1 (levels 1-3): drops steeply to hit targets at level 3.
// Phase 2 (levels 4+): keeps dropping more gradually to a hard floor.

const TIME_EASE_FACTOR = 1.25

// Base curve: level 1=50s, level 3=30s, then -5s/level down to 15s floor.
const LEVEL_TIME_PHASE1_BASE = 50
const LEVEL_TIME_PHASE1_DEC = 10 // per level during levels 1-3
const LEVEL_TIME_PHASE1_TARGET = 30 // value at level 3
const LEVEL_TIME_PHASE2_DEC = 5 // per level after level 3
const LEVEL_TIME_MIN_SEC = 15

// Base curve: level 1=25s, level 3=5s, then -1s/level down to 2s floor.
const MOVE_TIME_PHASE1_BASE = 25
const MOVE_TIME_PHASE1_DEC = 10 // per level during levels 1-3
const MOVE_TIME_PHASE1_TARGET = 5 // value at level 3
const MOVE_TIME_PHASE2_DEC = 1 // per level after level 3
const MOVE_TIME_MIN_SEC = 2

function addTimerEase(seconds: number): number {
  return Math.ceil(seconds * TIME_EASE_FACTOR)
}

export function getLevelTimeLimitSec(level: number): number {
  let baseLimit: number
  if (level <= 3) {
    baseLimit = LEVEL_TIME_PHASE1_BASE - (level - 1) * LEVEL_TIME_PHASE1_DEC
  } else {
    const t = LEVEL_TIME_PHASE1_TARGET - (level - 3) * LEVEL_TIME_PHASE2_DEC
    baseLimit = Math.max(LEVEL_TIME_MIN_SEC, t)
  }
  return addTimerEase(baseLimit)
}

export function getMoveTimeLimitSec(level: number): number {
  let baseLimit: number
  if (level <= 3) {
    baseLimit = MOVE_TIME_PHASE1_BASE - (level - 1) * MOVE_TIME_PHASE1_DEC
  } else {
    const t = MOVE_TIME_PHASE1_TARGET - (level - 3) * MOVE_TIME_PHASE2_DEC
    baseLimit = Math.max(MOVE_TIME_MIN_SEC, t)
  }
  return addTimerEase(baseLimit)
}

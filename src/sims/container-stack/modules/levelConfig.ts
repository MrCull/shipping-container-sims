/** Moves required to complete a level and advance. */
export const MOVES_PER_LEVEL = 5

// Phase 1 (levels 1-3): drops steeply to hit targets at level 3.
// Phase 2 (levels 4+): keeps dropping more gradually to a hard floor.

// Level 1=50s, level 3=30s, then -5s/level down to 15s floor.
const LEVEL_TIME_PHASE1_BASE = 50
const LEVEL_TIME_PHASE1_DEC = 10   // per level during levels 1-3
const LEVEL_TIME_PHASE1_TARGET = 30 // value at level 3
const LEVEL_TIME_PHASE2_DEC = 5    // per level after level 3
const LEVEL_TIME_MIN_SEC = 15

// Level 1=25s, level 3=5s, then -1s/level down to 2s floor.
const MOVE_TIME_PHASE1_BASE = 25
const MOVE_TIME_PHASE1_DEC = 10   // per level during levels 1-3
const MOVE_TIME_PHASE1_TARGET = 5  // value at level 3
const MOVE_TIME_PHASE2_DEC = 1    // per level after level 3
const MOVE_TIME_MIN_SEC = 2

export function getLevelTimeLimitSec(level: number): number {
  if (level <= 3) {
    return LEVEL_TIME_PHASE1_BASE - (level - 1) * LEVEL_TIME_PHASE1_DEC
  }
  const t = LEVEL_TIME_PHASE1_TARGET - (level - 3) * LEVEL_TIME_PHASE2_DEC
  return Math.max(LEVEL_TIME_MIN_SEC, t)
}

export function getMoveTimeLimitSec(level: number): number {
  if (level <= 3) {
    return MOVE_TIME_PHASE1_BASE - (level - 1) * MOVE_TIME_PHASE1_DEC
  }
  const t = MOVE_TIME_PHASE1_TARGET - (level - 3) * MOVE_TIME_PHASE2_DEC
  return Math.max(MOVE_TIME_MIN_SEC, t)
}

import type { LevelDef } from '../types/engine'

/** The tutorial (V20 level 1). #382 ports the other twelve levels. */
export const TUTORIAL: LevelDef = {
  number: 1,
  name: 'First shift',
  stacks: [[1], [2, 4], [3], []],
  capacity: 2,
  count: 4,
  maxRehandles: 5,
}

export const LEVELS: readonly LevelDef[] = [TUTORIAL]

export function levelByNumber(n: number): LevelDef | undefined {
  return LEVELS.find((l) => l.number === n)
}

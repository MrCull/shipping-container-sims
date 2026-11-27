import type { LevelDef } from '../types/engine'

/** Next-truck allowances for a level that is not the tutorial: first x 1, 0.5 and 0.28 (V20). */
export function truckSecondsFrom(first: number): [number, number, number] {
  return [first, first * 0.5, first * 0.28]
}

/** The tutorial (V20 level 1). #382 ports the other twelve levels. */
export const TUTORIAL: LevelDef = {
  number: 1,
  name: 'First shift',
  stacks: [[1], [2, 4], [3], []],
  capacity: 2,
  count: 4,
  maxRehandles: 5,
  shiftSeconds: 150,
  truckSeconds: [30, 20, 15],
  overtimeMultiplier: 2,
}

export const LEVELS: readonly LevelDef[] = [TUTORIAL]

export function levelByNumber(n: number): LevelDef | undefined {
  return LEVELS.find((l) => l.number === n)
}

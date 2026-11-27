import { describe, expect, it } from 'vitest'
import { LEVELS, levelByNumber } from './levels'
import levelsSource from './levels.ts?raw'

/**
 * V20 `L` array (yardshift-v20.html, levels as `[name, stacks, count, capacity, min, max, shiftSec, firstTruckSec,
 * arrivals[[after, id, moves]], heavyIds]`), typed in by hand. `min` is V20's hand-entered target, not level data.
 */
// prettier-ignore
const V20 = [
  ['First shift', [[1], [2, 4], [3], []], 4, 2, 1, 5, 150, 30, [], []],
  ['Think ahead', [[2, 5], [1, 6], [3, 4], []], 6, 3, 3, 7, 40, 12, [], []],
  ['Rush hour', [[1, 5, 8], [3, 6], [2, 7, 9], [4], []], 9, 3, 5, 9, 48, 11, [], []],
  ['First arrivals', [[1, 5], [3, 7], [2, 6], [4], []], 9, 3, 3, 7, 55, 10, [[0, 8, 3], [2, 9, 2]], []],
  ['Stack attack', [[5, 7, 2], [8, 6, 4], [1, 9, 10], [3], []], 10, 3, 3, 8, 48, 10, [], []],
  ['Double booking', [[1, 6, 10], [3, 8], [2, 7, 9], [4, 5], []], 12, 3, 6, 11, 56, 10, [[1, 11, 3], [4, 12, 2]], []],
  ['Tall stacks', [[1, 8, 11, 6], [3, 10, 12], [2, 7, 9], [4, 5], []], 12, 4, 9, 14, 55, 9, [], []],
  ['Tight turnaround', [[1, 6, 10], [3, 8, 11], [2, 7, 12], [9, 5, 4], []], 14, 4, 6, 11, 60, 9, [[0, 13, 3], [3, 14, 2]], []],
  ['Busy gate', [[4, 9, 11], [1, 6, 10], [2, 7], [3, 5, 8], []], 14, 3, 7, 12, 62, 9, [[0, 12, 3], [2, 13, 2], [5, 14, 2]], []],
  ['Peak shift', [[1, 7, 13], [2, 8, 12], [3, 9, 11], [4, 10, 14], [5, 6]], 16, 4, 11, 16, 65, 8, [[1, 15, 3], [4, 16, 2]], []],
  ['Heavy lifting', [[1, 4], [5, 2], [3], [6], []], 6, 3, 1, 7, 65, 18, [], [1, 4, 6]],
  ['Heavy traffic', [[5, 7, 2], [8, 6, 4], [1, 9, 10], [3], []], 10, 3, 4, 10, 45, 9, [], [5, 7, 8, 1, 9, 3]],
  ['Gridlock', [[1, 6, 10], [3, 8, 11], [2, 7, 12], [9, 5, 4], []], 14, 4, 7, 13, 65, 8, [[0, 13, 3], [3, 14, 2]], [1, 6, 3, 8, 2, 7, 9, 5, 13, 14]],
] as const

describe('Yardshift levels', () => {
  it('ports all 13 V20 levels exactly', () => {
    expect(LEVELS).toHaveLength(13)
    V20.forEach(([name, stacks, count, capacity, , max, shift, first, arrivals, heavy], i) => {
      const l = levelByNumber(i + 1)!
      expect(l).toMatchObject({ number: i + 1, name, stacks, count, capacity, maxRehandles: max, shiftSeconds: shift, heavy })
      expect(l.truckSeconds[0]).toBe(first)
      expect(l.arrivals).toEqual(arrivals.map(([after, id, moves]) => ({ after, id, moves })))
    })
  })

  it('every container 1..count appears once, in the yard or on an incoming truck', () => {
    for (const l of LEVELS) {
      const ids = [...l.stacks.flat(), ...l.arrivals.map((a) => a.id)].sort((a, b) => a - b)
      expect(ids).toEqual(Array.from({ length: l.count }, (_, i) => i + 1))
      for (const s of l.stacks) expect(s.length).toBeLessThanOrEqual(l.capacity)
    }
  })

  it('keeps the V20 code rules as explicit data', () => {
    expect(LEVELS[0]!.truckSeconds).toEqual([30, 20, 15])
    expect(LEVELS[1]!.truckSeconds).toEqual([12, 6, 12 * 0.28])
    expect(LEVELS.map((l) => l.overtimeMultiplier)).toEqual([2, ...Array(12).fill(3)])
    expect(LEVELS.map((l) => l.bonusWindowSeconds)).toEqual([0, 1.6, 1.3, 1.3, ...Array(9).fill(1.1)])
    expect(LEVELS[0]!.bonusIds).toEqual([])
    expect(LEVELS[9]!.bonusIds).toEqual([3, 6, 9, 12, 15])
    expect(LEVELS.filter((l) => l.heavyHints).map((l) => l.number)).toEqual([11, 12])
    expect(LEVELS.filter((l) => l.tutorialCoaching).map((l) => l.number)).toEqual([1])
  })

  it('chooses no level value from the level number (each row states it)', () => {
    expect(levelsSource).not.toMatch(/\bn\s*(===|<=|>=|<|>)\s*\d/)
    expect(levelsSource).not.toMatch(/TIPS\[/)
  })
})

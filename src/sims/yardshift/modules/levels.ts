/**
 * The 13 V20 levels, ported exactly (stacks bottom to top). V20 kept bonus cadence, bonus window, overtime, truck
 * timings and coaching as code rules keyed on the level index; here they are explicit fields on each row, and no
 * value is chosen from the level number. The three-star target is
 * not level data: it comes from the solver fixture (`fixtures/`, `modules/stars.ts`).
 */
import type { Arrival, LevelDef } from '../types/engine'

interface V20Row {
  name: string
  stacks: number[][]
  count: number
  capacity: number
  maxRehandles: number
  shiftSeconds: number
  /** Next-truck allowances: first, second, then every later operation (`truck(first)`, or the tutorial's 30/20/15). */
  truckSeconds: readonly [number, number, number]
  /** Bonus cadence: every multiple of this id is a bonus container (0 for none). */
  bonusEvery: number
  /** Explicit bonus ids, in place of the cadence (the tutorial's one bonus, owner round 4). */
  bonusIds?: number[]
  bonusWindowSeconds: number
  overtimeMultiplier: number
  tutorialCoaching?: boolean
  heavyHints?: boolean
  tip?: string
  arrivals?: Arrival[]
  heavy?: number[]
}

const DEFAULT_TIP = 'Clear the yard before time runs out.'

/** Next-truck allowances for a level that is not the tutorial: first x 1, 0.5 and 0.28 (V20). */
export function truckSecondsFrom(first: number): [number, number, number] {
  return [first, first * 0.5, first * 0.28]
}
const truck = truckSecondsFrom

function bonusIds(every: number, count: number): number[] {
  const ids: number[] = []
  if (every > 0) for (let id = every; id <= count; id += every) ids.push(id)
  return ids
}

function level(n: number, row: V20Row): LevelDef {
  return {
    number: n,
    name: row.name,
    stacks: row.stacks,
    capacity: row.capacity,
    count: row.count,
    maxRehandles: row.maxRehandles,
    shiftSeconds: row.shiftSeconds,
    truckSeconds: row.truckSeconds,
    arrivals: row.arrivals ?? [],
    heavy: row.heavy ?? [],
    bonusIds: row.bonusIds ?? bonusIds(row.bonusEvery, row.count),
    bonusWindowSeconds: row.bonusWindowSeconds,
    overtimeMultiplier: row.overtimeMultiplier,
    tutorialCoaching: row.tutorialCoaching ?? false,
    heavyHints: row.heavyHints ?? false,
    tip: row.tip ?? DEFAULT_TIP,
  }
}

// prettier-ignore
const ROWS: V20Row[] = [
  { name: 'First shift', stacks: [[1], [2, 4], [3], []], count: 4, capacity: 2, maxRehandles: 5, shiftSeconds: 150,
    // Owner round 4, deviating from V20 (no tutorial bonus): one bonus, the last container, with a generous window.
    truckSeconds: [30, 20, 15], bonusEvery: 0, bonusIds: [4], bonusWindowSeconds: 2.0, overtimeMultiplier: 2,
    tutorialCoaching: true,
    tip: 'Tap #1 to load it. Move #4 aside to uncover #2.' },
  { name: 'Think ahead', stacks: [[2, 5], [1, 6], [3, 4], []], count: 6, capacity: 3, maxRehandles: 7, shiftSeconds: 40,
    truckSeconds: truck(12), bonusEvery: 3, bonusWindowSeconds: 1.6, overtimeMultiplier: 3,
    tip: 'Star cargo: quick collection = +250 pts / +5s.' },
  { name: 'Rush hour', stacks: [[1, 5, 8], [3, 6], [2, 7, 9], [4], []], count: 9, capacity: 3, maxRehandles: 9, shiftSeconds: 48,
    truckSeconds: truck(11), bonusEvery: 3, bonusWindowSeconds: 1.3, overtimeMultiplier: 3 },
  { name: 'First arrivals', stacks: [[1, 5], [3, 7], [2, 6], [4], []], count: 9, capacity: 3, maxRehandles: 7, shiftSeconds: 55,
    truckSeconds: truck(10), bonusEvery: 3, bonusWindowSeconds: 1.3, overtimeMultiplier: 3,
    tip: 'Receive incoming trucks before their move deadline.',
    arrivals: [{ after: 0, id: 8, moves: 3 }, { after: 2, id: 9, moves: 2 }] },
  { name: 'Stack attack', stacks: [[5, 7, 2], [8, 6, 4], [1, 9, 10], [3], []], count: 10, capacity: 3, maxRehandles: 8, shiftSeconds: 48,
    truckSeconds: truck(10), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3 },
  { name: 'Double booking', stacks: [[1, 6, 10], [3, 8], [2, 7, 9], [4, 5], []], count: 12, capacity: 3, maxRehandles: 11, shiftSeconds: 56,
    truckSeconds: truck(10), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3,
    arrivals: [{ after: 1, id: 11, moves: 3 }, { after: 4, id: 12, moves: 2 }] },
  { name: 'Tall stacks', stacks: [[1, 8, 11, 6], [3, 10, 12], [2, 7, 9], [4, 5], []], count: 12, capacity: 4, maxRehandles: 14, shiftSeconds: 55,
    truckSeconds: truck(9), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3 },
  { name: 'Tight turnaround', stacks: [[1, 6, 10], [3, 8, 11], [2, 7, 12], [9, 5, 4], []], count: 14, capacity: 4, maxRehandles: 11, shiftSeconds: 60,
    truckSeconds: truck(9), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3,
    arrivals: [{ after: 0, id: 13, moves: 3 }, { after: 3, id: 14, moves: 2 }] },
  { name: 'Busy gate', stacks: [[4, 9, 11], [1, 6, 10], [2, 7], [3, 5, 8], []], count: 14, capacity: 3, maxRehandles: 12, shiftSeconds: 62,
    truckSeconds: truck(9), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3,
    arrivals: [{ after: 0, id: 12, moves: 3 }, { after: 2, id: 13, moves: 2 }, { after: 5, id: 14, moves: 2 }] },
  { name: 'Peak shift', stacks: [[1, 7, 13], [2, 8, 12], [3, 9, 11], [4, 10, 14], [5, 6]], count: 16, capacity: 4, maxRehandles: 16, shiftSeconds: 65,
    truckSeconds: truck(8), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3,
    arrivals: [{ after: 1, id: 15, moves: 3 }, { after: 4, id: 16, moves: 2 }] },
  { name: 'Heavy lifting', stacks: [[1, 4], [5, 2], [3], [6], []], count: 6, capacity: 3, maxRehandles: 7, shiftSeconds: 65,
    truckSeconds: truck(18), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3, heavyHints: true,
    tip: 'H = heavy. Follow the live hints.',
    heavy: [1, 4, 6] },
  { name: 'Heavy traffic', stacks: [[5, 7, 2], [8, 6, 4], [1, 9, 10], [3], []], count: 10, capacity: 3, maxRehandles: 10, shiftSeconds: 45,
    truckSeconds: truck(9), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3, heavyHints: true,
    heavy: [5, 7, 8, 1, 9, 3] },
  { name: 'Gridlock', stacks: [[1, 6, 10], [3, 8, 11], [2, 7, 12], [9, 5, 4], []], count: 14, capacity: 4, maxRehandles: 13, shiftSeconds: 65,
    truckSeconds: truck(8), bonusEvery: 3, bonusWindowSeconds: 1.1, overtimeMultiplier: 3,
    arrivals: [{ after: 0, id: 13, moves: 3 }, { after: 3, id: 14, moves: 2 }], heavy: [1, 6, 3, 8, 2, 7, 9, 5, 13, 14] },
]

export const LEVELS: readonly LevelDef[] = ROWS.map((row, i) => level(i + 1, row))

/** The tutorial (level 1). */
export const TUTORIAL: LevelDef = LEVELS[0]!

export function levelByNumber(n: number): LevelDef | undefined {
  return LEVELS.find((l) => l.number === n)
}

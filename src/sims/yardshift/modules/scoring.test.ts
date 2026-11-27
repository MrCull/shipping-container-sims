/**
 * Yardshift score, combo, time rewards and bonus windows (#385). Tests go through `createShift`, `dispatch` and
 * `tick` only.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { levelByNumber, TUTORIAL, truckSecondsFrom } from './levels'
import { starsFor } from './stars'
import type { LevelDef, Shift, ShiftEvent } from '../types/engine'

/** Six containers exposed in order on their own stacks, plus room to rehandle; no bonus. */
const open: LevelDef = {
  ...TUTORIAL,
  number: 97,
  name: 'Open',
  stacks: [[1], [2], [3], [4], [5], [6], [7], []],
  capacity: 3,
  count: 7,
  maxRehandles: 5,
  shiftSeconds: 60,
  truckSeconds: truckSecondsFrom(10),
  overtimeMultiplier: 3,
  bonusIds: [],
  bonusWindowSeconds: 0,
}

/** #3 is a bonus with a 1.1 s window. */
const bonus: LevelDef = {
  ...open,
  number: 96,
  name: 'Bonus',
  stacks: [[1], [2], [3], [4], []],
  count: 4,
  bonusIds: [3],
  bonusWindowSeconds: 1.1,
  arrivals: [],
}

function run(shift: Shift, ms: number): void {
  for (let t = 0; t < ms; t += MAX_STEP_MS) shift.tick(Math.min(MAX_STEP_MS, ms - t))
}

function collecting(shift: Shift): ShiftEvent[] {
  const seen: ShiftEvent[] = []
  shift.onEvent((e) => seen.push(e))
  return seen
}

describe('Yardshift score and combo', () => {
  it('starts at zero score, combo and golds', () => {
    expect(createShift(open).state).toMatchObject({ score: 0, combo: 0, bestCombo: 0, golds: 0 })
  })

  it('collections score 100 + 50 x (min(combo, 5) - 1): 100, 150, 200, 250, 300, then 300', () => {
    const shift = createShift(open)
    const scores: number[] = []
    for (let i = 0; i < 7; i++) {
      const before = shift.state.score
      shift.dispatch({ type: 'collect' })
      scores.push(shift.state.score - before)
    }
    expect(scores).toEqual([100, 150, 200, 250, 300, 300, 300])
    expect(shift.state.combo).toBe(7)
    expect(shift.state.bestCombo).toBe(7)
  })

  it('a rehandle costs 25 + 5 x stack distance and breaks the combo', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    expect(shift.state).toMatchObject({ score: 250, combo: 2 })
    shift.dispatch({ type: 'rehandle', from: 6, to: 7 })
    expect(shift.state).toMatchObject({ score: 250 - 30, combo: 0, bestCombo: 2 })
    shift.dispatch({ type: 'rehandle', from: 7, to: 3 })
    expect(shift.state.score).toBe(250 - 30 - 45)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.score).toBe(250 - 75 + 100)
  })

  it('score can go negative', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'rehandle', from: 0, to: 7 })
    expect(shift.state.score).toBe(-60)
  })

  it('a receipt scores +100 and breaks the combo', () => {
    const level: LevelDef = { ...open, arrivals: [{ after: 1, id: 8, moves: 3 }], count: 8 }
    const shift = createShift(level)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    expect(shift.state.combo).toBe(2)
    shift.dispatch({ type: 'receive', to: 7 })
    expect(shift.state).toMatchObject({ score: 350, combo: 0, bestCombo: 2 })
  })

  it('a rejected move changes no score or combo', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'collect' })
    const r = shift.dispatch({ type: 'collect', from: 3 })
    expect(r.ok).toBe(false)
    expect(shift.state).toMatchObject({ score: 100, combo: 1 })
  })
})

describe('Yardshift time rewards', () => {
  it('a quick collection adds 0.35 s; chained collections add min(2, combo x 0.4) s', () => {
    const shift = createShift(open)
    const gains: number[] = []
    for (let i = 0; i < 6; i++) {
      const before = shift.state.shiftMs
      shift.dispatch({ type: 'collect' })
      gains.push(shift.state.shiftMs - before)
    }
    expect(gains).toEqual([350, 350 + 800, 350 + 1200, 350 + 1600, 350 + 2000, 350 + 2000])
  })

  it('a collection in overtime gets no quick-service time, only combo time', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'collect' })
    run(shift, 6_000)
    expect(shift.state.overtime).toBe(true)
    const before = shift.state.shiftMs
    shift.dispatch({ type: 'collect' })
    expect(shift.state.shiftMs - before).toBe(800)
  })

  it('a quick receipt adds 0.35 s; a rehandle adds no shift time', () => {
    const level: LevelDef = { ...open, arrivals: [{ after: 0, id: 8, moves: 3 }], count: 8 }
    const shift = createShift(level)
    let before = shift.state.shiftMs
    shift.dispatch({ type: 'receive', to: 7 })
    expect(shift.state.shiftMs - before).toBe(350)
    before = shift.state.shiftMs
    shift.dispatch({ type: 'rehandle', from: 7, to: 0 })
    expect(shift.state.shiftMs).toBe(before)
  })
})

describe('Yardshift bonus window', () => {
  it('opens when a bonus container becomes next, with the level window', () => {
    const shift = createShift(bonus)
    const seen = collecting(shift)
    expect(shift.state.bonusMs).toBe(0)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.bonusMs).toBe(0)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.bonusMs).toBe(1100)
    expect(seen).toContainEqual({ type: 'bonus-window', id: 3, ms: 1100 })
  })

  it('collecting within the window awards +250 points, +5 s shift and a gold', () => {
    const shift = createShift(bonus)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    run(shift, 1000)
    const seen = collecting(shift)
    const { score, shiftMs } = shift.state
    shift.dispatch({ type: 'collect' })
    expect(shift.state.score - score).toBe(200 + 250)
    expect(shift.state.shiftMs - shiftMs).toBe(350 + 1200 + 5000)
    expect(shift.state).toMatchObject({ golds: 1, bonusMs: 0 })
    expect(seen.filter((e) => e.type === 'bonus-awarded')).toEqual([{ type: 'bonus-awarded', id: 3, points: 250, ms: 5000 }])
  })

  it('a miss turns it into ordinary cargo: one missed event, no award', () => {
    const shift = createShift(bonus)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    const seen = collecting(shift)
    run(shift, 1100)
    expect(shift.state.bonusMs).toBe(0)
    run(shift, 500)
    expect(seen.filter((e) => e.type === 'bonus-missed')).toEqual([{ type: 'bonus-missed', id: 3 }])
    const score = shift.state.score
    shift.dispatch({ type: 'collect' })
    expect(shift.state.score - score).toBe(200)
    expect(shift.state.golds).toBe(0)
    expect(seen.some((e) => e.type === 'bonus-awarded')).toBe(false)
  })

  it('pauses during a crane animation', () => {
    const shift = createShift(bonus)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'pause', reason: 'animation' })
    run(shift, 2000)
    expect(shift.state.bonusMs).toBe(1100)
    shift.dispatch({ type: 'resume', reason: 'animation' })
    run(shift, 500)
    expect(shift.state.bonusMs).toBe(600)
  })

  it('pauses during a forced receipt while the clocks keep running, and a receipt does not reset it', () => {
    const level: LevelDef = { ...bonus, count: 5, arrivals: [{ after: 2, id: 5, moves: 0 }] }
    const shift = createShift(level)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    expect(shift.state).toMatchObject({ deadline: 0, bonusMs: 1100 })
    const shiftBefore = shift.state.shiftMs
    run(shift, 700)
    expect(shift.state.bonusMs).toBe(1100)
    expect(shift.state.shiftMs).toBeLessThan(shiftBefore)
    shift.dispatch({ type: 'receive', to: 4 })
    expect(shift.state.bonusMs).toBe(1100)
    run(shift, 300)
    expect(shift.state.bonusMs).toBe(800)
  })

  it('an optional waiting truck does not pause it', () => {
    const level: LevelDef = { ...bonus, count: 5, arrivals: [{ after: 2, id: 5, moves: 3 }] }
    const shift = createShift(level)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    run(shift, 400)
    expect(shift.state.bonusMs).toBe(700)
  })

  it('a level without bonus ids never opens a window', () => {
    const shift = createShift(open)
    const seen = collecting(shift)
    for (let i = 0; i < 7; i++) shift.dispatch({ type: 'collect' })
    expect(seen.some((e) => e.type.startsWith('bonus'))).toBe(false)
  })

  it('level data drives ids and windows: level 2 opens 1.6 s on #3', () => {
    const level = levelByNumber(2)!
    expect(level.bonusIds).toEqual([3, 6])
    const shift = createShift({ ...level, stacks: [[1], [2], [3], [4], [5], [6], []], capacity: 3 })
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    expect(shift.state.bonusMs).toBe(1600)
  })

  it('bonus does not affect stars', () => {
    const won = createShift(bonus)
    for (let i = 0; i < 4; i++) won.dispatch({ type: 'collect' })
    const missed = createShift(bonus)
    missed.dispatch({ type: 'collect' })
    missed.dispatch({ type: 'collect' })
    run(missed, 2000)
    for (let i = 0; i < 2; i++) missed.dispatch({ type: 'collect' })
    expect(won.state.golds).toBe(1)
    expect(missed.state.golds).toBe(0)
    expect(starsFor(won.state.rehandles, 0)).toBe(starsFor(missed.state.rehandles, 0))
  })
})

/**
 * Yardshift screen content (#386): intro, result, fail, level picker rows and the undo button.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { LEVELS, TUTORIAL, truckSecondsFrom } from './levels'
import { emptyProgress, recordCompletion } from './progress'
import { failView, introView, pickerRows, resultView, undoView } from './screens'
import type { LevelDef } from '../types/engine'

const open: LevelDef = {
  ...TUTORIAL,
  stacks: [[1], [2], []],
  count: 2,
  capacity: 3,
  maxRehandles: 2,
  shiftSeconds: 30,
  truckSeconds: truckSecondsFrom(10),
  arrivals: [],
  bonusIds: [],
  bonusWindowSeconds: 0,
}

describe('screens', () => {
  it('intro names level, objective, target, max, shift and tip', () => {
    expect(introView(TUTORIAL, 1)).toEqual({
      title: '1. ' + TUTORIAL.name,
      objective: `Load ${TUTORIAL.count} containers in order.`,
      target: `★★★ 1 rehandle · Max ${TUTORIAL.maxRehandles}`,
      shift: `${TUTORIAL.shiftSeconds}s shift`,
      tip: TUTORIAL.tip,
    })
  })

  it('result shows actual and minimum rehandles, score, best combo, bonuses and time earned', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'rehandle', from: 1, to: 2 })
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    const r = resultView(shift.state, 0, LEVELS.length)
    expect(r.stars).toBe(2)
    expect(r.verdict).toBe('Shift complete')
    expect(r.rehandles).toBe('1 rehandle · minimum 0')
    expect(r.score).toBe(`${shift.state.score} points`)
    expect(r.combo).toBe('Best combo ×2')
    expect(r.bonuses).toBe('0 star bonuses collected')
    expect(r.timeEarned).toBe('+1.5s shift time earned') // 0.35 + 0.35 + 0.8 combo
    expect(r.hasNext).toBe(true)
    expect(resultView({ ...shift.state, level: LEVELS.at(-1)! }, 0, LEVELS.length).hasNext).toBe(false)
  })

  it('fail screen gives a clear reason for a timeout', () => {
    const shift = createShift({ ...open, shiftSeconds: 1 })
    for (let t = 0; t < 2000; t += MAX_STEP_MS) shift.tick(MAX_STEP_MS)
    expect(failView(shift.state)).toEqual({
      title: 'Time’s up',
      reason: 'Time ran out.',
      left: '2 containers left · 0 points',
      canUndo: false,
    })
  })

  it('fail screen offers undo after a blocked yard', () => {
    const shift = createShift({ ...open, stacks: [[1, 3], [2], []], count: 3, capacity: 2, maxRehandles: 1 })
    shift.dispatch({ type: 'rehandle', from: 1, to: 2 })
    const f = failView(shift.state)
    expect(f.title).toBe('Yard blocked')
    expect(f.canUndo).toBe(true)
  })

  it('picker rows show best stars, best score and locks', () => {
    const p = recordCompletion(emptyProgress(), 1, 2, 480, LEVELS.length)
    const rows = pickerRows(LEVELS, p, false)
    expect(rows[0]).toMatchObject({ number: 1, locked: false, stars: '★★☆', best: 'Best 480' })
    expect(rows[1]).toMatchObject({ locked: false, stars: '', best: 'Not played' })
    expect(rows[2]).toMatchObject({ locked: true, best: 'Locked' })
    expect(pickerRows(LEVELS, p, true).every((r) => !r.locked)).toBe(true)
  })

  it('undo button shows why it is disabled', () => {
    const shift = createShift(open)
    expect(undoView(shift.state)).toEqual({ enabled: false, label: 'Undo (1)', reason: 'Nothing to undo yet.' })
    shift.dispatch({ type: 'collect' })
    expect(undoView(shift.state).enabled).toBe(true)
    expect(undoView({ ...shift.state, shiftMs: 3000 }).reason).toBe('Undo needs more than 3s of shift.')
    shift.dispatch({ type: 'undo' })
    expect(undoView(shift.state)).toMatchObject({ enabled: false, label: 'Undo (0)', reason: 'Undo already used this shift.' })
  })
})

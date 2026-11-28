/**
 * Yardshift undo (#386): one per shift, -25 points and -3 s of shift; restores the puzzle, combo, bonus eligibility
 * and receipt deadline without refunding spent time or letting a bonus be farmed. Through `createShift` only.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS, UNDO_POINTS, UNDO_SHIFT_MS } from './engine'
import { TUTORIAL, truckSecondsFrom } from './levels'
import type { LevelDef, Shift } from '../types/engine'

const open: LevelDef = {
  ...TUTORIAL,
  number: 95,
  name: 'Open',
  stacks: [[1], [2], [3], [4], []],
  capacity: 3,
  count: 4,
  maxRehandles: 5,
  shiftSeconds: 60,
  truckSeconds: truckSecondsFrom(10),
  overtimeMultiplier: 3,
  bonusIds: [],
  bonusWindowSeconds: 0,
  arrivals: [],
}

function run(shift: Shift, ms: number): void {
  for (let t = 0; t < ms; t += MAX_STEP_MS) shift.tick(Math.min(MAX_STEP_MS, ms - t))
}

describe('undo', () => {
  it('restores the puzzle and combo, and costs 25 points and 3 s', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'collect' })
    const before = shift.state
    shift.dispatch({ type: 'collect' })
    expect(shift.state.combo).toBe(2)
    const r = shift.dispatch({ type: 'undo' })
    expect(r.ok).toBe(true)
    const s = shift.state
    expect(s.stacks).toEqual(before.stacks)
    expect(s.next).toBe(2)
    expect(s.collected).toBe(1)
    expect(s.combo).toBe(1)
    expect(s.bestCombo).toBe(1)
    expect(s.score).toBe(before.score + UNDO_POINTS)
    expect(s.shiftMs).toBe(before.shiftMs - UNDO_SHIFT_MS)
    expect(s.undosLeft).toBe(0)
    expect(shift.events.at(-1)).toEqual({ type: 'undone', points: -25, ms: 3000 })
  })

  it('never refunds time spent since the snapshot', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'collect' })
    run(shift, 4000)
    const now = shift.state
    shift.dispatch({ type: 'rehandle', from: 1, to: 4 })
    run(shift, 2000)
    const shiftBefore = shift.state.shiftMs
    const truckBefore = shift.state.truckMs
    shift.dispatch({ type: 'undo' })
    expect(shift.state.shiftMs).toBe(shiftBefore - UNDO_SHIFT_MS)
    expect(shift.state.truckMs).toBe(Math.min(truckBefore, now.truckMs))
    expect(shift.state.rehandles).toBe(0)
  })

  it('restores bonus eligibility only as the smaller window (no farming)', () => {
    const bonus: LevelDef = { ...open, bonusIds: [2], bonusWindowSeconds: 1.5 }
    const shift = createShift(bonus)
    shift.dispatch({ type: 'collect' }) // #2's window opens
    run(shift, 1000)
    const left = shift.state.bonusMs
    expect(left).toBe(500)
    shift.dispatch({ type: 'collect' }) // gold for #2
    expect(shift.state.golds).toBe(1)
    shift.dispatch({ type: 'undo' })
    expect(shift.state.golds).toBe(0)
    // The collect reset the window to 0 for #3; the snapshot had 500 ms: undo keeps the smaller.
    expect(shift.state.bonusMs).toBe(0)
  })

  it('keeps a still-open window, never extended', () => {
    const bonus: LevelDef = { ...open, bonusIds: [2], bonusWindowSeconds: 1.5 }
    const shift = createShift(bonus)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'rehandle', from: 2, to: 4 })
    run(shift, 400)
    const left = shift.state.bonusMs
    shift.dispatch({ type: 'undo' })
    expect(shift.state.bonusMs).toBe(left)
    expect(left).toBe(1100)
  })

  it('restores the receipt deadline and re-announces the truck an undone receipt served', () => {
    const arrivals: LevelDef = { ...open, stacks: [[1], [2], [3], []], count: 5, arrivals: [{ after: 0, id: 5, moves: 3 }] }
    const shift = createShift(arrivals)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.deadline).toBe(2)
    shift.dispatch({ type: 'receive', to: 3 })
    expect(shift.state.deadline).toBeNull()
    shift.dispatch({ type: 'undo' })
    expect(shift.state.deadline).toBe(2)
    expect(shift.state.receipts).toBe(0)
    expect(shift.state.stacks[3]).toEqual([])
    expect(shift.events.at(-1)).toEqual({ type: 'arrival', id: 5, moves: 2 })
  })

  it('is one per shift', () => {
    const shift = createShift(open)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'undo' })
    shift.dispatch({ type: 'collect' })
    const r = shift.dispatch({ type: 'undo' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('undo-used')
  })

  it('needs a move to undo', () => {
    const r = createShift(open).dispatch({ type: 'undo' })
    expect(!r.ok && r.rejection.reason).toBe('nothing-to-undo')
  })

  it('is disabled at 3 s or less of shift, and the rejection changes nothing', () => {
    const shift = createShift({ ...open, shiftSeconds: 5, truckSeconds: [60, 60, 60] })
    shift.dispatch({ type: 'rehandle', from: 1, to: 4 })
    run(shift, 2000)
    expect(shift.state.shiftMs).toBe(3000)
    const before = shift.state
    const r = shift.dispatch({ type: 'undo' })
    expect(!r.ok && r.rejection.reason).toBe('undo-low-time')
    expect(shift.state).toBe(before)
  })

  it('is allowed after a blocked failure, not after a timeout', () => {
    const tight: LevelDef = { ...open, stacks: [[1, 3], [2], []], count: 3, capacity: 2, maxRehandles: 1 }
    const shift = createShift(tight)
    shift.dispatch({ type: 'rehandle', from: 1, to: 2 }) // #1 stays under #3 and the cap is reached
    expect(shift.state.failure?.reason).toBe('blocked')
    expect(shift.dispatch({ type: 'undo' }).ok).toBe(true)
    expect(shift.state.status).toBe('playing')

    const late = createShift({ ...open, shiftSeconds: 4 })
    late.dispatch({ type: 'collect' })
    run(late, 10000)
    expect(late.state.failure?.reason).toBe('timeout')
    const r = late.dispatch({ type: 'undo' })
    expect(!r.ok && r.rejection.reason).toBe('shift-over')
  })
})

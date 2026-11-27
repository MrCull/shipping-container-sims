/**
 * Yardshift clocks (#383): the shift and next-truck clocks driven only by the injected `tick(dtMs)`, overtime, pause
 * reasons and the crane-busy guard. Tests go through `createShift` and `dispatch`/`tick` only.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { TUTORIAL, truckSecondsFrom } from './levels'
import type { LevelDef, PauseReason, Shift, ShiftEvent } from '../types/engine'

/** Four exposed-in-order collections and room to rehandle; first truck 12 s, shift 40 s, overtime 3x. */
const timed: LevelDef = {
  ...TUTORIAL,
  number: 98,
  name: 'Timed',
  stacks: [[1], [2], [3], [4], []],
  capacity: 3,
  count: 4,
  maxRehandles: 2,
  shiftSeconds: 40,
  truckSeconds: truckSecondsFrom(12),
  overtimeMultiplier: 3,
}

function run(shift: Shift, ms: number): void {
  for (let t = 0; t < ms; t += MAX_STEP_MS) shift.tick(Math.min(MAX_STEP_MS, ms - t))
}

function collecting(shift: Shift): ShiftEvent[] {
  const seen: ShiftEvent[] = []
  shift.onEvent((e) => seen.push(e))
  return seen
}

describe('Yardshift clocks', () => {
  it('starts with the full shift and the first-truck allowance', () => {
    expect(createShift(timed).state).toMatchObject({ shiftMs: 40_000, truckMs: 12_000, truckAllowanceMs: 12_000 })
    expect(createShift(TUTORIAL).state).toMatchObject({ shiftMs: 150_000, truckMs: 30_000 })
  })

  it('tutorial allowances are 30, 20, then 15 s from level data', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.truckMs).toBe(20_000)
    shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    shift.dispatch({ type: 'collect' })
    expect(shift.state.truckMs).toBe(15_000)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.truckMs).toBe(15_000)
  })

  it('other levels use first x 1, 0.5 and 0.28', () => {
    const shift = createShift(timed)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.truckAllowanceMs).toBe(6_000)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.truckAllowanceMs).toBe(3_360)
  })

  it('both clocks run 1x through tick', () => {
    const shift = createShift(timed)
    run(shift, 2_000)
    expect(shift.state).toMatchObject({ shiftMs: 38_000, truckMs: 10_000, overtime: false })
  })

  it('a rehandle adds exactly +1 s to the next-truck clock only, without a reset', () => {
    const shift = createShift(timed)
    const seen = collecting(shift)
    run(shift, 5_000)
    shift.dispatch({ type: 'rehandle', from: 3, to: 4 })
    expect(shift.state).toMatchObject({ truckMs: 8_000, shiftMs: 35_000, truckAllowanceMs: 12_000 })
    expect(seen).toContainEqual({ type: 'time-credit', ms: 1000 })
  })

  it('the next-truck clock resets only when a truck operation completes', () => {
    const shift = createShift(timed)
    run(shift, 3_000)
    shift.dispatch({ type: 'pause', reason: 'player' })
    shift.dispatch({ type: 'resume', reason: 'player' })
    expect(shift.state.truckMs).toBe(9_000)
    shift.dispatch({ type: 'collect' })
    expect(shift.state.truckMs).toBe(6_000)
  })

  it('at 0 the shift drains at the overtime multiplier, and a collection recovers', () => {
    const shift = createShift(timed)
    const seen = collecting(shift)
    run(shift, 12_000)
    expect(shift.state).toMatchObject({ truckMs: 0, overtime: true, shiftMs: 28_000 })
    expect(seen.filter((e) => e.type === 'overtime-start')).toHaveLength(1)
    run(shift, 1_000)
    expect(shift.state.shiftMs).toBe(25_000)
    shift.dispatch({ type: 'collect' })
    expect(shift.state).toMatchObject({ overtime: false, truckMs: 6_000 })
    expect(seen.filter((e) => e.type === 'overtime-end')).toHaveLength(1)
    run(shift, 1_000)
    expect(shift.state.shiftMs).toBe(24_000)
  })

  it('the tutorial overtime drains 2x', () => {
    const shift = createShift(TUTORIAL)
    run(shift, 31_000)
    expect(shift.state.shiftMs).toBe(150_000 - 30_000 - 2_000)
  })

  it('a step that crosses 0 drains only its overtime part faster', () => {
    const shift = createShift({ ...timed, truckSeconds: [0.05, 0.05, 0.05] })
    shift.tick(100)
    expect(shift.state.shiftMs).toBe(40_000 - 50 - 3 * 50)
  })

  it('a rehandle in overtime credits +1 s to the truck clock, never to the shift', () => {
    const shift = createShift(timed)
    run(shift, 13_000)
    const shiftBefore = shift.state.shiftMs
    shift.dispatch({ type: 'rehandle', from: 3, to: 4 })
    expect(shift.state).toMatchObject({ truckMs: 1_000, overtime: false, shiftMs: shiftBefore })
  })

  it.each<PauseReason>(['intro', 'player', 'animation', 'hidden'])('clocks freeze while %s is held', (reason) => {
    const shift = createShift(timed)
    shift.dispatch({ type: 'pause', reason })
    run(shift, 5_000)
    expect(shift.state).toMatchObject({ shiftMs: 40_000, truckMs: 12_000 })
    shift.dispatch({ type: 'resume', reason })
    run(shift, 1_000)
    expect(shift.state).toMatchObject({ shiftMs: 39_000, truckMs: 11_000 })
  })

  it('reasons are held independently: clocks run only when all are released', () => {
    const shift = createShift(timed)
    shift.dispatch({ type: 'pause', reason: 'hidden' })
    shift.dispatch({ type: 'pause', reason: 'player' })
    shift.dispatch({ type: 'resume', reason: 'hidden' })
    run(shift, 1_000)
    expect(shift.state.shiftMs).toBe(40_000)
  })

  it('one tick applies at most 100 ms', () => {
    const shift = createShift(timed)
    shift.tick(5_000)
    expect(shift.state).toMatchObject({ shiftMs: 39_900, truckMs: 11_900 })
    shift.tick(-50)
    shift.tick(Number.NaN)
    expect(shift.state.shiftMs).toBe(39_900)
  })

  it('no clock goes negative, and the shift fails once on timeout with a reason', () => {
    const shift = createShift(timed)
    const seen = collecting(shift)
    run(shift, 60_000)
    expect(shift.state).toMatchObject({ shiftMs: 0, truckMs: 0, status: 'failed' })
    expect(shift.state.failure?.reason).toBe('timeout')
    expect(shift.state.failure?.message).toMatch(/time/i)
    expect(seen.filter((e) => e.type === 'failed')).toHaveLength(1)
    expect(shift.dispatch({ type: 'collect' }).ok).toBe(false)
  })

  it('the rehandle cap blocks rehandles while collections stay legal', () => {
    const shift = createShift(timed)
    shift.dispatch({ type: 'rehandle', from: 3, to: 4 })
    shift.dispatch({ type: 'rehandle', from: 4, to: 3 })
    const r = shift.dispatch({ type: 'rehandle', from: 3, to: 4 })
    expect(!r.ok && r.rejection.reason).toBe('rehandle-cap')
    expect(shift.dispatch({ type: 'collect' }).ok).toBe(true)
  })

  it('invalid actions grant no time', () => {
    const shift = createShift(timed)
    run(shift, 2_000)
    const before = shift.state
    expect(shift.dispatch({ type: 'rehandle', from: 0, to: 0 }).ok).toBe(false)
    expect(shift.dispatch({ type: 'collect', from: 1 }).ok).toBe(false)
    expect(shift.state).toBe(before)
  })

  it('while the crane animates, moves are rejected (no double move) and the clocks hold', () => {
    const shift = createShift(timed)
    shift.dispatch({ type: 'pause', reason: 'animation' })
    const r = shift.dispatch({ type: 'collect' })
    expect(!r.ok && r.rejection.reason).toBe('crane-busy')
    run(shift, 400)
    shift.dispatch({ type: 'resume', reason: 'animation' })
    expect(shift.dispatch({ type: 'collect' }).ok).toBe(true)
    expect(shift.state).toMatchObject({ collected: 1, shiftMs: 40_000 + 350 })
  })
})

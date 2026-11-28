/** Yardshift clock presentation and crane-move input (#383), through `present`, `clocksView` and `input`. */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { TUTORIAL, truckSecondsFrom } from './levels'
import { CRANE_MAX_MS, clocksView, craneDurationMs, input, layoutFor, moveSpan, present } from './presentation'
import type { LevelDef, Shift } from '../types/engine'

const level: LevelDef = { ...TUTORIAL, number: 97, shiftSeconds: 20, truckSeconds: truckSecondsFrom(4), overtimeMultiplier: 3 }

function run(shift: Shift, ms: number): void {
  for (let t = 0; t < ms; t += MAX_STEP_MS) shift.tick(MAX_STEP_MS)
}

describe('Yardshift clocks view', () => {
  it('shows both clocks calm at the start', () => {
    const c = clocksView(createShift(level).state)
    expect(c.shift).toMatchObject({ label: 'SHIFT LEFT', text: '0:20', fraction: 1, red: false, shake: false })
    expect(c.truck).toMatchObject({ label: 'NEXT TRUCK', text: '4.0s', fraction: 1, red: false, shake: false })
  })

  it('the next-truck bar never goes above 1, even after +1 s credits past the allowance', () => {
    const shift = createShift(level)
    for (let i = 0; i < 3; i++) shift.dispatch({ type: 'rehandle', from: i % 2 === 0 ? 1 : 3, to: i % 2 === 0 ? 3 : 1 })
    expect(shift.state.truckMs).toBe(7_000)
    const c = clocksView(shift.state)
    expect(c.truck.fraction).toBe(1)
    expect(c.truck.text).toBe('7.0s')
    run(shift, 3_500)
    expect(clocksView(shift.state).truck.fraction).toBeCloseTo(3_500 / 4_000)
  })

  it('overtime turns both clocks red and shaking, and the truck label names the multiplier', () => {
    const shift = createShift(level)
    run(shift, 4_000)
    const c = present(shift.state, { selection: null }, { width: 390, height: 560 }).clocks
    expect(c.overtime).toBe(true)
    expect(c.shift).toMatchObject({ red: true, shake: true })
    expect(c.truck).toMatchObject({ red: true, shake: true, label: 'OVERTIME ×3', text: '0.0s', fraction: 0 })
    shift.dispatch({ type: 'collect' })
    const after = clocksView(shift.state)
    expect(after.shift.shake || after.truck.shake).toBe(false)
  })

  it('the truck clock reads red below 35% of its allowance; the shift below 9 s', () => {
    const shift = createShift(level)
    run(shift, 2_700)
    expect(clocksView(shift.state).truck.red).toBe(true)
    expect(clocksView(shift.state).shift.red).toBe(false)
  })

  it('clock text is never negative', () => {
    const shift = createShift(level)
    run(shift, 30_000)
    const c = clocksView(shift.state)
    expect([c.shift.text, c.truck.text]).toEqual(['0:00', '0.0s'])
    expect(present(shift.state, { selection: null }, { width: 390, height: 560 }).failed).toMatch(/time/i)
  })
})

describe('Yardshift crane move input', () => {
  it('a move lasts 330 ms plus 0.38 ms per pixel of travel', () => {
    const layout = layoutFor(4, { width: 390, height: 560 })
    const state = createShift(TUTORIAL).state
    const span = moveSpan(layout, { type: 'rehandle', from: 1, to: 3 }, state)!
    expect(craneDurationMs(span.toX - span.fromX)).toBeCloseTo(330 + (span.toX - span.fromX) * 0.38)
    expect(craneDurationMs(0)).toBe(330)
    expect(craneDurationMs(-100)).toBe(368)
  })

  it('a move stays within 330 to 460 ms at desktop width (story 20)', () => {
    const layout = layoutFor(5, { width: 880, height: 620 })
    const state = createShift(TUTORIAL).state
    const span = moveSpan(layout, { type: 'rehandle', from: 0, to: 4 }, state)!
    expect(Math.abs(span.toX - span.fromX)).toBeGreaterThan(400)
    expect(craneDurationMs(span.toX - span.fromX)).toBe(CRANE_MAX_MS)
    expect(CRANE_MAX_MS).toBe(460)
    expect(craneDurationMs(10_000)).toBe(460)
  })

  it('taps during the animation produce no action and keep the selection', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'pause', reason: 'animation' })
    const ui = { selection: 1 }
    for (const target of [{ kind: 'stack' as const, index: 0 }, { kind: 'collection' as const }, null]) {
      const r = input(ui, { type: 'tap', target }, shift.state)
      expect(r.action).toBeUndefined()
      expect(r.ui).toEqual(ui)
    }
    expect(present(shift.state, ui, { width: 390, height: 560 }).busy).toBe(true)
  })
})

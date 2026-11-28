/**
 * Yardshift playtest fixes (spec #374 phase 1): rejection feedback at deadline 0, the empty incoming band, stack
 * capacity labels, the receipt arrow clear of the cargo number, and a yard that fills the play surface.
 */
import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { levelByNumber, TUTORIAL } from './levels'
import { arrowBox, input, layoutFor, present } from './presentation'
import type { ShiftAction, ShiftState } from '../types/engine'
import type { UiState, Viewport } from '../types/presentation'

const PHONE: Viewport = { width: 390, height: 560 }
const NONE: UiState = { selection: null }

const TO_ZERO: ShiftAction[] = [
  { type: 'rehandle', from: 0, to: 4 },
  { type: 'collect', from: 0 },
  { type: 'rehandle', from: 2, to: 4 },
]

function level4(actions: ShiftAction[] = []) {
  const shift = createShift(levelByNumber(4)!)
  for (const a of actions) expect(shift.dispatch(a).ok).toBe(true)
  return shift
}

describe('Yardshift playtest fixes', () => {
  it('a stack tap at deadline 0 sends a move the engine rejects with "Receive truck #8 first."', () => {
    const shift = level4(TO_ZERO)
    const r = input(NONE, { type: 'tap', target: { kind: 'stack', index: 1 } }, shift.state)
    expect(r.ui.selection).toBeNull()
    expect(r.action).toBeDefined()
    const result = shift.dispatch(r.action!)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejection.reason).toBe('receive-first')
      expect(result.rejection.message).toBe('Receive truck #8 first.')
    }
  })

  it('with no truck waiting the incoming band reads COLLECT #n · READY', () => {
    const state: ShiftState = createShift(TUTORIAL).state
    const vm = present(state, NONE, PHONE)
    expect(vm.incoming).toMatchObject({ status: 'none', text: `COLLECT #${state.next} · READY`, bay: 'NO TRUCK' })
  })

  it('every stack has a two-digit number and the view carries the capacity', () => {
    const vm = present(createShift(levelByNumber(4)!).state, NONE, PHONE)
    expect(vm.stackLabels).toEqual(['01', '02', '03', '04', '05'])
    expect(vm.capacity).toBe(levelByNumber(4)!.capacity)
  })

  it('an open bonus window carries the share left for the countdown ring', () => {
    const state = createShift(levelByNumber(2)!).state
    const windowMs = state.level.bonusWindowSeconds * 1000
    const vm = present({ ...state, bonusMs: windowMs / 4 }, NONE, PHONE)
    expect(vm.bonus?.fraction).toBeCloseTo(0.25)
  })

  it('the mandatory arrow sits beside the cab, clear of the cargo number in the bay centre', () => {
    const bay = layoutFor(5, PHONE).receipt
    const arrow = arrowBox(bay)
    expect(arrow.x).toBeGreaterThanOrEqual(bay.x + bay.w * 0.62)
    expect(arrow.x + arrow.w).toBeLessThanOrEqual(bay.x + bay.w)
  })

  it('the trucks sit above the yard (owner round 5): the bays right over it, at most a quarter of the height', () => {
    for (const vp of [PHONE, { width: 840, height: 520 }, { width: 390, height: 420 }]) {
      const l = layoutFor(4, vp)
      // The road strip with both bays is above the yard, with a small gap, and the yard runs to the bottom.
      expect(l.yard.y - (l.collection.y + l.collection.h)).toBeGreaterThanOrEqual(0)
      expect(l.yard.y - (l.collection.y + l.collection.h)).toBeLessThanOrEqual(8)
      expect(l.receipt.y).toBe(l.collection.y)
      expect(l.collection.h).toBeLessThanOrEqual(vp.height * 0.25)
      expect(l.yard.h / vp.height).toBeGreaterThan(0.62)
      // With the capacity, the bays take about a fifth of the surface right over a yard that fits its stacks.
      const fit = layoutFor(4, vp, 3)
      expect(fit.yard.y - (fit.collection.y + fit.collection.h)).toBeLessThanOrEqual(8)
      expect(fit.collection.h).toBeGreaterThanOrEqual(Math.min(84, vp.height * 0.2) - 1)
      expect(fit.collection.h).toBeLessThanOrEqual(Math.max(84, vp.height * 0.3) + 1)
      // No dark gaps and no bare road: the bays sit right under the beam room, the road is just the bays' strip, and
      // spare height goes to the yard, which ends at the bottom margin.
      expect(fit.road.y).toBe(l.road.y)
      for (const lay of [l, fit]) expect(lay.collection.y).toBe(lay.road.y)
      for (const lay of [l, fit]) expect(lay.collection.y + lay.collection.h).toBe(lay.road.y + lay.road.h)
      expect(fit.yard.y + fit.yard.h).toBe(l.yard.y + l.yard.h)
    }
  })
})

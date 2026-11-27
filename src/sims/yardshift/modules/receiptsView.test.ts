import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { levelByNumber, TUTORIAL } from './levels'
import { input, layoutFor, moveSpan, present } from './presentation'
import type { ShiftAction, ShiftState } from '../types/engine'
import type { UiState, Viewport } from '../types/presentation'

const PHONE: Viewport = { width: 390, height: 560 }
const NONE: UiState = { selection: null }
const RECEIPT: UiState = { selection: 'receipt' }

/** Level 4 (truck #8 waits from the start with 3 moves) after `actions`. */
function level4(actions: ShiftAction[] = []): ShiftState {
  const shift = createShift(levelByNumber(4)!)
  for (const a of actions) expect(shift.dispatch(a).ok).toBe(true)
  return shift.state
}

const TO_ZERO: ShiftAction[] = [
  { type: 'rehandle', from: 0, to: 4 },
  { type: 'collect', from: 0 },
  { type: 'rehandle', from: 2, to: 4 },
]

describe('Yardshift receipt presentation', () => {
  it('no arrow and no dimming at deadlines 3, 2 and 1; an orange optional signal instead', () => {
    for (let k = 0; k < 3; k++) {
      const state = level4(TO_ZERO.slice(0, k))
      expect(state.deadline).toBe(3 - k)
      const vm = present(state, NONE, PHONE)
      expect(vm.arrow).toBeNull()
      expect(vm.dimYard).toBe(false)
      expect(vm.incoming.status).toBe('optional')
      expect(vm.incoming.text).toBe(`↑ RECEIPT #8 · ${3 - k} ${3 - k === 1 ? 'MOVE' : 'MOVES'} LEFT`)
      expect(vm.receiptCargo?.id).toBe(8)
    }
  })

  it('at deadline 0 the yard dims and the arrow points at the receipt truck, never a stack', () => {
    const vm = present(level4(TO_ZERO), NONE, PHONE)
    expect(vm.dimYard).toBe(true)
    expect(vm.arrow).toBe('receipt')
    expect(vm.incoming).toMatchObject({ status: 'mandatory', text: '↑ RECEIPT #8 · MANDATORY', bay: 'MANDATORY NOW' })
    expect(vm.hint).toMatch(/receipt truck/i)
  })

  it('selecting the receipt truck clears the arrow and dimming and highlights legal destinations', () => {
    const state = level4(TO_ZERO)
    const vm = present(state, RECEIPT, PHONE)
    expect(vm.arrow).toBeNull()
    expect(vm.dimYard).toBe(false)
    expect(vm.destinations).toEqual([0, 1, 2, 3, 4])
    expect(vm.receiptCargo?.selected).toBe(true)
    // A full stack is not a destination.
    const full: ShiftState = { ...state, stacks: [[], [3, 7, 9], [2], [4], [5, 6]] }
    expect(present(full, RECEIPT, PHONE).destinations).toEqual([0, 2, 3, 4])
  })

  it('shows NO TRUCK and no cargo when nothing waits', () => {
    const state = createShift(levelByNumber(2)!).state
    const vm = present(state, NONE, PHONE)
    expect(vm.incoming).toMatchObject({ status: 'none', bay: 'NO TRUCK' })
    expect(vm.receiptCargo).toBeNull()
  })

  it('the incoming band has reserved space: an arrival never changes the layout or hit regions', () => {
    const shift = createShift({ ...TUTORIAL, count: 5, arrivals: [{ after: 1, id: 5, moves: 2 }] })
    const before = present(shift.state, NONE, PHONE)
    expect(before.incoming.status).toBe('none')
    expect(before.layout).toEqual(layoutFor(shift.state.stacks.length, PHONE))
    const r = shift.dispatch({ type: 'collect' })
    expect(r.ok && r.events.some((e) => e.type === 'arrival')).toBe(true)
    const after = present(shift.state, NONE, PHONE)
    expect(after.incoming.status).toBe('optional')
    expect(after.layout).toEqual(before.layout)
    expect(after.hitRegions).toEqual(before.hitRegions)
  })
})

describe('Yardshift receipt input', () => {
  it('a tap on the receipt bay selects the waiting truck and a second tap clears it', () => {
    const state = level4()
    const r = input(NONE, { type: 'tap', target: { kind: 'receipt' } }, state)
    expect(r).toEqual({ ui: RECEIPT })
    expect(input(RECEIPT, { type: 'tap', target: { kind: 'receipt' } }, state)).toEqual({ ui: NONE })
  })

  it('a tap on the receipt bay with no truck waiting does nothing', () => {
    const state = createShift(levelByNumber(2)!).state
    expect(input(NONE, { type: 'tap', target: { kind: 'receipt' } }, state)).toEqual({ ui: NONE })
  })

  it('truck then stack receives; truck then collection only clears the selection', () => {
    const state = level4()
    expect(input(RECEIPT, { type: 'tap', target: { kind: 'stack', index: 4 } }, state)).toEqual({
      ui: NONE,
      action: { type: 'receive', to: 4 },
    })
    expect(input(RECEIPT, { type: 'tap', target: { kind: 'collection' } }, state)).toEqual({ ui: NONE })
  })

  it('at deadline 0 a stack tap without the truck selected selects nothing; its move is rejected (receive-first)', () => {
    const state = level4(TO_ZERO)
    expect(input(NONE, { type: 'tap', target: { kind: 'stack', index: 1 } }, state)).toEqual({
      ui: NONE,
      action: { type: 'collect', from: 1 },
    })
  })

  it('a receipt crane move runs from the receipt bay to the stack', () => {
    const state = level4()
    const layout = layoutFor(state.stacks.length, PHONE)
    const span = moveSpan(layout, { type: 'receive', to: 0 }, state)!
    expect(span.fromX).toBeCloseTo(layout.receipt.x + layout.receipt.w / 2)
    expect(span.toX).toBeCloseTo(layout.columns[0]!.x + layout.columns[0]!.w / 2)
  })
})

/** #387: drag and keyboard as equal inputs, urgency shake levels and live coaching hints. */
import { describe, expect, it } from 'vitest'
import { createShift, waitingArrival } from './engine'
import { levelByNumber, TUTORIAL } from './levels'
import { input, present, urgencyRisk } from './presentation'
import type { ShiftAction, ShiftState } from '../types/engine'
import type { HitTarget, UiAction, UiEvent, UiState, Viewport } from '../types/presentation'

const PHONE: Viewport = { width: 390, height: 560 }
const NONE: UiState = { selection: null }

function levelState(n: number, actions: ShiftAction[] = []): ShiftState {
  const shift = createShift(levelByNumber(n)!)
  for (const a of actions) expect(shift.dispatch(a).ok).toBe(true)
  return shift.state
}

const stack = (index: number): HitTarget => ({ kind: 'stack', index })
const COLLECTION: HitTarget = { kind: 'collection' }
const RECEIPT_BAY: HitTarget = { kind: 'receipt' }

/** Feed events in order; return every action emitted and the final UI state. */
function run(state: ShiftState, events: UiEvent[], ui: UiState = NONE): { ui: UiState; actions: UiAction[] } {
  const actions: UiAction[] = []
  for (const e of events) {
    const r = input(ui, e, state)
    ui = r.ui
    if (r.action) actions.push(r.action)
  }
  return { ui, actions }
}

const taps = (...targets: HitTarget[]): UiEvent[] => targets.map((target) => ({ type: 'tap', target }))
const drag = (from: HitTarget, to: HitTarget | null): UiEvent[] => [
  { type: 'drag-start', from },
  { type: 'drag-move', over: to },
  { type: 'drag-end', target: to },
]
const keys = (...ks: string[]): UiEvent[] => ks.map((key) => ({ type: 'key', key }))

/** Level 4 at deadline 0 (truck #8 mandatory). */
const L4_ZERO: ShiftAction[] = [
  { type: 'rehandle', from: 0, to: 4 },
  { type: 'collect', from: 0 },
  { type: 'rehandle', from: 2, to: 4 },
]

describe('Yardshift input: tap, drag and keyboard resolve to the same actions', () => {
  const tutorial = createShift(TUTORIAL).state
  const after1 = levelState(1, [{ type: 'collect', from: 0 }])
  const level4 = levelState(4)

  it.each([
    ['collect the exposed next container', tutorial, taps(stack(0)), keys('1'), null],
    ['rehandle #4 onto the empty stack', after1, taps(stack(1), stack(3)), keys('2', '4'), drag(stack(1), stack(3))],
    ['receive onto a stack', level4, taps(RECEIPT_BAY, stack(4)), keys('r', '5'), drag(RECEIPT_BAY, stack(4))],
    ['select then serve the collection truck', after1, taps(stack(2), COLLECTION), keys('3', 'c'), drag(stack(2), COLLECTION)],
  ] as const)('%s', (_name, state, tapEvents, keyEvents, dragEvents) => {
    const tapped = run(state, [...tapEvents])
    expect(tapped.actions).toHaveLength(1)
    expect(run(state, [...keyEvents]).actions).toEqual(tapped.actions)
    if (dragEvents) expect(run(state, [...dragEvents]).actions).toEqual(tapped.actions)
  })

  it('keys are case-insensitive and C serves the collection truck with nothing selected', () => {
    expect(run(tutorial, keys('C')).actions).toEqual([{ type: 'collect' }])
    expect(run(level4, keys('R')).ui.selection).toBe('receipt')
  })

  it('a key past the last stack or an unknown key does nothing', () => {
    expect(run(tutorial, keys('9', 'x', 'Enter'))).toEqual({ ui: NONE, actions: [] })
  })

  it('the receipt and collection bays never resolve to each other', () => {
    // Receipt selected, then collection (tap, key or drop): no action, never a receive or a collect.
    expect(run(level4, [...taps(RECEIPT_BAY, COLLECTION)]).actions).toEqual([])
    expect(run(level4, keys('r', 'c')).actions).toEqual([])
    expect(run(level4, drag(RECEIPT_BAY, COLLECTION)).actions).toEqual([])
    // A stack dropped on the receipt bay is no receive either.
    expect(run(level4, drag(stack(0), RECEIPT_BAY)).actions).toEqual([])
  })

  it('a drag needs a valid source: no truck, an empty stack, or a stack at deadline 0 start nothing', () => {
    expect(run(tutorial, drag(RECEIPT_BAY, stack(3)))).toEqual({ ui: NONE, actions: [] })
    expect(run(tutorial, drag(stack(3), stack(0)))).toEqual({ ui: NONE, actions: [] })
    expect(run(levelState(4, L4_ZERO), drag(stack(1), stack(4))).actions).toEqual([])
  })

  it('a drag shows the source as selected while it moves and ends with nothing selected', () => {
    const started = input(NONE, { type: 'drag-start', from: stack(1) }, after1)
    expect(started.ui.selection).toBe(1)
    expect(started.ui.drag).toEqual({ from: stack(1), over: null })
    expect(present(after1, started.ui, PHONE).destinations).toEqual([0, 2, 3])
    const dropped = run(after1, drag(stack(1), stack(1)))
    expect(dropped).toEqual({ ui: NONE, actions: [] })
    expect(run(after1, drag(stack(1), null))).toEqual({ ui: NONE, actions: [] })
  })

  it('Esc cancels a selection first, then pauses; Esc while paused resumes', () => {
    const selected = run(after1, keys('2'))
    expect(selected.ui.selection).toBe(1)
    const esc = input(selected.ui, { type: 'key', key: 'Escape' }, after1)
    expect(esc).toEqual({ ui: NONE })
    expect(input(NONE, { type: 'key', key: 'Escape' }, after1)).toEqual({
      ui: NONE,
      action: { type: 'pause', reason: 'player' },
    })
    const paused = levelState(1, [{ type: 'pause', reason: 'player' }])
    expect(input(NONE, { type: 'key', key: 'Escape' }, paused).action).toEqual({ type: 'resume', reason: 'player' })
  })

  it('U undoes and clears the selection; both U and Esc are dropped while the crane animates', () => {
    expect(input({ selection: 1 }, { type: 'key', key: 'u' }, after1)).toEqual({ ui: NONE, action: { type: 'undo' } })
    const busy = levelState(1, [{ type: 'pause', reason: 'animation' }])
    expect(input(NONE, { type: 'key', key: 'u' }, busy).action).toBeUndefined()
    expect(input(NONE, { type: 'key', key: 'Escape' }, busy).action).toBeUndefined()
  })
})

describe('Yardshift urgency', () => {
  /** The tutorial with both clocks set. */
  function clocked(shiftMs: number, truckMs: number): ShiftState {
    const s = createShift(TUTORIAL).state
    return { ...s, shiftMs, truckMs }
  }
  const nextOf = (vm: ReturnType<typeof present>) => vm.containers.find((c) => c.next)!
  const others = (vm: ReturnType<typeof present>) => vm.containers.filter((c) => !c.next)

  it('the next container trembles gently from the start of its turn, the others are still', () => {
    const s = clocked(100_000, 30_000)
    const vm = present(s, NONE, PHONE)
    expect(nextOf(vm).shake).toBeCloseTo(0.08)
    for (const c of others(vm)) expect(c.shake).toBe(0)
  })

  it('the next container shakes harder below 35% of the next-truck clock, up to 1 at 0', () => {
    const allowance = createShift(TUTORIAL).state.truckAllowanceMs
    expect(urgencyRisk(clocked(100_000, allowance * 0.35), true)).toBeCloseTo(0.08)
    expect(urgencyRisk(clocked(100_000, allowance * 0.175), true)).toBeCloseTo(0.54)
    expect(urgencyRisk(clocked(100_000, 0), true)).toBeCloseTo(1)
  })

  it('every container shakes progressively in the last 9 s of the shift', () => {
    expect(urgencyRisk(clocked(9_000, 30_000), false)).toBe(0)
    expect(urgencyRisk(clocked(6_000, 30_000), false)).toBeCloseTo(0.5)
    expect(urgencyRisk(clocked(3_000, 30_000), false)).toBe(1)
    for (const c of present(clocked(6_000, 30_000), NONE, PHONE).containers) expect(c.shake).toBeGreaterThanOrEqual(0.5)
  })

  it('at deadline 0 the receipt cargo is the current container', () => {
    const vm = present(levelState(4, L4_ZERO), NONE, PHONE)
    expect(vm.receiptCargo!.shake).toBeGreaterThan(0)
    expect(vm.containers.every((c) => c.shake === 0)).toBe(true)
  })

  it('reduced motion swaps shake for a static urgency flag', () => {
    const calm = present(clocked(100_000, 30_000), { ...NONE, reducedMotion: true }, PHONE)
    expect(calm.containers.every((c) => c.shake === 0)).toBe(true)
    expect(calm.containers.every((c) => !c.urgent)).toBe(true)
    const late = present(clocked(4_000, 0), { ...NONE, reducedMotion: true }, PHONE)
    expect(late.containers.every((c) => c.shake === 0)).toBe(true)
    expect(late.containers.every((c) => c.urgent)).toBe(true)
    const moving = present(clocked(4_000, 0), NONE, PHONE)
    expect(moving.containers.every((c) => !c.urgent && c.shake > 0)).toBe(true)
  })

  it('hit regions are identical across every shake level and the reduced-motion flag', () => {
    const base = present(clocked(100_000, 30_000), NONE, PHONE).hitRegions
    for (const [shiftMs, truckMs] of [
      [8_000, 30_000],
      [5_000, 5_000],
      [1_000, 0],
    ]) {
      expect(present(clocked(shiftMs!, truckMs!), NONE, PHONE).hitRegions).toEqual(base)
      expect(present(clocked(shiftMs!, truckMs!), { ...NONE, reducedMotion: true }, PHONE).hitRegions).toEqual(base)
    }
  })
})

describe('Yardshift coaching hints', () => {
  it('the tutorial coaches its first actions live: collect #1, move #4 aside, then collect #2, #3, #4', () => {
    const shift = createShift(TUTORIAL)
    const hint = (ui: UiState = NONE) => present(shift.state, ui, PHONE).hint
    expect(hint()).toBe('Tap container #1 to load the first truck.')
    shift.dispatch({ type: 'collect', from: 0 })
    expect(hint()).toBe('Move #4 to an empty stack to uncover #2.')
    expect(hint({ selection: 1 })).toBe('Choose a destination for #4')
    shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    expect(hint()).toBe('Tap #2 to load the next truck.')
    shift.dispatch({ type: 'collect', from: 1 })
    expect(hint()).toBe('Tap #3 to load the next truck.')
    shift.dispatch({ type: 'collect', from: 2 })
    // #4 is the tutorial's one bonus: its window opens as it becomes next (owner round 4).
    expect(shift.state.bonusMs).toBeGreaterThan(0)
    expect(hint()).toBe('Gold bonus! Load #4 fast for +250')
  })

  it('once the tutorial bonus window closes, the plain coaching returns', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'collect', from: 0 })
    shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    shift.dispatch({ type: 'collect', from: 1 })
    shift.dispatch({ type: 'collect', from: 2 })
    for (let t = 0; t < 2100; t += 100) shift.tick(100)
    expect(shift.state.bonusMs).toBe(0)
    expect(present(shift.state, NONE, PHONE).hint).toBe('Tap #4 to load the next truck.')
  })

  it('other levels get the plain hint', () => {
    expect(present(levelState(2), NONE, PHONE).hint).not.toMatch(/first truck/)
  })

  /** A UI state with the first non-next heavy top container selected. */
  function heavySelection(state: ShiftState): UiState {
    const i = state.stacks.findIndex((s) => {
      const top = s[s.length - 1]
      return top !== undefined && top !== state.next && state.level.heavy.includes(top)
    })
    expect(i).toBeGreaterThanOrEqual(0)
    return { selection: i }
  }

  it('heavy hints on 11 and 12 name the container and the rule', () => {
    for (const n of [11, 12]) {
      const state = levelState(n)
      const hint = present(state, heavySelection(state), PHONE).hint
      expect(hint).toMatch(/^Heavy #\d+ · Choose a highlighted stack: heavy on heavy or empty\.$/)
    }
  })

  it('a heavy container with no legal stack says so', () => {
    const state = levelState(11)
    // Level 11: [[1,4],[5,2],[3],[6],[]], heavy 1, 4, 6. Fill the empty stack and cover #6 so #4 has nowhere to go.
    const blocked: ShiftState = { ...state, stacks: [[1, 4], [5], [3, 2], [6, 9], [7, 8]] }
    expect(present(blocked, { selection: 0 }, PHONE).hint).toBe('Heavy #4 · No valid stack. Make space first.')
  })

  it('heavy hints are gone on 13, while the specific rejection reason remains', () => {
    // Level 13 opens with heavy truck #13 waiting; every yard top (10, 11, 12, 4) is light.
    const state = levelState(13)
    const ui: UiState = { selection: 'receipt' }
    expect(state.level.heavy).toContain(waitingArrival(state))
    expect(present(state, ui, PHONE).hint).not.toMatch(/Heavy/)
    const r = createShift(levelByNumber(13)!).dispatch({ type: 'receive', to: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.reason).toBe('heavy')
  })

  it('on 11 a heavy selection highlights its legal destinations', () => {
    const state = levelState(11)
    const vm = present(state, { selection: 0 }, PHONE)
    expect(vm.hint).toBe('Heavy #4 · Choose a highlighted stack: heavy on heavy or empty.')
    expect(vm.destinations).toEqual([3, 4])
  })
})

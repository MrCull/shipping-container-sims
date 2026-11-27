/**
 * Yardshift presentation of colours, queue, bonus badges, score and combo (#385). Through `present` only.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { TUTORIAL } from './levels'
import { GREY, present, SEQUENCE_COLOURS } from './presentation'
import type { LevelDef, Shift } from '../types/engine'
import type { UiState, Viewport } from '../types/presentation'

const PHONE: Viewport = { width: 390, height: 560 }
const NONE: UiState = { selection: null }

/** Nine containers: #1..#8 buried under #9 and each other, bonus #3 and #6 (window 1.3 s). */
const deep: LevelDef = {
  ...TUTORIAL,
  number: 95,
  name: 'Deep',
  stacks: [[2, 1], [4, 3], [6, 5], [9, 8, 7], []],
  capacity: 4,
  count: 9,
  maxRehandles: 4,
  bonusIds: [3, 6],
  bonusWindowSeconds: 1.3,
}

function run(shift: Shift, ms: number): void {
  for (let t = 0; t < ms; t += MAX_STEP_MS) shift.tick(Math.min(MAX_STEP_MS, ms - t))
}

const view = (shift: Shift, ui: UiState = NONE) => present(shift.state, ui, PHONE)
const byId = (shift: Shift, ui: UiState = NONE) => new Map(view(shift, ui).containers.map((c) => [c.id, c]))

describe('Yardshift colours and queue', () => {
  it('the palette is mint, blue, purple, yellow, pink, lime, then grey', () => {
    expect(SEQUENCE_COLOURS).toEqual(['#54ddb0', '#58b3ef', '#b19af5', '#f7ce53', '#ee8bb7', '#a5d36e'])
    expect(GREY).toBe('#84949c')
  })

  it('the next six collection positions take the six colour slots; farther ones are grey, numbers always shown', () => {
    const c = byId(createShift(deep))
    for (let id = 1; id <= 6; id++) expect(c.get(id)).toMatchObject({ slot: id - 1, colour: SEQUENCE_COLOURS[id - 1] })
    for (const id of [7, 8, 9]) expect(c.get(id)).toMatchObject({ slot: null, colour: GREY, label: String(id) })
  })

  it('slots follow the next container as collections advance', () => {
    const shift = createShift(deep)
    shift.dispatch({ type: 'collect' })
    const c = byId(shift)
    expect(c.get(2)!.slot).toBe(0)
    expect(c.get(7)!.slot).toBe(5)
    expect(c.get(8)!.slot).toBeNull()
  })

  it('the HUD queue has six items matching the yard colours and bonus stars', () => {
    const shift = createShift(deep)
    const vm = view(shift)
    const c = byId(shift)
    expect(vm.queue).toHaveLength(6)
    expect(vm.queue.map((q) => q.label)).toEqual(['1', '2', '3', '4', '5', '6'])
    vm.queue.forEach((q) => expect(q.colour).toBe(c.get(q.id!)!.colour))
    expect(vm.queue.map((q) => q.bonus)).toEqual([false, false, true, false, false, true])
  })

  it('queue positions past the last container are empty slots', () => {
    const level: LevelDef = { ...deep, stacks: [[2, 1], [3], []], count: 3, bonusIds: [] }
    const vm = view(createShift(level))
    expect(vm.queue.slice(3)).toEqual([
      { id: null, label: '–', colour: '#526773', bonus: false },
      { id: null, label: '–', colour: '#526773', bonus: false },
      { id: null, label: '–', colour: '#526773', bonus: false },
    ])
  })

  it('the current container has no border; only the selection does', () => {
    const shift = createShift(deep)
    expect(byId(shift).get(1)!.border).toBe(false)
    const c = byId(shift, { selection: 3 })
    expect(c.get(7)!.border).toBe(true)
    expect([...c.values()].filter((x) => x.border).map((x) => x.id)).toEqual([7])
  })
})

describe('Yardshift bonus badges', () => {
  it('bonus containers carry the badge when buried and when grey', () => {
    const level: LevelDef = { ...deep, bonusIds: [3, 9] }
    const c = byId(createShift(level))
    expect(c.get(3)).toMatchObject({ bonus: true })
    expect(c.get(9)).toMatchObject({ bonus: true, slot: null })
    expect(c.get(4)!.bonus).toBe(false)
  })

  it('the current bonus container keeps its badge while the window is open and loses it on a miss', () => {
    const shift = createShift({ ...deep, stacks: [[1], [2], [3], [4], [9, 8, 7, 6], [5], []], maxRehandles: 0 })
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    expect(byId(shift).get(3)!.bonus).toBe(true)
    expect(view(shift).queue[0]!.bonus).toBe(true)
    expect(view(shift).bonus).toEqual({ id: 3, text: '1.3s' })
    run(shift, 1300)
    expect(byId(shift).get(3)!.bonus).toBe(false)
    expect(view(shift).queue[0]!.bonus).toBe(false)
    expect(view(shift).bonus).toBeNull()
    expect(byId(shift).get(6)!.bonus).toBe(true)
  })
})

describe('Yardshift score HUD', () => {
  it('shows score and combo', () => {
    const shift = createShift({ ...deep, stacks: [[1], [2], [3], []], count: 3, bonusIds: [] })
    expect(view(shift).hud).toMatchObject({ score: '0', combo: '×0' })
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    expect(view(shift).hud).toMatchObject({ score: '250', combo: '×2' })
  })
})

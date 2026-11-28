/**
 * Yardshift presentation of colours, queue, bonus badges, score and combo (#385). Through `present` only.
 */
import { describe, expect, it } from 'vitest'
import { createShift, MAX_STEP_MS } from './engine'
import { levelByNumber, TUTORIAL } from './levels'
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
      { id: null, label: '–', colour: '#526773', bonus: false, active: false },
      { id: null, label: '–', colour: '#526773', bonus: false, active: false },
      { id: null, label: '–', colour: '#526773', bonus: false, active: false },
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
    expect(view(shift).bonus).toMatchObject({ id: 3, text: '1.3s' })
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

  it('heavy containers carry the H flag, buried or grey, and on the receipt truck', () => {
    const shift = createShift(levelByNumber(13)!)
    const v = view(shift)
    const heavy = new Set(levelByNumber(13)!.heavy)
    for (const c of v.containers) expect(c.heavy).toBe(heavy.has(c.id))
    // Buried heavy (#1 under #6 and #10) and grey heavy (far down the order) both keep the flag.
    expect(v.containers.find((c) => c.id === 1)).toMatchObject({ heavy: true, tier: 0 })
    expect(v.containers.find((c) => c.id === 9)).toMatchObject({ heavy: true, slot: null })
    expect(v.receiptCargo).toMatchObject({ id: 13, heavy: true })
  })

  it('a bonus container shows a static badge until it is next with its window open (art pass 3)', () => {
    const shift = createShift({ ...deep, stacks: [[2, 1], [3, 4], [5, 6], [9, 8, 7], []] })
    const v = present(shift.state, NONE, PHONE)
    // #6 is exposed but not next: badge only, no gold, no glint; its chip keeps its colour with a star.
    expect(v.containers.find((c) => c.id === 6)).toMatchObject({ bonus: true, bonusActive: false, glint: false })
    expect(v.containers.find((c) => c.id === 3)).toMatchObject({ bonus: true, bonusActive: false, glint: false })
    expect(v.queue.map((q) => q.active)).toEqual([false, false, false, false, false, false])
    expect(v.queue[2]).toMatchObject({ bonus: true, active: false })
  })

  it('the next bonus container turns active (gold, glint) while its window is open; reduced motion keeps it still', () => {
    const shift = createShift({ ...deep, stacks: [[1], [2], [3], [4], [9, 8, 7, 6], [5], []], maxRehandles: 0 })
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'collect' })
    const v = present(shift.state, NONE, PHONE)
    expect(v.containers.find((c) => c.id === 3)).toMatchObject({ next: true, bonus: true, bonusActive: true, glint: true })
    expect(v.containers.find((c) => c.id === 6)).toMatchObject({ bonus: true, bonusActive: false, glint: false })
    expect(v.queue[0]).toMatchObject({ id: 3, bonus: true, active: true })
    expect(v.queue.filter((q) => q.active)).toHaveLength(1)
    const still = present(shift.state, { selection: null, reducedMotion: true }, PHONE)
    expect(still.containers.find((c) => c.id === 3)).toMatchObject({ bonusActive: true, glint: false })
    run(shift, 1300)
    const after = present(shift.state, NONE, PHONE)
    expect(after.containers.find((c) => c.id === 3)).toMatchObject({ bonus: false, bonusActive: false, glint: false })
    expect(after.queue[0]!.active).toBe(false)
  })
})

describe('Yardshift next marker (art pass 3)', () => {
  it('the next container is flagged from the start of the shift, #1 included, and the chevron targets its stack', () => {
    const shift = createShift(levelByNumber(3)!)
    const v = present(shift.state, NONE, PHONE)
    expect(v.containers.filter((c) => c.next).map((c) => c.id)).toEqual([1])
    expect(v.nextMarker).toEqual({ stack: 0, buried: true })
    shift.dispatch({ type: 'rehandle', from: 0, to: 4 })
    shift.dispatch({ type: 'rehandle', from: 0, to: 4 })
    expect(present(shift.state, NONE, PHONE).nextMarker).toEqual({ stack: 0, buried: false })
    shift.dispatch({ type: 'collect' })
    const v2 = present(shift.state, NONE, PHONE)
    expect(v2.containers.filter((c) => c.next).map((c) => c.id)).toEqual([2])
    expect(v2.nextMarker).toEqual({ stack: 2, buried: true })
  })

  it('hit regions come from the layout only: calm, urgent (buzzing) and reduced motion give the same regions', () => {
    const state = createShift(levelByNumber(3)!).state
    const calm = present(state, NONE, PHONE).hitRegions
    expect(present({ ...state, truckMs: 1, shiftMs: 2000 }, NONE, PHONE).hitRegions).toEqual(calm)
    expect(present(state, { selection: null, reducedMotion: true }, PHONE).hitRegions).toEqual(calm)
    expect(present(state, { selection: 0 }, PHONE).hitRegions).toEqual(calm)
  })

  it('no chevron once the shift is over or while a receipt is mandatory', () => {
    const shift = createShift({ ...deep, stacks: [[1], []], count: 1, bonusIds: [] })
    shift.dispatch({ type: 'collect' })
    expect(present(shift.state, NONE, PHONE).nextMarker).toBeNull()
    expect(present({ ...createShift(deep).state, deadline: 0 }, NONE, PHONE).nextMarker).toBeNull()
  })
})


import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { LEVELS, levelByNumber } from './levels'
import { present } from './presentation'
import { contains, offset, overlaps, screenLayout, type Insets, type ScreenLayout } from './screenLayout'
import { introView, resultView } from './screens'
import type { ShiftAction, ShiftState } from '../types/engine'
import type { Rect } from '../types/presentation'

/** iPhone 14 portrait (390x844): the game box under the site header (about 51 px), and full screen with notch insets. */
const CASES: { name: string; box: { width: number; height: number }; insets?: Insets }[] = [
  { name: 'phone 390 under the site header', box: { width: 390, height: 793 } },
  { name: 'phone 390 full screen with safe-area insets', box: { width: 390, height: 844 }, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
  { name: 'tablet 820x1180', box: { width: 820, height: 1129 } },
  { name: 'desktop 1280x720', box: { width: 1280, height: 669 } },
  { name: 'desktop 1920x1080', box: { width: 1920, height: 1029 } },
]

const bands = (l: ScreenLayout): [string, Rect][] => [
  ['hud', l.hud],
  ['queue', l.queue],
  ['incoming', l.incoming],
  ['surface', l.surface],
  ['hint', l.hint],
  ['controls', l.controls],
]

/** Level 4 at deadline 0 (mandatory receipt #8), the arrow state. */
function mandatory(): ShiftState {
  const shift = createShift(levelByNumber(4)!)
  const moves: ShiftAction[] = [
    { type: 'rehandle', from: 0, to: 4 },
    { type: 'collect', from: 0 },
    { type: 'rehandle', from: 2, to: 4 },
  ]
  for (const a of moves) expect(shift.dispatch(a).ok).toBe(true)
  expect(shift.state.deadline).toBe(0)
  return shift.state
}

function pairs<T>(xs: T[]): [T, T][] {
  return xs.flatMap((a, i) => xs.slice(i + 1).map((b): [T, T] => [a, b]))
}

describe('Yardshift screen layout (#389)', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const layout = screenLayout(c.box, c.insets)

      it('every band lies inside the safe area and no two bands overlap', () => {
        for (const [name, r] of bands(layout)) expect(contains(layout.safe, r), name).toBe(true)
        for (const [[a, ra], [b, rb]] of pairs(bands(layout))) expect(overlaps(ra, rb), `${a} / ${b}`).toBe(false)
      })

      it('the play surface is the hero: the tallest band, over half the safe height', () => {
        for (const [name, r] of bands(layout)) if (name !== 'surface') expect(layout.surface.h).toBeGreaterThan(r.h)
        expect(layout.surface.h / layout.safe.h).toBeGreaterThan(0.55)
      })

      it('every stack and both truck bays sit inside the surface without overlapping, for every level', () => {
        const vp = { width: layout.surface.w, height: layout.surface.h }
        for (const level of LEVELS) {
          const vm = present(createShift(level).state, { selection: null }, vp)
          const regions = vm.hitRegions.map((r) => offset(r.rect, layout.surface))
          for (const r of regions) expect(contains(layout.surface, r)).toBe(true)
          for (const [a, b] of pairs(regions)) expect(overlaps(a, b)).toBe(false)
        }
      })

      it('the mandatory-receipt arrow sits over the receipt truck, never over a yard stack', () => {
        const vm = present(mandatory(), { selection: null }, { width: layout.surface.w, height: layout.surface.h })
        expect(vm.arrow).toBe('receipt')
        const arrow = vm.arrowAt!
        expect(arrow.h).toBeGreaterThan(0)
        expect(contains(vm.layout.receipt, arrow)).toBe(true)
        expect(overlaps(arrow, vm.layout.yard)).toBe(false)
        for (const col of vm.layout.columns) expect(overlaps(arrow, col)).toBe(false)
        expect(overlaps(arrow, vm.layout.collection)).toBe(false)
      })
    })
  }

  it('no arrow box without the arrow', () => {
    const vm = present(createShift(levelByNumber(4)!).state, { selection: null }, { width: 390, height: 520 })
    expect(vm.arrowAt).toBeNull()
  })

  it('a very short window keeps a usable surface rather than collapsing it', () => {
    expect(screenLayout({ width: 390, height: 300 }).surface.h).toBeGreaterThanOrEqual(200)
  })
})

describe('Yardshift singular and plural copy (#389)', () => {
  it('one of a thing reads singular, more read plural', () => {
    expect(introView(levelByNumber(1)!, 1).target).toBe('★★★ 1 rehandle · Max 5')
    expect(introView(levelByNumber(2)!, 3).target).toBe('★★★ 3 rehandles · Max 7')
    const shift = createShift(levelByNumber(4)!)
    shift.dispatch({ type: 'rehandle', from: 0, to: 4 })
    shift.dispatch({ type: 'collect', from: 0 })
    const vm = present(shift.state, { selection: null }, { width: 390, height: 520 })
    expect(vm.incoming.text).toBe('↓ RECEIPT #8 · 1 MOVE LEFT')
    expect(vm.incoming.bay).toBe('1 MOVE LEFT')
    const result = resultView({ ...shift.state, rehandles: 1, golds: 1 }, 1, LEVELS.length)
    expect(result.rehandles).toBe('1 rehandle · minimum 1')
    expect(result.bonuses).toBe('1 star bonus collected')
  })

  it('no HUD string pairs a 1 with a plural word', () => {
    for (const level of LEVELS) {
      const vm = present(createShift(level).state, { selection: null }, { width: 390, height: 520 })
      const texts = [vm.incoming.text, vm.incoming.bay, vm.hint, ...Object.values(vm.hud)]
      for (const t of texts) expect(t).not.toMatch(/\b1 (MOVES|moves|rehandles|containers)\b/)
    }
  })
})

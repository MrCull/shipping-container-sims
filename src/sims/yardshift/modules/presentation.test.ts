import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { TUTORIAL } from './levels'
import { hitTest, input, layoutFor, present } from './presentation'
import type { HitRegion, HitTarget, UiState, Viewport } from '../types/presentation'
import type { ShiftAction, ShiftState } from '../types/engine'

const PHONE: Viewport = { width: 390, height: 560 }
const DESKTOP: Viewport = { width: 1280, height: 640 }
const NONE: UiState = { selection: null }

const stack = (index: number): HitTarget => ({ kind: 'stack', index })

/** Feeds taps through `input`, dispatching the actions it returns, and records them. */
function tapAll(targets: (HitTarget | null)[]) {
  const shift = createShift(TUTORIAL)
  let ui = NONE
  const actions: ShiftAction[] = []
  for (const target of targets) {
    const r = input(ui, { type: 'tap', target }, shift.state)
    ui = r.ui
    if (r.action) {
      actions.push(r.action)
      shift.dispatch(r.action)
    }
  }
  return { actions, ui, state: shift.state }
}

function centre(region: HitRegion): [number, number] {
  return [region.rect.x + region.rect.w / 2, region.rect.y + region.rect.h / 2]
}

describe('Yardshift input', () => {
  it('a tap on the stack holding the exposed next container collects it', () => {
    expect(tapAll([stack(0)]).actions).toEqual([{ type: 'collect', from: 0 }])
  })

  it('a tap on another container selects it, then a stack tap rehandles it', () => {
    const r = tapAll([stack(0), stack(1)])
    expect(r.ui.selection).toBe(1)
    const r2 = tapAll([stack(0), stack(1), stack(3)])
    expect(r2.actions[1]).toEqual({ type: 'rehandle', from: 1, to: 3 })
    expect(r2.ui.selection).toBeNull()
  })

  it('tapping the selected stack again or empty ground clears the selection', () => {
    expect(tapAll([stack(1), stack(1)]).ui.selection).toBeNull()
    expect(tapAll([stack(1), null]).ui.selection).toBeNull()
    expect(tapAll([stack(3)]).actions).toEqual([])
  })

  it('a tap on the collection truck collects the exposed next container', () => {
    expect(tapAll([{ kind: 'collection' }]).actions).toEqual([{ type: 'collect' }])
    expect(tapAll([stack(1), { kind: 'collection' }]).actions).toEqual([{ type: 'collect', from: 1 }])
  })

  it('a tap on the receipt bay never collects', () => {
    expect(tapAll([{ kind: 'receipt' }]).actions).toEqual([])
  })

  it('wins the tutorial by taps alone', () => {
    const r = tapAll([stack(0), stack(1), stack(3), stack(1), { kind: 'collection' }, stack(3)])
    expect(r.state.status).toBe('complete')
    expect(r.state.rehandles).toBe(1)
  })
})

describe('Yardshift present', () => {
  const state = createShift(TUTORIAL).state

  it('shows every container with its number, bottom to top', () => {
    const vm = present(state, NONE, PHONE)
    expect(vm.containers.map((c) => [c.label, c.stack, c.tier])).toEqual([
      ['1', 0, 0],
      ['2', 1, 0],
      ['4', 1, 1],
      ['3', 2, 0],
    ])
    expect(vm.containers.find((c) => c.next)?.id).toBe(1)
    expect(vm.hud).toMatchObject({ loaded: '0/4', rehandles: '0/5' })
  })

  it('marks the selection and its legal destinations', () => {
    const vm = present(state, { selection: 1 }, PHONE)
    expect(vm.containers.find((c) => c.selected)?.id).toBe(4)
    expect(vm.destinations).toEqual([0, 2, 3])
    expect(vm.hint).toMatch(/#4/)
    expect(present(state, NONE, PHONE).destinations).toEqual([])
  })

  it('hit regions come from layout only, not from containers', () => {
    const empty: ShiftState = { ...state, stacks: [[], [], [], []] }
    expect(present(empty, { selection: 2 }, PHONE).hitRegions).toEqual(present(state, NONE, PHONE).hitRegions)
    expect(present(state, NONE, PHONE).layout).toEqual(layoutFor(4, PHONE))
  })

  it.each([PHONE, DESKTOP])('regions never overlap and stay inside the viewport (%o)', (vp) => {
    const regions = present(state, NONE, vp).hitRegions
    expect(regions).toHaveLength(6)
    for (const a of regions) {
      expect(a.rect.x).toBeGreaterThanOrEqual(0)
      expect(a.rect.y).toBeGreaterThanOrEqual(0)
      expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(vp.width)
      expect(a.rect.y + a.rect.h).toBeLessThanOrEqual(vp.height)
      for (const b of regions) {
        if (a === b) continue
        const apart =
          a.rect.x + a.rect.w <= b.rect.x ||
          b.rect.x + b.rect.w <= a.rect.x ||
          a.rect.y + a.rect.h <= b.rect.y ||
          b.rect.y + b.rect.h <= a.rect.y
        expect(apart).toBe(true)
      }
    }
  })

  it('hitTest resolves each region centre to itself, and the two bays never to each other', () => {
    const regions = present(state, NONE, PHONE).hitRegions
    for (const r of regions) {
      const target = r.kind === 'stack' ? { kind: 'stack', index: r.index } : { kind: r.kind }
      expect(hitTest(regions, ...centre(r))).toEqual(target)
    }
    const collection = regions.find((r) => r.kind === 'collection')!
    const receipt = regions.find((r) => r.kind === 'receipt')!
    expect(hitTest(regions, collection.rect.x + collection.rect.w - 1, collection.rect.y + 1)?.kind).toBe('collection')
    expect(hitTest(regions, receipt.rect.x + 1, receipt.rect.y + 1)?.kind).toBe('receipt')
    expect(hitTest(regions, -5, -5)).toBeNull()
  })

  it('reports completion', () => {
    const r = tapAll([stack(0), stack(1), stack(3), stack(1), stack(2), stack(3)])
    const vm = present(r.state, r.ui, PHONE)
    expect(vm.complete).toBe(true)
    expect(vm.hud.loaded).toBe('4/4')
  })
})

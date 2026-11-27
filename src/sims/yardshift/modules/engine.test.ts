import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { TUTORIAL } from './levels'
import type { LevelDef, ShiftAction } from '../types/engine'

const tiny: LevelDef = { number: 99, name: 'Tiny', stacks: [[1, 2], []], capacity: 2, count: 2, maxRehandles: 1 }

function rejectionOf(level: LevelDef, setup: ShiftAction[], action: ShiftAction) {
  const shift = createShift(level)
  for (const a of setup) expect(shift.dispatch(a).ok).toBe(true)
  const before = shift.state
  const eventsBefore = shift.events.length
  const result = shift.dispatch(action)
  expect(result.ok).toBe(false)
  expect(shift.state).toBe(before)
  expect(shift.events.length).toBe(eventsBefore)
  return result.ok ? null : result.rejection
}

describe('Yardshift engine', () => {
  it('starts from the level stacks with #1 next', () => {
    const s = createShift(TUTORIAL).state
    expect(s.stacks).toEqual([[1], [2, 4], [3], []])
    expect(s).toMatchObject({ next: 1, collected: 0, rehandles: 0, status: 'playing' })
  })

  it('collects the exposed next container, from its stack or through the truck', () => {
    const shift = createShift(TUTORIAL)
    const r = shift.dispatch({ type: 'collect', from: 0 })
    expect(r.ok && r.events).toEqual([{ type: 'collected', id: 1, from: 0 }])
    expect(shift.state).toMatchObject({ next: 2, collected: 1 })
    expect(shift.state.stacks[0]).toEqual([])
    shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    expect(shift.dispatch({ type: 'collect' }).ok).toBe(true)
    expect(shift.state.next).toBe(3)
  })

  it('rehandles the top container onto a stack with room', () => {
    const shift = createShift(TUTORIAL)
    const r = shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    expect(r.ok && r.events).toEqual([{ type: 'rehandled', id: 4, from: 1, to: 3 }])
    expect(shift.state.stacks).toEqual([[1], [2], [3], [4]])
    expect(shift.state.rehandles).toBe(1)
  })

  it('rejects illegal moves with a reason code and changes nothing', () => {
    expect(rejectionOf(TUTORIAL, [], { type: 'collect', from: 1 })?.reason).toBe('wrong-order')
    expect(rejectionOf(TUTORIAL, [], { type: 'collect', from: 3 })?.reason).toBe('empty-stack')
    expect(rejectionOf(TUTORIAL, [{ type: 'collect' }], { type: 'collect' })?.reason).toBe('not-exposed')
    expect(rejectionOf(TUTORIAL, [], { type: 'rehandle', from: 1, to: 1 })?.reason).toBe('same-stack')
    expect(rejectionOf(TUTORIAL, [], { type: 'rehandle', from: 0, to: 1 })?.reason).toBe('stack-full')
    expect(rejectionOf(TUTORIAL, [], { type: 'rehandle', from: 3, to: 0 })?.reason).toBe('empty-stack')
    expect(rejectionOf(TUTORIAL, [], { type: 'rehandle', from: 0, to: 9 })?.reason).toBe('no-such-stack')
    const msg = rejectionOf(TUTORIAL, [], { type: 'collect', from: 1 })?.message
    expect(msg).toMatch(/order/i)
  })

  it('only the top container is pickable: a buried next container cannot be collected', () => {
    expect(rejectionOf(tiny, [], { type: 'collect' })?.reason).toBe('not-exposed')
    expect(rejectionOf(tiny, [], { type: 'collect', from: 0 })?.reason).toBe('wrong-order')
  })

  it('keeps collections legal at the rehandle cap but blocks further rehandles', () => {
    const level: LevelDef = { ...tiny, stacks: [[2, 1], [], []], capacity: 2 }
    expect(rejectionOf(level, [{ type: 'rehandle', from: 0, to: 1 }], { type: 'rehandle', from: 0, to: 2 })?.reason).toBe(
      'rehandle-cap',
    )
    const shift = createShift(level)
    shift.dispatch({ type: 'rehandle', from: 0, to: 1 })
    expect(shift.dispatch({ type: 'collect' }).ok).toBe(true)
  })

  it('enforces collection order across the whole shift', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'collect' })
    expect(shift.dispatch({ type: 'collect', from: 2 }).ok).toBe(false)
    shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    expect(shift.dispatch({ type: 'collect', from: 3 }).ok).toBe(false)
    expect(shift.dispatch({ type: 'collect', from: 1 }).ok).toBe(true)
  })

  it('completes the tutorial when every container is collected and the yard is empty', () => {
    const shift = createShift(TUTORIAL)
    const seen: string[] = []
    shift.onEvent((e) => seen.push(e.type))
    const plan: ShiftAction[] = [
      { type: 'collect' },
      { type: 'rehandle', from: 1, to: 3 },
      { type: 'collect' },
      { type: 'collect' },
    ]
    for (const a of plan) expect(shift.dispatch(a).ok).toBe(true)
    expect(shift.state.status).toBe('playing')
    const last = shift.dispatch({ type: 'collect' })
    expect(last.ok && last.events.map((e) => e.type)).toEqual(['collected', 'completed'])
    expect(shift.state).toMatchObject({ status: 'complete', collected: 4, next: 5, rehandles: 1 })
    expect(shift.state.stacks.every((s) => s.length === 0)).toBe(true)
    expect(seen.filter((t) => t === 'completed')).toHaveLength(1)
    expect(shift.dispatch({ type: 'collect' }).ok).toBe(false)
    expect(shift.events).toHaveLength(6)
  })

  it('tick is a no-op until the clocks arrive', () => {
    const shift = createShift(TUTORIAL)
    const before = shift.state
    expect(shift.tick(100)).toBe(before)
  })

  it('never shares the level arrays with the state', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'collect' })
    expect(TUTORIAL.stacks[0]).toEqual([1])
  })
})

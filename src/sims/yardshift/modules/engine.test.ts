import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { TUTORIAL } from './levels'
import type { LevelDef, ShiftAction } from '../types/engine'

const tiny: LevelDef = {
  ...TUTORIAL,
  number: 99,
  name: 'Tiny',
  stacks: [[1, 2], []],
  capacity: 2,
  count: 2,
  maxRehandles: 1,
}

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
    expect(r.ok && r.events).toEqual([
      { type: 'rehandled', id: 4, from: 1, to: 3 },
      { type: 'time-credit', ms: 1000 },
    ])
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
    expect(shift.events).toHaveLength(7) // four collections, one rehandle and its time credit, completed
  })

  it('tick is a no-op once the shift is over', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'collect' })
    shift.dispatch({ type: 'rehandle', from: 1, to: 3 })
    for (let i = 0; i < 3; i++) shift.dispatch({ type: 'collect' })
    const before = shift.state
    expect(shift.tick(100)).toBe(before)
  })

  it('never shares the level arrays with the state', () => {
    const shift = createShift(TUTORIAL)
    shift.dispatch({ type: 'collect' })
    expect(TUTORIAL.stacks[0]).toEqual([1])
  })

  describe('heavy cargo', () => {
    // 3 and 4 are heavy; 1 and 2 are not.
    const heavy: LevelDef = { ...tiny, stacks: [[4], [1], [2, 3], []], count: 4, capacity: 3, maxRehandles: 9, heavy: [3, 4] }

    it('goes onto an empty stack or another heavy container', () => {
      const shift = createShift(heavy)
      expect(shift.dispatch({ type: 'rehandle', from: 2, to: 3 }).ok).toBe(true)
      expect(shift.dispatch({ type: 'rehandle', from: 3, to: 0 }).ok).toBe(true)
      expect(shift.state.stacks[0]).toEqual([4, 3])
    })

    it('is rejected on a non-heavy container with its own reason, changing nothing', () => {
      const rejection = rejectionOf(heavy, [], { type: 'rehandle', from: 2, to: 1 })
      expect(rejection?.reason).toBe('heavy')
      expect(rejection?.message).toMatch(/heavy/i)
    })

    it('does not restrict light cargo', () => {
      const shift = createShift({ ...heavy, stacks: [[4], [1, 2], [3], []] })
      expect(shift.dispatch({ type: 'rehandle', from: 1, to: 0 }).ok).toBe(true)
    })

    it('applies to receipts too', () => {
      const level: LevelDef = { ...heavy, stacks: [[1], [2]], count: 3, arrivals: [{ after: 0, id: 3, moves: 2 }] }
      const rejection = rejectionOf(level, [], { type: 'receive', to: 0 })
      expect(rejection?.reason).toBe('heavy')
    })
  })

  describe('receipts', () => {
    const level: LevelDef = {
      ...tiny,
      stacks: [[1], [2], []],
      count: 4,
      capacity: 2,
      maxRehandles: 5,
      arrivals: [
        { after: 0, id: 3, moves: 2 },
        { after: 1, id: 4, moves: 1 },
      ],
    }

    it('activates a truck at the start, counts other moves down and blocks everything at 0', () => {
      const shift = createShift(level)
      expect(shift.state).toMatchObject({ receipts: 0, deadline: 2 })
      expect(shift.dispatch({ type: 'rehandle', from: 1, to: 2 }).ok).toBe(true)
      expect(shift.state.deadline).toBe(1)
      expect(shift.dispatch({ type: 'collect' }).ok).toBe(true)
      expect(shift.state.deadline).toBe(0)
      expect(rejectionOf(level, [{ type: 'rehandle', from: 1, to: 2 }, { type: 'collect' }], { type: 'collect' })?.reason).toBe(
        'receive-first',
      )
    })

    it('serving a truck activates the next eligible one with its full allowance', () => {
      const shift = createShift(level)
      shift.dispatch({ type: 'collect' })
      const r = shift.dispatch({ type: 'receive', to: 0 })
      expect(r.ok && r.events).toEqual([
        { type: 'received', id: 3, to: 0 },
        { type: 'arrival', id: 4, moves: 1 },
      ])
      expect(shift.state).toMatchObject({ receipts: 1, deadline: 1 })
    })

    it('rejects a receipt with no truck waiting', () => {
      expect(rejectionOf({ ...level, arrivals: [] }, [], { type: 'receive', to: 2 })?.reason).toBe('no-truck')
    })

    it('completes only when every truck is served and the yard is empty', () => {
      const shift = createShift(level)
      const plan: ShiftAction[] = [
        { type: 'collect' },
        { type: 'receive', to: 0 },
        { type: 'collect' },
        { type: 'receive', to: 2 },
        { type: 'collect', from: 0 },
      ]
      for (const a of plan) expect(shift.dispatch(a).ok).toBe(true)
      expect(shift.state.status).toBe('playing')
      expect(shift.dispatch({ type: 'collect', from: 2 }).ok).toBe(true)
      expect(shift.state.status).toBe('complete')
    })
    it('a truck with after > 0 arrives on the collection that reaches it, and that collection does not count', () => {
      const shift = createShift({ ...level, arrivals: [{ after: 1, id: 3, moves: 2 }] })
      expect(shift.state.deadline).toBeNull()
      expect(shift.dispatch({ type: 'rehandle', from: 1, to: 2 }).ok).toBe(true)
      expect(shift.state.deadline).toBeNull()
      const r = shift.dispatch({ type: 'collect' })
      expect(r.ok && r.events.filter((e) => e.type === 'arrival')).toEqual([{ type: 'arrival', id: 3, moves: 2 }])
      expect(shift.state.deadline).toBe(2)
    })

    it('invalid input never counts the deadline down; receipts and pauses do not either', () => {
      const shift = createShift(level)
      expect(shift.dispatch({ type: 'collect', from: 1 }).ok).toBe(false)
      expect(shift.dispatch({ type: 'rehandle', from: 2, to: 0 }).ok).toBe(false)
      shift.dispatch({ type: 'pause', reason: 'player' })
      shift.dispatch({ type: 'resume', reason: 'player' })
      expect(shift.state.deadline).toBe(2)
    })

    it('receiving is optional before the deadline and legal at any count', () => {
      const shift = createShift(level)
      expect(shift.dispatch({ type: 'receive', to: 2 }).ok).toBe(true)
      expect(shift.state).toMatchObject({ receipts: 1, deadline: null })
    })

    it('at deadline 0 only a receipt is legal, and receiving resets the next-truck clock', () => {
      const shift = createShift(level)
      shift.dispatch({ type: 'rehandle', from: 1, to: 2 })
      shift.tick(100)
      shift.tick(100)
      expect(shift.dispatch({ type: 'collect' }).ok).toBe(true)
      expect(shift.state.deadline).toBe(0)
      expect(shift.dispatch({ type: 'rehandle', from: 2, to: 0 }).ok).toBe(false)
      shift.tick(100)
      const before = shift.state
      expect(before.truckMs).toBeLessThan(before.truckAllowanceMs)
      const r = shift.dispatch({ type: 'receive', to: 0 })
      expect(r.ok).toBe(true)
      expect(shift.state.operations).toBe(before.operations + 1)
      expect(shift.state.truckMs).toBe(shift.state.truckAllowanceMs)
      expect(shift.state).toMatchObject({ receipts: 1, deadline: 1, stacks: [[3], [], [2]] })
    })

    it('emits deadline-zero once when a waiting truck becomes mandatory', () => {
      const shift = createShift(level)
      shift.dispatch({ type: 'rehandle', from: 1, to: 2 })
      const r = shift.dispatch({ type: 'collect' })
      expect(r.ok && r.events.filter((e) => e.type === 'deadline-zero')).toEqual([{ type: 'deadline-zero', id: 3 }])
    })
  })

  describe('no legal move', () => {
    it('fails the shift when a mandatory receipt has no legal space', () => {
      // Two full stacks, the truck brings #3 with one move allowed; the collection that would free space is too late.
      const lvl: LevelDef = {
        ...tiny,
        stacks: [[2, 1], [4, 5]],
        count: 5,
        capacity: 2,
        maxRehandles: 5,
        arrivals: [{ after: 0, id: 3, moves: 0 }],
      }
      const shift = createShift(lvl)
      expect(shift.state.status).toBe('failed')
      expect(shift.state.failure?.reason).toBe('blocked')
      expect(shift.state.failure?.message).toMatch(/receipt/i)
    })

    it('fails the shift after a move that leaves no legal move, with a clear reason, once', () => {
      // No rehandles allowed: once #1 is collected, #2 is buried under #3 for good.
      const lvl: LevelDef = { ...tiny, stacks: [[1], [2, 3]], count: 3, capacity: 2, maxRehandles: 0 }
      const shift = createShift(lvl)
      expect(shift.state.status).toBe('playing')
      const r = shift.dispatch({ type: 'collect' })
      expect(r.ok && r.events.map((e) => e.type)).toEqual(['collected', 'failed'])
      expect(shift.state).toMatchObject({ status: 'failed', failure: { reason: 'blocked' } })
      expect(shift.state.failure?.message).toMatch(/no legal move/i)
      expect(shift.dispatch({ type: 'collect' }).ok).toBe(false)
    })

    it('does not fail while a move is still possible', () => {
      const shift = createShift({ ...tiny, stacks: [[1], [2, 3]], count: 3, capacity: 2, maxRehandles: 1 })
      shift.dispatch({ type: 'collect' })
      expect(shift.state.status).toBe('playing')
    })
  })
})

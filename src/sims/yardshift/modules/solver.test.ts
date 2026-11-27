import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { FIXTURES } from './fixtures'
import { LEVELS, TUTORIAL } from './levels'
import { solve } from './solver'
import type { LevelDef } from '../types/engine'

describe('Yardshift solver fixtures', () => {
  it('has one fixture per level', () => {
    expect(FIXTURES.map((f) => f.level)).toEqual(LEVELS.map((l) => l.number))
  })

  it.each(LEVELS.map((l) => [l.number, l] as const))(
    'level %i fixture replays through the engine to completion with exactly its rehandles',
    (n, level) => {
      const fixture = FIXTURES.find((f) => f.level === n)!
      const shift = createShift(level)
      for (const action of fixture.actions) {
        const r = shift.dispatch(action)
        expect(r.ok ? null : r.rejection, JSON.stringify(action)).toBeNull()
      }
      expect(shift.state.status).toBe('complete')
      expect(shift.state.rehandles).toBe(fixture.minRehandles)
    },
  )
})

describe('Yardshift solver', () => {
  it.each(LEVELS.map((l) => [l.number, l] as const))('re-proves the level %i minimum', (n, level) => {
    const solution = solve(level)
    expect(solution?.minRehandles).toBe(FIXTURES.find((f) => f.level === n)!.minRehandles)
  })

  it('finds the tutorial needs one rehandle', () => {
    expect(solve(TUTORIAL)?.minRehandles).toBe(1)
  })

  it('returns null when the rehandle cap makes a level impossible', () => {
    const level: LevelDef = { ...TUTORIAL, maxRehandles: 0 }
    expect(solve(level)).toBeNull()
  })

  it('respects the heavy rule (a heavy container blocks the only light destination)', () => {
    // 2 heavy must leave the stack above 1; the only other stack holds light 3, so the solver must dig 3 out first.
    const level: LevelDef = { ...TUTORIAL, stacks: [[1, 2], [3]], count: 3, capacity: 3, maxRehandles: 9, heavy: [2] }
    const light = solve({ ...level, heavy: [] })
    expect(light?.minRehandles).toBe(1)
    expect(solve(level)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { createShift } from './engine'
import { fixtureFor } from './fixtures'
import { levelByNumber } from './levels'
import { minRehandlesFor, starsFor, starsForLevel } from './stars'

describe('Yardshift stars', () => {
  it('gives three at the minimum, two at minimum + 1, one otherwise', () => {
    expect(starsFor(3, 3)).toBe(3)
    expect(starsFor(4, 3)).toBe(2)
    expect(starsFor(5, 3)).toBe(1)
    expect(starsFor(12, 3)).toBe(1)
  })

  it('never gives fewer than three below the minimum', () => {
    expect(starsFor(2, 3)).toBe(3)
  })

  it('takes the target from the solver fixture', () => {
    expect(minRehandlesFor(10)).toBe(fixtureFor(10)!.minRehandles)
    expect(starsForLevel(10, fixtureFor(10)!.minRehandles + 1)).toBe(2)
  })

  it('an optimal solution earns three stars regardless of time or score', () => {
    const fixture = fixtureFor(7)!
    const shift = createShift(levelByNumber(7)!)
    for (const a of fixture.actions) shift.dispatch(a)
    shift.tick(60_000)
    expect(shift.state.status).toBe('complete')
    expect(starsForLevel(7, shift.state.rehandles)).toBe(3)
  })
})

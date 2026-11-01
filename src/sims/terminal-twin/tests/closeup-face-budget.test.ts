/**
 * Close-up face budget (#143): the nearest visible faces first, up to the budget and the distance, with hysteresis so
 * faces do not pop at the cut.
 */
import { describe, expect, it } from 'vitest'
import { selectFaces, type FaceCandidate } from '../modules/closeupFaceBudget'

const at = (id: number, d: number): FaceCandidate => ({ id, d2: d * d })
const OPTS = { budget: 3, maxDistM: 35, hysteresis: 1.15 }

describe('selectFaces', () => {
  it('takes the nearest faces first, up to the budget', () => {
    const picked = selectFaces([at(1, 30), at(2, 5), at(3, 12), at(4, 8), at(5, 20)], OPTS, new Set())
    expect([...picked].sort()).toEqual([2, 3, 4])
  })

  it('takes none with a budget of zero (low quality) and none beyond the distance', () => {
    expect(selectFaces([at(1, 2)], { ...OPTS, budget: 0 }, new Set())).toEqual([])
    expect(selectFaces([at(1, 36)], OPTS, new Set())).toEqual([])
  })

  it('never exceeds the budget however many faces are near', () => {
    const many = Array.from({ length: 1000 }, (_, i) => at(i, 1 + (i % 30)))
    expect(selectFaces(many, { ...OPTS, budget: 400 }, new Set())).toHaveLength(400)
  })

  it('keeps a drawn face out to the distance times the hysteresis, and does not take it back until inside the distance', () => {
    expect(selectFaces([at(1, 38)], OPTS, new Set([1]))).toEqual([1])
    expect(selectFaces([at(1, 41)], OPTS, new Set([1]))).toEqual([])
    expect(selectFaces([at(1, 38)], OPTS, new Set())).toEqual([])
  })

  it('keeps a drawn face over a slightly nearer newcomer at the budget cut, but not over a much nearer set', () => {
    const slight = selectFaces([at(1, 5), at(2, 6), at(3, 10), at(4, 9.5)], OPTS, new Set([3]))
    expect(slight).toContain(3)
    expect(slight).toHaveLength(3)
    const jump = selectFaces([at(1, 1), at(2, 2), at(3, 3), at(4, 30)], OPTS, new Set([4]))
    expect([...jump].sort()).toEqual([1, 2, 3]) // the camera moved: the old far face loses its place
  })
})

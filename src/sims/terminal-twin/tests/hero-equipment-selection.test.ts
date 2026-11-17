/**
 * Hero equipment selection (#273), pure: which spreaders near the camera get the hero model. Nearest first, within
 * the piece's reach (`HERO_PIECES`), capped, and a spreader chosen last frame keeps its place out to 1.15 x the distance.
 */
import { describe, expect, it } from 'vitest'
import { HERO_PIECES } from '../modules/heroEquipment'
import { HERO_EQUIPMENT_HYSTERESIS, selectHeroEquipment, type HeroEquipmentCandidate } from '../modules/heroEquipmentSelection'

const none: ReadonlySet<string> = new Set()
const SPREADER_M: number = HERO_PIECES.spreader.distanceM
const SHC_BODY_M = HERO_PIECES['shc-body'].distanceM
/** The spreader lane's selection unless a reach is given. */
const select = (c: readonly HeroEquipmentCandidate[], cap: number, previous: ReadonlySet<string>, distanceM = SPREADER_M): string[] => selectHeroEquipment(c, cap, previous, distanceM)

describe('selectHeroEquipment', () => {
  it('has the triage constants: 25 m, hysteresis 1.15', () => {
    expect(SPREADER_M).toBe(25)
    expect(HERO_EQUIPMENT_HYSTERESIS).toBe(1.15)
    expect(HERO_PIECES.truck.distanceM).toBe(25) // #276, from the truck centre
  })

  it('returns the spreaders within the distance, nearest first', () => {
    const picked = select(
      [
        { id: 'ASC-2', distanceM: 20 },
        { id: 'STS-1', distanceM: 5 },
        { id: 'SHC-7', distanceM: 12 },
      ],
      3,
      none,
    )
    expect(picked).toEqual(['STS-1', 'SHC-7', 'ASC-2'])
  })

  it('never returns more than the cap, and nothing at cap 0 (Low)', () => {
    const candidates = [
      { id: 'a', distanceM: 4 },
      { id: 'b', distanceM: 3 },
      { id: 'c', distanceM: 9 },
      { id: 'd', distanceM: 6 },
    ]
    expect(select(candidates, 3, none)).toEqual(['b', 'a', 'd'])
    expect(select(candidates, 1, none)).toEqual(['b'])
    expect(select(candidates, 0, none)).toEqual([])
    expect(select(candidates, 0, new Set(['a', 'b']))).toEqual([])
  })

  it('leaves out a spreader beyond 25 m; one at exactly 25 m is in', () => {
    const picked = select(
      [
        { id: 'far', distanceM: 25.1 },
        { id: 'edge', distanceM: 25 },
        { id: 'near', distanceM: 10 },
      ],
      3,
      none,
    )
    expect(picked).toEqual(['near', 'edge'])
  })

  it('keeps a previous pick at 1.1 x the distance and drops it at 1.2 x', () => {
    const previous = new Set(['held'])
    expect(select([{ id: 'held', distanceM: 27.5 }], 3, previous)).toEqual(['held'])
    expect(select([{ id: 'held', distanceM: 30 }], 3, previous)).toEqual([])
    // a newcomer at the same 27.5 m is not picked: the extra reach is only for a spreader already chosen
    expect(select([{ id: 'new', distanceM: 27.5 }], 3, previous)).toEqual([])
  })

  it('with the cap full, a previous pick inside the distance keeps its place against a much nearer newcomer', () => {
    const candidates = [
      { id: 'held', distanceM: 24 },
      { id: 'new', distanceM: 5 },
    ]
    expect(select(candidates, 1, new Set(['held']))).toEqual(['held'])
    // also in its extra reach (25 to 28.75 m)
    expect(select([{ id: 'held', distanceM: 28 }, candidates[1]], 1, new Set(['held']))).toEqual(['held'])
    // once it is beyond 25 x 1.15 m the newcomer takes the place
    expect(select([{ id: 'held', distanceM: 29 }, candidates[1]], 1, new Set(['held']))).toEqual(['new'])
  })

  it('free places go to newcomers within 25 m, nearest first; the result is nearest first', () => {
    const picked = select(
      [
        { id: 'held', distanceM: 27 },
        { id: 'newFar', distanceM: 20 },
        { id: 'newNear', distanceM: 8 },
        { id: 'newMid', distanceM: 14 },
        { id: 'newOut', distanceM: 26 },
      ],
      3,
      new Set(['held']),
    )
    expect(picked).toEqual(['newNear', 'newMid', 'held'])
  })

  it('more previous picks than the cap (the cap was lowered): the nearest of them stay', () => {
    const picked = select(
      [
        { id: 'a', distanceM: 20 },
        { id: 'b', distanceM: 10 },
        { id: 'c', distanceM: 15 },
        { id: 'new', distanceM: 2 },
      ],
      2,
      new Set(['a', 'b', 'c']),
    )
    expect(picked).toEqual(['b', 'c'])
  })

  it('does not change its inputs', () => {
    const candidates = [
      { id: 'b', distanceM: 8 },
      { id: 'a', distanceM: 2 },
    ]
    select(candidates, 2, none)
    expect(candidates.map((c) => c.id)).toEqual(['b', 'a'])
  })
  it('takes the reach as a parameter: the SHC body has 30 m, kept out to 30 x 1.15 m', () => {
    expect(SHC_BODY_M).toBe(30)
    const at = (d: number) => [{ id: 'SHC01', distanceM: d }]
    expect(select(at(28), 1, none)).toEqual([])
    expect(select(at(28), 1, none, SHC_BODY_M)).toEqual(['SHC01'])
    expect(select(at(31), 1, none, SHC_BODY_M)).toEqual([])
    const kept = new Set(['SHC01'])
    expect(select(at(34.4), 1, kept, SHC_BODY_M)).toEqual(['SHC01'])
    expect(select(at(34.6), 1, kept, SHC_BODY_M)).toEqual([])
  })
})

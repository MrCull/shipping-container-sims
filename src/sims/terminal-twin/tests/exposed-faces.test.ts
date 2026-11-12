/**
 * Exposed faces (#143): which of a box's six faces can be seen, from the occupancy next to it. A yard box is hidden
 * where a neighbour touches it (above, either end, either side) and on its underside; vessel and vehicle boxes show
 * every face.
 */
import { describe, expect, it } from 'vitest'
import { exposedFaces, neighboursOf, visibleFaceList, type Face, type PlacedBox } from '../modules/exposedFaces'

const L40 = 12.192
const W = 2.438
const H = 2.591
const GAP = 0.46 // row and bay gaps of the yard

/** A 40 ft yard box whose length runs along Z (yaw 90 degrees, as stacked boxes are), `row` across and `tier` up (1-based). */
const box = (row: number, tier: number, bay = 0): PlacedBox => ({
  x: row * (W + GAP),
  y: (tier - 1) * 2.896 + H / 2,
  z: bay * (L40 + GAP),
  yaw: Math.PI / 2,
  length: L40,
  width: W,
  height: H,
})

const faces = (b: PlacedBox, others: PlacedBox[]) => exposedFaces('yard', neighboursOf(b, others))
const sides = (l: Face[]) => l.filter((x) => x === 'sideP' || x === 'sideN')
const ends = (l: Face[]) => l.filter((x) => x === 'door' || x === 'front')

describe('exposed faces of a yard box', () => {
  it('shows nothing of a box buried in a block (neighbours all round and on top)', () => {
    const b = box(1, 1, 1)
    const around = [box(0, 1, 1), box(2, 1, 1), box(1, 1, 0), box(1, 1, 2), box(1, 2, 1)]
    expect(visibleFaceList(faces(b, around))).toEqual([])
  })

  it('shows the roof of a box with nothing on it, and not of one with a box on top', () => {
    const lower = box(1, 1)
    const top = box(1, 2)
    expect(faces(top, [lower]).top).toBe(true)
    expect(faces(lower, [top]).top).toBe(false)
  })

  it('#267: a high cube resting on a standard box covers its roof, and a neighbour row 0.61 m lower still hides its side', () => {
    const HC = 2.896
    const lower = box(1, 1) // standard box on tier 1: top at 2.591
    const upper: PlacedBox = { ...box(1, 2), y: H + HC / 2, height: HC } // 40HC resting on it
    expect(faces(lower, [upper]).top).toBe(false)
    expect(faces(upper, [lower]).bottom).toBe(false)
    expect(faces(upper, [lower]).top).toBe(true)
    // the next row: two high cubes, so its tier-2 box stands 0.305 m higher; at tier 3 over two standard boxes, 0.61 m lower
    const neighbourHigher: PlacedBox = { ...upper, x: box(0, 2).x, y: HC + HC / 2 }
    expect(sides(visibleFaceList(faces(upper, [lower, neighbourHigher])))).toHaveLength(1)
    const tier3: PlacedBox = { ...box(1, 3), y: 2 * HC + H / 2 } // standard box on two high cubes: bottom 5.792
    const lowerRow: PlacedBox = { ...box(0, 3), y: 2 * H + H / 2 } // same tier over two standard boxes: bottom 5.182 (0.61 m lower)
    expect(sides(visibleFaceList(faces(tier3, [lowerRow])))).toHaveLength(1)
  })

  it('shows both ends, the roof and one side of a box at the edge of the block', () => {
    const b = box(1, 1)
    const f = faces(b, [box(0, 1)]) // a neighbour on one side only
    expect(f.door).toBe(true)
    expect(f.front).toBe(true)
    expect(f.top).toBe(true)
    expect(f.bottom).toBe(false)
    expect(sides(visibleFaceList(f))).toHaveLength(1)
  })

  it('shows a side next to an empty slot, also when only a lower slot beside it is taken', () => {
    const b = box(1, 2)
    expect(sides(visibleFaceList(faces(b, [box(0, 1)])))).toHaveLength(2)
    expect(sides(visibleFaceList(faces(b, [box(0, 2)])))).toHaveLength(1)
  })

  it('hides an end that touches the next bay', () => {
    const b = box(1, 1, 1)
    expect(ends(visibleFaceList(faces(b, [box(1, 1, 2)])))).toHaveLength(1)
  })

  it('ignores a box across a driving lane and a distant one', () => {
    const b = box(1, 1)
    const lane: PlacedBox = { ...box(2, 1), x: b.x + W + 6 }
    expect(faces(b, [lane, box(6, 1)]).sideP).toBe(true)
    expect(faces(b, [lane, box(6, 1)]).sideN).toBe(true)
  })
})

describe('exposed faces of other boxes', () => {
  it('counts every face of a vessel or vehicle box as visible', () => {
    const f = exposedFaces('free')
    expect(Object.values(f).every(Boolean)).toBe(true)
    expect(visibleFaceList(f)).toHaveLength(6)
  })
})

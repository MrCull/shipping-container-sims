/** V11-05: Labels declutter at distance: of any labels that would overlap on screen, only the highest-priority one stays. */
import { describe, expect, it } from 'vitest'
import { declutterLabels, type LabelBox } from '../modules/labelDeclutter'

const box = (id: string, x: number, y: number, w = 100, h = 20): LabelBox => ({ id, x, y, w, h })

describe('declutterLabels', () => {
  it('keeps everything when nothing overlaps', () => {
    expect([...declutterLabels([box('a', 0, 0), box('b', 200, 0), box('c', 0, 50)])].sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps the earlier (higher priority) label of an overlapping pair', () => {
    expect([...declutterLabels([box('a', 0, 0), box('b', 50, 5)])]).toEqual(['a'])
  })

  it('touching edges do not overlap', () => {
    expect([...declutterLabels([box('a', 0, 0), box('b', 100, 0)])].sort()).toEqual(['a', 'b'])
  })

  it('a hidden label does not hide others', () => {
    expect([...declutterLabels([box('a', 0, 0), box('b', 60, 0), box('c', 140, 0)])].sort()).toEqual(['a', 'c'])
  })

  it('leaves no two kept labels overlapping, whatever the input', () => {
    const boxes = Array.from({ length: 200 }, (_, i) => box(`l${i}`, (i * 37) % 400, (i * 53) % 200))
    const keep = declutterLabels(boxes)
    const kept = boxes.filter((b) => keep.has(b.id))
    expect(kept.length).toBeGreaterThan(0)
    for (const a of kept)
      for (const b of kept) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { LEVELS } from './levels'
import { arrowBox, layoutFor } from './presentation'
import { contains, overlaps, screenLayout } from './screenLayout'
import { boxAt, boxBounds, freeSlots, slotsFor, truckIn, yardGeometry } from './yardGeometry'

/** Play surfaces of a phone (with and without notch insets), a tablet and two desktops. */
const SURFACES = [
  screenLayout({ width: 390, height: 793 }).surface,
  screenLayout({ width: 390, height: 844 }, { top: 47, right: 0, bottom: 34, left: 0 }).surface,
  screenLayout({ width: 820, height: 1129 }).surface,
  screenLayout({ width: 1280, height: 669 }).surface,
  screenLayout({ width: 1920, height: 1029 }).surface,
]

describe('Yardshift 2D yard geometry', () => {
  for (const s of SURFACES) {
    describe(`surface ${s.w}x${s.h}`, () => {
      const vp = { width: s.w, height: s.h }

      it('every slot, also the top one lifted, is drawn inside its own column and below the crane beam', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp)
          const g = yardGeometry(layout, level.capacity)
          layout.columns.forEach((col, i) => {
            const slots = slotsFor(g, layout, i, level.capacity)
            for (const b of slots) expect(contains(col, boxBounds(b)), `level ${level.number} stack ${i}`).toBe(true)
            const lifted = boxAt(g, layout, i, level.capacity - 1, g.lift)
            expect(contains(col, boxBounds(lifted))).toBe(true)
            expect(boxBounds(lifted).y).toBeGreaterThan(g.gantry.beamY + g.gantry.beamH)
            for (let t = 1; t < slots.length; t++) expect(overlaps(slots[t]!, slots[t - 1]!)).toBe(false)
          })
        }
      })

      it('the gantry legs stand outside every column and inside the surface', () => {
        const layout = layoutFor(5, vp)
        const g = yardGeometry(layout, 3)
        const legs = [
          { x: g.gantry.left, y: g.gantry.beamY, w: g.gantry.legW, h: 10 },
          { x: g.gantry.right - g.gantry.legW, y: g.gantry.beamY, w: g.gantry.legW, h: 10 },
        ]
        for (const leg of legs) {
          expect(contains({ x: 0, y: 0, w: s.w, h: s.h }, leg)).toBe(true)
          for (const col of layout.columns) expect(overlaps(leg, col)).toBe(false)
        }
      })

      it('the backdrop sits above the floor, and the stacks start on the floor', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp)
          const g = yardGeometry(layout, level.capacity)
          expect(g.backdrop.y + g.backdrop.h).toBe(g.floor.y)
          expect(g.groundY).toBeGreaterThan(g.floor.y)
          expect(g.groundY).toBeLessThan(layout.yard.y + layout.yard.h)
        }
      })

      it('each truck is drawn inside its bay; the receipt arrow points at the cab, never at the cargo number', () => {
        const layout = layoutFor(5, vp)
        const g = yardGeometry(layout, 3)
        for (const bay of [layout.collection, layout.receipt]) {
          const t = truckIn(bay, g)
          for (const r of [t.bed, t.cab, boxBounds(t.cargo)]) expect(contains(bay, r)).toBe(true)
          expect(overlaps(t.bed, t.cab)).toBe(false)
          expect(t.cargo.w).toBeGreaterThan(10)
        }
        const t = truckIn(layout.receipt, g)
        const arrow = arrowBox(layout.receipt)
        expect(arrow.x + arrow.w / 2).toBeGreaterThan(t.cab.x)
        expect(arrow.x + arrow.w / 2).toBeLessThan(t.cab.x + t.cab.w)
        expect(overlaps(arrow, boxBounds(t.cargo))).toBe(false)
      })
    })
  }

  it('free slots count capacity times stacks less the containers', () => {
    expect(freeSlots(3, 5, 6)).toBe(9)
    expect(freeSlots(2, 4, 9)).toBe(0)
  })
})

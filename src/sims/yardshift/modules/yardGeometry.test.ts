import { describe, expect, it } from 'vitest'
import { LEVELS } from './levels'
import { arrowBox, layoutFor } from './presentation'
import { contains, overlaps, screenLayout } from './screenLayout'
import { ASPECT_MAX, ASPECT_MIN, BAY_STATUS_PX, BAY_TITLE_PX, boxAt, boxBounds, freeSlots, slotsFor, truckIn, yardGeometry } from './yardGeometry'

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
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          layout.columns.forEach((col, i) => {
            const slots = slotsFor(g, layout, i, level.capacity)
            for (const b of slots) expect(contains(col, boxBounds(b)), `level ${level.number} stack ${i}`).toBe(true)
            // Even the top slot stays on the concrete, below the backdrop band.
            expect(boxBounds(slots[slots.length - 1]!).y).toBeGreaterThanOrEqual(g.floor.y)
            const lifted = boxAt(g, layout, i, level.capacity - 1, g.lift)
            expect(contains(col, boxBounds(lifted))).toBe(true)
            expect(boxBounds(lifted).y).toBeGreaterThan(g.gantry.beamY + g.gantry.beamH)
            for (let t = 1; t < slots.length; t++) expect(overlaps(slots[t]!, slots[t - 1]!)).toBe(false)
          })
        }
      })

      it('full stacks fill the yard: no bare concrete above the top slot, the beam just above the crane headroom', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          const stacksH = level.capacity * g.boxH
          expect(stacksH / (g.groundY - g.floor.y), `level ${level.number}`).toBeGreaterThan(0.85)
          // A carried box clears a full stack, and the beam sits just above it (spreader room only).
          const fullTop = g.groundY - level.capacity * g.boxH
          expect(g.carryY + g.boxH).toBeLessThanOrEqual(fullTop)
          expect(g.carryY - g.dy - (g.gantry.beamY + g.gantry.beamH)).toBeLessThanOrEqual(10)
          // Boxes are sized from the column width first: on a phone they are as tall as the 1.8:1 shape allows.
          if (s.w < 600) expect(g.boxW / g.boxH, `level ${level.number}`).toBeLessThan(1.9)
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
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          expect(g.backdrop.y + g.backdrop.h).toBe(g.floor.y)
          expect(g.groundY).toBeGreaterThan(g.floor.y)
          expect(g.groundY).toBeLessThan(layout.yard.y + layout.yard.h)
          // The backdrop band holds the sky strip, the beam and the crane headroom.
          expect(g.backdrop.h).toBeGreaterThan(g.boxH)
          // Container shaped (art pass 3): a side-on box 1.8 to 2.4 times as long as tall, that fills its column unless
          // the room is short, when it narrows to keep its shape instead of flattening.
          const aspect = g.boxW / g.boxH
          expect(aspect, `level ${level.number}`).toBeGreaterThanOrEqual(ASPECT_MIN - 0.01)
          expect(aspect, `level ${level.number}`).toBeLessThanOrEqual(ASPECT_MAX + 0.01)
          if (aspect < ASPECT_MAX - 0.01) expect((g.boxW + g.dx) / layout.columns[0]!.w).toBeGreaterThan(0.85)
          expect(g.dy).toBeLessThan(g.boxH * 0.5)
        }
      })

      it('each truck is drawn inside its bay, cab ahead of the trailer; the receipt arrow points at the cab', () => {
        const layout = layoutFor(5, vp)
        const g = yardGeometry(layout, 3)
        for (const [bay, facing] of [
          [layout.collection, 'left'],
          [layout.receipt, 'right'],
        ] as const) {
          const t = truckIn(bay, g, facing)
          for (const r of [t.trailer, t.cab, boxBounds(t.cargo)]) expect(contains(bay, r)).toBe(true)
          // The truck fills most of the bay width and sits in the middle of the room between title and status.
          expect(t.cab.w + t.trailer.w).toBeGreaterThan(bay.w * (bay.w > 300 ? 0.45 : 0.8))
          const room = { top: bay.y + BAY_TITLE_PX, bottom: bay.y + bay.h - BAY_STATUS_PX }
          const truckTop = Math.min(t.cab.y, t.cargo.y - t.cargo.dy)
          expect(Math.abs(truckTop - room.top - (room.bottom - t.groundY))).toBeLessThanOrEqual(2)
          expect(overlaps(t.trailer, t.cab)).toBe(false)
          // The cab is at the end the truck faces.
          if (facing === 'left') expect(t.cab.x).toBeLessThan(t.trailer.x)
          else expect(t.cab.x).toBeGreaterThan(t.trailer.x)
          // Three axles, every wheel on the road and inside the bay; the cargo sits on the trailer, container shaped.
          expect(t.wheels).toHaveLength(3)
          for (const w of t.wheels) {
            expect(w.y + t.wheelR).toBeLessThanOrEqual(t.groundY + 0.01)
            expect(contains(bay, { x: w.x - t.wheelR, y: w.y - t.wheelR, w: 2 * t.wheelR, h: 2 * t.wheelR })).toBe(true)
          }
          expect(t.cargo.y + t.cargo.h).toBeCloseTo(t.trailer.y)
          expect(t.cargo.x).toBeGreaterThanOrEqual(t.trailer.x)
          expect(t.cargo.x + t.cargo.w + t.cargo.dx).toBeLessThanOrEqual(t.trailer.x + t.trailer.w)
          expect(t.cargo.w / t.cargo.h).toBeGreaterThanOrEqual(ASPECT_MIN - 0.01)
          expect(t.cargo.w).toBeGreaterThan(10)
        }
        const t = truckIn(layout.receipt, g, 'right')
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

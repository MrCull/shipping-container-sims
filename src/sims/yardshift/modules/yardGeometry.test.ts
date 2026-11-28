import { describe, expect, it } from 'vitest'
import { LEVELS } from './levels'
import { arrowBox, layoutFor } from './presentation'
import { contains, overlaps, screenLayout } from './screenLayout'
import {
  ASPECT_MAX,
  ASPECT_MIN,
  BAY_STATUS_PX,
  BAY_TITLE_PX,
  CAPTION_PX,
  boxAt,
  boxBounds,
  CHEVRON_BOUNCE,
  chevronAt,
  freeSlots,
  numberSize,
  slotsFor,
  truckIn,
  yardGeometry,
} from './yardGeometry'

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
            // Even the top slot stays on the concrete, below the road strip.
            expect(boxBounds(slots[slots.length - 1]!).y).toBeGreaterThanOrEqual(g.floor.y)
            const lifted = boxAt(g, layout, i, level.capacity - 1, g.lift)
            expect(contains(col, boxBounds(lifted))).toBe(true)
            expect(boxBounds(lifted).y).toBeGreaterThan(g.road.y + g.road.h)
            for (let t = 1; t < slots.length; t++) expect(overlaps(slots[t]!, slots[t - 1]!)).toBe(false)
          })
        }
      })

      it('the beam tops the road strip, the trucks sit above the yard and a carried box clears a full stack', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          const where = `level ${level.number}`
          // Owner round 5: the gantry beam spans the top, over the road strip with both truck bays; the yard is below.
          expect(g.gantry.beamY, where).toBeGreaterThanOrEqual(0)
          expect(g.gantry.beamY + g.gantry.beamH, where).toBeLessThanOrEqual(layout.collection.y)
          for (const bay of [layout.collection, layout.receipt]) expect(contains(g.road, bay), where).toBe(true)
          expect(g.road.y + g.road.h, where).toBeLessThanOrEqual(layout.yard.y)
          // A carried box clears a full stack.
          const fullTop = g.groundY - level.capacity * g.boxH
          expect(g.carryY + g.boxH).toBeLessThanOrEqual(fullTop)
          expect(g.carryY - g.dy - layout.yard.y, where).toBeGreaterThanOrEqual(8)
          // The crane lifts high, just under the road (captions and spreader room), so the lift up to a truck is short.
          expect(g.carryY - g.dy - layout.yard.y, where).toBeLessThanOrEqual(CAPTION_PX + 8 + 1)
          // At rest the spreader parks just under the trolley, above the road (no cables down through the bays).
          expect(g.parkY - 5, where).toBeGreaterThanOrEqual(g.gantry.beamY + g.gantry.beamH)
          expect(g.parkY - 1, where).toBeLessThanOrEqual(g.road.y)
          // The legs run from the beam down the full yard.
          expect(g.gantry.footY).toBeGreaterThanOrEqual(g.groundY)
          // Boxes are sized from the column width first: on a phone they are as tall as the 1.3:1 shape allows.
          if (s.w < 600) expect(g.boxW / g.boxH, where).toBeLessThan(1.35)
        }
      })

      it('the crane carries a box up to each truck: the cargo slots sit above the carry height, under the beam', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          for (const [bay, facing] of [
            [layout.collection, 'left'],
            [layout.receipt, 'right'],
          ] as const) {
            const cargo = truckIn(bay, g, facing).cargo
            expect(cargo.y + cargo.h, `level ${level.number}`).toBeLessThan(g.carryY)
            expect(cargo.y - cargo.dy).toBeGreaterThan(g.gantry.beamY + g.gantry.beamH)
            // Between the legs, so the trolley reaches it.
            expect(cargo.x).toBeGreaterThan(g.gantry.left + g.gantry.legW)
            expect(cargo.x + cargo.w + cargo.dx).toBeLessThan(g.gantry.right - g.gantry.legW)
          }
        }
      })

      it('the NEXT chevron sits over its stack, inside its column and under the beam, at every stack height', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          layout.columns.forEach((col, i) => {
            for (let height = 0; height <= level.capacity; height++) {
              const c = chevronAt(g, layout, i, height)
              const where = `level ${level.number} stack ${i} height ${height}`
              expect(contains(col, c), where).toBe(true)
              // Clear of the stack top even at the bottom of its bounce, and clear of the beam at the top of it.
              const stackTop = height > 0 ? boxBounds(boxAt(g, layout, i, height - 1)).y : g.groundY
              expect(c.y + c.h + CHEVRON_BOUNCE, where).toBeLessThanOrEqual(stackTop)
              expect(c.y - CHEVRON_BOUNCE, where).toBeGreaterThanOrEqual(layout.yard.y)
              expect(c.w, where).toBeGreaterThanOrEqual(12)
            }
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

      it('the road strip sits above the floor (no sky band), and the stacks start on the floor', () => {
        for (const level of LEVELS) {
          const layout = layoutFor(level.stacks.length, vp, level.capacity)
          const g = yardGeometry(layout, level.capacity)
          expect(g.road.y + g.road.h).toBeLessThanOrEqual(g.floor.y)
          expect(g.floor).toEqual(layout.yard)
          expect(g.groundY).toBeGreaterThan(g.floor.y)
          expect(g.groundY).toBeLessThan(layout.yard.y + layout.yard.h)
          // Chunky boxes (owner, art pass 3 of the 2D yard: the v1 look): 1.3 to 1.45 times as wide as tall, filling
          // the column unless the room is short, when they narrow to keep their shape instead of flattening.
          const aspect = g.boxW / g.boxH
          expect(ASPECT_MIN).toBe(1.3)
          expect(ASPECT_MAX).toBe(1.45)
          expect(aspect, `level ${level.number}`).toBeGreaterThanOrEqual(ASPECT_MIN - 0.01)
          expect(aspect, `level ${level.number}`).toBeLessThanOrEqual(ASPECT_MAX + 0.01)
          if (aspect < ASPECT_MAX - 0.01) expect((g.boxW + g.dx) / layout.columns[0]!.w).toBeGreaterThan(0.85)
          expect(g.dy).toBeLessThan(g.boxH * 0.5)
          // Big bold numbers: 55 to 60 % of the box height.
          const n = numberSize(boxAt(g, layout, 0, 0))
          expect(n / g.boxH, `level ${level.number}`).toBeGreaterThanOrEqual(0.55 - 1 / g.boxH)
          expect(n / g.boxH, `level ${level.number}`).toBeLessThanOrEqual(0.6 + 1 / g.boxH)
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

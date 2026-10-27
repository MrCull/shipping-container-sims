import { describe, expect, it } from 'vitest'
import { planSegment, positionAt, travelTime } from '../engine'

describe('kinematic profile', () => {
  it('long move: accelerate, cruise, decelerate', () => {
    // 4 s to reach 4 m/s (8 m), 84 m cruise at 4 m/s (21 s), 4 s to stop (8 m)
    expect(travelTime(100, { vMax: 4, accel: 1, decel: 1 })).toBeCloseTo(29, 9)
  })

  it('long move with asymmetric accel/decel', () => {
    // accel 2: 2 s / 4 m; decel 1: 4 s / 8 m; cruise 88 m / 4 = 22 s
    expect(travelTime(100, { vMax: 4, accel: 2, decel: 1 })).toBeCloseTo(28, 9)
  })

  it('short move: triangular profile never reaches vMax', () => {
    // peak 2 m/s after 2 s (2 m), then 2 s to stop (2 m)
    expect(travelTime(4, { vMax: 4, accel: 1, decel: 1 })).toBeCloseTo(4, 9)
    // asymmetric triangle: peak 4 m/s, 4 s accel + 2 s decel
    expect(travelTime(12, { vMax: 10, accel: 1, decel: 2 })).toBeCloseTo(6, 9)
  })

  it('exactly reaching vMax is the boundary between both cases', () => {
    expect(travelTime(16, { vMax: 4, accel: 1, decel: 1 })).toBeCloseTo(8, 9)
  })

  it('zero and negative distances', () => {
    expect(travelTime(0, { vMax: 4, accel: 1, decel: 1 })).toBe(0)
    expect(travelTime(-100, { vMax: 4, accel: 1, decel: 1 })).toBeCloseTo(29, 9)
  })

  it('a motion segment knows its end time and interpolates position', () => {
    const seg = planSegment('STS01', 'trolley', 10, 110, 50, { vMax: 4, accel: 1, decel: 1 })
    expect(seg.t0).toBe(50)
    expect(seg.t1).toBeCloseTo(79, 9)
    expect(positionAt(seg, 0)).toBe(10)
    expect(positionAt(seg, 54)).toBeCloseTo(18, 9) // end of accel phase: 8 m
    expect(positionAt(seg, 64.5)).toBeCloseTo(60, 9) // midpoint
    expect(positionAt(seg, 75)).toBeCloseTo(102, 9) // start of decel: 92 m
    expect(positionAt(seg, 1000)).toBe(110)
  })

  it('interpolates backwards moves and triangular profiles', () => {
    const seg = planSegment('STS01', 'hoist', 4, 0, 0, { vMax: 4, accel: 1, decel: 1 })
    expect(seg.t1).toBeCloseTo(4, 9)
    expect(positionAt(seg, 2)).toBeCloseTo(2, 9)
  })
})

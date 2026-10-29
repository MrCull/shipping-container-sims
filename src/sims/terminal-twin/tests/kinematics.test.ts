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

describe('segments with entry and exit speeds (V11-12 cornering)', () => {
  const p = { vMax: 4, accel: 1, decel: 1 }

  it('a run that enters at 2 m/s and leaves at 2 m/s skips the standing start and stop', () => {
    // 2 -> 4 m/s: 2 s / 6 m; 4 -> 2 m/s: 2 s / 6 m; 88 m cruise = 22 s
    const s = planSegment('X', 'x', 0, 100, 10, p, 2, 2)
    expect(s.t1 - s.t0).toBeCloseTo(26, 9)
    expect(s.v0).toBe(2)
    expect(s.v1).toBe(2)
    expect(positionAt(s, 10)).toBeCloseTo(0, 9)
    expect(positionAt(s, 12)).toBeCloseTo(6, 9)
    expect(positionAt(s, 36)).toBeCloseTo(100, 9)
    expect(positionAt(s, 34)).toBeCloseTo(94, 9)
  })

  it('a short run with a triangular profile still ends at its target at the exit speed', () => {
    const s = planSegment('X', 'x', 0, 9, 0, p, 1, 3)
    // peak: v^2 = (2*9 + 1 + 9) / 2 = 14
    expect(s.vPeak).toBeCloseTo(Math.sqrt(14), 9)
    expect(positionAt(s, s.t1 - 1e-6)).toBeCloseTo(9, 4)
    expect(positionAt(s, s.t1)).toBe(9)
  })

  it('defaults to rest-to-rest', () => {
    expect(planSegment('X', 'x', 0, 100, 0, p).t1).toBeCloseTo(travelTime(100, p), 9)
  })
})

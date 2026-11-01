import { describe, expect, it } from 'vitest'
import { CASTING_SPACING_M, spreaderLengthM, spreaderLengthRatio, spreaderModeFor } from '../modules/spreaderMode'
import { shcSpawnYaw } from '../modules/shcSpawn'

describe('spreaderModeFor (#142)', () => {
  it('uses the short spreader for a single 20 ft box', () => {
    expect(spreaderModeFor({ count: 1, size: '20' }, { canTwin: true })).toBe('20')
  })
  it('uses the long spreader for 40, 40HC and 45 ft boxes', () => {
    for (const size of ['40', '40HC', '45']) expect(spreaderModeFor({ count: 1, size }, { canTwin: true })).toBe('40')
  })
  it('uses twin-20 for two boxes only where the machine can carry two', () => {
    expect(spreaderModeFor({ count: 2, size: '20' }, { canTwin: true })).toBe('twin-20')
    expect(spreaderModeFor({ count: 2, size: '20' }, { canTwin: false })).toBe('20')
  })
  it('keeps the previous mode when empty, 40 by default', () => {
    expect(spreaderModeFor(undefined, { canTwin: false })).toBe('40')
    expect(spreaderModeFor(undefined, { canTwin: false, previous: '20' })).toBe('20')
    expect(spreaderModeFor({ count: 0, size: '20' }, { canTwin: true, previous: 'twin-20' })).toBe('twin-20')
  })
  it('gives a short lock pattern for 20 and a long one for 40 and twin-20', () => {
    expect(spreaderLengthM('20')).toBe(CASTING_SPACING_M.short)
    expect(spreaderLengthM('40')).toBe(CASTING_SPACING_M.long)
    expect(spreaderLengthM('twin-20')).toBe(CASTING_SPACING_M.long)
    expect(spreaderLengthRatio('40')).toBe(1)
    expect(spreaderLengthRatio('20')).toBeCloseTo(0.488, 3)
  })
})

describe('shcSpawnYaw (#142)', () => {
  it('faces the direction of the first leg', () => {
    expect(shcSpawnYaw({ axis: 'x', from: 0, to: 10 })).toBe(0)
    expect(shcSpawnYaw({ axis: 'x', from: 10, to: 0 })).toBeCloseTo(Math.PI)
    expect(shcSpawnYaw({ axis: 'z', from: 54, to: 40 })).toBeCloseTo(Math.PI / 2)
    expect(shcSpawnYaw({ axis: 'z', from: 40, to: 54 })).toBeCloseTo(-Math.PI / 2)
  })
  it('faces east along the parking row before any leg', () => {
    expect(shcSpawnYaw(null)).toBe(0)
  })
})

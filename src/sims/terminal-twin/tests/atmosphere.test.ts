import { describe, expect, it } from 'vitest'
import { ambientIntensity, daylightLockDefault, hourOfDay, lightingFor } from '../modules/atmosphere'

describe('night stays readable (V11-03)', () => {
  it('keeps a night ambient level at least as strong as the day one', () => {
    expect(ambientIntensity(lightingFor(0, false).daylight)).toBeGreaterThanOrEqual(ambientIntensity(lightingFor(13, false).daylight))
    expect(ambientIntensity(0)).toBeGreaterThanOrEqual(1.4)
  })
})

describe('lighting follows the sim clock', () => {
  it('is bright at noon and dark at midnight', () => {
    const noon = lightingFor(13, false)
    const midnight = lightingFor(0, false)
    expect(noon.mode).toBe('day')
    expect(noon.shadows).toBe(true)
    expect(noon.floodGlow).toBeLessThan(0.05)
    expect(midnight.mode).toBe('night')
    expect(midnight.daylight).toBe(0)
    expect(midnight.shadows).toBe(false)
    expect(midnight.floodGlow).toBe(1)
  })

  it('shows a full 24 h cycle with night, day and twilight', () => {
    const modes = Array.from({ length: 24 }, (_, h) => lightingFor(h, false).mode)
    expect(modes[2]).toBe('night')
    expect(modes[13]).toBe('day')
    expect(modes[23]).toBe('night')
    expect(modes).toContain('dusk')
  })

  it('moves the sun east to west', () => {
    expect(lightingFor(8, false).sun.x).toBeGreaterThan(lightingFor(16, false).sun.x)
  })

  it('holds daylight all day when locked', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const l = lightingFor(h, true)
      expect(l.mode).toBe('day')
      expect(l.daylight).toBe(1)
      expect(l.shadows).toBe(true)
      expect(l.floodGlow).toBe(0)
    }
  })

  it('reads the local hour from the start time and sim seconds', () => {
    const start = new Date(2026, 0, 5, 6, 0, 0).toISOString()
    expect(hourOfDay(start, 3600)).toBeCloseTo(7, 5)
    expect(hourOfDay(start, 20 * 3600)).toBeCloseTo(2, 5)
  })

  it('locks daylight by default only for the Stress test preset', () => {
    expect(daylightLockDefault('Stress test')).toBe(true)
    expect(daylightLockDefault('TTI Algeciras baseline')).toBe(false)
    expect(daylightLockDefault('Small automated')).toBe(false)
  })
})

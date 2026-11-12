import { describe, expect, it } from 'vitest'
import { EnvironmentCache, environmentIntensity, skyColours } from '../modules/skyEnvironment'
import { QUALITY_PROFILES } from '../modules/quality'
import { contactFactor, CONTACT_HEIGHT_M, setContactShadows, contactShadowUniform } from '../modules/contactShadow'

describe('contact shadow ramp (#248)', () => {
  it('is darkest at the joint, clear above it, and off at strength 0', () => {
    expect(contactFactor(0)).toBeCloseTo(0.5, 5)
    expect(contactFactor(CONTACT_HEIGHT_M / 2)).toBeGreaterThan(contactFactor(0))
    expect(contactFactor(CONTACT_HEIGHT_M / 2)).toBeLessThan(1)
    expect(contactFactor(CONTACT_HEIGHT_M)).toBe(1)
    expect(contactFactor(5)).toBe(1)
    expect(contactFactor(0, 0)).toBe(1)
    setContactShadows(false)
    expect(contactShadowUniform.value).toBe(0)
    setContactShadows(true)
    expect(contactShadowUniform.value).toBeGreaterThan(0)
  })
})

describe('sky environment (#248)', () => {
  it('has a different sky for day, dusk and night, brightest by day', () => {
    const lum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b
    const day = skyColours('day')
    const dusk = skyColours('dusk')
    const night = skyColours('night')
    expect(lum(day.zenith)).toBeGreaterThan(lum(dusk.zenith))
    expect(lum(dusk.zenith)).toBeGreaterThan(lum(night.zenith))
    expect(dusk.horizon.r).toBeGreaterThan(dusk.horizon.b) // warm horizon at dusk
  })

  it('reflection strength falls with daylight and never goes negative', () => {
    expect(environmentIntensity(1)).toBeGreaterThan(environmentIntensity(0.5))
    expect(environmentIntensity(0.5)).toBeGreaterThan(environmentIntensity(0))
    expect(environmentIntensity(0)).toBeGreaterThan(0)
  })

  it('builds once per lighting mode, not per request', () => {
    let made = 0
    const cache = new EnvironmentCache<number>(() => ++made)
    const a = cache.get('day')
    for (let i = 0; i < 1000; i++) expect(cache.get('day')).toBe(a)
    cache.get('night')
    cache.get('day')
    cache.get('night')
    expect(cache.builds).toBe(2)
    expect(made).toBe(2)
  })

  it('Low draws neither reflections nor contact shadows; Medium and High draw both', () => {
    expect(QUALITY_PROFILES.low.environmentReflections).toBe(false)
    expect(QUALITY_PROFILES.low.contactShadows).toBe(false)
    for (const l of ['medium', 'high'] as const) {
      expect(QUALITY_PROFILES[l].environmentReflections).toBe(true)
      expect(QUALITY_PROFILES[l].contactShadows).toBe(true)
    }
  })
})

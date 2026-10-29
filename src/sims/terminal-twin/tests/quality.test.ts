import { describe, expect, it } from 'vitest'
import { AutoQuality, AUTO_DOWN_FPS, QUALITY_LEVELS, QUALITY_PROFILES, FpsMeter, profileFor } from '../modules/quality'

/** Feeds `seconds` of frames at a steady `fps`, returns the level after. */
function feed(auto: AutoQuality, startMs: number, seconds: number, fps: number): number {
  const dt = 1000 / fps
  let t = startMs
  const end = startMs + seconds * 1000
  while (t < end) {
    t += dt
    auto.frame(t)
  }
  return t
}

describe('quality profiles', () => {
  it('get cheaper from high to low on every axis', () => {
    const [low, med, high] = QUALITY_LEVELS.map((l) => QUALITY_PROFILES[l])
    expect(low.shadows).toBe(false)
    expect(high.shadows).toBe(true)
    expect(low.shadowMapSize).toBeLessThanOrEqual(med.shadowMapSize)
    expect(med.shadowMapSize).toBeLessThanOrEqual(high.shadowMapSize)
    expect(low.lod0DistanceM).toBeLessThan(med.lod0DistanceM)
    expect(med.lod0DistanceM).toBeLessThan(high.lod0DistanceM)
    expect(low.lodScale).toBeLessThan(med.lodScale)
    expect(med.lodScale).toBeLessThan(high.lodScale)
    expect(low.lod0Cap).toBeLessThan(high.lod0Cap)
    expect(low.resolutionScale).toBeLessThan(high.resolutionScale)
    expect(low.oceanSegments).toBeLessThan(high.oceanSegments)
    expect(low.nightLights).toBeLessThan(high.nightLights)
  })

  it('a fixed setting maps to its profile and auto starts at high', () => {
    expect(profileFor('low')).toBe(QUALITY_PROFILES.low)
    expect(new AutoQuality().level).toBe('high')
  })
})

describe('FpsMeter', () => {
  it('reports the frame rate over the last second', () => {
    const m = new FpsMeter()
    let t = 0
    for (let i = 0; i < 120; i++) m.frame((t += 1000 / 60))
    expect(m.fps).toBeGreaterThan(58)
    expect(m.fps).toBeLessThan(62)
    for (let i = 0; i < 40; i++) m.frame((t += 1000 / 20))
    expect(m.fps).toBeGreaterThan(18)
    expect(m.fps).toBeLessThan(22)
  })
})

describe('AutoQuality', () => {
  it('holds quality at a steady 60 fps', () => {
    const auto = new AutoQuality()
    feed(auto, 0, 60, 60)
    expect(auto.level).toBe('high')
  })

  it('steps down when fps stays under 45, one level per sustained window', () => {
    const auto = new AutoQuality()
    let t = feed(auto, 0, 1, 60)
    t = feed(auto, t, 1, 30) // a short dip does not step down
    expect(auto.level).toBe('high')
    t = feed(auto, t, 4, 30)
    expect(auto.level).toBe('medium')
    t = feed(auto, t, 6, 30)
    expect(auto.level).toBe('low')
    feed(auto, t, 20, 30)
    expect(auto.level).toBe('low') // floor
  })

  it('a single long frame (tab switch, GC) does not step down', () => {
    const auto = new AutoQuality()
    let t = feed(auto, 0, 5, 60)
    t += 3000
    auto.frame(t)
    feed(auto, t, 3, 60)
    expect(auto.level).toBe('high')
  })

  it('steps back up with headroom, never straight after a step down', () => {
    const auto = new AutoQuality()
    let t = feed(auto, 0, 6, 30)
    expect(auto.level).not.toBe('high')
    const down = auto.level
    t = feed(auto, t, 3, 60)
    expect(auto.level).toBe(down) // cooldown
    t = feed(auto, t, 15, 60)
    expect(auto.level).toBe('high')
    expect(t).toBeGreaterThan(0)
  })

  it('backs off after a step up that did not hold, so it does not oscillate', () => {
    const auto = new AutoQuality()
    let t = 0
    const levels: string[] = []
    // load that is fine at low/medium but too heavy at high: 70 fps below high, 30 fps at high
    for (let i = 0; i < 600; i++) {
      t = feed(auto, t, 1, auto.level === 'high' ? 30 : 70)
      levels.push(auto.level)
    }
    const changes = levels.filter((l, i) => i > 0 && l !== levels[i - 1]).length
    expect(changes).toBeLessThan(14)
    expect(AUTO_DOWN_FPS).toBe(45)
  })

  it('reports each change to a listener', () => {
    const seen: string[] = []
    const auto = new AutoQuality((l) => seen.push(l))
    feed(auto, 0, 6, 20)
    expect(seen[0]).toBe('medium')
  })
})

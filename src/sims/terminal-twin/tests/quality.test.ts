import { describe, expect, it } from 'vitest'
import { AutoQuality, AUTO_DOWN_FPS, AUTO_RUNGS, BOTTOM_RUNG, MANUAL_RUNG, QUALITY_LEVELS, QUALITY_PROFILES, FpsMeter, levelOfRung, markStepForRung, profileFor, profileForRung, rungName } from '../modules/quality'

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

  it('every level draws close-up markings (#158: Auto settles on Low on a laptop), Low the shortest and cheapest', () => {
    const [low, med, high] = QUALITY_LEVELS.map((l) => QUALITY_PROFILES[l])
    for (const p of [low, med, high]) {
      expect(p.closeupFaceBudget).toBeGreaterThan(0)
      expect(p.closeupDistanceM).toBeGreaterThan(0)
    }
    // the orbit camera stops 8 m from its target, so a box beside the target is about 10 to 15 m away
    expect(low.closeupDistanceM).toBeGreaterThanOrEqual(15)
    expect(low.closeupDistanceM).toBeLessThan(med.closeupDistanceM)
    expect(med.closeupDistanceM).toBeLessThan(high.closeupDistanceM)
    expect(low.closeupFaceBudget).toBeLessThan(med.closeupFaceBudget)
    expect(med.closeupFaceBudget).toBeLessThan(high.closeupFaceBudget)
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

describe('the shedding ladder (pure)', () => {
  it('sheds in the listed order: hero cap, hero marks, hero off, shadows and resolution, Medium, Low', () => {
    expect(AUTO_RUNGS.map((r) => r.name)).toEqual(['hero-full', 'hero-half', 'hero-quarter', 'hero-marks-standard', 'hero-off', 'shadows-resolution', 'medium', 'low'])
  })

  it('hero cap falls full, half, quarter, none, and never returns lower down the ladder', () => {
    const caps = AUTO_RUNGS.map((_, i) => profileForRung(i).heroBoxes)
    expect(caps[0]).toBe(QUALITY_PROFILES.high.heroBoxes)
    expect(caps[1]).toBe(caps[0] / 2)
    expect(caps[2]).toBe(caps[0] / 4)
    expect(caps[4]).toBe(0)
    for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeLessThanOrEqual(caps[i - 1])
  })

  it('hero marking resolution drops after the cap has shrunk, then stays standard', () => {
    expect(AUTO_RUNGS.map((_, i) => markStepForRung(i))).toEqual(['sharp', 'sharp', 'sharp', 'standard', 'standard', 'standard', 'standard', 'standard'])
  })

  it('shadows and resolution drop only after the hero rungs, and never rise down the ladder', () => {
    const p = AUTO_RUNGS.map((_, i) => profileForRung(i))
    for (let i = 0; i <= 4; i++) {
      expect(p[i].shadowMapSize).toBe(QUALITY_PROFILES.high.shadowMapSize)
      expect(p[i].resolutionScale).toBe(1)
    }
    expect(p[5].shadowMapSize).toBeLessThan(p[4].shadowMapSize)
    expect(p[5].resolutionScale).toBeLessThan(p[4].resolutionScale)
    for (let i = 1; i < p.length; i++) {
      expect(p[i].shadowMapSize).toBeLessThanOrEqual(p[i - 1].shadowMapSize)
      expect(p[i].resolutionScale).toBeLessThanOrEqual(p[i - 1].resolutionScale)
      expect(p[i].lod0DistanceM).toBeLessThanOrEqual(p[i - 1].lod0DistanceM)
    }
    expect(profileForRung(6)).toEqual({ ...QUALITY_PROFILES.medium, heroBoxes: 0 })
    expect(profileForRung(7)).toEqual(QUALITY_PROFILES.low)
  })

  it('manual levels fix the ladder at their rung', () => {
    expect(MANUAL_RUNG).toEqual({ high: 0, medium: 6, low: 7 })
    expect(profileForRung(MANUAL_RUNG.high)).toEqual(QUALITY_PROFILES.high)
    expect(levelOfRung(MANUAL_RUNG.medium)).toBe('medium')
    expect(levelOfRung(MANUAL_RUNG.low)).toBe('low')
  })

  it('is a pure function of the rung, clamped at both ends', () => {
    expect(profileForRung(-3)).toEqual(profileForRung(0))
    expect(profileForRung(99)).toEqual(profileForRung(BOTTOM_RUNG))
    expect(rungName(2)).toBe('hero-quarter')
  })
})

describe('AutoQuality', () => {
  it('holds the top rung at a steady 60 fps', () => {
    const auto = new AutoQuality()
    feed(auto, 0, 60, 60)
    expect(auto.rung).toBe(0)
  })

  it('steps down the ladder one rung per sustained slow window run, in order, to the floor', () => {
    const seen: number[] = []
    const auto = new AutoQuality((r) => seen.push(r))
    let t = feed(auto, 0, 1, 60)
    t = feed(auto, t, 1, 30) // a short dip does not step down
    expect(auto.rung).toBe(0)
    t = feed(auto, t, 80, 30)
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(auto.rung).toBe(BOTTOM_RUNG)
    feed(auto, t, 20, 30)
    expect(auto.rung).toBe(BOTTOM_RUNG) // floor
  })

  it('a good average with a high share of slow frames still steps down', () => {
    const auto = new AutoQuality()
    // one frame in six takes 80 ms, the rest 8 ms: median 8 ms (125 fps), average about 17 ms (58 fps)
    let t = 0
    auto.frame(t)
    for (let i = 0; i < 400; i++) {
      t += i % 6 === 5 ? 80 : 8
      auto.frame(t)
    }
    expect(auto.lastWindow.medianMs).toBeLessThan(10)
    expect(auto.lastWindow.slowShare).toBeGreaterThan(0.1)
    expect(auto.rung).toBeGreaterThan(0)
  })

  it('a few slow frames among good ones do not step down', () => {
    const auto = new AutoQuality()
    let t = 0
    auto.frame(t)
    for (let i = 0; i < 2000; i++) {
      t += i % 50 === 49 ? 60 : 12 // 2 % slow
      auto.frame(t)
    }
    expect(auto.rung).toBe(0)
  })

  it('judges by the median, not by one stall: a window of mostly 16 ms frames holds', () => {
    const auto = new AutoQuality()
    let t = 0
    auto.frame(t)
    for (let i = 0; i < 1500; i++) {
      t += i % 100 === 99 ? 400 : 14 // one 400 ms stall per 100 frames: 1 % slow, median 14 ms
      auto.frame(t)
    }
    expect(auto.rung).toBe(0)
  })

  it('a single long frame (tab switch, GC) does not step down', () => {
    const auto = new AutoQuality()
    let t = feed(auto, 0, 5, 60)
    t += 3000
    auto.frame(t)
    feed(auto, t, 3, 60)
    expect(auto.rung).toBe(0)
  })

  it('steps back up in reverse order with headroom, never straight after a step down', () => {
    const seen: number[] = []
    const auto = new AutoQuality((r) => seen.push(r))
    let t = feed(auto, 0, 14, 30)
    expect(auto.rung).toBe(3)
    t = feed(auto, t, 3, 60)
    expect(auto.rung).toBe(3) // cooldown
    t = feed(auto, t, 200, 60)
    expect(auto.rung).toBe(0)
    expect(seen).toEqual([1, 2, 3, 2, 1, 0])
    expect(t).toBeGreaterThan(0)
  })

  it('backs off after a step up that did not hold, so it does not oscillate', () => {
    const auto = new AutoQuality()
    let t = 0
    const rungs: number[] = []
    // load that is fine below rung 3 and too heavy at rung 2 and above: 70 fps at 3 or more, 30 fps at 0 to 2
    for (let i = 0; i < 600; i++) {
      t = feed(auto, t, 1, auto.rung <= 2 ? 30 : 70)
      rungs.push(auto.rung)
    }
    const changes = rungs.filter((r, i) => i > 0 && r !== rungs[i - 1]).length
    expect(changes).toBeLessThan(20) // without the back-off: about 100
    expect(AUTO_DOWN_FPS).toBe(45)
  })

  it('the wait before the next step up doubles after an undone step up', () => {
    const auto = new AutoQuality()
    let t = feed(auto, 0, 5, 30) // 0 -> 1
    expect(auto.rung).toBe(1)
    const upStart = t
    while (auto.rung === 1 && t - upStart < 60_000) t = feed(auto, t, 1, 70)
    expect(auto.rung).toBe(0)
    const firstWait = t - upStart
    t = feed(auto, t, 5, 30) // undone within 30 s: 0 -> 1 again
    expect(auto.rung).toBe(1)
    const secondStart = t
    while (auto.rung === 1 && t - secondStart < 120_000) t = feed(auto, t, 1, 70)
    expect(auto.rung).toBe(0)
    expect(t - secondStart).toBeGreaterThanOrEqual(firstWait * 1.8)
  })

  it('retunes the median threshold from fps for slow renderers', () => {
    const auto = new AutoQuality()
    auto.setFpsThresholds(12, 15)
    feed(auto, 0, 10, 20) // 20 fps is fine against 12
    expect(auto.rung).toBe(0)
    feed(auto, 20_000, 10, 6)
    expect(auto.rung).toBeGreaterThan(0)
    auto.setFpsThresholds(null, null)
    expect(auto.downMedianMs).toBeCloseTo(1000 / AUTO_DOWN_FPS)
  })

  it('reports each change to a listener, and reset restarts from a rung', () => {
    const seen: number[] = []
    const auto = new AutoQuality((r) => seen.push(r))
    feed(auto, 0, 6, 20)
    expect(seen[0]).toBe(1)
    auto.reset(5)
    expect(auto.rung).toBe(5)
    expect(auto.level).toBe('high')
  })
})

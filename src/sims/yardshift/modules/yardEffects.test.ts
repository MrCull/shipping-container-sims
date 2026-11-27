import { describe, expect, it } from 'vitest'
import { FOCUS_BASE_RISK } from './presentation'
import { burst, collectMotion, FX_MS, fxProgress, liveFx, rejectX, squash, urgencyStyle, vibrateX, VIBRATE_HZ, type Fx } from './yardEffects'

describe('Yardshift yard effects (render only, deterministic)', () => {
  it('vibration is a tight sideways buzz: 1 to 2 px at about 27 Hz, none at zero risk', () => {
    expect(vibrateX(0, 123, 1)).toBe(0)
    expect(VIBRATE_HZ).toBeGreaterThanOrEqual(25)
    expect(VIBRATE_HZ).toBeLessThanOrEqual(30)
    for (const risk of [0.1, 0.5, 1]) {
      let max = 0
      let crossings = 0
      let prev = vibrateX(risk, 0, 3)
      for (let ms = 0.25; ms <= 1000; ms += 0.25) {
        const x = vibrateX(risk, ms, 3)
        max = Math.max(max, Math.abs(x))
        if (Math.sign(x) !== Math.sign(prev)) crossings++
        prev = x
      }
      expect(max).toBeGreaterThanOrEqual(1)
      expect(max).toBeLessThanOrEqual(2.001)
      // Two zero crossings per cycle.
      expect(crossings / 2).toBeCloseTo(VIBRATE_HZ, -1)
    }
    // Same time, same offset.
    expect(vibrateX(0.7, 456.5, 2)).toBe(vibrateX(0.7, 456.5, 2))
  })

  it('urgency: calm current glows, low truck clock vibrates red, last seconds vibrate all, reduced motion is static', () => {
    expect(urgencyStyle({ shake: FOCUS_BASE_RISK, urgent: false }, true, false)).toEqual({ vibrate: 0, red: false, glow: true })
    expect(urgencyStyle({ shake: 0.6, urgent: false }, true, false)).toEqual({ vibrate: 0.6, red: true, glow: false })
    expect(urgencyStyle({ shake: 0.4, urgent: false }, false, false)).toEqual({ vibrate: 0.4, red: false, glow: false })
    expect(urgencyStyle({ shake: 0, urgent: false }, false, false)).toEqual({ vibrate: 0, red: false, glow: false })
    expect(urgencyStyle({ shake: 0, urgent: true }, true, true)).toEqual({ vibrate: 0, red: true, glow: false })
    expect(urgencyStyle({ shake: 0, urgent: false }, true, true).vibrate).toBe(0)
  })

  it('squash, reject shake and the truck motion start and end at rest', () => {
    for (const t of [0, 1]) {
      expect(squash(t)).toEqual({ sx: 1, sy: 1 })
      expect(rejectX(t)).toBe(0)
      expect(collectMotion(t, 200)).toEqual({ x: 0, y: 0, carrying: false })
    }
    expect(squash(0.2).sy).toBeLessThan(1)
    expect(squash(0.2).sx).toBeGreaterThan(1)
    expect(Math.max(...[0.05, 0.1, 0.15].map((t) => Math.abs(rejectX(t))))).toBeGreaterThan(1)
    // Off to the left carrying the box, back in empty.
    expect(collectMotion(0.45, 200).x).toBeLessThan(-100)
    expect(collectMotion(0.45, 200).carrying).toBe(true)
    expect(collectMotion(0.8, 200).carrying).toBe(false)
    expect(collectMotion(0.8, 200).x).toBeGreaterThan(0)
  })

  it('the bonus burst is deterministic and gone at the end; effects expire after their duration', () => {
    expect(burst(0.3)).toEqual(burst(0.3))
    expect(burst(0.3).length).toBeGreaterThan(8)
    expect(burst(1)).toEqual([])
    const list: Fx[] = [
      { kind: 'bonus', at: 0 },
      { kind: 'reject', at: 0, target: { kind: 'stack', index: 1 } },
    ]
    expect(liveFx(list, FX_MS.reject + 1)).toEqual([list[0]])
    expect(liveFx(list, FX_MS.bonus + 1)).toEqual([])
    expect(fxProgress(list[0]!, FX_MS.bonus / 2)).toBeCloseTo(0.5)
  })
})

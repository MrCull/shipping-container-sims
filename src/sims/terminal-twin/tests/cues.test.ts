import { describe, expect, it } from 'vitest'
import { CuePlanner, SoundThrottle } from '../modules/cues'
import type { EventType } from '../engine'
import type { EventSummary } from '../worker/protocol'

let nextId = 1
function ev(type: EventType, t: number, vessel?: string): EventSummary {
  return { id: nextId++, seq: 0, t, type, causedBy: null, subjects: vessel ? { vessels: [vessel] } : {} }
}

describe('cues', () => {
  it('releases cues only when the display clock reaches them', () => {
    const p = new CuePlanner()
    p.ingest([ev('StsGrounded', 148), ev('VesselDeparted', 203, 'V1')])
    expect(p.drain(50, 1)).toEqual([])
    expect(p.drain(150, 1).map((c) => c.kind)).toEqual(['landed'])
    const [dep] = p.drain(205, 1)
    expect(dep).toMatchObject({ kind: 'horn', banner: 'departure', vesselId: 'V1' })
  })

  it('maps arrival, departure and the end of the scenario', () => {
    const p = new CuePlanner((id) => id === 'BIG')
    p.ingest([ev('VesselArrived', 1, 'BIG'), ev('VesselArrived', 2, 'S'), ev('StsLoaded', 3), ev('ScenarioEnded', 4), ev('StsPicked', 5)])
    const cues = p.drain(4, 1)
    expect(cues.map((c) => [c.kind, c.large])).toEqual([
      ['horn', true],
      ['horn', false],
      ['landed', undefined],
      ['complete', undefined],
    ])
    expect(cues[3].banner).toBe('complete')
  })

  it('drops long-past cues after a jump but keeps the completion', () => {
    const p = new CuePlanner()
    p.ingest([ev('StsGrounded', 10), ev('ScenarioEnded', 20)])
    expect(p.drain(5000, 10).map((c) => c.kind)).toEqual(['complete'])
  })

  it('does not release one event twice', () => {
    const p = new CuePlanner()
    const e = ev('StsGrounded', 1)
    p.ingest([e])
    p.ingest([e])
    expect(p.drain(2, 1)).toHaveLength(1)
  })
})

describe('sound throttle', () => {
  it('plays every landing at x1 but only a few per minute at x600', () => {
    const count = (speed: number): number => {
      const th = new SoundThrottle()
      let played = 0
      // one landing every 40 sim s, for one real minute (60 fps frames)
      const simPerFrame = speed / 60
      let nextLanding = 0
      for (let frame = 0; frame < 3600; frame++) {
        const simT = frame * simPerFrame
        while (nextLanding <= simT) {
          if (th.allow('landed', speed, (frame * 1000) / 60)) played++
          nextLanding += 40
        }
      }
      return played
    }
    expect(count(1)).toBe(2) // 60 sim s: landings at 0 and 40
    expect(count(600)).toBeLessThanOrEqual(25)
    expect(count(600)).toBeGreaterThan(0)
  })

  it('limits horns at high speed', () => {
    const th = new SoundThrottle()
    expect(th.allow('horn', 600, 0)).toBe(true)
    expect(th.allow('horn', 600, 5000)).toBe(false)
    expect(th.allow('horn', 600, 13000)).toBe(true)
  })
})

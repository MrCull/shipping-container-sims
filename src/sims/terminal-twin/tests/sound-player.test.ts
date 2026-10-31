import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundPlayer } from '../modules/soundPlayer'
import type { Cue } from '../modules/cues'

class FakeAudio {
  static created: FakeAudio[] = []
  volume = 1
  constructor(public src: string) {
    FakeAudio.created.push(this)
  }
  play(): Promise<void> {
    return Promise.resolve()
  }
  pause(): void {}
}

const landed: Cue = { kind: 'landed', t: 10 } as Cue

describe('SoundPlayer master gain', () => {
  beforeEach(() => {
    FakeAudio.created = []
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('scales playback level by the master gain', () => {
    const quiet = new SoundPlayer(() => 0.2)
    const loud = new SoundPlayer(() => 1)
    expect(quiet.play(landed, 1, 0)).toBe(true)
    expect(loud.play(landed, 1, 0)).toBe(true)
    const [q, l] = FakeAudio.created
    expect(l.volume).toBeCloseTo(0.35)
    expect(q.volume).toBeCloseTo(0.07)
  })

  it('plays nothing at gain 0: no audio is created and nothing is counted', () => {
    const player = new SoundPlayer(() => 0)
    expect(player.play(landed, 1, 0)).toBe(false)
    expect(FakeAudio.created).toHaveLength(0)
    expect(player.stats().played).toBe(0)
  })

  it('a sound that was silenced does not use up the throttle', () => {
    let gain = 0
    const player = new SoundPlayer(() => gain)
    player.play(landed, 1, 0)
    gain = 1
    expect(player.play(landed, 1, 1)).toBe(true)
  })

  it('changing the gain retunes a sound that is still playing', () => {
    let gain = 1
    const player = new SoundPlayer(() => gain)
    player.play(landed, 1, 0)
    gain = 0.5
    player.applyGain()
    expect(FakeAudio.created[0].volume).toBeCloseTo(0.175)
  })
})

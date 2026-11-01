import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { followMasterGain, useAudioStore } from './audio'

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
  })
  return data
}

const KEY = 'shipping-container-sims'
const fresh = () => {
  setActivePinia(createPinia())
  return useAudioStore()
}

describe('shared audio store: volume and mute', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to unmuted at 40%', () => {
    stubStorage()
    const audio = fresh()
    expect(audio.soundMuted).toBe(false)
    expect(audio.volume).toBe(0.4)
    expect(audio.masterGain).toBe(0.4)
  })

  it('the master gain is 0 while muted, and the volume is kept', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(0.7)
    audio.setSoundMuted(true)
    expect(audio.masterGain).toBe(0)
    expect(audio.volume).toBe(0.7)
    audio.setSoundMuted(false)
    expect(audio.masterGain).toBe(0.7)
  })

  it('clamps the volume to 0..1', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(3)
    expect(audio.volume).toBe(1)
    audio.setVolume(-1)
    expect(audio.volume).toBe(0)
    audio.setVolume(Number.NaN)
    expect(audio.volume).toBe(0)
  })

  it('volume and mute survive a reload (a new store reads what was persisted)', () => {
    stubStorage()
    const a = fresh()
    a.setVolume(0.15)
    a.setSoundMuted(true)
    const b = fresh()
    expect(b.volume).toBe(0.15)
    expect(b.soundMuted).toBe(true)
  })

  it('honours a mute persisted by another sim, and ignores a bad stored volume', () => {
    stubStorage({ [KEY]: JSON.stringify({ version: 1, global: { soundMuted: true, godModeEnabled: false, volume: 'loud' }, sims: {} }) })
    const audio = fresh()
    expect(audio.soundMuted).toBe(true)
    expect(audio.volume).toBe(0.4)
  })

  it('any slider movement unmutes and sets the level', () => {
    stubStorage()
    const audio = fresh()
    audio.setSoundMuted(true)
    audio.moveVolumeSlider(0.3)
    expect(audio.soundMuted).toBe(false)
    expect(audio.volume).toBeCloseTo(0.3)
    expect(audio.masterGain).toBeCloseTo(0.3)
    audio.setSoundMuted(true)
    audio.moveVolumeSlider(0)
    expect(audio.soundMuted).toBe(false)
    expect(audio.volume).toBe(0)
  })
})

describe('master gain applied to a sound: per-sound gain times the master volume', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('scales a per-sound gain by the volume, and gives 0 while muted or at volume 0', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(0.5)
    expect(audio.gainFor(0.8)).toBeCloseTo(0.4)
    expect(audio.gainFor(0.3)).toBeCloseTo(0.15)
    audio.setVolume(1)
    expect(audio.gainFor(0.35)).toBeCloseTo(0.35)
    audio.setSoundMuted(true)
    expect(audio.gainFor(0.8)).toBe(0)
    audio.setSoundMuted(false)
    audio.setVolume(0)
    expect(audio.gainFor(0.8)).toBe(0)
  })

  it('keeps the result a valid element volume (0..1) for any per-sound gain', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(1)
    expect(audio.gainFor(1.5)).toBe(1)
    expect(audio.gainFor(-0.2)).toBe(0)
    expect(audio.gainFor(Number.NaN)).toBe(0)
  })

  it('an element that follows the master gain changes level live as the slider moves and on mute', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(0.4)
    const music = { volume: 1 }
    const stop = followMasterGain(music, 0.35)
    expect(music.volume).toBeCloseTo(0.14)
    audio.moveVolumeSlider(1)
    expect(music.volume).toBeCloseTo(0.35)
    audio.moveVolumeSlider(0)
    expect(music.volume).toBe(0)
    audio.moveVolumeSlider(0.6)
    expect(music.volume).toBeCloseTo(0.21)
    audio.setSoundMuted(true)
    expect(music.volume).toBe(0)
    stop()
    audio.setSoundMuted(false)
    expect(music.volume).toBe(0)
  })
})

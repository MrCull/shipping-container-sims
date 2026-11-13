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
    expect(audio.gainFor(0.8, 'sfx')).toBeCloseTo(0.4)
    expect(audio.gainFor(0.3, 'sfx')).toBeCloseTo(0.15)
    audio.setVolume(1)
    expect(audio.gainFor(0.35, 'sfx')).toBeCloseTo(0.35)
    audio.setSoundMuted(true)
    expect(audio.gainFor(0.8, 'sfx')).toBe(0)
    audio.setSoundMuted(false)
    audio.setVolume(0)
    expect(audio.gainFor(0.8, 'sfx')).toBe(0)
  })

  it('keeps the result a valid element volume (0..1) for any per-sound gain', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(1)
    expect(audio.gainFor(1.5, 'sfx')).toBe(1)
    expect(audio.gainFor(-0.2, 'sfx')).toBe(0)
    expect(audio.gainFor(Number.NaN, 'sfx')).toBe(0)
  })

  it('an element that follows the master gain changes level live as the slider moves and on mute', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(0.4)
    const music = { volume: 1 }
    const stop = followMasterGain(music, 0.35, 'music')
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

describe('separate music and effects levels under one mute', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults both channels to full, so they play at the master gain', () => {
    stubStorage()
    const audio = fresh()
    expect(audio.musicVolume).toBe(1)
    expect(audio.sfxVolume).toBe(1)
    expect(audio.gainFor(0.5, 'music')).toBeCloseTo(0.2)
    expect(audio.gainFor(0.5, 'sfx')).toBeCloseTo(0.2)
  })

  it('scales each channel independently, and mute silences both', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(0.8)
    audio.setMusicVolume(0.25)
    audio.setSfxVolume(0.5)
    expect(audio.musicGain).toBeCloseTo(0.2)
    expect(audio.sfxGain).toBeCloseTo(0.4)
    expect(audio.gainFor(1, 'music')).toBeCloseTo(0.2)
    expect(audio.gainFor(1, 'sfx')).toBeCloseTo(0.4)
    audio.setMusicVolume(0)
    expect(audio.gainFor(1, 'music')).toBe(0)
    expect(audio.gainFor(1, 'sfx')).toBeCloseTo(0.4)
    audio.setSoundMuted(true)
    expect(audio.musicGain).toBe(0)
    expect(audio.sfxGain).toBe(0)
  })

  it('clamps channel levels, persists them, and ignores bad stored values', () => {
    stubStorage()
    const a = fresh()
    a.setMusicVolume(2)
    a.setSfxVolume(Number.NaN)
    expect(a.musicVolume).toBe(1)
    expect(a.sfxVolume).toBe(0)
    a.setMusicVolume(0.3)
    a.setSfxVolume(0.6)
    const b = fresh()
    expect(b.musicVolume).toBeCloseTo(0.3)
    expect(b.sfxVolume).toBeCloseTo(0.6)

    stubStorage({ [KEY]: JSON.stringify({ version: 1, global: { soundMuted: false, volume: 0.5, musicVolume: 'x', sfxVolume: 7 }, sims: {} }) })
    const c = fresh()
    expect(c.musicVolume).toBe(1)
    expect(c.sfxVolume).toBe(1)
  })

  it('moving a channel slider unmutes', () => {
    stubStorage()
    const audio = fresh()
    audio.setSoundMuted(true)
    audio.moveMusicSlider(0.5)
    expect(audio.soundMuted).toBe(false)
    audio.setSoundMuted(true)
    audio.moveSfxSlider(0.5)
    expect(audio.soundMuted).toBe(false)
  })

  it('a following element tracks only its own channel', () => {
    stubStorage()
    const audio = fresh()
    audio.setVolume(1)
    const music = { volume: 1 }
    const voice = { volume: 1 }
    const stopMusic = followMasterGain(music, 0.5, 'music')
    const stopVoice = followMasterGain(voice, 0.5, 'sfx')
    audio.moveMusicSlider(0.2)
    expect(music.volume).toBeCloseTo(0.1)
    expect(voice.volume).toBeCloseTo(0.5)
    audio.moveSfxSlider(0)
    expect(music.volume).toBeCloseTo(0.1)
    expect(voice.volume).toBe(0)
    stopMusic()
    stopVoice()
  })
})

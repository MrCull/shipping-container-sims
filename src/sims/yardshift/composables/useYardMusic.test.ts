// @vitest-environment happy-dom
/**
 * Yardshift music wiring (#390, moved here from a browser smoke spec in #391): `useYardMusic` makes one looping
 * track on the shared `'music'` channel, silent on the intro, playing once the shift starts, following the music
 * slider and mute live, pausing with the pause menu and stopping on unmount. `Audio` is a recording fake; the
 * play/pause rules themselves are in modules/music.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAudioStore } from '@/stores/audio'
import { useYardshiftStore } from '../store/yardshiftStore'
import { MUSIC_GAIN } from '../modules/music'
import { useYardMusic } from './useYardMusic'

class FakeAudio {
  static made: FakeAudio[] = []
  volume = 1
  loop = false
  paused = true
  constructor(public src: string) {
    FakeAudio.made.push(this)
  }
  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  removeAttribute(): void {}
  load(): void {}
}

describe('useYardMusic', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    FakeAudio.made = []
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loops on the music channel, follows the shift and the sliders, and stops on unmount', async () => {
    const store = useYardshiftStore()
    const audio = useAudioStore()
    store.loadLevel(1, { intro: true })
    const wrapper = mount(defineComponent({ setup: () => useYardMusic(() => store.state), render: () => null }))
    const [music] = FakeAudio.made
    expect(FakeAudio.made).toHaveLength(1)
    expect(music!.loop).toBe(true)
    expect(music!.paused).toBe(true)

    store.startShift()
    await nextTick()
    expect(music!.paused).toBe(false)

    audio.setVolume(1)
    audio.setMusicVolume(0.5)
    expect(music!.volume).toBeCloseTo(0.5 * MUSIC_GAIN)
    audio.setSoundMuted(true)
    expect(music!.volume).toBe(0)
    audio.setSoundMuted(false)
    expect(music!.volume).toBeCloseTo(0.5 * MUSIC_GAIN)

    store.pause()
    await nextTick()
    expect(music!.paused).toBe(true)
    store.resume()
    await nextTick()
    expect(music!.paused).toBe(false)

    wrapper.unmount()
    expect(music!.paused).toBe(true)
  })
})

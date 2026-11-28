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

const Host = defineComponent({
  props: { store: { type: Object, required: true } },
  setup: (props) => useYardMusic(() => (props.store as ReturnType<typeof useYardshiftStore>).state),
  render: () => null,
})

function mountMusic(store: ReturnType<typeof useYardshiftStore>) {
  return mount(Host, { props: { store } })
}

describe('useYardMusic', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
    FakeAudio.made = []
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('loops on the music channel, follows the shift and the sliders, and stops on unmount', async () => {
    const store = useYardshiftStore()
    const audio = useAudioStore()
    store.loadLevel(1, { intro: true })
    const wrapper = mountMusic(store)
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

  it('unmutes for the visit (owner round 5) without writing the stored mute, and leaving restores it', async () => {
    const store = useYardshiftStore()
    const audio = useAudioStore()
    audio.setSoundMuted(true)
    store.loadLevel(1)
    const wrapper = mountMusic(store)
    const [music] = FakeAudio.made
    await nextTick()
    expect(audio.soundMuted).toBe(false)
    expect(music!.paused).toBe(false)
    expect(music!.volume).toBeGreaterThan(0)
    wrapper.unmount()
    expect(audio.soundMuted).toBe(true)
  })

  it('a mute the player chooses inside Yardshift is kept after leaving', () => {
    const store = useYardshiftStore()
    const audio = useAudioStore()
    store.loadLevel(1)
    const wrapper = mountMusic(store)
    audio.toggleSound()
    wrapper.unmount()
    expect(audio.soundMuted).toBe(true)
  })
})

import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { loadSiteStorage, updateSiteStorage } from '@/utils/localStorage'
import type { SiteStorageGlobalSettings } from '@/types/local-storage'

/**
 * Which level a sound follows: `music` (background tracks) or `sfx` (effects, ambience and voice). Each has its own
 * slider under the master volume; one mute silences both.
 */
export type AudioChannel = 'music' | 'sfx'

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export const useAudioStore = defineStore('audio', () => {
  const persistedStorage = loadSiteStorage()
  const soundMuted = ref(persistedStorage.global.soundMuted)

  function persistSoundMuted(): void {
    updateSiteStorage(storage => ({
      ...storage,
      global: {
        ...storage.global,
        soundMuted: soundMuted.value,
      },
    }))
  }

  function persistGlobal(patch: Partial<SiteStorageGlobalSettings>): void {
    updateSiteStorage(storage => ({
      ...storage,
      global: { ...storage.global, ...patch },
    }))
  }

  const volume = ref(persistedStorage.global.volume)
  /** Music level 0..1 relative to the master volume. */
  const musicVolume = ref(persistedStorage.global.musicVolume)
  /** Sound-effects level 0..1 relative to the master volume (effects, ambience, voice). */
  const sfxVolume = ref(persistedStorage.global.sfxVolume)
  /** The master gain every sim's playback is scaled by: 0 while muted. */
  const masterGain = computed(() => (soundMuted.value ? 0 : volume.value))
  /** Master gain times the music level: what background music plays at. */
  const musicGain = computed(() => masterGain.value * musicVolume.value)
  /** Master gain times the effects level: what sound effects play at. */
  const sfxGain = computed(() => masterGain.value * sfxVolume.value)

  function channelGain(channel: AudioChannel): number {
    return channel === 'music' ? musicGain.value : sfxGain.value
  }

  /** A sound's own gain (its level at full volume) scaled by its channel's gain, as a valid element volume (0..1). */
  function gainFor(soundGain: number, channel: AudioChannel): number {
    return scaleGain(soundGain, channelGain(channel))
  }

  function setVolume(value: number): void {
    volume.value = clamp01(value)
    persistGlobal({ volume: volume.value })
  }

  function setMusicVolume(value: number): void {
    musicVolume.value = clamp01(value)
    persistGlobal({ musicVolume: musicVolume.value })
  }

  function setSfxVolume(value: number): void {
    sfxVolume.value = clamp01(value)
    persistGlobal({ sfxVolume: sfxVolume.value })
  }

  function setSoundMuted(value: boolean): void {
    soundMuted.value = value
    persistSoundMuted()
  }

  /** Mute or unmute for this page only, without writing the stored choice (a forced mute must not outlive the tab). */
  function setSoundMutedTransient(value: boolean): void {
    soundMuted.value = value
  }

  /** Any movement of the volume slider means "I want to hear it": it unmutes. */
  function moveVolumeSlider(value: number): void {
    setVolume(value)
    if (soundMuted.value) setSoundMuted(false)
  }

  /** Moving the music slider also unmutes, like the master slider. */
  function moveMusicSlider(value: number): void {
    setMusicVolume(value)
    if (soundMuted.value) setSoundMuted(false)
  }

  /** Moving the effects slider also unmutes, like the master slider. */
  function moveSfxSlider(value: number): void {
    setSfxVolume(value)
    if (soundMuted.value) setSoundMuted(false)
  }

  function toggleSound(): void {
    setSoundMuted(!soundMuted.value)
  }

  // Compatibility aliases keep existing sim audio logic working while using one global mute flag.
  const musicMuted = computed(() => soundMuted.value)
  const sfxMuted = computed(() => soundMuted.value)
  const menuMusicMuted = computed(() => soundMuted.value)
  const gameMusicMuted = computed(() => soundMuted.value)
  const backgroundMusicMuted = computed(() => soundMuted.value)
  const toggleMusic = toggleSound
  const toggleSfx = toggleSound
  const toggleMenuMusic = toggleSound
  const toggleGameMusic = toggleSound
  const toggleBackgroundMusic = toggleSound

  return {
    soundMuted,
    volume,
    musicVolume,
    sfxVolume,
    masterGain,
    musicGain,
    sfxGain,
    gainFor,
    setVolume,
    setMusicVolume,
    setSfxVolume,
    moveMusicSlider,
    moveSfxSlider,
    setSoundMuted,
    setSoundMutedTransient,
    moveVolumeSlider,
    toggleSound,
    musicMuted,
    sfxMuted,
    toggleMusic,
    toggleSfx,
    menuMusicMuted,
    gameMusicMuted,
    backgroundMusicMuted,
    toggleMenuMusic,
    toggleGameMusic,
    toggleBackgroundMusic,
  }
})

/** Per-sound gain times master gain, clamped to 0..1 (0 for a non-finite input). */
export function scaleGain(soundGain: number, masterGain: number): number {
  const g = soundGain * masterGain
  return Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0
}

/**
 * Keep a playing element's volume at `soundGain` times its channel's gain, live: the sliders and mute apply to a
 * sound that is already playing (music, narration). Returns the stop handle; call it when the element is dropped.
 */
export function followMasterGain(element: { volume: number }, soundGain: number, channel: AudioChannel): WatchStopHandle {
  const audio = useAudioStore()
  return watch(
    () => audio.gainFor(soundGain, channel),
    (gain) => {
      element.volume = gain
    },
    { immediate: true, flush: 'sync' },
  )
}

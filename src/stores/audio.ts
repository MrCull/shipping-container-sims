import { defineStore } from 'pinia'
import { computed, ref, watch, type WatchStopHandle } from 'vue'
import { loadSiteStorage, updateSiteStorage } from '@/utils/localStorage'

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

  const volume = ref(persistedStorage.global.volume)
  /** The one gain every sim's playback is scaled by: 0 while muted. */
  const masterGain = computed(() => (soundMuted.value ? 0 : volume.value))

  /** A sound's own gain (its level at full volume) scaled by the master gain, as a valid element volume (0..1). */
  function gainFor(soundGain: number): number {
    return scaleGain(soundGain, masterGain.value)
  }

  function setVolume(value: number): void {
    volume.value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    updateSiteStorage(storage => ({
      ...storage,
      global: { ...storage.global, volume: volume.value },
    }))
  }

  function setSoundMuted(value: boolean): void {
    soundMuted.value = value
    persistSoundMuted()
  }

  /** Any movement of the volume slider means "I want to hear it": it unmutes. */
  function moveVolumeSlider(value: number): void {
    setVolume(value)
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
    masterGain,
    gainFor,
    setVolume,
    setSoundMuted,
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
 * Keep a playing element's volume at `soundGain` times the master gain, live: the slider and mute apply to music
 * that is already playing. Returns the stop handle; call it when the element is dropped.
 */
export function followMasterGain(element: { volume: number }, soundGain: number): WatchStopHandle {
  const audio = useAudioStore()
  return watch(
    () => audio.gainFor(soundGain),
    (gain) => {
      element.volume = gain
    },
    { immediate: true, flush: 'sync' },
  )
}

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
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
    setVolume,
    setSoundMuted,
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
